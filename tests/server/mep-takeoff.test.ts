import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { load as parseYaml } from 'js-yaml';
import {
  derivedSlopeRunToHeight,
  endpointSourcesFromFacts,
  isMepViaCoordinate,
  parseMepCoordination,
  resolveMepRoutes,
} from '../../shared/mep-hvac-coordination-schema.js';
import { computeMepTakeoff, parseWireSizeMm2, pricedCircuitLength, travelerNodeKey, travelerSubtreeLength, unionPlanLength, type MepTakeoffRules, type TakeoffCircuit, type TravelerGraphEdge } from '../../shared/mep-takeoff.js';
import { pointWallIndexFromElements } from '../../shared/point-placement.js';
import { buildPlacementIndexes } from '../../shared/placement-indexes.js';
import { resolveLayout } from '../../server/layout-resolver.js';
import type { FurnishingsYaml, VertexLayoutYaml } from '../../shared/types.js';

/**
 * 水电子系统算量（Phase 0）。四道防线：
 *  ① schema：config/plumbing.yaml 的 water_temp/water_dn/drain_dn 错字被 strict 拦下（见 verify:facts）；
 *  ② 覆盖度契约：routed/unrouted 计数是"稳定底座"的可观测指标——谁改了路由或点位，
 *     这里立刻红，必须走 DEC 而不是悄悄把数字变好看；
 *  ③ 双实现交叉：层长用本模块 + 测试内独立手写循环各算一次，容差 1e-6；
 *  ④ 显形项契约：unresolved 只允许"主干线径未裁定"这一条；出现新条目 = 有人缺声明，测试失败。
 */

const rules = parseYaml(readFileSync('config/mep-takeoff.yaml', 'utf8')) as MepTakeoffRules;
const electrical = parseYaml(readFileSync('config/electrical.yaml', 'utf8')) as Array<Record<string, unknown>>;
const plumbing = parseYaml(readFileSync('config/plumbing.yaml', 'utf8')) as Array<Record<string, unknown>>;
const hvac = parseYaml(readFileSync('config/hvac.yaml', 'utf8')) as { plans: unknown[] };
const ceiling = parseYaml(readFileSync('config/model/envelope/ceiling.yaml', 'utf8')) as unknown[];
const topology = parseYaml(readFileSync('config/electrical-topology.yaml', 'utf8')) as {
  circuits: TakeoffCircuit[];
  controls?: Array<{ switch_point_ids?: string[]; target_point_ids?: string[] }>;
};
const coordination = parseMepCoordination(readFileSync('config/mep-hvac-coordination.yaml', 'utf8'));

// 点位宿主墙/家具索引（issue #98 S1/S3）：与 scripts/project/mep-takeoff.ts 同一构造。
// S3 起沿墙/挂载点位不再声明绝对 x/z，不传索引则 68 个路线端点解析不出。
// 二阶段 S1 起家具宿主索引须走 buildPlacementIndexes 统一解算：anchor 家具无手写 x/z，
// 直读 x/z 的 pointMountHostIndex 会把它静默排除，锚定点位随即断引用。
const geometry = parseYaml(readFileSync('config/layout/model-geometry.yaml', 'utf-8')) as VertexLayoutYaml;
const layout = resolveLayout(geometry);
const pointWalls = pointWallIndexFromElements(layout.walls);
const houseForMountHosts = parseYaml(readFileSync('config/house.yaml', 'utf-8')) as { furnishings?: FurnishingsYaml };
const { mountHosts } = buildPlacementIndexes({ geometry: { walls: layout.walls }, furnishings: houseForMountHosts.furnishings ?? {} });
const sources = endpointSourcesFromFacts({
  electrical: electrical as unknown as Parameters<typeof endpointSourcesFromFacts>[0]['electrical'],
  plumbing: plumbing as unknown as Parameters<typeof endpointSourcesFromFacts>[0]['plumbing'],
  ceiling: ceiling as unknown as Parameters<typeof endpointSourcesFromFacts>[0]['ceiling'],
  hvac: hvac as unknown as Parameters<typeof endpointSourcesFromFacts>[0]['hvac'],
}, pointWalls, mountHosts);
const resolution = resolveMepRoutes(coordination, sources);
const takeoff = computeMepTakeoff({
  electrical: electrical as unknown as Parameters<typeof computeMepTakeoff>[0]['electrical'],
  plumbing: plumbing as unknown as Parameters<typeof computeMepTakeoff>[0]['plumbing'],
  circuits: topology.circuits,
  controls: topology.controls ?? [],
  routes: coordination.routes,
  resolution,
  rules,
});

test('线径解析只认显式字符串，猜不了', () => {
  assert.equal(parseWireSizeMm2('1.5mm²(φ16)'), '1.5');
  assert.equal(parseWireSizeMm2('4.0mm²(φ20)'), '4.0');
  assert.equal(parseWireSizeMm2('4.0mm²(φ20)（proposed，按 docs/...）'), '4.0');
  assert.equal(parseWireSizeMm2(undefined), null);
  assert.equal(parseWireSizeMm2('待厂家铭牌核验'), null);
});

test('端点全部可解析：138 条路由 0 悬空（含 hvac anchors 的 bend_corridor）', () => {
  assert.equal(resolution.total, 137); // DEC-2026-10-27-R01 删床头路线 strong-light-bedrooms-parent-bed 后 138→137； // R1 删两条照明路由 137→135；R2 删四条卫浴照明路由 135→131；DEC-2026-10-13-R5 删电视墙灯带路由 131→130；DEC-2026-10-17-R20 删 strong-ded-fridge / strong-power-parent-child-parentbed-l 两条路由 130→128；同批走线专项为 7 个新点位补 7 条路线 128→135；DEC-2026-10-18-R21 补画 strong-power-living-water 下引 1 条 135→136；DEC-2026-10-19-R25 新增客餐厅 DN32 共用主管 136→137；DEC-2026-10-23-R03 新增客卫沉箱二次排水需求路线 137→138
  assert.equal(resolution.unresolved, 0);
});

test('路由端点解析不建第二份坐标：内联坐标对象与 id 引用混用都被解析', () => {
  const inline = coordination.routes.filter((route) => typeof route.from === 'object' || typeof route.to === 'object');
  const byId = coordination.routes.filter((route) => typeof route.from === 'string');
  assert.ok(inline.length > 0, '应存在内联坐标端点（给水 requirement 路由）');
  assert.ok(byId.length > 0, '应存在 id 引用端点');
});

const pointHeights = new Map<string, number>();
for (const point of [...electrical, ...plumbing]) {
  const height = (point as { height?: number }).height;
  if (height !== undefined) pointHeights.set(String(point.id), height);
}

/** 测试内独立实现：逐 physical route 用原始 via 折线 + 竖向下引段重算层长，与模块输出交叉验证。 */
function independentLayerLength(layer: string, coord: typeof coordination = coordination, reso: typeof resolution = resolution): number {
  let total = 0;
  for (const route of coord.routes) {
    if (route.layer !== layer) continue;
    const resolved = reso.routes.find((item) => item.route.id === route.id);
    if (!resolved || resolved.unresolved.length > 0 || !resolved.metadata.physicalRoute) continue;
    const points: Array<[number, number, number]> = [];
    // 与统一出口 resolved.points 同优先级：路由自己声明的 from_height/to_height 优先于点位高度；
    // slope_run 路由删了 to_height，终端标高由末步落点派生（与解算器共用 derivedSlopeRunToHeight
    // 单一实现，见 schema：to_height ?? 派生落点 ?? 端点 y）。直接读端点 y 会错：立管端点
    // 本就不带 y（会把终端当成 y=0、凭空多出约 0.02m 竖直段），客卫支管派生终端 0.0165m
    // 也会被端点高度 0.02m 顶回、多出 0.0035m 上升段——两种都会让本交叉验证超 1e-6 容差。
    if (resolved.from) points.push([resolved.from.x, route.from_height ?? resolved.from.y ?? 0, resolved.from.z]);
    for (const via of resolved.viaPoints) points.push([via.x, via.y ?? 0, via.z]);
    if (resolved.to) points.push([resolved.to.x, route.to_height ?? derivedSlopeRunToHeight(route, resolved.viaPoints) ?? resolved.to.y ?? 0, resolved.to.z]);
    // 零平面位移（首末平面点重合）的路由只贡献竖向长度，仓库口径不计为 physical 折线；本独立实现同步排除
    const first = points[0];
    const last = points[points.length - 1];
    if (route.route_kind !== 'physical' && first[0] === last[0] && first[2] === last[2]) continue;
    // 终点是"未激活预留点位"（position_status 与 status 均 pending，如 sock_child_ac / sock_kitchen_oven）的
    // 路由不进量：预留接口未激活前不占箱位、不进场（口径见 electrical-topology pending_parameters）
    if (typeof route.to === 'string') {
      const point = electrical.find((item) => (item as { id?: string }).id === route.to) as
        | { position_status?: string; status?: string }
        | undefined;
      if (point?.position_status === 'pending' && point?.status === 'pending') continue;
    }
    for (let i = 1; i < points.length; i += 1) {
      total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1], points[i][2] - points[i - 1][2]);
    }
    // 竖向下引段：终点有点位高度声明时，末点 y − height（负值取 0）。
    // issue #243 step 4：末点 y 为统一来源（与生产实现同口径）；旧口径 to_height ?? 端点 y
    // 对删了 to_height 的 slope_run 路由会读 stale 声明（客卫支管：端点 0.02m vs 派生 0.0165m）。
    if (typeof route.to === 'string') {
      const height = pointHeights.get(route.to);
      if (height !== undefined && points.length > 0) {
        total += Math.max(0, points[points.length - 1][1] - height);
      }
    }
    // 起点 stub：首点 y − 起点位高度（负值取 0），与生产实现 fromDrop 同口径
    // （量价算法审计 D3：此前只计 to 端，from 端 13 条路由共 0.2962m 静默漏计）。
    if (typeof route.from === 'string') {
      const fromHeight = pointHeights.get(route.from);
      if (fromHeight !== undefined && points.length > 0) {
        total += Math.max(0, points[0][1] - fromHeight);
      }
    }
  }
  return total;
}

test('层长双实现交叉验证（折线 + 竖向下引段）', () => {
  assert.ok(Math.abs(takeoff.conduit.strongPowerM - independentLayerLength('strong_power')) < 1e-6);
  assert.ok(Math.abs(takeoff.conduit.weakPowerM - independentLayerLength('weak_power')) < 1e-6);
  assert.ok(Math.abs(takeoff.conduit.waterSupplyM - independentLayerLength('water_supply')) < 1e-6);
  assert.ok(Math.abs(takeoff.conduit.drainageM - independentLayerLength('drainage')) < 1e-6);
  // 已画线端点以顶面设备为主（空调插座 2.5m/灯具 2.7~2.8m），竖向下引实测量级应在个位数米
  assert.ok(takeoff.conduit.terminalDropM > 0 && takeoff.conduit.terminalDropM < 5, `竖向下引段 ${takeoff.conduit.terminalDropM}m`);
});

test('终端下引跟随派生终端：客卫支管坡度 1%→0.5%，下引段按派生终端计（issue #243 step 4）', () => {
  // 旧口径读 route.to_height ?? 端点 y：drain-guest-bath 删了 to_height，端点
  // drain_gbath_floor y=0.02，下引恒为 0——坡度一动、派生终端变了，下引也不跟随。
  // 新口径读统一出口末点 y：坡度 0.005 时派生终端高于点位 0.02m，超出部分必须进量。
  const mutated = structuredClone(coordination);
  const guest = mutated.routes.find((route) => route.id === 'drain-guest-bath')!;
  assert.equal(guest.slope, 0.01);
  guest.slope = 0.005;
  const mutatedResolution = resolveMepRoutes(mutated, sources);
  const baseTerminal = resolution.routes.find((item) => item.route.id === 'drain-guest-bath')!.points.at(-1)?.y;
  const mutatedTerminal = mutatedResolution.routes.find((item) => item.route.id === 'drain-guest-bath')!.points.at(-1)?.y;
  assert.ok(baseTerminal !== undefined && Math.abs(baseTerminal - 0.0165) < 1e-9, `基线派生终端须为 0.0165m，实际 ${baseTerminal}`);
  assert.ok(mutatedTerminal !== undefined && mutatedTerminal > 0.02, `坡度减半后派生终端须高于点位 0.02m，实际 ${mutatedTerminal}`);
  const mutatedTakeoff = computeMepTakeoff({
    electrical: electrical as unknown as Parameters<typeof computeMepTakeoff>[0]['electrical'],
    plumbing: plumbing as unknown as Parameters<typeof computeMepTakeoff>[0]['plumbing'],
    circuits: topology.circuits,
    controls: topology.controls ?? [],
    routes: mutated.routes,
    resolution: mutatedResolution,
    rules,
  });
  assert.deepEqual(mutatedTakeoff.unresolved.map((item) => item.id), ['trunk_strong_main']);
  const expectedDrop = mutatedTerminal - 0.02;
  assert.ok(
    Math.abs((mutatedTakeoff.conduit.terminalDropM - takeoff.conduit.terminalDropM) - expectedDrop) < 1e-9,
    `下引增量须等于派生终端超出点位的部分 ${expectedDrop}，实际 ${mutatedTakeoff.conduit.terminalDropM - takeoff.conduit.terminalDropM}`,
  );
  // 交叉验证在变异配置上仍成立（独立实现同口径读末点 y；旧口径会在此差 expectedDrop）。
  assert.ok(Math.abs(mutatedTakeoff.conduit.drainageM - independentLayerLength('drainage', mutated, mutatedResolution)) < 1e-6);
});

test('起点竖直 stub 计入层长：折线起点高于起点位安装高度的部分不是凭空消失（量价算法审计 D3）', () => {
  // 独立复算：逐 physical route 取统一出口折线首点 y − 起点位高度（负值取 0），
  // 与 production 的 fromDropSpan 同规则、不同实现。实测 13 条：排水 10 条
  // 0.1462m（drain-master-bath 0.0245 最大）+ 强电 3 条 0.15m（入户灯路各 0.05m）。
  const fromDropByLayer: Record<string, number> = {};
  let fromDropTotal = 0;
  for (const route of coordination.routes) {
    const resolved = resolution.routes.find((item) => item.route.id === route.id);
    if (!resolved || resolved.unresolved.length > 0 || !resolved.metadata.physicalRoute) continue;
    if (typeof route.from !== 'string') continue;
    const height = pointHeights.get(route.from);
    if (height === undefined) continue;
    const firstY = resolved.points[0]?.y ?? (route as { from_height?: number }).from_height ?? resolved.from?.y;
    if (firstY === undefined) continue;
    const drop = Math.max(0, firstY - height);
    if (drop > 0) {
      fromDropByLayer[route.layer] = (fromDropByLayer[route.layer] ?? 0) + drop;
      fromDropTotal += drop;
    }
  }
  assert.ok(Math.abs(fromDropTotal - 0.2962) < 1e-6, `起点 stub 合计须为 0.2962m，实际 ${fromDropTotal}`);
  assert.ok(Math.abs((fromDropByLayer.drainage ?? 0) - 0.1462) < 1e-6, `排水起点 stub 须为 0.1462m，实际 ${fromDropByLayer.drainage}`);
  assert.ok(Math.abs((fromDropByLayer.strong_power ?? 0) - 0.15) < 1e-6, `强电起点 stub 须为 0.15m，实际 ${fromDropByLayer.strong_power}`);
  // terminalDropM 是 drawnM − drawnMWithoutDrop 的派生值：修前只含 to 端下引
  // 1.6m，修后须含两端（1.6 + 0.2962 = 1.8962）。
  assert.ok(Math.abs(takeoff.conduit.terminalDropM - 1.8962) < 1e-6, `终端竖直段须为 1.8962m（含起点 stub 0.2962），实际 ${takeoff.conduit.terminalDropM}`);
  // 层长交叉验证在修后仍成立（independentLayerLength 已同步含起点 stub）。
  assert.ok(Math.abs(takeoff.conduit.drainageM - independentLayerLength('drainage')) < 1e-6);
  assert.ok(Math.abs(takeoff.conduit.strongPowerM - independentLayerLength('strong_power')) < 1e-6);
});

test('起点竖直段须进入给排水采购量，不只进层长（Codex blocking，PR #255 复审第 5 轮）', () => {
  // D3 只补了层长 conduit：attributePipe/routeSegments 另起炉灶按折线重算长度、
  // 只补 terminalDrop，起点段从采购量里静默漏掉。最小输入：1m 水平排水路线 +
  // 1m 起点竖直段（from 点位高 0m、折线起点高 1m、to 点位高 1m 故终端下引为 0）。
  // 修复前 conduit.drainageM = 2m 但 pipe.totalDrainageM = 1.08（只计折线 ×1.08）。
  const baseRules: MepTakeoffRules = {
    sources: {
      electrical_points: 'config/electrical.yaml',
      plumbing_points: 'config/plumbing.yaml',
      circuits: 'config/electrical-topology.yaml',
      routes: 'config/mep-hvac-coordination.yaml',
      hvac: 'config/hvac.yaml',
    },
    covered_layers: ['drainage'],
    excluded_layers: [],
    units: {
      cores_by_purpose: {},
      dual_control_extra_cores: 0,
      loss: { wire: 1.05, pipe: 1.08 },
      fitting_per_meter: { ppr: 0.35, pvc: 0.27 },
    },
    trunk_wire_size: null,
    include_terminal_drop: true,
    panel: { main_switch_poles: 1, spd_modules: 1, spare_ratio: 0, round_up: false },
  };
  const route = {
    id: 'probe-drain',
    layer: 'drainage',
    from: 'drain_from',
    to: 'drain_to',
    route_kind: 'physical',
  } as unknown as Parameters<typeof computeMepTakeoff>[0]['routes'][number];
  const resolution = {
    total: 1,
    resolved: 1,
    unresolved: 0,
    diagnostics: [],
    routes: [{
      route,
      from: { x: 0, z: 0, y: 1 },
      to: { x: 1, z: 0, y: 1 },
      points: [{ x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }],
      viaPoints: [],
      unresolved: [],
      diagnostics: [],
      metadata: { physicalRoute: true, routeKind: 'physical' },
    }],
  } as unknown as Parameters<typeof computeMepTakeoff>[0]['resolution'];
  const plumbing = [
    { id: 'drain_from', room: 'guest_bath', type: 'drain', height: 0, drain_dn: 110 },
    { id: 'drain_to', room: 'guest_bath', type: 'drain', height: 1, drain_dn: 110 },
  ] as unknown as Parameters<typeof computeMepTakeoff>[0]['plumbing'];
  const run = (rules: MepTakeoffRules) => computeMepTakeoff({
    electrical: [], plumbing, circuits: [], controls: [], routes: [route], resolution, rules,
  });
  // 端点推断口径（无 pipe_route_segments）：折线 1m + 起点段 1m，再 ×1.08。
  const inferred = run(baseRules);
  assert.equal(inferred.conduit.drainageM, 2);
  assert.ok(Math.abs(inferred.pipe.totalDrainageM - 2.16) < 1e-9);
  // 显式分段口径：起点段进首段（单段路由首尾同一段，两项都加；给水 fallback
  // 与分段共用同一行修正，此处只钉排水两条路）。
  const segmented = run({
    ...baseRules,
    pipe_route_segments: { 'probe-drain': [{ from_index: 0, to_index: 1, drain_dn: 110 }] },
  });
  assert.ok(Math.abs(segmented.pipe.totalDrainageM - 2.16) < 1e-9);
  // 生产量：排水起点 stub 0.1462m（D3 实测，10 条）× 1.08 = 0.157896m 进入
  // totalDrainageM（24.384521593854366 → 24.54241759385437，de110 +0.023436、
  // de50 +0.13446）；给水无 fromDrop，总量不变。
  assert.ok(Math.abs(takeoff.pipe.totalDrainageM - 24.54241759385437) < 1e-9);
});

test('导线按 topology wire_size 分桶，不按 id 猜', () => {
  const bySize = new Map(takeoff.wire.bySize.map((bucket) => [bucket.wireSize, bucket]));
  assert.deepEqual([...bySize.keys()].sort(), ['1.5', '2.5', '4.0']);
  // 20 回路 = 1.5mm²×4（照明）+ 2.5mm²×14 + 4.0mm²×2（外机/厨房）。
  // 删除 allowance 后（DEC-2026-10-07-M03），**只有画了路由的回路才进导线量**：
  // 某个回路的点位全部未路由时该回路不出现在桶里（无管长即无导线），故 2.5mm² 先降为 13 个；
  // DEC-2026-10-17-R20：strong-ded-fridge 路由删除、专用冰箱回路由 sock_kitchen_fridge 改绑
  // sock_fridge_living 且暂未画路由 → dedicated_kitchen_fridge 整路退出桶，2.5mm² 13→12。
  assert.equal(bySize.get('1.5')!.circuits.length, 4); // DEC-2026-10-13-R5 删 lighting_tv_ambient（1.5mm² 照明回路）后 5→4
  assert.equal(bySize.get('2.5')!.circuits.length, 13); // DEC-2026-10-17-R20：dedicated_kitchen_fridge 无路由退出桶 13→12；同批走线专项 strong-ded-fridge-living 落地后重新入桶 12→13
  assert.equal(bySize.get('4.0')!.circuits.length, 2);
  // 未路由点位必须显形，且不得进任何采购量
  assert.equal(takeoff.coverage.unroutedPoints.length, takeoff.coverage.unroutedPointIds.length);
  assert.ok(takeoff.coverage.unroutedPoints.length > 0, '未路由点位必须显形（删 allowance 后必然 >0）');
  for (const bucket of takeoff.wire.bySize) {
    assert.ok(Math.abs(bucket.wireM - bucket.conduitM * bucket.cores * rules.units.loss.wire) < 1e-9, '导线 = 管长 × 芯数 × 损耗');
  }
});

test('覆盖度契约：routed + unrouted 与点位数对齐（非水电设施已排除）', () => {
  const nonMep = new Set((rules.non_mep_items ?? []).map((item) => item.id));
  const deferred = (point: Record<string, unknown>) => point.position_status === 'pending' && point.status === 'pending';
  const electricalCount = electrical.filter((point) => !nonMep.has(String(point.id)) && !deferred(point)).length;
  const plumbingCount = plumbing.filter((point) => !nonMep.has(String(point.id))).length;
  assert.equal(takeoff.coverage.routedPointIds.length + takeoff.coverage.unroutedPointIds.length, electricalCount + plumbingCount);
  // 两个 status 均 pending 的点位不进入可报价基线（微蒸烤预留 + 墙体归属待量房的儿童房空调插座）。
  // 2026-10-07 声明式补客客厅 ordinary_power_living 十条路由后，已画线点位 57 → 67；R15 删除 NP-4b 后 98→97；
  // DEC-2026-10-08-W01 给排水 15 条路线端点由内联坐标改绑点位 id + 新增 2 条路线，97→103。
  // 新增 routed 六点：shower_mbath / shower_gbath（v1 干管本来就画到它们，只是端点是内联坐标）、
  //   faucet_kitchen_purifier / drain_balcony_floor（本轮新支路）、water_entry / drain_riser_balcony（本轮新点位）。
  // DEC-2026-10-17-R20：删 strong-ded-fridge / strong-power-parent-child-parentbed-l 两条路由，
  //   sock_kitchen_fridge / sock_parent_bed_l 两点随之退出 routed（97→95）；本轮新增 7 电气点 +
  //   faucet_kitchen_dishwasher 均未画路由，全部落在 unrouted 侧显形（routed 不增）。
  assert.equal(takeoff.coverage.routedPointIds.length, 101); // DEC-2026-10-27-R01 删床头开关与供电路，routed 点位 102→101； // W02：+water_heater 锚点；R1 删两条照明路由后 104→102；R2 删四条卫浴照明路由后 102→98；DEC-2026-10-13-R5 删 strong-light-tv 后 98→97；DEC-2026-10-17-R20 删两条电源路由后 97→95；同批走线专项 7 条新路线覆盖 7 个新点位 95→102
  assert.equal(takeoff.coverage.byType.socket?.routed, 36); // DEC-2026-10-17-R20：删 sock_kitchen_fridge / sock_parent_bed_l（原 routed）后 34→32；同批走线专项 sock_fridge_living / sock_waterbar / sock_weakbox / sock_kitchen_east_counter 四个插座点位随新路线进入 routed 32→36
  assert.equal(takeoff.coverage.byType.faucet?.routed, 5);
  assert.equal(takeoff.coverage.byType.shower?.routed, 2);
  assert.equal(takeoff.coverage.byType.drain?.routed, 11);
  // W03 注意：两卫 4 处地漏**本来就在 routed 里**（drain-master-bath / drain-guest-bath 已把它们连成链），
  // 只是链子在 drain_mbath_floor / drain_gbath_floor 断头、没接立管；W03 补的是"接到立管"而非覆盖率，
  // 故 routed 仍为 104、排水 de50 由 16.09m → 21.39m（+5.30m）才是本轮的真实效果。
  assert.equal(takeoff.coverage.byType.drain?.unrouted, 1); // 仅 drain_garden（#48 去留未决）
  assert.equal(takeoff.coverage.byType.drain_riser?.routed, 4);
  assert.equal(takeoff.coverage.byType.water_supply?.routed, 1);
  assert.equal(takeoff.coverage.byType.water_heater?.routed, 1);
  assert.equal(takeoff.coverage.unroutedPointIds.length, electricalCount + plumbingCount - 101); // DEC-2026-10-27-R01 删床头开关（已路由点），常量 102→101（未路由数不变）；R1：电气点位 107→105、已路由 104→102；R2：电气点位 105→101、已路由 102→98；DEC-2026-10-13-R5 电气点位 101→100、已路由 98→97；DEC-2026-10-17-R20 已路由 97→95（+8 新点全部未路由：7 电气 + faucet_kitchen_dishwasher）；同批走线专项 7 条新路线后已路由 95→102
  // 未路由点位逐条显形，不进采购量
  assert.equal(takeoff.coverage.unroutedPoints.length, takeoff.coverage.unroutedPointIds.length);
});

test('显形项契约：unresolved 只允许"主干线径未裁定"这一条', () => {
  assert.equal(takeoff.unresolved.length, 1);
  assert.equal(takeoff.unresolved[0].id, 'trunk_strong_main');
  assert.equal(takeoff.feasibleForQuote, false, '主干线径未裁定前不得进入报价');
});

test('requirement/candidate 路由只显形不计量：5 条待决（入户花园 #48 + DEC-2026-10-17-R13）', () => {
  // 2026-10-07 v1：6 条给水 + 1 条排水 requirement 已按推断锚点提升为 physical（uncertainty ±0.3m、
  // construction_status 恒 pending），剩余 2 条属 pending-site-data 第48项"入户花园去留未决"——未决不计量的。
  // DEC-2026-10-17-R13：3 条 v1 估算水路（kitchen / hot-mbath / hot-gbath）显式声明 route_kind: candidate
  //（reason 载明 ±0.3m 估算、量房日按实重画），与 garden 两条同样只显形、不进管长——
  // 与 C8「臆测数据不进量」业主裁定同向；量房实测重画为 physical 后长度自然回归。
  assert.equal(takeoff.requirementRoutes.length, 5);
  assert.deepEqual(takeoff.requirementRoutes.map((item) => item.id).sort(), [
    'drain-garden-requirement',
    'water-garden-requirement',
    'water-hot-water-gbath-requirement',
    'water-hot-water-mbath-requirement',
    'water-kitchen-requirement',
  ]);
  assert.ok(takeoff.requirementRoutes.every((item) => item.routeKind === 'requirement' || item.routeKind === 'candidate'));
  for (const item of takeoff.requirementRoutes) {
    assert.ok(!takeoff.coverage.routedPointIds.includes(item.id), 'requirement/candidate 路由不算覆盖');
  }
});

test('空调层与非水电设施被排除并带 reason', () => {
  const excluded = takeoff.excluded.map((item) => item.layer ?? item.id);
  for (const layer of ['refrigerant', 'condensate', 'supply_air', 'return_air']) assert.ok(excluded.includes(layer));
  for (const id of ['gas_meter_kitchen', 'duct_kitchen_exhaust']) {
    assert.ok(excluded.includes(id));
    assert.ok((takeoff.excluded.find((item) => item.id === id)?.reason ?? '').length > 0);
  }
});

test('设备量：底盒/模数/断路器/穿墙孔', () => {
  assert.equal(takeoff.devices.boxes, 77); // DEC-2026-10-27-R01 删 switch_parent_bed 开关底盒 78→77； // DEC-2026-10-12-R2 删 switch_mbath/switch_gbath 两个开关底盒后 77→75；DEC-2026-10-17-R20 +sock_waterbar/+sock_weakbox/+sock_kitchen_east_counter 三个强电底盒（sock_fridge_living 换位 sock_kitchen_fridge 净 0；弱电 net_master_ap 与灯具点位不占强电底盒）75→78
  // 28 = ceil((20 回路 + 2P 进线 + 1 SPD) × 1.2)；DEC-2026-10-13-R5 删电视墙灯带整条照明回路后 21→20 路，模数 29→28、断路器 21→20
  assert.equal(takeoff.devices.panelModules, Math.ceil((20 + 2 + 1) * 1.2));
  assert.equal(takeoff.devices.breakers.total, 20);
  assert.equal(takeoff.devices.breakers.withRcd, 16);
  assert.equal(takeoff.devices.breakers.mcbOnly, 4); // DEC-2026-10-13-R5 删 lighting_tv_ambient 照明回路（C16 无漏保）后 5→4
  assert.ok(takeoff.devices.penetrations > 0);
});

test('给排水分桶只认显式声明，缺声明进 unresolved', () => {
  const waterKeys = takeoff.pipe.water.map((bucket) => bucket.key);
  const drainKeys = takeoff.pipe.drainage.map((bucket) => bucket.key);
  assert.ok(waterKeys.every((key) => /^(hot|cold|mixed)\/(20|25|32)$/.test(key)), `给水桶 ${waterKeys.join(',')}`);
  assert.ok(drainKeys.every((key) => /^de(50|75|110)$/.test(key)), `排水桶 ${drainKeys.join(',')}`);
});

test('deferred：未激活预留点位显形，不算错也不算漏', () => {
  const ids = takeoff.deferred.map((item) => item.id);
  assert.ok(ids.includes('sock_kitchen_oven'));
  assert.ok(ids.includes('sock_child_ac'));
  // 空调线控器：删除 allowance 后不再产生"信号管 24m"这种估算量，
  // 改为在 unroutedPoints 里显形（归属空调商/水电未声明），见 DEC-2026-10-07-M03。
  const acPanels = takeoff.coverage.unroutedPoints.filter((point) => point.type === 'ac_controller');
  assert.equal(acPanels.length, 6);
});

test('未四舍五入：数量保留原始浮点', () => {
  assert.ok(!Number.isInteger(takeoff.conduit.strongPowerM));
  assert.ok(!Number.isInteger(takeoff.wire.totalWireM));
});

/**
 * DEC-2026-10-23-R01：回路计价基数 pricedCircuitLength = 平面 union + 竖直段。
 * 修复前 unionPlanLength 只吃 {x,z}，竖直边整体归零（强电约 89m、导线低估约 36%）。
 * 断言一律写**绝对值**：竖直分量是精确算术（区间合并），平面分量是 5cm 网格量化
 * （3m 直线段 = 61 个 cell = 3.05）——两个口径分别钉死。旧写法用「计价 − 平面 union」
 * 差值隔离竖直分量，曾把纯竖直路径多出的一个网格 cell（0.05m）一并抵消，
 * 掩盖了退化路径的平面分量偏差（2026-10-23 评审 P2），禁止再用差值断言。
 */
test('pricedCircuitLength：纯竖直路径计入其高度', () => {
  const path = [{ x: 0, z: 0, y: 0.3 }, { x: 0, z: 0, y: 2.55 }];
  assert.ok(Math.abs(pricedCircuitLength([path]) - 2.25) < 1e-6,
    `纯竖直路径应精确等于 2.25（平面分量 0），实际 ${pricedCircuitLength([path])}`);
});

test('pricedCircuitLength：混合路径 = 平面 union + 竖直下引', () => {
  const path = [{ x: 0, z: 0, y: 2.55 }, { x: 3, z: 0, y: 2.55 }, { x: 3, z: 0, y: 0.3 }];
  // 平面 3m 直线段经 5cm 网格 = 3.05；竖直下引 2.25（精确）→ 合计 5.30。
  assert.ok(Math.abs(pricedCircuitLength([path]) - 5.3) < 1e-6,
    `混合路径应为 5.30，实际 ${pricedCircuitLength([path])}`);
});

test('pricedCircuitLength：平面重叠仍去重，同回路共享立管只计一次', () => {
  const path = [{ x: 0, z: 0, y: 2.55 }, { x: 3, z: 0, y: 2.55 }, { x: 3, z: 0, y: 0.3 }];
  assert.equal(pricedCircuitLength([path, path]), pricedCircuitLength([path]));
});

test('pricedCircuitLength：不同位置的下引各计一次', () => {
  const a = [{ x: 0, z: 0, y: 2.55 }, { x: 3, z: 0, y: 2.55 }, { x: 3, z: 0, y: 0.3 }];
  const b = [{ x: 0, z: 0, y: 2.55 }, { x: 5, z: 0, y: 2.55 }, { x: 5, z: 0, y: 0.3 }];
  // 平面 union：两条路径在 z=0 上 [0,3] 与 [0,5] 并集 = 5m → 101 cells = 5.05；
  // 竖直：(3,0) 与 (5,0) 两处下引各 2.25 → 合计 9.55。
  assert.ok(Math.abs(pricedCircuitLength([a, b]) - 9.55) < 1e-6,
    `两处下引路径应为 9.55，实际 ${pricedCircuitLength([a, b])}`);
});

test('pricedCircuitLength：斜边的竖直分量逐边计入', () => {
  const path = [{ x: 0, z: 0, y: 0 }, { x: 1, z: 0, y: 1 }];
  // 平面 1m 经网格 = 21 cells = 1.05；斜边 |Δy| = 1 逐边计入 → 合计 2.05。
  assert.ok(Math.abs(pricedCircuitLength([path]) - 2.05) < 1e-6,
    `斜边路径应为 2.05，实际 ${pricedCircuitLength([path])}`);
});

test('pricedCircuitLength：点缺 y 标高即抛错，不许 ?? 0 兜底（评审 P2）', () => {
  assert.throws(
    () => pricedCircuitLength([[{ x: 0, z: 0 }, { x: 0, z: 0, y: 2 }]]),
    /缺失标高 y/,
    '缺 y 曾被 ?? 0 静默当成 0 出数（探针得 2.05 而非抛错）',
  );
  assert.throws(
    () => pricedCircuitLength([[{ x: 0, z: 0, y: Number.NaN }, { x: 1, z: 0, y: 2 }]]),
    /缺失标高 y/,
  );
});

test('计价口径含竖直段：strongPowerTotalM 大于纯平面 union（DEC-2026-10-23-R01）', () => {
  const verticalPriced = takeoff.conduit.strongPowerTotalM - takeoff.conduit.strongPowerUnionPerCircuitM;
  // 2026-10-23 实算：计价管长 256.55 → 342.72（竖直 +86.17），导线 829.8 → 1101.21。
  // 同日评审后修订：终端下引进回路计价（原始 0.95m、回路内同 (x,z) 区间合并后
  // 净 +0.75）→ 计价管长 343.47（竖直分量 86.92），导线 1103.57；纯竖直路径的
  // 0.05 网格多计在本配置下被同回路平面段端点 cell 覆盖，生产净影响为 0。
  // 路由增删会动这些数（走 DEC 时同步更新本断言的量级带），但「计价 > 纯平面 union」
  // 与竖直分量量级（数十米）是口径性质，不许回退到 0。
  assert.ok(verticalPriced > 50, `竖直计价分量应在数十米量级，实际 ${verticalPriced}`);
  assert.ok(takeoff.wire.totalWireM > 1000, `导线总量应已含竖直段，实际 ${takeoff.wire.totalWireM}`);
});

test('终端下引进回路计价：include_terminal_drop 开含下引、关不含（评审 P1）', () => {
  // 合成场景：强电路由沿 2.55 标高走到插座正上方（平面 3m），插座安装高度 0.3，
  // 终端下引 = 2.55 − 0.3 = 2.25m。此前下引只进 drawn/layer 诊断长度，
  // circuitPaths 只有路由折线——报价卡从 strongPowerTotalM 取量，这段不在基数内。
  const synthElectrical = [{ id: 'sock_test', type: 'socket', room: 'test_room', x: 3, z: 0, height: 0.3 }];
  const synthCoordination = parseMepCoordination(`
version: '1'
status: synthetic-test
layers:
  strong_power: { label: 强电, color: '#000000', height: 2.55 }
  weak_power: { label: 弱电, color: '#000000', height: 2.55 }
  water_supply: { label: 给水, color: '#000000', height: 0.18 }
  drainage: { label: 排水, color: '#000000', height: 0.1 }
  refrigerant: { label: 冷媒, color: '#000000', height: 2.4 }
  condensate: { label: 冷凝水, color: '#000000', height: 2.4 }
  supply_air: { label: 送风, color: '#000000', height: 2.4 }
  return_air: { label: 回风, color: '#000000', height: 2.4 }
routes:
  - id: test-drop-route
    layer: strong_power
    status: inferred
    route_kind: physical
    from: { x: 0, z: 0, y: 2.55 }
    via: [{ x: 3, z: 0, y: 2.55 }]
    to: sock_test
    to_height: 2.55
`);
  const synthSources = endpointSourcesFromFacts({
    electrical: synthElectrical as unknown as Parameters<typeof endpointSourcesFromFacts>[0]['electrical'],
    plumbing: [] as unknown as Parameters<typeof endpointSourcesFromFacts>[0]['plumbing'],
    ceiling: [] as unknown as Parameters<typeof endpointSourcesFromFacts>[0]['ceiling'],
    hvac: { plans: [] } as unknown as Parameters<typeof endpointSourcesFromFacts>[0]['hvac'],
  });
  const synthResolution = resolveMepRoutes(synthCoordination, synthSources);
  const synthCircuits = [{
    id: 'TEST-C1', purpose: 'ordinary_power', wire_size: '2.5mm²(φ20)',
    breaker: 'C20', member_point_ids: ['sock_test'],
  }] as TakeoffCircuit[];
  const runSynth = (includeDrop: boolean) => computeMepTakeoff({
    electrical: synthElectrical as unknown as Parameters<typeof computeMepTakeoff>[0]['electrical'],
    plumbing: [] as unknown as Parameters<typeof computeMepTakeoff>[0]['plumbing'],
    circuits: synthCircuits,
    controls: [],
    routes: synthCoordination.routes,
    resolution: synthResolution,
    rules: { ...cloneRules(), include_terminal_drop: includeDrop },
  });
  const off = runSynth(false);
  const on = runSynth(true);
  // 关：只有平面 union——3m 直线段经 5cm 网格 = 61 cells = 3.05，下引不在计价内。
  assert.ok(Math.abs(off.conduit.strongPowerTotalM - 3.05) < 1e-6,
    `关下引时计价应为 3.05，实际 ${off.conduit.strongPowerTotalM}`);
  // 开：+ 下引 2.25（精确算术）= 5.30；导线增量 = 下引 × 3 芯 × 1.05 损耗。
  assert.ok(Math.abs(on.conduit.strongPowerTotalM - 5.3) < 1e-6,
    `开下引时计价应为 5.30，实际 ${on.conduit.strongPowerTotalM}`);
  assert.ok(Math.abs((on.wire.totalWireM - off.wire.totalWireM) - 2.25 * 3 * 1.05) < 1e-6,
    `导线增量应为 7.0875，实际 ${on.wire.totalWireM - off.wire.totalWireM}`);
});

test('双控行程取开关间最小子树，不取点位类型分摊（2026-11-16 量价算法审计）', () => {
  // 手工图：swA—3m—lightX—4m—swB，另有 swA—swB 直连 10m（更长，不取）、
  // swB—5m—nightY（死胡同，不取）。旧口径按点位 type 对半分会算出 (3+10)/2 + (4+10+5)/2 = 16m。
  const edges: TravelerGraphEdge[] = [
    { routeId: 'r1', a: 'swA', b: 'lightX', length: 3, stubA: 0, stubB: 0 },
    { routeId: 'r2', a: 'lightX', b: 'swB', length: 4, stubA: 0, stubB: 0 },
    { routeId: 'r3', a: 'swA', b: 'swB', length: 10, stubA: 0, stubB: 0 },
    { routeId: 'r4', a: 'swB', b: 'nightY', length: 5, stubA: 0, stubB: 0 },
  ];
  assert.equal(travelerSubtreeLength(edges, ['swA', 'swB']), 7);
  // 三控：精确最小子树取两条短边，不取 10m 的第三边。
  const threeWay: TravelerGraphEdge[] = [
    { routeId: 't1', a: 'swA', b: 'swB', length: 2, stubA: 0, stubB: 0 },
    { routeId: 't2', a: 'swB', b: 'swC', length: 3, stubA: 0, stubB: 0 },
    { routeId: 't3', a: 'swA', b: 'swC', length: 10, stubA: 0, stubB: 0 },
  ];
  assert.equal(travelerSubtreeLength(threeWay, ['swA', 'swB', 'swC']), 5);
  // 星形三控：三开关两两直连各 2m、各自到接线盒 O 均为 1.1m——度量闭包 MST
  // 取两条直连边得 4m，精确最小子树经 O 只需 3.3m（Codex blocking③，PR #255
  // 复审；初版 Kruskal 近似在此多算 0.7m × 附加芯数 × 损耗系数）。
  const star: TravelerGraphEdge[] = [
    { routeId: 's-ab', a: 'swA', b: 'swB', length: 2, stubA: 0, stubB: 0 },
    { routeId: 's-bc', a: 'swB', b: 'swC', length: 2, stubA: 0, stubB: 0 },
    { routeId: 's-ac', a: 'swA', b: 'swC', length: 2, stubA: 0, stubB: 0 },
    { routeId: 's-ao', a: 'swA', b: 'O', length: 1.1, stubA: 0, stubB: 0 },
    { routeId: 's-bo', a: 'swB', b: 'O', length: 1.1, stubA: 0, stubB: 0 },
    { routeId: 's-co', a: 'swC', b: 'O', length: 1.1, stubA: 0, stubB: 0 },
  ];
  assert.ok(Math.abs(travelerSubtreeLength(star, ['swA', 'swB', 'swC']) - 3.3) < 1e-9);
  // 单控不成组、无路不通，各计 0；折线未下引的 stub 只计成员开关端。
  assert.equal(travelerSubtreeLength(edges, ['swA']), 0);
  assert.equal(travelerSubtreeLength(edges, ['swA', 'swZ']), 0);
  const stubbed: TravelerGraphEdge[] = [
    { routeId: 's1', a: 'swA', b: 'lightX', length: 3, stubA: 1.5, stubB: 0 },
    { routeId: 's2', a: 'lightX', b: 'swB', length: 4, stubA: 0, stubB: 2 },
  ];
  assert.equal(travelerSubtreeLength(stubbed, ['swA', 'swB']), 10.5);
  // 同 x/z 不同标高是不同的物理点：swA—(0,0,y=2.5) 与 (0,0,y=0.5)—swB
  // 之间未画连接，行程应为 0；旧 travelerNodeKey 只取 x/z，两端合并成一个
  // 节点、凭空算出 2m（Codex blocking，PR #255 复审第 4 轮）。
  const heights: TravelerGraphEdge[] = [
    { routeId: 'h1', a: 'swA', b: travelerNodeKey({ x: 0, z: 0 }, 2.5), length: 1, stubA: 0, stubB: 0 },
    { routeId: 'h2', a: travelerNodeKey({ x: 0, z: 0 }, 0.5), b: 'swB', length: 1, stubA: 0, stubB: 0 },
  ];
  assert.equal(travelerSubtreeLength(heights, ['swA', 'swB']), 0);
  // 对照：同 x/z 同标高的两端是同一个点，行程照常连通。
  const sameHeight: TravelerGraphEdge[] = [
    { routeId: 'h3', a: 'swA', b: travelerNodeKey({ x: 0, z: 0 }, 2.5), length: 1, stubA: 0, stubB: 0 },
    { routeId: 'h4', a: travelerNodeKey({ x: 0, z: 0 }, 2.5), b: 'swB', length: 1, stubA: 0, stubB: 0 },
  ];
  assert.equal(travelerSubtreeLength(sameHeight, ['swA', 'swB']), 2);
});

test('双控行程建图须认中途接入点：路由端点落在别条折线中途即连通（Codex blocking，PR #255 复审第 6 轮）', () => {
  // 最小输入（同回路、同标高 y=2.5，开关 stub 均为 0）：
  //   r1: swA(2,0) → J(0,0)，折线经中途点 (1,0)，长 2m；
  //   r2: swB(1,1) → 接入点 (1,0)，长 1m。
  // 已画网络 swA—swB 应为 2m（(2,0)→(1,0) 1m + (1,0)→(1,1) 1m）；
  // 旧建图把整条折线压成一条 from→to 边，(1,0) 节点悬空、行程计 0，
  // 两开关又都有 physical route，coverage 也不报，静默漏计。
  const miniRules: MepTakeoffRules = {
    sources: {
      electrical_points: 'config/electrical.yaml',
      plumbing_points: 'config/plumbing.yaml',
      circuits: 'config/electrical-topology.yaml',
      routes: 'config/mep-hvac-coordination.yaml',
      hvac: 'config/hvac.yaml',
    },
    covered_layers: ['strong_power'],
    excluded_layers: [],
    units: {
      cores_by_purpose: {},
      dual_control_extra_cores: 1,
      loss: { wire: 1.05, pipe: 1.08 },
      fitting_per_meter: { ppr: 0.35, pvc: 0.27 },
    },
    trunk_wire_size: null,
    include_terminal_drop: true,
    panel: { main_switch_poles: 1, spd_modules: 1, spare_ratio: 0, round_up: false },
  };
  const r1 = { id: 'r1', layer: 'strong_power', from: 'swA', to: { x: 0, z: 0 }, route_kind: 'physical' } as unknown as Parameters<typeof computeMepTakeoff>[0]['routes'][number];
  const r2 = { id: 'r2', layer: 'strong_power', from: 'swB', to: { x: 1, z: 0 }, route_kind: 'physical' } as unknown as Parameters<typeof computeMepTakeoff>[0]['routes'][number];
  const resolution = {
    total: 2,
    resolved: 2,
    unresolved: 0,
    diagnostics: [],
    routes: [
      {
        route: r1,
        from: { x: 2, z: 0, y: 2.5 },
        to: { x: 0, z: 0, y: 2.5 },
        points: [{ x: 2, y: 2.5, z: 0 }, { x: 1, y: 2.5, z: 0 }, { x: 0, y: 2.5, z: 0 }],
        viaPoints: [{ x: 1, y: 2.5, z: 0 }],
        unresolved: [],
        diagnostics: [],
        metadata: { physicalRoute: true, routeKind: 'physical' },
      },
      {
        route: r2,
        from: { x: 1, z: 1, y: 2.5 },
        to: { x: 1, z: 0, y: 2.5 },
        points: [{ x: 1, y: 2.5, z: 1 }, { x: 1, y: 2.5, z: 0 }],
        viaPoints: [],
        unresolved: [],
        diagnostics: [],
        metadata: { physicalRoute: true, routeKind: 'physical' },
      },
    ],
  } as unknown as Parameters<typeof computeMepTakeoff>[0]['resolution'];
  const mini = computeMepTakeoff({
    electrical: [
      { id: 'swA', room: 'living', type: 'switch', height: 2.5 },
      { id: 'swB', room: 'living', type: 'switch', height: 2.5 },
      { id: 'light1', room: 'living', type: 'light', height: 2.5 },
    ] as unknown as Parameters<typeof computeMepTakeoff>[0]['electrical'],
    plumbing: [],
    circuits: [{ id: 'c1', wire_size: '1.5mm²(φ16)', breaker: '漏保', member_point_ids: ['swA', 'swB', 'light1'] }],
    controls: [{ id: 'ctl1', switch_point_ids: ['swA', 'swB'], target_point_ids: ['light1'] }],
    routes: [r1, r2],
    resolution,
    rules: miniRules,
  });
  // 行程 2m × 1 附加芯 × 1.05 损耗 = 2.1m。生产值见下个测试（第 7 轮后为
  // 20.69445m：儿童房两开关经 Q1 接入，不再双计灯头→Q1 的 0.514m）。
  assert.ok(Math.abs(mini.wire.dualControlExtraM - 2.1) < 1e-9);
});

test('双控行程图须切分线段内部接入点：删去冗余 via 点不得改变行程（Codex blocking，PR #255 复审第 7 轮）', () => {
  // 与上个测试同一几何，但 r1 删去共线中间点 (1,0)，只留 (2,0)→(0,0) 一段：
  // 接入点 (1,0) 落在线段内部。旧逐段建边只认折线顶点，(1,0) 悬空、行程计 0；
  // 修复后该段在 (1,0) 处切分，行程仍为 2m。附加导线数量不能依赖冗余 via
  // 点是否存在。
  const miniRules: MepTakeoffRules = {
    sources: {
      electrical_points: 'config/electrical.yaml',
      plumbing_points: 'config/plumbing.yaml',
      circuits: 'config/electrical-topology.yaml',
      routes: 'config/mep-hvac-coordination.yaml',
      hvac: 'config/hvac.yaml',
    },
    covered_layers: ['strong_power'],
    excluded_layers: [],
    units: {
      cores_by_purpose: {},
      dual_control_extra_cores: 1,
      loss: { wire: 1.05, pipe: 1.08 },
      fitting_per_meter: { ppr: 0.35, pvc: 0.27 },
    },
    trunk_wire_size: null,
    include_terminal_drop: true,
    panel: { main_switch_poles: 1, spd_modules: 1, spare_ratio: 0, round_up: false },
  };
  const r1 = { id: 'r1', layer: 'strong_power', from: 'swA', to: { x: 0, z: 0 }, route_kind: 'physical' } as unknown as Parameters<typeof computeMepTakeoff>[0]['routes'][number];
  const r2 = { id: 'r2', layer: 'strong_power', from: 'swB', to: { x: 1, z: 0 }, route_kind: 'physical' } as unknown as Parameters<typeof computeMepTakeoff>[0]['routes'][number];
  const resolution = {
    total: 2,
    resolved: 2,
    unresolved: 0,
    diagnostics: [],
    routes: [
      {
        route: r1,
        from: { x: 2, z: 0, y: 2.5 },
        to: { x: 0, z: 0, y: 2.5 },
        points: [{ x: 2, y: 2.5, z: 0 }, { x: 0, y: 2.5, z: 0 }],
        viaPoints: [],
        unresolved: [],
        diagnostics: [],
        metadata: { physicalRoute: true, routeKind: 'physical' },
      },
      {
        route: r2,
        from: { x: 1, z: 1, y: 2.5 },
        to: { x: 1, z: 0, y: 2.5 },
        points: [{ x: 1, y: 2.5, z: 1 }, { x: 1, y: 2.5, z: 0 }],
        viaPoints: [],
        unresolved: [],
        diagnostics: [],
        metadata: { physicalRoute: true, routeKind: 'physical' },
      },
    ],
  } as unknown as Parameters<typeof computeMepTakeoff>[0]['resolution'];
  const mini = computeMepTakeoff({
    electrical: [
      { id: 'swA', room: 'living', type: 'switch', height: 2.5 },
      { id: 'swB', room: 'living', type: 'switch', height: 2.5 },
      { id: 'light1', room: 'living', type: 'light', height: 2.5 },
    ] as unknown as Parameters<typeof computeMepTakeoff>[0]['electrical'],
    plumbing: [],
    circuits: [{ id: 'c1', wire_size: '1.5mm²(φ16)', breaker: '漏保', member_point_ids: ['swA', 'swB', 'light1'] }],
    controls: [{ id: 'ctl1', switch_point_ids: ['swA', 'swB'], target_point_ids: ['light1'] }],
    routes: [r1, r2],
    resolution,
    rules: miniRules,
  });
  assert.ok(Math.abs(mini.wire.dualControlExtraM - 2.1) < 1e-9);
  // 对照：异标高接入不成节点——r2 整条折线改到 y=0.5（与 r1 的 y=2.5 不同），
  // (1,0) 不再落在 r1 线段上（标高不一致），行程仍为 0。同回路、同标高才
  // 切分，跨高度串线不是接入。
  const lowResolution = {
    total: 2,
    resolved: 2,
    unresolved: 0,
    diagnostics: [],
    routes: [
      {
        route: r1,
        from: { x: 2, z: 0, y: 2.5 },
        to: { x: 0, z: 0, y: 2.5 },
        points: [{ x: 2, y: 2.5, z: 0 }, { x: 0, y: 2.5, z: 0 }],
        viaPoints: [],
        unresolved: [],
        diagnostics: [],
        metadata: { physicalRoute: true, routeKind: 'physical' },
      },
      {
        route: r2,
        from: { x: 1, z: 1, y: 0.5 },
        to: { x: 1, z: 0, y: 0.5 },
        points: [{ x: 1, y: 0.5, z: 1 }, { x: 1, y: 0.5, z: 0 }],
        viaPoints: [],
        unresolved: [],
        diagnostics: [],
        metadata: { physicalRoute: true, routeKind: 'physical' },
      },
    ],
  } as unknown as Parameters<typeof computeMepTakeoff>[0]['resolution'];
  const otherHeight = computeMepTakeoff({
    electrical: [
      { id: 'swA', room: 'living', type: 'switch', height: 2.5 },
      { id: 'swB', room: 'living', type: 'switch', height: 0.5 },
      { id: 'light1', room: 'living', type: 'light', height: 2.5 },
    ] as unknown as Parameters<typeof computeMepTakeoff>[0]['electrical'],
    plumbing: [],
    circuits: [{ id: 'c1', wire_size: '1.5mm²(φ16)', breaker: '漏保', member_point_ids: ['swA', 'swB', 'light1'] }],
    controls: [{ id: 'ctl1', switch_point_ids: ['swA', 'swB'], target_point_ids: ['light1'] }],
    routes: [r1, r2],
    resolution: lowResolution,
    rules: miniRules,
  });
  assert.equal(otherHeight.wire.dualControlExtraM, 0);
});

test('双控行程节点身份须统一：ID 端点与坐标切分点同位置即同一节点（Codex blocking，PR #255 复审第 8 轮）', () => {
  // 与第 7 轮夹具同一几何，但 r2 终点改写为灯位 ID L，L 解析到与 (1,0)
  // 完全相同的位置。旧建图下 L 成节点 'L'、切分点成 'coord:1000,0,2500'，
  // 同一物理接点两个节点、行程归零；修复后坐标点先查端点登记表，落在本回
  // 路某点位 ID 的已解位置上时改用 ID，行程仍为 2m。
  const miniRules: MepTakeoffRules = {
    sources: {
      electrical_points: 'config/electrical.yaml',
      plumbing_points: 'config/plumbing.yaml',
      circuits: 'config/electrical-topology.yaml',
      routes: 'config/mep-hvac-coordination.yaml',
      hvac: 'config/hvac.yaml',
    },
    covered_layers: ['strong_power'],
    excluded_layers: [],
    units: {
      cores_by_purpose: {},
      dual_control_extra_cores: 1,
      loss: { wire: 1.05, pipe: 1.08 },
      fitting_per_meter: { ppr: 0.35, pvc: 0.27 },
    },
    trunk_wire_size: null,
    include_terminal_drop: true,
    panel: { main_switch_poles: 1, spd_modules: 1, spare_ratio: 0, round_up: false },
  };
  const r1 = { id: 'r1', layer: 'strong_power', from: 'swA', to: { x: 0, z: 0 }, route_kind: 'physical' } as unknown as Parameters<typeof computeMepTakeoff>[0]['routes'][number];
  const r2 = { id: 'r2', layer: 'strong_power', from: 'swB', to: 'lightJ', route_kind: 'physical' } as unknown as Parameters<typeof computeMepTakeoff>[0]['routes'][number];
  const resolution = {
    total: 2,
    resolved: 2,
    unresolved: 0,
    diagnostics: [],
    routes: [
      {
        route: r1,
        from: { x: 2, z: 0, y: 2.5 },
        to: { x: 0, z: 0, y: 2.5 },
        points: [{ x: 2, y: 2.5, z: 0 }, { x: 0, y: 2.5, z: 0 }],
        viaPoints: [],
        unresolved: [],
        diagnostics: [],
        metadata: { physicalRoute: true, routeKind: 'physical' },
      },
      {
        route: r2,
        from: { x: 1, z: 1, y: 2.5 },
        to: { x: 1, z: 0, y: 2.5 },
        points: [{ x: 1, y: 2.5, z: 1 }, { x: 1, y: 2.5, z: 0 }],
        viaPoints: [],
        unresolved: [],
        diagnostics: [],
        metadata: { physicalRoute: true, routeKind: 'physical' },
      },
    ],
  } as unknown as Parameters<typeof computeMepTakeoff>[0]['resolution'];
  const mini = computeMepTakeoff({
    electrical: [
      { id: 'swA', room: 'living', type: 'switch', height: 2.5 },
      { id: 'swB', room: 'living', type: 'switch', height: 2.5 },
      { id: 'light1', room: 'living', type: 'light', height: 2.5 },
      { id: 'lightJ', room: 'living', type: 'light', height: 2.5 },
    ] as unknown as Parameters<typeof computeMepTakeoff>[0]['electrical'],
    plumbing: [],
    circuits: [{ id: 'c1', wire_size: '1.5mm²(φ16)', breaker: '漏保', member_point_ids: ['swA', 'swB', 'light1', 'lightJ'] }],
    controls: [{ id: 'ctl1', switch_point_ids: ['swA', 'swB'], target_point_ids: ['light1'] }],
    routes: [r1, r2],
    resolution,
    rules: miniRules,
  });
  assert.ok(Math.abs(mini.wire.dualControlExtraM - 2.1) < 1e-9);
  // 生产值 20.69445m 不变：live 切分点均不与 ID 端点位置重合，统一身份无新增连接。
});

test('双控附加控制线按控制声明算行程：生产值 20.69445m（2026-11-16 量价算法审计）', () => {
  // 独立推导（测试内手写循环，不复用 takeoff 的图算法）：行程边按控制声明手点——
  // 主卧三控：north↔L + north↔door；书房双控：灯↔门口 + 灯↔床头；
  // 儿童房双控：灯↔门口 + 灯↔床头。客厅双控未画线计 0；书房门口单控计 0；
  // 起夜支路（switch_guest_bed → night_guest_head）不是行程，不计。
  // 旧口径（点位 type + 对半分）算出 20.3821m，本断言在其上会红。
  const byId = new Map(resolution.routes.map((item) => [item.route.id, item]));
  const yOf = (point: { y?: number }): number => {
    if (point.y === undefined) throw new Error('test setup: resolved point missing y');
    return point.y;
  };
  const len = (id: string): number => {
    const points = (byId.get(id) as { points: Array<{ x: number; y?: number; z: number }> }).points;
    let total = 0;
    for (let i = 1; i < points.length; i += 1) {
      total += Math.hypot(points[i].x - points[i - 1].x, yOf(points[i]) - yOf(points[i - 1]), points[i].z - points[i - 1].z);
    }
    return total;
  };
  // 主卧 6.498m、书房 7.350m：两组无中途接入，行程 = 各路由长之和。
  // 儿童房 5.861m（第 7 轮修正，原 6.889m）：child-bed 的转弯点
  // Q1 (4.1,3.214,2.7) 落在 child-door 的 (4.1,2.7)→(4.1,4.3) 段内部，
  // 两开关经 Q1 相连，不再经灯头绕行——灯头→Q1 的 0.514m（z 2.7→3.214）
  // 旧树双计（两路由各含一次），新树只在 Q1 会合处计一次，减 2×0.514：
  // switch_child→Q1 2.861m + switch_child_bed→Q1 3.0m = 5.861m。
  // 行程合计 6.498 + 7.350 + 5.861 = 19.709m。
  const travelerM = len('strong-light-bedrooms-master-bed-l') + len('strong-light-bedrooms-master-door')
    + len('strong-light-bedrooms-study-door') + len('strong-light-bedrooms-study-guest-bed')
    + len('strong-light-bedrooms-child-door') + len('strong-light-bedrooms-child-bed')
    - 2 * (3.214 - 2.7);
  const expected = travelerM * rules.units.dual_control_extra_cores * rules.units.loss.wire;
  assert.ok(Math.abs(takeoff.wire.dualControlExtraM - expected) < 1e-6,
    `双控附加应为行程 ${travelerM.toFixed(3)}m × 1 芯 × 1.05 = ${expected.toFixed(5)}m，实际 ${takeoff.wire.dualControlExtraM}`);
});

test('byCircuit 诊断导线量之和等于总量减双控附加（分桶芯数取本回路声明）', () => {
  const sum = takeoff.byCircuit.reduce((total, item) => total + item.wireM, 0);
  assert.ok(Math.abs(sum - (takeoff.wire.totalWireM - takeoff.wire.dualControlExtraM)) < 1e-6,
    `byCircuit 之和 ${sum} 应等于 totalWireM − dualControlExtraM ${takeoff.wire.totalWireM - takeoff.wire.dualControlExtraM}`);
});

/**
 * 2026-10-14 阶段 4：算量规则/坐标缺失一律 fail-closed，不按兜底值继续算。
 *
 * 这一组钉的是失败方式：过去这些值缺失时会各自兜底（损耗 1.0、双控附加 0 芯、
 * 折线点标高 0、终点标高 0、无 breaker 不算漏保、管件系数硬编码在报价层），
 * 每一种都仍会产出一份"结构完整"的量表——`unresolved` 里也确实有记录，
 * 但忽略 `feasibleForQuote` 的下游拿到的是错数，不是"待定"。
 */
const cloneRules = (): MepTakeoffRules => JSON.parse(JSON.stringify(rules)) as MepTakeoffRules;

/** 与文件顶部同一套 as 断言：本文件的 electrical/plumbing 是 Record 视图，只喂测试。 */
const elec = electrical as unknown as Parameters<typeof computeMepTakeoff>[0]['electrical'];
const plumb = plumbing as unknown as Parameters<typeof computeMepTakeoff>[0]['plumbing'];

test('算量规则缺失即抛错：损耗 / 双控附加芯 / 管件系数都不兜底', () => {
  const base = {
    electrical: elec, plumbing: plumb,
    circuits: topology.circuits,
    controls: topology.controls ?? [],
    routes: coordination.routes,
    resolution,
  };
  const withoutLoss = cloneRules();
  delete (withoutLoss.units as { loss?: unknown }).loss;
  assert.throws(() => computeMepTakeoff({ ...base, rules: withoutLoss }), /units\.loss\.wire/);

  const zeroLoss = cloneRules();
  zeroLoss.units.loss = { wire: 0, pipe: 1.08 };
  assert.throws(() => computeMepTakeoff({ ...base, rules: zeroLoss }), /units\.loss\.wire/,
    '零损耗等于"施工不用余料"，物理上不成立');

  const withoutFittings = cloneRules();
  delete (withoutFittings.units as { fitting_per_meter?: unknown }).fitting_per_meter;
  assert.throws(() => computeMepTakeoff({ ...base, rules: withoutFittings }), /units\.fitting_per_meter\.ppr/,
    '管件系数过去硬编码在 server/mep-quotes.ts（0.35 / 0.27），依据只在报价卡 scope_note 散文里');

  const withoutDual = cloneRules();
  delete (withoutDual.units as { dual_control_extra_cores?: unknown }).dual_control_extra_cores;
  assert.throws(() => computeMepTakeoff({ ...base, rules: withoutDual }), /units\.dual_control_extra_cores/);
});

test('管件数量由声明的 fitting_per_meter 派生，并随 takeoff 输出（报价层只读量）', () => {
  const water = takeoff.pipe.water.reduce((sum, bucket) => sum + bucket.meters, 0);
  const drainage = takeoff.pipe.drainage.reduce((sum, bucket) => sum + bucket.meters, 0);
  assert.ok(Math.abs(takeoff.pipe.fittings.ppr - water * rules.units.fitting_per_meter.ppr) < 1e-9);
  assert.ok(Math.abs(takeoff.pipe.fittings.pvc - drainage * rules.units.fitting_per_meter.pvc) < 1e-9);
  assert.ok(takeoff.pipe.fittings.ppr > 0 && takeoff.pipe.fittings.pvc > 0, '管件数必须是正数（0 = 静默漏计）');
});

test('同线径分桶混装不同芯数时 byCircuit 取本回路芯数（2026-11-16 量价算法审计）', () => {
  // 两回路同为 2.5mm²，但 purpose 芯数不同（lighting 2 芯 / ordinary_power 4 芯）。
  // 旧口径取分桶首条回路的 cores：B 回路的诊断 wireM 会按 2 芯算（11.13m），
  // 正确应为 4 芯（22.26m）。总量（totalWireM）一直按各回路芯数累加，是对的，只验 byCircuit。
  const synthRules = cloneRules();
  synthRules.units.cores_by_purpose = { lighting: 2, ordinary_power: 4 };
  const synthElectrical = [
    { id: 'sock_a', type: 'socket', room: 'test_room', x: 3, z: 0, height: 0.3 },
    { id: 'sock_b', type: 'socket', room: 'test_room', x: 3, z: 1, height: 0.3 },
  ];
  const synthCoordination = parseMepCoordination(`
version: '1'
status: synthetic-test
layers:
  strong_power: { label: 强电, color: '#000000', height: 2.55 }
  weak_power: { label: 弱电, color: '#000000', height: 2.55 }
  water_supply: { label: 给水, color: '#000000', height: 0.18 }
  drainage: { label: 排水, color: '#000000', height: 0.1 }
  refrigerant: { label: 冷媒, color: '#000000', height: 2.4 }
  condensate: { label: 冷凝水, color: '#000000', height: 2.4 }
  supply_air: { label: 送风, color: '#000000', height: 2.4 }
  return_air: { label: 回风, color: '#000000', height: 2.4 }
routes:
  - id: test-mixed-a
    layer: strong_power
    status: inferred
    route_kind: physical
    from: { x: 0, z: 0, y: 2.55 }
    via: [{ x: 3, z: 0, y: 2.55 }]
    to: sock_a
    to_height: 2.55
  - id: test-mixed-b
    layer: strong_power
    status: inferred
    route_kind: physical
    from: { x: 0, z: 1, y: 2.55 }
    via: [{ x: 3, z: 1, y: 2.55 }]
    to: sock_b
    to_height: 2.55
`);
  const synthSources = endpointSourcesFromFacts({
    electrical: synthElectrical as unknown as Parameters<typeof endpointSourcesFromFacts>[0]['electrical'],
    plumbing: [] as unknown as Parameters<typeof endpointSourcesFromFacts>[0]['plumbing'],
    ceiling: [] as unknown as Parameters<typeof endpointSourcesFromFacts>[0]['ceiling'],
    hvac: { plans: [] } as unknown as Parameters<typeof endpointSourcesFromFacts>[0]['hvac'],
  });
  const synthResolution = resolveMepRoutes(synthCoordination, synthSources);
  const synthCircuits = [
    { id: 'TEST-M1', purpose: 'lighting', wire_size: '2.5mm²(φ20)', breaker: 'C16', member_point_ids: ['sock_a'] },
    { id: 'TEST-M2', purpose: 'ordinary_power', wire_size: '2.5mm²(φ20)', breaker: 'C20', member_point_ids: ['sock_b'] },
  ] as TakeoffCircuit[];
  const synth = computeMepTakeoff({
    electrical: synthElectrical as unknown as Parameters<typeof computeMepTakeoff>[0]['electrical'],
    plumbing: [] as unknown as Parameters<typeof computeMepTakeoff>[0]['plumbing'],
    circuits: synthCircuits,
    controls: [],
    routes: synthCoordination.routes,
    resolution: synthResolution,
    rules: synthRules,
  });
  const byId = new Map(synth.byCircuit.map((item) => [item.circuitId, item]));
  // 每回路计价 5.30m（3m 平面 union 3.05 + 下引 2.25）；A: 5.30×2×1.05=11.13，B: 5.30×4×1.05=22.26。
  assert.ok(Math.abs((byId.get('TEST-M1')?.wireM ?? -1) - 11.13) < 1e-6,
    `A 回路诊断 wireM 应为 11.13，实际 ${byId.get('TEST-M1')?.wireM}`);
  assert.ok(Math.abs((byId.get('TEST-M2')?.wireM ?? -1) - 22.26) < 1e-6,
    `B 回路诊断 wireM 应为 22.26（4 芯），实际 ${byId.get('TEST-M2')?.wireM}`);
  assert.equal(byId.get('TEST-M2')?.cores, 4);
});

test('回路缺 breaker 声明即抛错：漏保数量不能靠"没声明=没有"少算', () => {
  const stripped = topology.circuits.map((circuit, index) => (
    index === 0 ? { ...circuit, breaker: undefined } : circuit
  )) as TakeoffCircuit[];
  assert.throws(() => computeMepTakeoff({
    electrical: elec, plumbing: plumb,
    circuits: stripped,
    controls: topology.controls ?? [],
    routes: coordination.routes,
    resolution,
    rules,
  }), /缺 breaker 声明/);
});

test('折线点缺 y 标高即抛错：不按 0 算（否则吊顶内的水平段变成竖直段）', () => {
  // 目标路由动态选取：首条含绝对弯点的路由（强电干线切片后 strong-main 已关系化，
  // 钉死它会随后续批迁移而失效；选首条含坐标 via 的路由，本质是“任一绝对弯点缺 y 即抛”）。
  const target = coordination.routes.find((route) => route.via.some(isMepViaCoordinate));
  assert.ok(target, '须有一条含绝对弯点的路由可供构造缺 y 场景');
  const broken = coordination.routes.map((route) => (
    route.id === target.id
      ? { ...route, via: route.via.filter(isMepViaCoordinate).map((point) => ({ x: point.x, z: point.z })) }
      : route
  ));
  const brokenResolution = resolveMepRoutes({ ...coordination, routes: broken } as typeof coordination, sources);
  assert.throws(() => computeMepTakeoff({
    electrical: elec, plumbing: plumb,
    circuits: topology.circuits,
    controls: topology.controls ?? [],
    routes: broken,
    resolution: brokenResolution,
    rules,
  }), /缺 y 标高/);
});

test('竖向下引段的终点标高与折线标高同一个表达式：缺声明时先由折线守卫 fail-closed', () => {
  // terminalDrop 用的是 `to_height ?? to.y`，与 mepRoutePoints 给折线点的赋值同源。
  // 所以"终点标高缺失"今天由 requirePointY 先拦下（错误信息指到同一个 config 字段），
  // 竖向下引段不可能静默按 0 消失。这里把这条不变量钉住：抽掉 to_height 后，
  // 整条 takeoff 抛错而不是产出一份少了 2.2m/个管长的量表。
  const stripped = coordination.routes.map((route) => {
    if (route.to_height === undefined) return route;
    const { to_height: _dropped, ...rest } = route as Record<string, unknown>;
    return rest as typeof route;
  });
  const strippedResolution = resolveMepRoutes({ ...coordination, routes: stripped } as typeof coordination, sources);
  assert.throws(() => computeMepTakeoff({
    electrical: elec, plumbing: plumb,
    circuits: topology.circuits,
    controls: topology.controls ?? [],
    routes: stripped,
    resolution: strippedResolution,
    rules,
  }), /标高/);
  // 对照组：原样规则下竖向下引段确实被算出来（不是 0），否则上面的断言只是"什么都没算"。
  assert.ok(takeoff.conduit.terminalDropM > 0, `竖向下引段应为正（实际 ${takeoff.conduit.terminalDropM}m）`);
});
