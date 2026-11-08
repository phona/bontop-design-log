import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HvacAnchorSchema,
  HvacTerminalSchema,
  parseCeilingZones,
  parseElectricalPoints,
  parseProjectHvacFacts,
  validateProjectHvacFacts,
} from '../../shared/project-render-facts-schema.js';
import {
  LD_DECO_INTENTIONAL_BLANKS,
  HVAC_MEP_NODE_PARITY_PAIRS,
  lintHvacAccessOffsets,
  lintHvacLdDecoBandFill,
  lintHvacMepNodeParity,
  lintHvacTerminalCeilingBands,
  type HvacTerminalLintIssue,
} from '../../shared/hvac-terminal-lint.js';
import { parseMepCoordination } from '../../shared/mep-hvac-coordination-schema.js';
import type { CeilingZone, HvacDiagram, HvacTerminal, ProjectHvacFacts } from '../../shared/types.js';

/**
 * issue #98 第五阶段 S2（hvac 侧）固化测试：业主 2026-11-08 四项裁定的机器执法。
 *
 * 设计文档 tmp/capture/migration/phase5-survey.md：
 *   - 裁定一 → 「风口必须落在吊顶带内」对账检查（§4.5-S2 / §5.3 指标 5「terminal 在宿主带
 *     包络内」lint 结局）；access 检修口结构化 offset + 恒等断言（§4.2 access 行）。
 *     **验收铁律②：先证明现配置全绿，再变异证明会红**——本文件的 test 顺序按此编排。
 *   - 裁定二/三/四 → 改字不改值与标注类改动用快照钉住（谁再动坐标或翻回旧字词即红）。
 *   - 本文件只加断言；检查的单一实现住在 shared/hvac-terminal-lint.ts（validateProjectHvacFacts
 *     的加载期断言共用同一函数，不造第二套算法）。
 */

const electrical = parseElectricalPoints(readFileSync('config/electrical.yaml', 'utf8'));
const ceiling = parseCeilingZones(readFileSync('config/model/envelope/ceiling.yaml', 'utf8'));
const hvacFacts = parseProjectHvacFacts(readFileSync('config/hvac.yaml', 'utf8'));
const plan = hvacFacts.plans[0];
const diagram = plan.diagram;

const OPENING_SYSTEMS = new Set(['supply_air', 'return_air', 'access', 'decorative']);
const openings = diagram.terminals.filter((terminal) => terminal.kind !== 'condensate_drain_candidate');
const zoneById = new Map<string, CeilingZone>(ceiling.map((zone) => [zone.id, zone]));

function diagramWith(mutate: (draft: HvacDiagram) => HvacDiagram): HvacDiagram {
  return mutate({ ...diagram, anchors: [...diagram.anchors], terminals: [...diagram.terminals], routes: [...diagram.routes] });
}

function codesOf(issues: HvacTerminalLintIssue[]): string[] {
  return issues.map((entry) => entry.code);
}

// ─────────────────────────── 绿：现配置全绿（验收铁律②前半） ───────────────────────────

test('绿：25 个吊顶口全部落在宿主房间吊顶带内（裁定一，现配置实跑）', () => {
  assert.equal(openings.length, 25, '吊顶口（非冷凝候选 terminal）应为 25 个');
  assert.equal(diagram.terminals.length, 30, '30 个 terminal = 25 吊顶口 + 5 冷凝候选（候选是地面物理量，不参与本检查）');
  const issues = lintHvacTerminalCeilingBands({ terminals: diagram.terminals, ceiling, anchors: diagram.anchors, routes: diagram.routes });
  assert.deepEqual(issues, [], `现配置必须全绿，实际：${issues.map((entry) => entry.message).join('；')}`);
});

test('绿：检查确实覆盖全部 25 个口（整体位移探针 → 恰 25 条 error）', () => {
  // 位移量 +10m：足够把 25 个口都推出各自可达的吊顶带（+5 曾让 access_dining 落在
  // ceiling_living 内、deco 落进邻带——那是检查正确放行，不是漏检）。
  const displaced = diagram.terminals.map((terminal) => ({
    ...terminal,
    position: { ...terminal.position, x: terminal.position.x + 10.0 },
  }));
  const issues = lintHvacTerminalCeilingBands({ terminals: displaced, ceiling, anchors: diagram.anchors, routes: diagram.routes });
  assert.equal(issues.length, 25, '每个吊顶口都必须被检查覆盖：全部位移后必须恰 25 条 error');
  assert.ok(issues.every((entry) => entry.code === 'terminal_outside_ceiling_band'));
});

test('绿：宿主房间解析走既有声明（route 链 12 + serves_unit 3），无链路者退化为任意带', () => {
  const routeTargets = new Set(diagram.routes.filter((route) => route.system === 'supply_air' || route.system === 'return_air').map((route) => route.to));
  const supplyReturn = openings.filter((terminal) => terminal.system === 'supply_air' || terminal.system === 'return_air');
  assert.equal(supplyReturn.length, 14, 'supply/return 口应为 14 个（含 2 个底装第二出口）');
  for (const terminal of supplyReturn) {
    if (terminal.id === 'supply_living_bottom' || terminal.id === 'supply_dining_bottom') {
      // S2 撤下登记（编排侧裁定 2026-11-08）：底装第二出口补 route 的机械项撞
      // vrf-config.test.ts「每房每系统恰 1 条 route」不变量，且 §6.3-10（diagram 与 MEP
      // 的定位）未裁——本切片不补，宿主房间解析对这两个口退化为任意带粗检查。
      assert.ok(!routeTargets.has(terminal.id), `${terminal.id} 本切片不在任何 route 上（撤下登记，等 §6.3-10 裁定）`);
      continue;
    }
    assert.ok(routeTargets.has(terminal.id), `${terminal.id} 必须在某条 supply/return route 上（宿主房间由此解析）`);
  }
  const access = openings.filter((terminal) => terminal.system === 'access');
  assert.equal(access.length, 3);
  for (const terminal of access) assert.ok(zoneById.get(terminal.serves_unit!)?.room, `${terminal.id} 的宿主房间由 serves_unit 解析`);
  assert.equal(openings.filter((terminal) => terminal.kind === 'decorative_louver').length, 8, 'LD-deco 8 段');
});

test('绿：宿主房间限定真的生效——功能口漂进别家吊顶带也算红', () => {
  // supply_master 搬到 return_living 的位置：落在 ceiling_living（living_dining）带内，
  // 但宿主房间是 master_bedroom → 必须报 error（不是「任意带内即绿」）。
  const moved = diagram.terminals.map((terminal) => terminal.id === 'supply_master'
    ? { ...terminal, position: { ...terminal.position, x: 10.95, z: 4.725 } }
    : terminal);
  const issues = lintHvacTerminalCeilingBands({ terminals: moved, ceiling, anchors: diagram.anchors, routes: diagram.routes });
  assert.equal(codesOf(issues).filter((code) => code === 'terminal_outside_ceiling_band').length, 1);
  assert.match(issues[0]!.message, /master_bedroom/, '错误信息必须点名宿主房间');
});

test('绿：3 个 access 检修口 offset 恒等断言（offset == position − 宿主 position，容差 0.005m）', () => {
  const issues = lintHvacAccessOffsets({ terminals: diagram.terminals, ceiling });
  assert.deepEqual(issues, [], `offset 断言必须全绿，实际：${issues.map((entry) => entry.message).join('；')}`);
  // 声明值快照（业主 2026-11-08 实测：avoidance 三向不改）——谁改 offset 或宿主 position 都要过这道显形。
  const declared = new Map(diagram.terminals.filter((terminal) => terminal.system === 'access').map((terminal) => {
    const offset = (terminal as import('../../shared/hvac-terminal-lint.js').HvacTerminalWithOffset).offset!;
    return [terminal.id, `${offset.x},${offset.z}`];
  }));
  assert.deepEqual(declared, new Map([
    ['access_dining', '0,-0.05'],
    ['access_study', '-0.05,0'],
    ['access_child', '-0.15,0'],
  ]));
});

test('绿：validateProjectHvacFacts（加载期门禁）对现配置不抛——offset 断言与示意锚点规则在位', () => {
  validateProjectHvacFacts(hvacFacts, { electrical, ceiling });
});

test('绿：LD-deco 铺满 lint——4 行精确铺满 [7.20,13.40]，R18 两条有意空白显式登记', () => {
  const issues = lintHvacLdDecoBandFill({ terminals: diagram.terminals, ceiling });
  assert.deepEqual(issues, [], `铺满 lint 必须全绿，实际：${issues.map((entry) => entry.message).join('；')}`);
  // 例外登记快照（phase5-survey §3-7：两条底面行恰好铺满；侧面南 [13.2,13.4]、北 [7.2,7.7] 为 R18 有意空白）。
  assert.deepEqual(LD_DECO_INTENTIONAL_BLANKS.map((blank) => `${blank.mount_face}@${blank.z}:${blank.x1}-${blank.x2}`), [
    'north@4.3:7.2-7.7',
    'south@5.56:13.2-13.4',
  ]);
  // 铺满证据（A survey2 §C tiles band exactly 同口径）：两行底面行的装饰+功能段并集端点。
  const rowSegments = (z: number): Array<[number, number]> => diagram.terminals
    .filter((terminal) => terminal.mount_face === 'bottom' && Math.abs(terminal.position.z - z) < 1e-9)
    .map((terminal) => [terminal.position.x - terminal.length! / 2, terminal.position.x + terminal.length! / 2] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  for (const z of [5.125, 4.725]) {
    const segments = rowSegments(z);
    assert.equal(segments.length, 5, `z=${z} 行应有 5 段（2 功能 + 3 装饰）`);
    assert.ok(Math.abs(segments[0]![0] - 7.20) < 1e-9 && Math.abs(segments.at(-1)![1] - 13.40) < 1e-9, `z=${z} 行必须铺满 [7.20,13.40]`);
    for (let i = 1; i < segments.length; i += 1) {
      assert.ok(Math.abs(segments[i - 1]![1] - segments[i]![0]) < 1e-6, `z=${z} 行段间必须端点相接无缝无叠`);
    }
  }
});

// ─────────────────────────── 红：变异证明门禁会红（验收铁律②后半） ───────────────────────────

test('红：功能口漂出宿主吊顶带 → terminal_outside_ceiling_band', () => {
  const moved = diagram.terminals.map((terminal) => terminal.id === 'supply_master'
    ? { ...terminal, position: { ...terminal.position, x: 6.0, z: 7.0 } }
    : terminal);
  const issues = lintHvacTerminalCeilingBands({ terminals: moved, ceiling, anchors: diagram.anchors, routes: diagram.routes });
  assert.deepEqual(codesOf(issues), ['terminal_outside_ceiling_band']);
  assert.equal(issues[0]!.terminalId, 'supply_master');
});

test('红：吊顶带自己动、口不动 → 一片红（phase5-survey 探针 D 的机制化）', () => {
  // 探针 D（A §3.3）：ceiling_living 南缘 5.55→改小时，terminals 不动、旧 lint 0→0。
  // 本检查建成后同样的漂移必须立刻显形。
  const shrunkCeiling = ceiling.map((zone) => zone.id === 'ceiling_living'
    ? { ...zone, area: [zone.area![0], zone.area![1], zone.area![2], 4.90] as [number, number, number, number] }
    : zone);
  const issues = lintHvacTerminalCeilingBands({ terminals: diagram.terminals, ceiling: shrunkCeiling, anchors: diagram.anchors, routes: diagram.routes });
  const outside = issues.filter((entry) => entry.code === 'terminal_outside_ceiling_band');
  assert.ok(outside.length >= 5, `带南缘收缩后 z>4.90 的口必须全部报错，实际 ${outside.length} 条`);
  assert.ok(outside.some((entry) => entry.terminalId === 'supply_living'), 'supply_living（z=5.56）必须点名');
  assert.ok(outside.some((entry) => entry.terminalId === 'supply_living_bottom'), 'supply_living_bottom（z=5.125）必须点名');
});

test('红：access position 漂移而 offset 未跟 → access_offset_mismatch，validate 加载期即抛', () => {
  const drifted = diagram.terminals.map((terminal) => terminal.id === 'access_dining'
    ? { ...terminal, position: { ...terminal.position, z: terminal.position.z + 0.02 } }
    : terminal);
  const issues = lintHvacAccessOffsets({ terminals: drifted, ceiling });
  assert.equal(codesOf(issues).filter((code) => code === 'access_offset_mismatch').length, 1, '0.02 > 0.005 容差，必须报');
  const driftedFacts = { ...hvacFacts, plans: [{ ...plan, diagram: diagramWith((draft) => ({ ...draft, terminals: drifted })) }] } as unknown as ProjectHvacFacts;
  assert.throws(() => validateProjectHvacFacts(driftedFacts, { electrical, ceiling }), /access offset 对账失败/);
});

test('红：缺 offset 在 validate 层拒绝（schema 管结构、validate 管完整性），offset 用在非 access / 缺宿主在 schema 拒绝', () => {
  // 分层：schema 只管结构（offset ⟹ access 且与 serves_unit 成对）；「access 必须声明
  // offset」是完整性规则，与 serves_unit 存在性校验同住 validateProjectHvacFacts
  // （断言需要 ceiling 宿主坐标，schema 只有 id 字符串）。
  const accessStudy = diagram.terminals.find((terminal) => terminal.id === 'access_study')!;
  const noOffset = { ...accessStudy } as Record<string, unknown>;
  delete noOffset.offset;
  assert.doesNotThrow(() => HvacTerminalSchema.parse(noOffset), 'schema 层不拒绝缺 offset（完整性规则在 validate）');
  const noServes = { ...accessStudy } as Record<string, unknown>;
  delete noServes.serves_unit;
  assert.throws(() => HvacTerminalSchema.parse(noServes), /必须声明 serves_unit/);
  const supplyMaster = diagram.terminals.find((terminal) => terminal.id === 'supply_master')!;
  assert.throws(() => HvacTerminalSchema.parse({ ...supplyMaster, offset: { x: 0.1, z: 0 } }), /offset 仅限 system=access/);
  assert.throws(() => HvacTerminalSchema.parse({ ...supplyMaster, offset: { x: 0.1, z: 0 }, serves_unit: 'ac_master' }), /offset 必须与 serves_unit.*成对声明|offset 仅限 system=access/);
  // lint 侧同一事实（validate 走同一函数）：缺 offset 报 access_offset_missing → validate 抛。
  const missing = lintHvacAccessOffsets({ terminals: [noOffset as unknown as HvacTerminal], ceiling });
  assert.deepEqual(codesOf(missing), ['access_offset_missing']);
  const noOffsetFacts = { ...hvacFacts, plans: [{ ...plan, diagram: diagramWith((draft) => ({ ...draft, terminals: draft.terminals.map((terminal) => terminal.id === 'access_study' ? (noOffset as unknown as HvacTerminal) : terminal) })) }] } as unknown as ProjectHvacFacts;
  assert.throws(() => validateProjectHvacFacts(noOffsetFacts, { electrical, ceiling }), /access 检修口 access_study 未声明结构化 offset/);
});

test('红：LD-deco 缝隙与重叠各报一条', () => {
  const withGap = diagram.terminals.map((terminal) => terminal.id === 'LD-deco-return-mid'
    ? { ...terminal, length: 0.30 }
    : terminal);
  const gapIssues = lintHvacLdDecoBandFill({ terminals: withGap, ceiling });
  assert.ok(codesOf(gapIssues).includes('ld_deco_row_gap'), `缩短中段必须报缝隙：${JSON.stringify(gapIssues)}`);
  const withOverlap = diagram.terminals.map((terminal) => terminal.id === 'LD-deco-return-mid'
    ? { ...terminal, length: 0.40 }
    : terminal);
  const overlapIssues = lintHvacLdDecoBandFill({ terminals: withOverlap, ceiling });
  assert.ok(codesOf(overlapIssues).includes('ld_deco_row_overlap'), `加宽中段必须报重叠：${JSON.stringify(overlapIssues)}`);
});

test('红：把 R18 有意空白堵上 → ld_deco_row_fills_intentional_blank（反向执法）', () => {
  const blankFiller: HvacTerminal = {
    id: 'LD-deco-probe-blank-filler',
    status: 'pending',
    system: 'decorative',
    position: { x: 7.45, y: 2.65, z: 4.30 },
    mount_face: 'north',
    length: 0.5,
    kind: 'decorative_louver',
    confirmed: false,
    render_interior: true,
    render_coordination: false,
    finish: 'matte_black',
    render_style: 'linear_slot',
    reason: '探针：企图用装饰段补 [7.20,7.70] 正交交接空白',
  };
  const issues = lintHvacLdDecoBandFill({ terminals: [...diagram.terminals, blankFiller], ceiling });
  assert.ok(codesOf(issues).includes('ld_deco_row_fills_intentional_blank'),
    `装饰段压进登记空白必须报错（不许为了铺满把有意空白堵上）：${JSON.stringify(issues)}`);
});

test('红：带边界与登记空白脱钩（band x1 漂移）→ 铺满判定立刻红', () => {
  const shiftedBand = ceiling.map((zone) => zone.id === 'ceiling_living'
    ? { ...zone, area: [7.00, zone.area![1], zone.area![2], zone.area![3]] as [number, number, number, number] }
    : zone);
  const issues = lintHvacLdDecoBandFill({ terminals: diagram.terminals, ceiling: shiftedBand });
  assert.ok(codesOf(issues).some((code) => code === 'ld_deco_row_gap'),
    `带边界移动而段与空白不动，必须报缝隙：${JSON.stringify(issues)}`);
});

// ─────────────────────────── 快照钉住（裁定二/三/四 + 机械项） ───────────────────────────

test('钉：25 个吊顶口与 5 个冷凝候选坐标零变化（S2 不动坐标；唯一例外 branch_dining y）', () => {
  // 接触对象逐点位快照：offset 只加关系声明，position 一字不动（裁定一）。
  const pins: Array<[string, [number, number, number]]> = [
    ['access_dining', [8.00, 2.49, 4.70]],
    ['access_study', [15.05, 2.49, 5.85]],
    ['access_child', [4.25, 2.49, 4.0]],
    ['return_parent', [6.5, 2.49, 6.15]],
    ['supply_master', [3.70, 2.62, 5.585]],
    ['supply_living', [11.45, 2.65, 5.56]],
    ['LD-deco-side-north', [11.55, 2.65, 4.30]],
  ];
  for (const [id, expected] of pins) {
    const terminal = diagram.terminals.find((item) => item.id === id);
    assert.ok(terminal, `缺少 ${id}`);
    assert.deepEqual([terminal.position.x, terminal.position.y, terminal.position.z], expected, `${id} 的 position 在 S2 不得变化`);
  }
  // 散文改字对象里的 anchor（冷凝出口候选住 anchors 不住 terminals）——坐标原样。
  const diningCandidate = diagram.anchors.find((anchor) => anchor.id === 'condensate_dining_outlet_candidate')!;
  assert.ok(diningCandidate, '缺少 condensate_dining_outlet_candidate');
  assert.deepEqual([diningCandidate.position!.x, diningCandidate.position!.y, diningCandidate.position!.z], [7.6, 2.52, 4.34],
    'condensate_dining_outlet_candidate 的 position 在改字时不得变化');
});

test('钉：branch_dining 对齐 MEP 2.6（裁定三），x/z 未动；其余 4 个 branch 位置一个不动（裁定四）', () => {
  const dining = diagram.anchors.find((anchor) => anchor.id === 'branch_dining')!;
  assert.deepEqual([dining.position!.x, dining.position!.y, dining.position!.z], [8.0, 2.6, 4.3],
    'branch_dining y 2.55→2.6 是 S2 唯一坐标改动（DEC-2026-10-06-R5 明文 A 区冷媒 2.60）');
  assert.equal((dining as import('../../shared/hvac-terminal-lint.js').HvacAnchorWithSchematicOnly).schematic_only, undefined,
    'branch_dining 自称沿用 MEP 节点，不打示意标（走对齐路径）');
  const pins: Array<[string, [number, number, number]]> = [
    ['branch_master', [4.2, 2.5, 4.6]],
    ['branch_study', [13.6, 2.5, 5.85]],
    ['branch_parent', [5.5, 2.5, 6.2]],
    ['branch_child', [4.0, 2.5, 3.9]],
  ];
  for (const [id, expected] of pins) {
    const anchor = diagram.anchors.find((item) => item.id === id)!;
    assert.deepEqual([anchor.position!.x, anchor.position!.y, anchor.position!.z], expected, `${id} 位置不动（裁定四）`);
    assert.equal((anchor as import('../../shared/hvac-terminal-lint.js').HvacAnchorWithSchematicOnly).schematic_only, true, `${id} 必须 schematic_only`);
    assert.match(anchor.reason!, /不参与几何\/不放线/, `${id} 的 reason 必须写明示意语义`);
  }
  const schematicIds = diagram.anchors.filter((anchor) => (anchor as import('../../shared/hvac-terminal-lint.js').HvacAnchorWithSchematicOnly).schematic_only === true).map((anchor) => anchor.id).sort();
  assert.deepEqual(schematicIds, ['branch_child', 'branch_master', 'branch_parent', 'branch_study'],
    'schematic_only 集合快照：扩展或收缩都是评审事件');
});

test('钉：route.to 指向示意锚点在 validate 拒绝（示意锚点不放线）', () => {
  const misused = diagramWith((draft) => ({
    ...draft,
    routes: draft.routes.map((route) => route.id === 'refrigerant_master_branch' ? { ...route, to: 'branch_master' } : route),
  }));
  const misusedFacts = { ...hvacFacts, plans: [{ ...plan, diagram: misused }] } as unknown as ProjectHvacFacts;
  assert.throws(() => validateProjectHvacFacts(misusedFacts, { electrical, ceiling }), /指向 schematic_only 示意锚点/);
  assert.throws(() => HvacAnchorSchema.parse({
    id: 'branch_probe', status: 'confirmed', system: 'refrigerant', position: { x: 1, y: 2.5, z: 3 }, schematic_only: true, reason: 'x',
  }), /schematic_only 锚点只能是 inferred 态/);
});

test('钉：route 总数 33 不变——底装第二出口补 route 已撤下（撞「每房每系统恰 1 条 route」不变量 + §6.3-10 未裁）', () => {
  // 撤下登记（编排侧裁定 2026-11-08）：任务书第 5 项「hvac routes 补 2 条底送 route」原以为是
  // 机械项，实作撞上 tests/server/vrf-config.test.ts:39 钉住的不变量「每房每系统恰 1 条
  // route」——放宽该断言需业主评审（CI 基线纪律同源），且 §6.3-10（hvac diagram 与 MEP 的
  // 定位）本就未裁，未裁前往示意图加路线 = 把未裁口径写进数据。本测试把撤下后的状态钉住：
  // 谁要补这两条 route，必须显式改本断言并带上业主对 §6.3-10 的裁定。
  assert.equal(diagram.routes.length, 33, 'S2 撤下底送 route 后总数应维持 33');
  const targets = new Set(diagram.routes.filter((route) => route.system === 'supply_air' || route.system === 'return_air').map((route) => route.to));
  for (const id of ['supply_living_bottom', 'supply_dining_bottom']) {
    assert.ok(!targets.has(id), `${id} 不在任何 diagram route 上（撤下登记；MEP 侧 supply-air-*-bottom 不受影响）`);
  }
  const targetsFlat = [...targets];
  assert.deepEqual(targetsFlat.sort(), [...new Set(targetsFlat)].sort(), 'supply/return route 终点不得重复');
});

test('钉：3 处散文改字不改值（裁定二）——方向词修正、坐标原样', () => {
  const diningCandidate = diagram.anchors.find((anchor) => anchor.id === 'condensate_dining_outlet_candidate')!;
  assert.match(diningCandidate.reason!, /北侧0\.41m/);
  assert.ok(!/南侧0\.41m/.test(diningCandidate.reason!), '旧方向词「南侧0.41m」必须删净（改字说明里的引注不算）');
  const returnParent = diagram.terminals.find((terminal) => terminal.id === 'return_parent')!;
  assert.match(returnParent.reason!, /南偏 0\.15m/);
  assert.ok(!/正下方（机身/.test(returnParent.reason!), '旧表述「正下方（机身 …）」必须删净——实测南偏 0.15');
  const accessDining = diagram.terminals.find((terminal) => terminal.id === 'access_dining')!;
  assert.match(accessDining.reason!, /北移 0\.05/);
  assert.ok(!/南移 0\.05/.test(accessDining.reason!), '旧表述「南移 0.05」必须删净——Δz=−0.05 为北');
});

// ───────── branch_dining ↔ MEP refrigerant-dining 跨文件 parity（验伪轮修复） ─────────
// 既有 junction↔anchor 等值断言只遍历 MEP junctions（全仓仅 condensate_living_dining_merge），
// branch_dining ↔ refrigerant-dining via 内联点之间原本无任何机器对账：变异 y→2.55 零红
// （独立验伪员 m2-dining255 实测，空转面）。本组测试补上双向 parity 门禁。

const mepConfig = parseMepCoordination(readFileSync('config/mep-hvac-coordination.yaml', 'utf8'));

test('绿：branch_dining 与 MEP refrigerant-dining via 节点跨文件逐位相等（裁定三 parity 门禁）', () => {
  const dining = diagram.anchors.find((anchor) => anchor.id === 'branch_dining')!;
  const node = mepConfig.routes.find((route) => route.id === 'refrigerant-dining')!.via[0]!;
  assert.deepEqual([dining.position!.x, dining.position!.y, dining.position!.z], [node.x, node.y, node.z],
    `branch_dining (${dining.position!.x},${dining.position!.y},${dining.position!.z}) 必须逐位等于 MEP via (${node.x},${node.y},${node.z})`);
  const issues = lintHvacMepNodeParity({ anchors: diagram.anchors, mepRoutes: mepConfig.routes });
  assert.deepEqual(issues, [], `parity 门禁必须全绿，实际：${issues.map((entry) => entry.message).join('；')}`);
});

test('红：hvac 侧 branch_dining y 漂移 2.6→2.55（验伪员主变异 m2-dining255 复刻）→ parity 红', () => {
  const drifted = diagram.anchors.map((anchor) => anchor.id === 'branch_dining'
    ? { ...anchor, position: { ...anchor.position!, y: 2.55 } }
    : anchor);
  const issues = lintHvacMepNodeParity({ anchors: drifted, mepRoutes: mepConfig.routes });
  assert.equal(codesOf(issues).filter((code) => code === 'mep_node_parity_mismatch').length, 1,
    `hvac 侧漂移必须红：${JSON.stringify(issues)}`);
  assert.match(issues[0]!.message, /y=2\.55 .* y=2\.6/);
});

test('红：MEP 侧 via y 漂移 2.6→2.55（负对照 m2-mepside 复刻，内存变异）→ 同一断言红', () => {
  const driftedMep = {
    ...mepConfig,
    routes: mepConfig.routes.map((route) => route.id === 'refrigerant-dining'
      ? { ...route, via: route.via.map((node, index) => index === 0 ? { ...node, y: 2.55 } : node) }
      : route),
  };
  const issues = lintHvacMepNodeParity({ anchors: diagram.anchors, mepRoutes: driftedMep.routes });
  assert.equal(codesOf(issues).filter((code) => code === 'mep_node_parity_mismatch').length, 1,
    `MEP 侧漂移必须红（同一门禁双向执法）：${JSON.stringify(issues)}`);
});

test('钉：parity 对账表快照——只登记裁定三认定的同源对，扩展/收缩都是评审事件', () => {
  // 其余 4 个 branch_* 是 schematic_only 示意（裁定四），MEP 不引用它们，不做 parity；
  // 22 条 diagram route 全量对齐 MEP 属 §6.3-10 未裁口径，不许顺手扩表。
  assert.deepEqual(HVAC_MEP_NODE_PARITY_PAIRS.map((pair) => `${pair.anchorId}↔${pair.mepRouteId}:via[${pair.viaIndex}]`), [
    'branch_dining↔refrigerant-dining:via[0]',
  ]);
});
