import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { load as parseYaml } from 'js-yaml';
import {
  endpointSourcesFromFacts,
  parseMepCoordination,
  resolveMepRoutes,
} from '../../shared/mep-hvac-coordination-schema.js';
import { computeMepTakeoff, parseWireSizeMm2, type MepTakeoffRules, type TakeoffCircuit } from '../../shared/mep-takeoff.js';

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
const ceiling = parseYaml(readFileSync('config/ceiling.yaml', 'utf8')) as unknown[];
const topology = parseYaml(readFileSync('config/electrical-topology.yaml', 'utf8')) as {
  circuits: TakeoffCircuit[];
  controls?: Array<{ switch_point_ids?: string[]; target_point_ids?: string[] }>;
};
const coordination = parseMepCoordination(readFileSync('config/mep-hvac-coordination.yaml', 'utf8'));

const sources = endpointSourcesFromFacts({
  electrical: electrical as unknown as Parameters<typeof endpointSourcesFromFacts>[0]['electrical'],
  plumbing: plumbing as unknown as Parameters<typeof endpointSourcesFromFacts>[0]['plumbing'],
  ceiling: ceiling as unknown as Parameters<typeof endpointSourcesFromFacts>[0]['ceiling'],
  hvac: hvac as unknown as Parameters<typeof endpointSourcesFromFacts>[0]['hvac'],
});
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

test('端点全部可解析：130 条路由 0 悬空（含 hvac anchors 的 bend_corridor）', () => {
  assert.equal(resolution.total, 130); // R1 删两条照明路由 137→135；R2 删四条卫浴照明路由 135→131；DEC-2026-10-13-R5 删电视墙灯带路由 131→130
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
function independentLayerLength(layer: string): number {
  let total = 0;
  for (const route of coordination.routes) {
    if (route.layer !== layer) continue;
    const resolved = resolution.routes.find((item) => item.route.id === route.id);
    if (!resolved || resolved.unresolved.length > 0 || !resolved.metadata.physicalRoute) continue;
    const points: Array<[number, number, number]> = [];
    // 与 mepRoutePoints 同优先级：路由自己声明的 from_height/to_height 优先于点位高度
    if (resolved.from) points.push([resolved.from.x, route.from_height ?? resolved.from.y ?? 0, resolved.from.z]);
    for (const via of route.via) points.push([via.x, via.y ?? 0, via.z]);
    if (resolved.to) points.push([resolved.to.x, route.to_height ?? resolved.to.y ?? 0, resolved.to.z]);
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
    // 竖向下引段：终点有点位高度声明时，to_height − height（负值取 0）
    if (typeof route.to === 'string') {
      const height = pointHeights.get(route.to);
      if (height !== undefined && resolved.to) {
        total += Math.max(0, (route.to_height ?? resolved.to.y ?? 0) - height);
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

test('导线按 topology wire_size 分桶，不按 id 猜', () => {
  const bySize = new Map(takeoff.wire.bySize.map((bucket) => [bucket.wireSize, bucket]));
  assert.deepEqual([...bySize.keys()].sort(), ['1.5', '2.5', '4.0']);
  // 20 回路 = 1.5mm²×4（照明）+ 2.5mm²×14 + 4.0mm²×2（外机/厨房）。
  // 删除 allowance 后（DEC-2026-10-07-M03），**只有画了路由的回路才进导线量**：
  // 某个回路的点位全部未路由时该回路不出现在桶里（无管长即无导线），故 2.5mm² 现为 13 个。
  assert.equal(bySize.get('1.5')!.circuits.length, 4); // DEC-2026-10-13-R5 删 lighting_tv_ambient（1.5mm² 照明回路）后 5→4
  assert.equal(bySize.get('2.5')!.circuits.length, 13);
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
  assert.equal(takeoff.coverage.routedPointIds.length, 97); // W02：+water_heater 锚点；R1 删两条照明路由后 104→102；R2 删 strong-light-gbath/-mbath-panel/-mbath-switch/-gbath-switch 四条卫浴照明路由后 102→98；DEC-2026-10-13-R5 删 strong-light-tv 后 98→97
  assert.equal(takeoff.coverage.byType.socket?.routed, 34);
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
  assert.equal(takeoff.coverage.unroutedPointIds.length, electricalCount + plumbingCount - 97); // R1：电气点位 107→105、已路由 104→102；R2：电气点位 105→101、已路由 102→98；DEC-2026-10-13-R5 电气点位 101→100、已路由 98→97
  // 未路由点位逐条显形，不进采购量
  assert.equal(takeoff.coverage.unroutedPoints.length, takeoff.coverage.unroutedPointIds.length);
});

test('显形项契约：unresolved 只允许"主干线径未裁定"这一条', () => {
  assert.equal(takeoff.unresolved.length, 1);
  assert.equal(takeoff.unresolved[0].id, 'trunk_strong_main');
  assert.equal(takeoff.feasibleForQuote, false, '主干线径未裁定前不得进入报价');
});

test('requirement 路由只显形不计量：2 条待决（入户花园 #48）', () => {
  // 2026-10-07 v1：6 条给水 + 1 条排水 requirement 已按推断锚点提升为 physical（uncertainty ±0.3m、
  // construction_status 恒 pending），剩余 2 条属 pending-site-data 第48项"入户花园去留未决"——未决不计量的。
  assert.equal(takeoff.requirementRoutes.length, 2);
  assert.deepEqual(takeoff.requirementRoutes.map((item) => item.id).sort(), ['drain-garden-requirement', 'water-garden-requirement']);
  assert.ok(takeoff.requirementRoutes.every((item) => item.routeKind === 'requirement'));
  for (const item of takeoff.requirementRoutes) {
    assert.ok(!takeoff.coverage.routedPointIds.includes(item.id), 'requirement 路由不算覆盖');
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
  assert.equal(takeoff.devices.boxes, 75); // DEC-2026-10-12-R2 删 switch_mbath/switch_gbath 两个开关底盒后 77→75
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
  const broken = coordination.routes.map((route) => (
    route.id === 'strong-main'
      ? { ...route, via: route.via.map((point) => ({ x: point.x, z: point.z })) }
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
