import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { resolveLayout } from '../../server/layout-resolver.js';
import { loadCeilingConfig } from '../../server/config-loader.js';
import {
  runFinishScopeChecks,
  loadFinishLintConfig,
  validateFinishRegistry,
  IMPLEMENTED_RULES,
  FINISH_RULE_CODES,
} from '../../shared/finish/registry.js';
import { validateFinishScope, type FinishScopeInput } from '../../shared/finish/rules.js';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const readYaml = (file: string): any => parseYaml(readFileSync(path.join(ROOT, file), 'utf8'));

function buildInput(tolerance = 0.01): FinishScopeInput {
  const MG = readYaml('config/layout/model-geometry.yaml');
  const OV = readYaml('config/layout/overlay.yaml');
  const layout = resolveLayout(MG);
  const elements: any[] = OV.elements ?? [];
  const vertexById = new Map((MG.vertices ?? []).map((v: any) => [v.id, v]));
  const walls: FinishScopeInput['walls'] = [];
  for (const element of elements) {
    if (element.type === 'paint_region') {
      walls.push({ id: element.id, wall: element.wall, room: element.room, along: [Math.min(...element.along), Math.max(...element.along)], bottom: element.bottom ?? 0, top: element.height ?? 2.8, finish: 'paint', type: element.type });
    } else if (element.type === 'wall_region' && /^walltile/.test(String(element.id))) {
      walls.push({ id: element.id, wall: element.wall, room: element.room, along: [Math.min(...element.along), Math.max(...element.along)], bottom: element.bottom ?? 0, top: element.height ?? 2.65, finish: 'tile', type: element.type });
    }
  }
  const sills: FinishScopeInput['sills'] = [];
  for (const element of elements) {
    if (element.type === 'paint_sill_region') sills.push({ id: element.id, element: element.element, room: element.room, faces: element.faces ?? [], finish: 'paint', type: element.type });
    else if (element.type === 'sill_region') sills.push({ id: element.id, element: element.element, room: element.room, faces: element.face ? [element.face] : [], finish: 'tile', type: element.type });
  }
  const rooms: FinishScopeInput['rooms'] = [];
  for (const raw of MG.rooms ?? []) {
    const points = (raw.boundary ?? []).map((id: string) => vertexById.get(id)).filter(Boolean) as Array<{ x: number; z: number }>;
    if (points.length >= 3) rooms.push({ id: raw.id, points });
  }
  const wallGeometry: FinishScopeInput['wallGeometry'] = {};
  for (const wall of layout.walls as any[]) {
    const polyline = wall.segments?.length ? wall.segments.map((s: any) => ({ x1: s.x1, z1: s.z1, x2: s.x2, z2: s.z2 })) : [{ x1: wall.x1, z1: wall.z1, x2: wall.x2, z2: wall.z2 }];
    wallGeometry[wall.id] = { id: wall.id, polyline, length: polyline.reduce((sum: number, s: any) => sum + Math.hypot(s.x2 - s.x1, s.z2 - s.z1), 0), suppressed: Boolean(wall.suppressed) };
  }
  return { walls, sills, rooms, wallGeometry, tolerance };
}

const TODAY = '2026-10-09';

test('finish-scope：砖漆互斥裁定后真实配置必须全干净（0 error / 0 warning）', () => {
  const result = runFinishScopeChecks(buildInput(), TODAY, loadFinishLintConfig());
  assert.deepEqual(result.issues, [], `砖漆互斥 + 不能悬空两条裁定落地后不应再有任何 issue，实际 ${JSON.stringify(result.issues)}`);
  assert.deepEqual(result.registryIssues, [], '覆盖矩阵必须干净');
});

test('finish-scope：C18 后的 stale 挡水条已删除，厨房东墙只剩整段正砖一条声明', () => {
  const input = buildInput();
  const kitchenTiles = input.walls.filter((w) => w.wall === 'w_ent_west' && w.finish === 'tile');
  assert.equal(kitchenTiles.length, 1, `厨房东墙应只剩 walltile_kitchen_ent_west 一条，实际 ${kitchenTiles.map((t) => t.id).join(',')}`);
  assert.equal(kitchenTiles[0].id, 'walltile_kitchen_ent_west');
  const result = runFinishScopeChecks(input, TODAY, loadFinishLintConfig());
  assert.deepEqual(result.issues, [], '删掉 stale 挡水条后厨房东墙不应再有重叠');
});

test('finish-scope：height 字段是顶面标高不是高度（回归测试）', () => {
  // walltile_gbath_east_vanity_splash: bottom 0.77 / height 1.10，reason 写「0.77 台面 → 1.10 镜柜下沿」
  // 若按 bottom+height 算成 [0.77,1.87]，竖向重叠会从 0.33 变 1.10——曾在这里算错。
  // DEC-2026-10-09-P07 后该处的漆声明已拆成上下两段、让出两条砖带，所以不再有 issue；
  // 这里改成直接钉 buildInput 解析出的竖向带，防止口径回退。
  const input = buildInput();
  const splash = input.walls.find((w) => w.id === 'walltile_gbath_east_vanity_splash');
  assert.ok(splash, '台盆防溅带声明必须存在');
  assert.equal(splash.bottom, 0.77);
  assert.equal(splash.top, 1.1, 'height 是顶面标高：top 必须等于 1.10，不是 0.77+1.10=1.87');
  const lower = input.walls.find((w) => w.id === 'paint_guest_bath_w_gbath_east_open_vanity_lower');
  const upper = input.walls.find((w) => w.id === 'paint_guest_bath_w_gbath_east_open_vanity_upper');
  assert.ok(lower && upper, '砖漆互斥后客卫开放洗漱区东墙必须拆成上下两段漆');
  assert.equal(lower.bottom, 0.30);
  assert.equal(lower.top, 0.77);
  assert.equal(upper.bottom, 1.10);
  assert.equal(upper.top, 2.80);
});

test('finish-scope：双面涂漆合法，跨房间不报', () => {
  const base = buildInput();
  const input: FinishScopeInput = {
    ...base,
    walls: [
      { id: 'p_a', wall: 'w_x', room: 'roomA', along: [0, 3], bottom: 0, top: 2.8, finish: 'paint', type: 'paint_region' },
      { id: 'p_b', wall: 'w_x', room: 'roomB', along: [0, 3], bottom: 0, top: 2.8, finish: 'paint', type: 'paint_region' },
    ],
    sills: [],
  };
  const issues = validateFinishScope(input);
  assert.equal(issues.filter((i) => i.code === 'finish.wall_finish_overlap').length, 0, '同一面墙两侧各属一个房间，双面涂漆合法');
  assert.equal(issues.filter((i) => i.code === 'finish.paint_duplicate_same_side').length, 0);
});

test('finish-scope：同房间同侧重复声明必须报', () => {
  const base = buildInput();
  const input: FinishScopeInput = {
    ...base,
    walls: [
      { id: 'p_a', wall: 'w_x', room: 'roomA', along: [0, 2], bottom: 0, top: 2.8, finish: 'paint', type: 'paint_region' },
      { id: 'p_b', wall: 'w_x', room: 'roomA', along: [1, 3], bottom: 0, top: 2.8, finish: 'paint', type: 'paint_region' },
    ],
    sills: [],
  };
  const issues = validateFinishScope(input);
  const dup = issues.filter((i) => i.code === 'finish.paint_duplicate_same_side');
  assert.equal(dup.length, 1);
  assert.equal((dup[0].evidence as any).overlapM, 1);
});

test('finish-scope：漆声明挂在别的房间上必须报（过道悬空的几何判据）', () => {
  const base = buildInput();
  const input: FinishScopeInput = {
    ...base,
    walls: [{ id: 'p_a', wall: 'w_balc_west', room: 'study', along: [0, 1.2], bottom: 0, top: 2.8, finish: 'paint', type: 'paint_region' }],
    sills: [],
  };
  const issues = validateFinishScope(input);
  const outside = issues.filter((i) => i.code === 'finish.paint_outside_room');
  assert.equal(outside.length, 1, 'along 端点不在 study 的 boundary 上必须报');
});

test('finish-scope：覆盖矩阵不许说谎', () => {
  const config = loadFinishLintConfig();
  assert.deepEqual(validateFinishRegistry(config), [], '真实配置必须干净');
  // 配置少申报一条 → 报错
  const missing = { ...config, rules: config.rules.filter((r) => r.id !== 'finish.wall_overlap') };
  assert.ok(validateFinishRegistry(missing).some((i) => i.code === 'finish.rule_undeclared'));
  // 配置多申报一条 → 报错
  const extra = { ...config, rules: [...config.rules, { id: 'finish.ghost', codes: ['finish.ghost_code'], kinds: 'x', severity: 'warning' as const, enabled: true }] };
  assert.ok(validateFinishRegistry(extra).some((i) => i.code === 'finish.rule_code_unknown'));
  // 豁免没 reason → 报错
  const liar = { ...config, waivers: [{ id: 'w1', rule: 'finish.wall_overlap', pair: ['a', 'b'] as [string, string], reason: '', owner: 'x', expires: '2099-01-01' }] };
  assert.ok(validateFinishRegistry(liar).some((i) => i.code === 'finish.waiver_missing_reason'));
  // 豁免到期 → 复活为 error
  const stale = { ...config, waivers: [{ id: 'w1', rule: 'finish.wall_overlap', pair: ['a', 'b'] as [string, string], reason: 'r', owner: 'x', expires: '2020-01-01' }] };
  assert.ok(validateFinishRegistry(stale).some((i) => i.code === 'finish.waiver_expired'));
});

test('finish-scope：豁免命中后降为 info（用合成输入，不依赖真实配置的 issue）', () => {
  const config = loadFinishLintConfig();
  const synthetic: FinishScopeInput = {
    ...buildInput(),
    walls: [{ id: 'p_x', wall: 'w_x', room: 'roomA', along: [0, 2], bottom: 0, top: 2.8, finish: 'paint', type: 'paint_region' },
            { id: 't_x', wall: 'w_x', room: 'roomA', along: [0, 1], bottom: 0, top: 0.3, finish: 'tile', type: 'wall_region' }],
    sills: [],
  };
  const withWaiver = {
    ...config,
    waivers: [{ id: 'w_x', rule: 'finish.wall_overlap', pair: ['p_x', 't_x'] as [string, string], reason: '测试豁免', owner: '测试', expires: '2099-01-01' }],
  };
  const result = runFinishScopeChecks(synthetic, TODAY, withWaiver);
  const hit = result.issues.find((i) => i.code === 'finish.wall_finish_overlap');
  assert.ok(hit, '合成输入必须产出一条重叠');
  assert.equal(hit.level, 'info', '豁免命中必须降为 info');
  assert.equal((hit.evidence as any).waivedBy, 'w_x');
  // 同一合成输入不加豁免 → 按配置 severity 下限升为 error
  const noWaiver = runFinishScopeChecks(synthetic, TODAY, config);
  assert.equal(noWaiver.issues[0].level, 'error', '砖漆互斥裁定后 F01 是 error');
});

// ── F05 顶面面层归属 ──────────────────────────────────────────────────────
const withCeilings = (over: Partial<FinishScopeInput>): FinishScopeInput => ({
  ...buildInput(),
  walls: [], sills: [],
  ceilings: [
    { id: 'cz_a', room: 'roomA', type: 'drop', area: [0, 0, 2, 2] },
    { id: 'cz_b', room: 'roomB', type: 'aluminum_buckle', area: [0, 0, 2, 2] },
    { id: 'cz_c', room: 'roomC', type: 'drop', area: [0, 0, 2, 2] },
  ],
  roomRects: [
    { id: 'roomA', x: 1, z: 1, width: 2, depth: 2 },
    { id: 'roomB', x: 1, z: 1, width: 2, depth: 2 },
    { id: 'roomC', x: 1, z: 1, width: 2, depth: 2 },
  ],
  ceilingPaintRooms: new Set(['roomA']),
  wallPaintRooms: new Set(['roomA', 'roomB', 'roomC']),
  ...over,
});

test('finish-scope F05：涂装范围内有石膏板吊顶却没登记顶面 → error（静默少算）', () => {
  const issues = validateFinishScope(withCeilings({}));
  const hits = issues.filter((i) => i.code === 'finish.ceiling_finish_unaccounted');
  assert.equal(hits.length, 1, `只应报 roomC，实际 ${hits.map((h) => h.entity).join(',')}`);
  assert.equal(hits[0].entity, 'roomC');
  assert.equal(hits[0].level, 'error');
  assert.equal((hits[0].evidence as any).footprintSqm, 4);
});

test('finish-scope F05：铝扣板整间的房间豁免（业主确认铝扣板不用刷漆）', () => {
  const issues = validateFinishScope(withCeilings({}));
  const roomB = issues.filter((i) => i.entity === 'roomB' && i.code === 'finish.ceiling_finish_unaccounted');
  assert.equal(roomB.length, 0, 'roomB 整间铝扣板，顶面本就不刷漆，不该报');
});

test('finish-scope F05：完全不在涂装范围的房间豁免（如入户花园开发商已做好）', () => {
  const issues = validateFinishScope(withCeilings({ wallPaintRooms: new Set(['roomA', 'roomB']) }));
  assert.equal(issues.filter((i) => i.code === 'finish.ceiling_finish_unaccounted').length, 0, 'roomC 无 paint_region → 不在涂装范围，不查');
});

test('finish-scope F06：铝扣板矩形越出房间 → error（扣减口径错）', () => {
  const issues = validateFinishScope(withCeilings({
    ceilings: [{ id: 'cz_bad', room: 'roomA', type: 'aluminum_buckle', area: [0, 0, 4, 4] }],
  }));
  const hits = issues.filter((i) => i.code === 'finish.buckle_zone_outside_room');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].entity, 'cz_bad');
  assert.equal((hits[0].evidence as any).outsideM, 4);
});

test('finish-scope F06：真实配置的铝扣板 zone 必须都整块落在自己房间里', () => {
  const result = runFinishScopeChecks(buildInput(), TODAY, loadFinishLintConfig());
  assert.deepEqual(result.issues.filter((i) => i.code.startsWith('finish.buckle_zone')), [], '厨房/主卫/客卫的铝扣板必须都在房间内');
});

test('finish-scope：IMPLEMENTED_RULES 与配置互为镜像', () => {
  const config = loadFinishLintConfig();
  assert.equal(config.rules.length, IMPLEMENTED_RULES.length, '配置申报数必须等于实现数（F01-F06 六条）');
  for (const rule of IMPLEMENTED_RULES) {
    const declared = config.rules.find((r) => r.id === rule.id);
    assert.ok(declared, `规则 ${rule.id} 必须在配置申报`);
    for (const code of rule.codes) assert.ok(declared.codes.includes(code), `${rule.id} 的 ${code} 必须登记`);
  }
  assert.equal(FINISH_RULE_CODES.length, new Set(FINISH_RULE_CODES).size, 'code 不许重复');
});
