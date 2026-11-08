import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import {
  endpointSourcesFromFacts,
  parseMepCoordination,
  resolveMepEndpoint,
  resolveMepRoutes,
  type MepEndpointSources,
} from '../../shared/mep-hvac-coordination-schema.js';
import { lintMepCoordination } from '../../shared/mep-hvac-lint.js';
import { ElectricalPointSchema, parseCeilingZones, parseElectricalPoints, parsePlumbingPoints, parseProjectHvacFacts, validateProjectHvacFacts } from '../../shared/project-render-facts-schema.js';
import { pointMountHostIndex, pointWallIndexFromElements } from '../../shared/point-placement.js';
import { buildHvacBuilderSources, buildHvacEntityDescriptors, expectedHvacExportIds } from '../../shared/render/HvacBuilder.js';
import { buildScene } from '../../shared/render/SceneBuilder.js';
import { resolveLayout } from '../../server/layout-resolver.js';
import type { CeilingZone, ElectricalPoint, HvacDiagram, HvacTerminal, ProjectRenderFacts } from '../../shared/types.js';

/**
 * issue #98 第五阶段 S1（暖通机制层）探针固化 + E8 校验。
 *
 * 设计文档 tmp/capture/migration/phase5-survey.md §4.5-S1 验收铁律 ②：「探针 P1/P2/D 类漂移
 * 固化为测试（改 terminal/anchor 坐标 → 门禁必须红）」；P2 类须注明「迁移期断言」（M4）。
 * 本文件只加断言、不改任何配置数据；配置数据改动属 S2/S3。
 */

const electrical = parseElectricalPoints(readFileSync('config/electrical.yaml', 'utf8'));
const plumbing = parsePlumbingPoints(readFileSync('config/plumbing.yaml', 'utf8'));
const ceiling = parseCeilingZones(readFileSync('config/model/envelope/ceiling.yaml', 'utf8'));
const hvacFacts = parseProjectHvacFacts(readFileSync('config/hvac.yaml', 'utf8'));
const plan = hvacFacts.plans[0];
const diagram = plan.diagram;
const mepConfig = parseMepCoordination(readFileSync('config/mep-hvac-coordination.yaml', 'utf8'));
const pointWalls = pointWallIndexFromElements(
  resolveLayout(parseYaml(readFileSync('config/layout/model-geometry.yaml', 'utf8')) as Parameters<typeof resolveLayout>[0]).walls,
);
const house = parseYaml(readFileSync('config/house.yaml', 'utf8')) as { furnishings?: Record<string, Array<Record<string, unknown>>> };
const mountHosts = pointMountHostIndex(Object.values(house.furnishings ?? {}).flat() as never);

function sourcesOf(hvac: ProjectRenderFacts['hvac'] = hvacFacts, points: ElectricalPoint[] = electrical): MepEndpointSources {
  return endpointSourcesFromFacts({ electrical: points, plumbing, ceiling, hvac }, pointWalls, mountHosts);
}

/** 5 条 inline `to:` 抄 terminal xyz 的真双写点名（A §3.4 / B F1 两轨一致）。 */
const INLINE_TO_ROUTES = [
  { route: 'return-air-living', terminal: 'return_living' },
  { route: 'supply-air-dining', terminal: 'supply_dining' },
  { route: 'return-air-dining', terminal: 'return_dining' },
  { route: 'supply-air-living-bottom', terminal: 'supply_living_bottom' },
  { route: 'supply-air-dining-bottom', terminal: 'supply_dining_bottom' },
] as const;

test('探针 P2 固化（迁移期断言）：inline `to:` 与 terminal 的逐位副本关系被钉住', () => {
  // **迁移期断言**：S2 把这 5 条改绑 `to: <terminal id>` + `to_height` 后，语义反转为
  // 「端点跟随 terminal」——届时本测试改写为端点跟随 + to_height 一致性断言（设计文档 M4/S2 范围）。
  // S1 只做机制层：先证明「今天它们是逐位副本」这个事实，改任何一侧坐标本断言即红。
  for (const { route: routeId, terminal: terminalId } of INLINE_TO_ROUTES) {
    const route = mepConfig.routes.find((item) => item.id === routeId)!;
    const terminal = diagram.terminals.find((item) => item.id === terminalId)!;
    const to = route.to;
    assert.ok(typeof to === 'object', `${routeId} 的 to 应是内联坐标（真双写），实际 ${JSON.stringify(to)}`);
    assert.ok(Math.abs(to.x - terminal.position.x) < 1e-6 && Math.abs(to.z - terminal.position.z) < 1e-6,
      `${routeId} 的 inline to (${to.x},${to.z}) 必须逐位等于 ${terminalId} (${terminal.position.x},${terminal.position.z})——副本关系断了就是漂移`);
    // y 侧：route.to_height 必须已等于 terminal.position.y，S2 改绑后几何才按构造不变。
    assert.equal(route.to_height, terminal.position.y,
      `${routeId} 的 to_height ${route.to_height} 必须等于 ${terminalId} 的 y ${terminal.position.y}（否则改绑即几何变化）`);
  }
});

test('探针 P2 固化（迁移期断言）：terminal 移位后 MEP 端点留原地，且 lint 的重合告警同步消失', () => {
  // A §3.4 探针 P2 实证：return_living.x +0.30 后两个 validator 不抛、lint 109/241 不变、
  // MEP 端点停 (10.95,4.725)。S1 起 lint 兜底（E4）会先就「逐位副本」点名；而副本一旦漂开，
  // 重合告警消失——这正是 S2 必须改绑、且改绑后「端点跟随」的原因。
  const base = resolveMepRoutes({ ...mepConfig, routes: mepConfig.routes.filter((route) => route.id === 'return-air-living') }, sourcesOf());
  assert.ok(Math.abs(base.routes[0].to!.x - 10.95) < 1e-9);
  const shiftedDiagram: HvacDiagram = {
    ...diagram,
    terminals: diagram.terminals.map((terminal) => terminal.id === 'return_living'
      ? { ...terminal, position: { ...terminal.position, x: terminal.position.x + 0.30 } }
      : terminal),
  };
  const shifted = resolveMepRoutes(
    { ...mepConfig, routes: mepConfig.routes.filter((route) => route.id === 'return-air-living') },
    sourcesOf({ ...hvacFacts, plans: [{ ...plan, diagram: shiftedDiagram }] }),
  );
  assert.ok(Math.abs(shifted.routes[0].to!.x - 10.95) < 1e-9,
    '迁移期语义：inline to 是字面副本，terminal 移位不拖动 MEP 端点（S2 改绑后改写为端点跟随）');
  // lint 侧：副本在位时点名（E4 上线后的 5 条命中之一），漂开后该条不再重合 → 不再点名。
  const flagRoute = (hvac: ProjectRenderFacts['hvac']): number => {
    const result = lintMepCoordination(mepConfig, sourcesOf(hvac));
    return [...result.errors, ...result.warnings].filter((issue) => issue.code === 'endpoint_not_bound_to_point' && issue.routeId === 'return-air-living').length;
  };
  assert.equal(flagRoute(hvacFacts), 1, '副本在位：lint 必须点名 return-air-living');
  assert.equal(flagRoute({ ...hvacFacts, plans: [{ ...plan, diagram: shiftedDiagram }] }), 0,
    '副本漂开：重合告警消失——证明这类双写只能靠「改绑」根治，不能靠距离告警兜底');
});

test('E4 lint 扩层：5 条送/回风 inline `to:` 全部被端点绑定兜底点名', () => {
  const result = lintMepCoordination(mepConfig, sourcesOf());
  const flagged = [...result.errors, ...result.warnings].filter((issue) => issue.code === 'endpoint_not_bound_to_point');
  assert.deepEqual(flagged.map((issue) => issue.routeId).sort(), INLINE_TO_ROUTES.map((entry) => entry.route).sort());
  for (const issue of flagged) assert.equal(issue.level, 'error', 'must_fix 桶：交底前必须改绑');
});

test('探针 D 固化：客餐厅设备带（ceiling_living）与 15 个 band terminal 的几何关系被钉住', () => {
  // A §3.3 探针 D：ceiling_living 南缘 5.55→5.80、terminals 不动时，lint 提及这些 terminal 的
  // 条目 0→0——「终端坐标是分区几何的字面副本」这件事今天没有任何门禁。§6.3-1（terminal 的
  // 几何父对象）未裁，S1 **不写派生分支**，只把「现值关系」钉成对账断言：任一侧坐标变化即红，
  // 逼那个裁定显式发生（停止条件 -1 的边界内：这是断言，不是解算）。
  const zone = ceiling.find((item) => item.id === 'ceiling_living')!;
  assert.ok(zone.area && zone.thickness !== undefined, 'ceiling_living 必须声明 area 与 thickness');
  const [x1, z1, x2, z2] = zone.area;
  const band = diagram.terminals.filter((terminal) =>
    terminal.position.x >= x1 - 0.01 && terminal.position.x <= x2 + 0.01
    && terminal.position.z >= z1 - 0.01 && terminal.position.z <= z2 + 0.01);
  assert.equal(band.length, 15, `设备带内风口数应为 15，实际 ${band.length}（LD 三线图脚本曾按硬编码行位静默丢 11 个）`);
  const row = (predicate: (terminal: HvacTerminal) => boolean): HvacTerminal[] => band.filter(predicate);
  const sideSouth = row((terminal) => terminal.mount_face === 'south');
  const sideNorth = row((terminal) => terminal.mount_face === 'north');
  // 检修口（system=access）是「宿主 + 注明偏移」的字面存储（A §3.3(5)），不参与「两排由带中心
  // 派生」的统计；它仍计入带内 15 个口的清点。
  const duct = (terminal: HvacTerminal): boolean => terminal.mount_face !== 'south' && terminal.mount_face !== 'north' && terminal.system !== 'access';
  const supplyBottom = row((terminal) => duct(terminal) && terminal.position.z > (z1 + z2) / 2);
  const returnBottom = row((terminal) => duct(terminal) && terminal.position.z < (z1 + z2) / 2);
  const access = row((terminal) => terminal.system === 'access');
  assert.equal(sideSouth.length + sideNorth.length + supplyBottom.length + returnBottom.length + access.length, band.length,
    '带内 15 个口必须恰好分成：南侧装 / 北侧装 / 下出风排 / 回风排 / 检修口');
  assert.equal(access.length, 1, '带内检修口当前 1 个（access_dining）');
  assert.ok(sideSouth.length > 0 && sideNorth.length > 0 && supplyBottom.length > 0 && returnBottom.length > 0);
  // ① 侧装行面坐标 = 带边界 + 记录差值（A §3.2 实测：南 +0.010 / 北 0.000）
  for (const terminal of sideSouth) assert.ok(Math.abs(terminal.position.z - (z2 + 0.010)) < 1e-9, `南侧装 ${terminal.id} z 应 = 带南界+0.010`);
  for (const terminal of sideNorth) assert.ok(Math.abs(terminal.position.z - z1) < 1e-9, `北侧装 ${terminal.id} z 应 = 带北界`);
  // ② 两排底面行位由带的南北中心派生（A §3.2：均值 4.925 = 带中心）
  const supplyZ = supplyBottom.reduce((sum, terminal) => sum + terminal.position.z, 0) / supplyBottom.length;
  const returnZ = returnBottom.reduce((sum, terminal) => sum + terminal.position.z, 0) / returnBottom.length;
  assert.ok(Math.abs((supplyZ + returnZ) / 2 - (z1 + z2) / 2) < 1e-9, '两排底面行位均值必须等于设备带南北中心');
  // ③ y 与带底面的记录差（A §3.2：侧装 +0.150、底装送 +0.000 / 回 −0.010；底面 = 原顶 − thickness）
  const supplyY = supplyBottom.reduce((sum, terminal) => sum + terminal.position.y, 0) / supplyBottom.length;
  const returnY = returnBottom.reduce((sum, terminal) => sum + terminal.position.y, 0) / returnBottom.length;
  const sideY = [...sideSouth, ...sideNorth].reduce((sum, terminal) => sum + terminal.position.y, 0) / (sideSouth.length + sideNorth.length);
  assert.ok(Math.abs(sideY - supplyY - 0.150) < 1e-9, `侧装 y 应 = 下出风 y + 0.150，实际 ${sideY} vs ${supplyY}`);
  assert.ok(Math.abs(supplyY - returnY - 0.010) < 1e-9, `下出风 y 应 = 回风 y + 0.010，实际 ${supplyY} vs ${returnY}`);
});

test('E8 serves_unit：写错宿主 id 现在必抛，真实配置 3 个检修口全部解析', () => {
  const broken = {
    ...hvacFacts,
    plans: [{ ...plan, diagram: { ...diagram, terminals: diagram.terminals.map((terminal) => terminal.id === 'access_dining' ? { ...terminal, serves_unit: 'ac_typo' } : terminal) } }],
  };
  assert.throws(() => validateProjectHvacFacts(broken, { electrical, ceiling }), /serves unknown ceiling unit: ac_typo/);
  validateProjectHvacFacts(hvacFacts, { electrical, ceiling });
  const access = diagram.terminals.filter((terminal) => terminal.system === 'access');
  assert.equal(access.length, 3);
  for (const terminal of access) assert.ok(ceiling.some((zone) => zone.id === terminal.serves_unit), `${terminal.id} 的 serves_unit 必须存在`);
});

test('E8 三方配对：ceiling power_point == hvac power anchor ref == electrical host_intent', () => {
  // 「哪个插座供哪台内机」住 3 处（设计文档 §3-2）：ceiling `ac_*.power_point`（无运行时读者）、
  // hvac `power_*` anchor ref（有读者）、electrical `host_intent` 散文。今天 6/6 一致但无契约
  // 盯配对（C FM-4）——本测试把配对钉成机器断言。
  const powerAnchors = diagram.anchors.filter((anchor) => anchor.system === 'power');
  assert.equal(powerAnchors.length, 6);
  const roomsWithoutHostIntent: string[] = [];
  for (const anchor of powerAnchors) {
    const room = anchor.id.replace(/^power_/, '');
    const unit = ceiling.find((zone) => zone.id === `ac_${room}`);
    assert.ok(unit, `ceiling 缺少 ${anchor.id} 对应的内机对象 ac_${room}`);
    assert.ok(unit.power_point, `ac_${room} 未声明 power_point`);
    assert.equal(anchor.ref?.source, 'electrical');
    assert.equal(anchor.ref?.id, unit.power_point,
      `${anchor.id} 的 ref 必须指向 ac_${room}.power_point（${unit.power_point}），实际 ${anchor.ref?.id}`);
    const point = electrical.find((item) => item.id === unit.power_point);
    assert.ok(point, `electrical 缺少 ${unit.power_point}`);
    if (point.host_intent === undefined) {
      roomsWithoutHostIntent.push(room);
      continue;
    }
    assert.ok(point.host_intent.includes(`ac_${room}`),
      `${point.id} 的 host_intent 必须点名 ac_${room}，实际「${point.host_intent}」`);
  }
  // 第三腿散文的登记缺口（C FM-4：6 处里 sock_child_ac 缺 host_intent）——显形而不是静默：
  // 谁补上/改错都要来改这行快照。
  assert.deepEqual(roomsWithoutHostIntent, ['child'], '缺 host_intent 的内机取电点位集合必须与登记缺口一致');
});

test('E2/E7 回归：真实 config 的全部 MEP 路线端点解析与 hvac anchor 平面位置零变化', () => {
  // 机制层改动的零几何证明：anchor-ref 改走单一解算、anchor 补 y、normalizeCeilingZone 抽共享
  // 之后，137 条路线端点必须仍全部解析成功（resolveMepRoutes 的 from/to 平面值逐条比对快照）。
  const report = resolveMepRoutes(mepConfig, sourcesOf());
  assert.equal(report.total, 137);
  assert.equal(report.unresolved, 0);
  const living = resolveMepEndpoint('indoor_living', sourcesOf())!;
  assert.ok(Math.abs(living.x - 10.3) < 1e-9 && Math.abs(living.z - 4.75) < 1e-9, 'ceiling ref 直读权威对象');
  const power = resolveMepEndpoint('power_child', sourcesOf())!;
  const child = electrical.find((point) => point.id === 'sock_child_ac')!;
  assert.ok(Math.abs(power.x - 5.6) < 1e-9 && Math.abs(power.z - 4.0) < 1e-9,
    `sock_child_ac 沿墙解果 (5.6,4.0)，实际 (${power.x},${power.z})（声明 ${JSON.stringify({ x: child.x, z: child.z })} 已删）`);
});

test('normalizeCeilingZone 共享实现：area-only 分区两路解出同一中心', async () => {
  const { normalizeCeilingZone } = await import('../../shared/ceiling-zone.js');
  const { buildHvacBuilderSources } = await import('../../shared/render/HvacBuilder.js');
  const areaOnly: CeilingZone = { id: 'ac_area', room: 'living_dining', type: 'ac_indoor', area: [8, 4, 12, 6] } as CeilingZone;
  assert.deepEqual(normalizeCeilingZone(areaOnly), { id: 'ac_area', room: 'living_dining', type: 'ac_indoor', area: [8, 4, 12, 6], x: 10, z: 5 });
  // MEP 侧：ref ceiling 指向 area-only 分区时也解出中心（关 F-2 潜伏「3D 有、DXF 圈缺」）。
  const areaSources = sourcesOf({ ...hvacFacts, plans: [{ ...plan, diagram: { ...diagram, anchors: [...diagram.anchors, { id: 'indoor_area', status: 'confirmed', system: 'refrigerant', ref: { source: 'ceiling', id: 'ac_area' } }] } }] });
  const areaEndpointSources = { ...areaSources, ceiling: [...ceiling, areaOnly] };
  const resolved = resolveMepEndpoint('indoor_area', areaEndpointSources)!;
  assert.ok(Math.abs(resolved.x - 10) < 1e-9 && Math.abs(resolved.z - 5) < 1e-9, `area-only ceiling ref 应解出中心 (10,5)，实际 (${resolved.x},${resolved.z})`);
  const built = buildHvacBuilderSources({ ceiling: [areaOnly] });
  assert.deepEqual(built.ceiling, [normalizeCeilingZone(areaOnly)], 'HvacBuilder 与 MEP 两路必须同一实现');
});

test('schema 禁 wall/mount 来源同时带 x/z（E2 收口的机器执法）', () => {
  // 设计文档 §4.2 电气/给排水点位行「禁止回填 x/z（会复活静默回落分支）」的机器执法：
  // resolver 对 wall/mount 分支忽略 x/z，带着 x/z 的沿墙点位是哑弹——直读消费者（探针 P1
  // 的失效模式）会读到 stale 值。现 config 0 条违规（B §② locatedPointsWithXz=[]）。
  const base = { id: 'probe', room: 'living', type: 'socket' as const, wall: 'w_test', wall_side: 'north' as const, along: 1 };
  assert.throws(() => ElectricalPointSchema.parse({ ...base, x: 5.0 }), /禁止同时声明 x\/z/);
  assert.throws(() => ElectricalPointSchema.parse({ ...base, z: 4.3 }), /禁止同时声明 x\/z/);
  assert.throws(() => ElectricalPointSchema.parse({ ...base, mount: { furniture_id: 'f', face: 'east', along: 0.2 }, x: 1 }), /定位来源必须唯一/);
  assert.doesNotThrow(() => ElectricalPointSchema.parse({ ...base }));
  assert.doesNotThrow(() => ElectricalPointSchema.parse({ id: 'abs', room: 'living', type: 'socket', absolute: true, x: 1, z: 2 }));
});

test('E7 告警化：解析失败必须记诊断——不变量「可渲染实体数 = 落场景数 + 诊断数」', () => {
  // 独立验伪轮（2026-11-08）：原 CI 契约只在「全量源」断言 diagnostics 为空，而全量源无失败、
  // 新旧写法 diagnostics 都恒空——把 resolveAnchor 回退成 `Vec3|undefined` + `if (!position)
  // continue` 的旧写法时计数契约照过（实测复现：exit=0 + 51 个测试全绿）。本断言把「失败即记
  // 诊断」本身钉住：每个可渲染 anchor 要么落场景、要么出一条诊断，旧写法下 noWall=46+0、
  // empty=34+0 都小于 47 → 红。任何「删诊断逻辑」的变异都会被这条抓住。
  const renderableTotal = diagram.anchors.filter((anchor) => anchor.status === 'confirmed' || anchor.position !== undefined).length
    + diagram.terminals.filter((terminal) => terminal.kind !== 'condensate_drain_candidate').length;
  const scenarios: Array<[string, ReturnType<typeof buildHvacBuilderSources>]> = [
    ['full', buildHvacBuilderSources({ hvac: hvacFacts, electrical, ceiling, outdoor: [plan.outdoor], pointWalls, mountHosts })],
    ['noPointWalls', buildHvacBuilderSources({ hvac: hvacFacts, electrical, ceiling, outdoor: [plan.outdoor] })],
    ['empty', buildHvacBuilderSources({})],
  ];
  for (const [name, sources] of scenarios) {
    const diagnostics: string[] = [];
    const entities = buildHvacEntityDescriptors(plan.id, diagram, sources, diagnostics);
    assert.equal(entities.length + diagnostics.length, renderableTotal,
      `${name} 源：落场景 ${entities.length} + 诊断 ${diagnostics.length} 必须等于可渲染实体数 ${renderableTotal}（禁止静默 continue）`);
  }
});

test('E7 告警化：失败场景的诊断内容逐条对账（noPointWalls 恰 1 条 sock_child_ac / empty 恰 13 条 ref anchor）', () => {
  const noWallDiagnostics: string[] = [];
  buildHvacEntityDescriptors(plan.id, diagram, buildHvacBuilderSources({ hvac: hvacFacts, electrical, ceiling, outdoor: [plan.outdoor] }), noWallDiagnostics);
  assert.equal(noWallDiagnostics.length, 1, `noPointWalls 源应恰 1 条诊断，实际 ${noWallDiagnostics.length}`);
  assert.match(noWallDiagnostics[0], /hvac anchor power_child:/);
  assert.match(noWallDiagnostics[0], /sock_child_ac/, '诊断必须点名解不出的沿墙点位（缺 pointWalls 时调用方据此知道传索引）');

  const emptyDiagnostics: string[] = [];
  buildHvacEntityDescriptors(plan.id, diagram, buildHvacBuilderSources({}), emptyDiagnostics);
  const refAnchors = diagram.anchors.filter((anchor) => anchor.ref !== undefined).map((anchor) => anchor.id).sort();
  assert.equal(emptyDiagnostics.length, refAnchors.length, `empty 源应每个 ref anchor 一条诊断（${refAnchors.length} 条），实际 ${emptyDiagnostics.length}`);
  assert.deepEqual(emptyDiagnostics.map((line) => /^hvac anchor ([^:]+):/.exec(line)?.[1]).sort(), refAnchors);
  // 每条诊断都要带原因（断引用 / 缺索引 / 无坐标），不许只报 id
  for (const line of emptyDiagnostics) assert.match(line, /(断引用|不在墙段索引里|无 x\/z 且无 area)/);
});

test('E7 告警化：诊断经 SceneBuilder 的 placementDiagnostics 通道上浮', () => {
  // 3D/CLI 装配路径：buildHvacGeometry 的 diagnostics 必须进 report.placementDiagnostics，
  // 页面控制台 / verify-spatial / DXF-GLB 装配日志才看得见（不允许只在共享层记完就断链）。
  const projection = { version: '2.0', lightingFixtures: [], plumbing: [], ceiling: [], hvac: { status: 'implemented', planId: plan.id, diagram }, materials: { floor: { default: null, roomOverrides: {} } }, presentation: { curtains: {} } } as unknown as import('../../shared/types.js').ProjectRenderFactsProjection;
  const result = buildScene({
    rooms: [{ id: 'r', name: 'r', x: 0, z: 0, width: 4, depth: 4, height: 2.8, type: 'private', boundary_count: 4 }],
    walls: [], elements: [], furnishings: {},
    options: { hvac: { projection, sources: { ceiling: [], electrical: [], outdoor: [] } } },
  });
  const hvacDiagnostics = result.report.placementDiagnostics.filter((line) => line.startsWith('hvac: '));
  assert.equal(result.index.hvac.all.size, 34, '空源下 25 个 terminal + 9 个带 position 的 anchor 落场景，13 个 ref anchor 解不出');
  assert.equal(hvacDiagnostics.length, 13, `13 条 hvac 诊断必须上浮到 report.placementDiagnostics，实际 ${hvacDiagnostics.length}`);
  assert.ok(hvacDiagnostics.some((line) => line.includes('power_child')));
});

test('E7 期望集独立化：expectedHvacExportIds 按声明态枚举，与独立推导逐 id 一致', () => {
  // 独立评审轮（2026-11-08）：期望集曾过装配解算器（expectedHvacExportIds(planId, diagram, sources)
  // = buildHvacEntityDescriptors(...).map(id)），源缺件时期望集同步缩水，「场景里没有」与「期望里
  // 也没有」同时成立、ready 恒真——与旧写法 [...index.all.keys()] 同病。现改为声明态枚举（只读
  // diagram），本测试用一份独立重写的枚举与它对账（铁律④：两侧实现漂移即红）。
  const ids = expectedHvacExportIds(plan.id, diagram);
  const declared = [
    ...diagram.anchors.filter((anchor) => anchor.status === 'confirmed' || anchor.position !== undefined).map((anchor) => `hvac:${plan.id}:anchor:${anchor.id}`),
    ...diagram.terminals.filter((terminal) => terminal.kind !== 'condensate_drain_candidate').map((terminal) => `hvac:${plan.id}:terminal:${terminal.id}`),
  ].sort();
  assert.equal(ids.length, 47, `声明态期望集应为 47 个 id，实际 ${ids.length}`);
  assert.deepEqual([...ids].sort(), declared);
  // 签名不再接受 sources：任何「把解算结果当期望」的回退都要先改签名，typecheck 即拦
  assert.equal(expectedHvacExportIds.length, 2, 'expectedHvacExportIds(planId, diagram) 不再接受 sources 形参');
});
