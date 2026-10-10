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

test('finish-scope：真实配置产出 8 条 warning，全是同侧面层重叠，无 error', () => {
  const result = runFinishScopeChecks(buildInput(), TODAY, loadFinishLintConfig());
  const errors = result.issues.filter((i) => i.level === 'error');
  const warnings = result.issues.filter((i) => i.level === 'warning');
  assert.equal(errors.length, 0, `不该有 error：${errors.map((e) => e.code).join(',')}`);
  assert.equal(warnings.length, 8, `应有 8 条同侧面层重叠 warning，实际 ${warnings.length}`);
  assert.equal(result.registryIssues.length, 0, '覆盖矩阵必须干净');
  // 8 条里 7 条漆压砖、1 条砖压砖
  const codes = warnings.map((w) => w.code);
  assert.ok(codes.every((c) => c === 'finish.wall_finish_overlap'), `只应有 wall_finish_overlap，实际 ${[...new Set(codes)].join(',')}`);
});

test('finish-scope：厨房烟机墙挡水砖是 C18 之后的 stale 声明，与整段正砖重叠 0.45㎡', () => {
  const result = runFinishScopeChecks(buildInput(), TODAY, loadFinishLintConfig());
  const kitchen = result.issues.find((i) => i.entity.includes('walltile_kitchen_ent_west') && i.entity.includes('walltile_kitchen_ent_hood_wall'));
  assert.ok(kitchen, '厨房东墙两条瓷砖声明必须互相重叠');
  assert.equal((kitchen.evidence as any).overlapAreaSqm, 0.45);
  assert.equal((kitchen.evidence as any).finishes[0], 'tile');
  assert.equal((kitchen.evidence as any).finishes[1], 'tile');
});

test('finish-scope：height 字段是顶面标高不是高度（回归测试）', () => {
  // walltile_gbath_east_vanity_splash: bottom 0.77 / height 1.10，reason 写「0.77 台面 → 1.10 镜柜下沿」
  // 若按 bottom+height 算成 [0.77,1.87]，竖向重叠会从 0.33 变 1.10——曾在这里算错。
  const result = runFinishScopeChecks(buildInput(), TODAY, loadFinishLintConfig());
  const splash = result.issues.find((i) => i.entity.includes('walltile_gbath_east_vanity_splash'));
  assert.ok(splash);
  assert.equal((splash.evidence as any).verticalOverlapM, 0.33, '竖向重叠应为 1.10-0.77=0.33，不是 1.10');
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

test('finish-scope：豁免命中后降为 info，不影响 error 计数', () => {
  const config = loadFinishLintConfig();
  const withWaiver = {
    ...config,
    waivers: [{
      id: 'w_mbath_east',
      rule: 'finish.wall_overlap',
      pair: ['walltile_mbath_east', 'paint_master_bath_w_mbath_east'] as [string, string],
      reason: '0.30m 砖带按桶吸收，待业主书面确认',
      owner: '业主',
      expires: '2099-01-01',
    }],
  };
  const result = runFinishScopeChecks(buildInput(), TODAY, withWaiver);
  const waived = result.issues.find((i) => i.entity.includes('walltile_mbath_east') && i.entity.includes('paint_master_bath_w_mbath_east'));
  assert.equal(waived?.level, 'info', '豁免命中必须降为 info');
  assert.equal((waived?.evidence as any).waivedBy, 'w_mbath_east');
  assert.equal(result.issues.filter((i) => i.level === 'warning').length, 7, '其余 7 条仍是 warning');
});

test('finish-scope：IMPLEMENTED_RULES 与配置互为镜像', () => {
  const config = loadFinishLintConfig();
  assert.equal(config.rules.length, IMPLEMENTED_RULES.length);
  for (const rule of IMPLEMENTED_RULES) {
    const declared = config.rules.find((r) => r.id === rule.id);
    assert.ok(declared, `规则 ${rule.id} 必须在配置申报`);
    for (const code of rule.codes) assert.ok(declared.codes.includes(code), `${rule.id} 的 ${code} 必须登记`);
  }
  assert.equal(FINISH_RULE_CODES.length, new Set(FINISH_RULE_CODES).size, 'code 不许重复');
});
