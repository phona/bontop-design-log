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
import { validateFinishScope, type FinishScopeInput, type FinishSceneMesh } from '../../shared/finish/rules.js';
import { collectFinishSceneMeshes } from '../../shared/finish/scene.js';
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
  const ceilings: FinishScopeInput['ceilings'] = [];
  const roomRects: FinishScopeInput['roomRects'] = [];
  const ceilingPaintRooms = new Set<string>();
  const openings: FinishScopeInput['openings'] = [];
  for (const element of elements) {
    if (element.type === 'paint_ceiling_region') ceilingPaintRooms.add(element.room);
  }
  const scene = collectFinishSceneMeshes(layout);
  return { walls, sills, rooms, wallGeometry, ceilings, roomRects, ceilingPaintRooms, openings, sceneMeshIds: scene.meshIds, sceneCeilingRooms: scene.ceilingRooms, sceneMeshes: scene.meshes, sceneBayOutlines: scene.bayOutlines, tolerance };
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

// ── 顶面涂装选择独立于墙面 ───────────────────────────────────────────────
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
  ...over,
});

test('有墙面漆而缺少 paint_ceiling_region 仍表示顶面未选，不推导为漏项', () => {
  const input = buildInput();
  assert.ok(input.walls.some((wall) => wall.room === 'main_corridor'), 'fixture 必须保留走廊墙面涂装');
  input.ceilingPaintRooms?.delete('main_corridor');
  assert.ok(!input.ceilingPaintRooms?.has('main_corridor'), 'fixture 必须移除走廊顶面涂装选择');
  const issues = validateFinishScope(input);
  assert.ok(
    !issues.some((issue) => issue.code === 'finish.ceiling_finish_unaccounted'),
    '墙面是否有 paint_region 不决定顶面是否涂装',
  );
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

test('finish-scope：厨房上飘窗已由漆改砖，sill_region 的 face 枚举必须含 underside', () => {
  const input = buildInput();
  const kitchen = input.sills.filter((s) => s.element === 'kitchen_north_bay');
  assert.equal(kitchen.length, 2, `厨房上飘窗应有 front + underside 两条瓷砖声明，实际 ${kitchen.map((k) => k.id).join(',')}`);
  assert.deepEqual(kitchen.map((k) => k.faces[0]).sort(), ['front', 'underside']);
  assert.ok(kitchen.every((k) => k.finish === 'tile'), '必须全是瓷砖，不是漆');
  // 同一 element 的 front 被漆和砖同时声明才会被 F02 抓；现在只剩砖，必须干净
  const result = runFinishScopeChecks(input, TODAY, loadFinishLintConfig());
  assert.deepEqual(result.issues, [], '厨房上飘窗改贴砖后不应有任何 issue');
});

// F08：声明必须附着在 3D 实体
test('finish-scope F08：真实配置的每个面层声明都附着在场景实体上', () => {
  const input = buildInput();
  assert.ok(input.sceneMeshIds && input.sceneMeshIds.size > 0, '场景必须采到网格');
  assert.ok(input.sceneCeilingRooms && input.sceneCeilingRooms.size > 0, '场景必须采到 ceiling 网格');
  const issues = validateFinishScope(input).filter((i) => i.code === 'finish.declaration_unattached');
  assert.deepEqual(issues, [], '不应有声明落空/飘空');
});

test('finish-scope F08：声明在场景里产不出网格 → error', () => {
  const input = buildInput();
  const orphan: FinishScopeInput = {
    ...input,
    walls: [{ id: 'paint_ghost_wall', wall: 'w_x', room: 'roomA', along: [0, 2], bottom: 0, top: 2.8, finish: 'paint', type: 'paint_region' }],
    sills: [{ id: 'silltile_ghost', element: 'ghost_bay', room: 'roomA', faces: ['front'], finish: 'tile', type: 'sill_region' }],
    sceneCeilingRooms: new Set<string>(),
    ceilingPaintRooms: new Set<string>(),
  };
  const issues = validateFinishScope(orphan).filter((i) => i.code === 'finish.declaration_unattached');
  assert.equal(issues.length, 2, '应报 2 条（墙 + 飘窗台），实际 ' + issues.length);
  assert.ok(issues.every((i) => i.level === 'error'));
  assert.ok(issues.some((i) => i.entity === 'paint_ghost_wall'));
  assert.ok(issues.some((i) => i.entity === 'silltile_ghost'));
});

test('finish-scope F08：声明了顶面漆但房间没有 ceiling 几何 → error', () => {
  const input = buildInput();
  const floating: FinishScopeInput = { ...input, walls: [], sills: [], sceneCeilingRooms: new Set<string>() };
  const issues = validateFinishScope(floating).filter((i) => i.code === 'finish.declaration_unattached');
  assert.ok(issues.length > 0, '7 间声明了顶面漆的房间应全部报飘空');
  assert.ok(issues.every((i) => String(i.entity).startsWith('paint_ceiling_')));
});

// DEC-2026-10-09-P14：弧墙上 sill_region 必须逐段出网并贴墙
test('finish-scope P14：弧墙上的 sill_region 逐段出网，objectId 带 :sN 且每块贴墙', () => {
  const input = buildInput();
  const ids = input.sceneMeshIds!;
  // mbath_north_waterproof_ledge 挂在 w_bath_north（r=1.0 圆角弧 + 直线），必须拆成多段
  const front = [...ids].filter((id) => id.startsWith('silltile_mbath_north_front'));
  const top = [...ids].filter((id) => id.startsWith('silltile_mbath_north_top'));
  assert.ok(front.length > 1, `front 应拆成多段，实际 ${front.length}`);
  assert.ok(top.length > 1, `top 应拆成多段，实际 ${top.length}`);
  assert.ok(front.every((id) => /^silltile_mbath_north_front:s\d+$/.test(id)), '分段 objectId 必须是 id:sN');
  assert.ok(top.every((id) => /^silltile_mbath_north_top:s\d+$/.test(id)), '分段 objectId 必须是 id:sN');
  // 直线墙上的声明仍应是单块（不无谓拆分）
  assert.ok(ids.has('silltile_living_south_front'), '直线墙上的 sill_region 保持单块');
  assert.ok(![...ids].some((id) => id.startsWith('silltile_living_south_front:s')), '直线墙不该拆');
  assert.ok(ids.has('silltile_mbath_west_lower_front'), '主卫西墙防水台（直墙）保持单块');
});

test('finish-scope：豁免到期后复活为 error（--today 可固定日期保证可复现）', () => {
  const config = loadFinishLintConfig();
  const stale = {
    ...config,
    waivers: [{ id: 'w_x', rule: 'finish.wall_overlap', pair: ['p_x', 't_x'] as [string, string], reason: '测试', owner: '测试', expires: '2020-01-01' }],
  };
  // 到期豁免必须先被 validateFinishRegistry 抓出来（复活为 error），再谈 applyFinishPolicy
  const registry = validateFinishRegistry(stale);
  assert.ok(registry.some((i) => i.code === 'finish.waiver_expired' && i.level === 'error'), '到期豁免必须复活为 error');
  // 未到期的豁免命中后降 info
  const fresh = { ...config, waivers: [{ id: 'w_x', rule: 'finish.wall_overlap', pair: ['p_x', 't_x'] as [string, string], reason: '测试', owner: '测试', expires: '2099-01-01' }] };
  const synthetic: FinishScopeInput = {
    ...buildInput(), walls: [], sills: [], sceneCeilingRooms: new Set<string>(), ceilingPaintRooms: new Set<string>(),
    walls2: undefined,
  } as any;
  synthetic.walls = [
    { id: 'p_x', wall: 'w_x', room: 'roomA', along: [0, 2], bottom: 0, top: 2.8, finish: 'paint', type: 'paint_region' },
    { id: 't_x', wall: 'w_x', room: 'roomA', along: [1, 3], bottom: 0, top: 2.8, finish: 'tile', type: 'wall_region' },
  ];
  const hit = runFinishScopeChecks(synthetic, '2099-01-01', fresh).issues.find((i) => i.code === 'finish.wall_finish_overlap');
  assert.equal(hit?.level, 'info', '未到期豁免命中必须降为 info');
  assert.equal((hit?.evidence as any).waivedBy, 'w_x');
});

test('finish-scope：IMPLEMENTED_RULES 与配置互为镜像', () => {
  const config = loadFinishLintConfig();
  assert.equal(config.rules.length, IMPLEMENTED_RULES.length, '配置申报数必须等于实现数（F01–F09 九条）');
  for (const rule of IMPLEMENTED_RULES) {
    const declared = config.rules.find((r) => r.id === rule.id);
    assert.ok(declared, `规则 ${rule.id} 必须在配置申报`);
    for (const code of rule.codes) assert.ok(declared.codes.includes(code), `${rule.id} 的 ${code} 必须登记`);
  }
  assert.equal(FINISH_RULE_CODES.length, new Set(FINISH_RULE_CODES).size, 'code 不许重复');
});

// ── F09 网格必须贴在墙面几何上（F08 查不出「网格存在但位置错了」）─────────────
const F09_CODES = ['finish.mesh_unattached', 'finish.mesh_unattached_unknown_anchor'];

/** 合成一块面层网格：只填判据要用的字段，其余照抄真实采集到的样子。 */
function syntheticMesh(over: Partial<FinishSceneMesh> & Pick<FinishSceneMesh, 'objectId' | 'centre'>): FinishSceneMesh {
  return { type: 'wall_region', ...over };
}

test('finish-scope F09：真实配置每块面层网格都贴在它的锚几何上（0 命中）', () => {
  const input = buildInput();
  const meshes = input.sceneMeshes!;
  assert.ok(meshes.length > 100, `场景必须采到上百块面层网格，实际 ${meshes.length}`);
  // 逐段出网的 objectId 必须被逐块判定（弧墙 sill_region 的 :sN）
  const split = meshes.filter((mesh) => /:s\d+$/.test(mesh.objectId));
  assert.ok(split.length > 10, `弧墙逐段出网的网格必须参与逐块判定，实际 ${split.length}`);
  const issues = validateFinishScope(input).filter((i) => F09_CODES.includes(i.code));
  assert.deepEqual(issues, [], `现有声明都贴着墙，不应有命中，实际 ${JSON.stringify(issues)}`);
});

test('finish-scope F09：objectId 会撞车，所以判据必须逐块遍历 sceneMeshes 而不是按 id 收敛', () => {
  // computePaintSillScope 的 start_end 与 end_end 都产 `${id}:${i}`，真实配置里
  // paint_master_bedroom_west_bay:0 被两块网格共用。按 objectId 建 Map 必然丢一块不判。
  const input = buildInput();
  const byId = new Map<string, number>();
  for (const mesh of input.sceneMeshes!) byId.set(mesh.objectId, (byId.get(mesh.objectId) ?? 0) + 1);
  const collisions = [...byId].filter(([, count]) => count > 1);
  assert.ok(collisions.length > 0, `真实配置里应当有 objectId 撞车（本次 ${JSON.stringify(collisions)}），否则这条测试失去守的不变量`);
  const centres = collectFinishSceneMeshes(resolveLayout(readYaml('config/layout/model-geometry.yaml'))).meshCentres;
  assert.ok(centres.size < input.sceneMeshes!.length, '按 id 收敛的中心表必须比逐块清单少——这就是不能用 Map 当判据输入的原因');
});

test('finish-scope F09：网格飘离墙面 >0.12m → error（弧墙弦中点那种 0.50m 悬空）', () => {
  const input = buildInput();
  const wall = input.wallGeometry.w_bath_north;
  assert.ok(wall && wall.polyline.length > 1, 'w_bath_north 必须是弧墙（多段折线）');
  // 全跨度 wall_region 挂在弧墙上：弦中点离真实墙面 0.50m（SceneBuilder 现算法的产物）
  const floating = syntheticMesh({
    objectId: 'walltile_probe_float',
    type: 'wall_region',
    wallId: 'w_bath_north',
    centre: { x: 1.3, z: 1.6 },
  });
  const issues = validateFinishScope({ ...input, sceneMeshes: [...input.sceneMeshes!, floating] })
    .filter((i) => i.code === 'finish.mesh_unattached');
  assert.equal(issues.length, 1, '合成飘空网格必须被抓到');
  assert.equal(issues[0].entity, 'walltile_probe_float');
  assert.equal(issues[0].level, 'error');
  assert.ok((issues[0].evidence as any).distanceM > 0.12, 'evidence 必须给出实测距离');
  assert.equal((issues[0].evidence as any).anchor, 'wall_polyline');
});

test('finish-scope F09：合法偏移不误报——漆面外偏移 0.068m、台面在 depth/2 处', () => {
  const input = buildInput();
  // 逐块复算：把判据反向往容差上靠，确认真实配置里最坏的情况也稳稳在 0.12m 内
  const worst = input.sceneMeshes!
    .filter((mesh) => mesh.type === 'paint_region')
    .map((mesh) => ({ id: mesh.objectId, d: distanceToPolylineFor(mesh, input) }))
    .sort((a, b) => b.d - a.d)[0];
  assert.ok(worst.d <= 0.12, `漆面最大偏移必须 ≤0.12m（PAINT_FACE_OFFSET=0.068），实际 ${worst.d}`);
  const issues = validateFinishScope(input).filter((i) => i.code === 'finish.mesh_unattached');
  assert.deepEqual(issues, [], '合法偏移不许误报');
});

/** 测试内复用的「中心到墙折线最近距离」，用来钉容差余量（不依赖被测代码）。 */
function distanceToPolylineFor(mesh: FinishSceneMesh, input: FinishScopeInput): number {
  const polyline = input.wallGeometry[mesh.wallId!]?.polyline ?? [];
  let best = Infinity;
  for (const segment of polyline) {
    const dx = segment.x2 - segment.x1, dz = segment.z2 - segment.z1;
    const lenSq = dx * dx + dz * dz;
    let t = lenSq <= 1e-12 ? 0 : ((mesh.centre.x - segment.x1) * dx + (mesh.centre.z - segment.z1) * dz) / lenSq;
    t = Math.min(1, Math.max(0, t));
    best = Math.min(best, Math.hypot(mesh.centre.x - (segment.x1 + dx * t), mesh.centre.z - (segment.z1 + dz * t)));
  }
  return best;
}

test('finish-scope F09：sill 类网格飘离 bay footprint → error，且判据是「到边界距离」不是 inPoly', () => {
  const input = buildInput();
  const outline = input.sceneBayOutlines!.get('kitchen_north_bay')!;
  assert.ok(outline.length >= 4, '厨房上飘窗 footprint 必须采到');
  const centre = { x: (Math.min(...outline.map((p) => p.x)) + Math.max(...outline.map((p) => p.x))) / 2, z: (Math.min(...outline.map((p) => p.z)) + Math.max(...outline.map((p) => p.z))) / 2 };
  const floating = syntheticMesh({
    objectId: 'silltile_probe_float_top',
    type: 'sill_region',
    kind: 'sill-top',
    elementId: 'kitchen_north_bay',
    wallId: 'w_kit_north',
    // 平移 2.5m：足够跳出 footprint（厨房上飘窗 3.6m×1.1m），又不会被别的 bay 吸收
    centre: { x: centre.x + 2.5, z: centre.z },
  });
  const issues = validateFinishScope({ ...input, sceneMeshes: [...input.sceneMeshes!, floating] })
    .filter((i) => i.code === 'finish.mesh_unattached');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].entity, 'silltile_probe_float_top');  assert.equal((issues[0].evidence as any).anchor, 'bay_footprint');
});

test('finish-scope F09：前缘面中心就在 footprint 边界上，距离法不许误报（探针曾误报 16 块）', () => {
  const input = buildInput();
  // 取一块真实 front 网格的中心，再取它所在 footprint 的一个顶点——顶点是最刁的边界点
  const front = input.sceneMeshes!.find((mesh) => mesh.type === 'paint_sill_region' && mesh.face === 'front');
  assert.ok(front, '场景里必须有 paint_sill_region 的 front 网格');
  const outline = input.sceneBayOutlines!.get(front.elementId!)!;
  const vertex = outline[0];
  const onBoundary = syntheticMesh({
    objectId: 'paint_probe_boundary',
    type: 'paint_sill_region',
    face: 'front',
    elementId: front.elementId,
    centre: { x: vertex.x, z: vertex.z },
  });
  const inside = syntheticMesh({
    objectId: 'paint_probe_inside',
    type: 'paint_sill_region',
    face: 'underside',
    elementId: front.elementId,
    centre: { x: vertex.x, z: vertex.z },
  });
  const issues = validateFinishScope({ ...input, sceneMeshes: [...input.sceneMeshes!, onBoundary, inside] })
    .filter((i) => i.code === 'finish.mesh_unattached');
  assert.deepEqual(issues, [], '边界点与内部点都不许误报——距离支覆盖边界，包含支覆盖内部');
});

test('finish-scope F09：拿不到锚不静默跳过 → finish.mesh_unattached_unknown_anchor（fail-closed）', () => {
  const input = buildInput();
  const noWall = syntheticMesh({ objectId: 'walltile_probe_no_wall', type: 'wall_region', centre: { x: 0, z: 0 } });
  const unknownWall = syntheticMesh({ objectId: 'walltile_probe_ghost_wall', type: 'wall_region', wallId: 'w_does_not_exist', centre: { x: 0, z: 0 } });
  const noElement = syntheticMesh({ objectId: 'silltile_probe_no_element', type: 'sill_region', kind: 'sill-top', wallId: 'w_kit_north', centre: { x: 0, z: 0 } });
  const ghostBay = syntheticMesh({ objectId: 'silltile_probe_ghost_bay', type: 'sill_region', kind: 'sill-underside', elementId: 'ghost_bay', wallId: 'w_kit_north', centre: { x: 0, z: 0 } });
  const oddKind = syntheticMesh({ objectId: 'walltile_probe_odd_kind', type: 'sill_region', kind: 'sill-what', wallId: 'w_kit_north', elementId: 'kitchen_north_bay', centre: { x: 0, z: 0 } });
  const issues = validateFinishScope({ ...input, sceneMeshes: [noWall, unknownWall, noElement, ghostBay, oddKind] })
    .filter((i) => i.code === 'finish.mesh_unattached_unknown_anchor');
  assert.equal(issues.length, 5, `五种缺锚情形都要显形，实际 ${issues.map((i) => i.entity).join(',')}`);
  assert.ok(issues.every((i) => i.level === 'error'));
});

test('finish-scope F09：没采集场景网格时不判（与 F08 一致，不造 issue）', () => {
  const input = { ...buildInput(), sceneMeshes: undefined };
  assert.deepEqual(validateFinishScope(input).filter((i) => F09_CODES.includes(i.code)), []);
});
