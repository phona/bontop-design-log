import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeMepTakeoff,
  type MepTakeoffRules,
} from '../../shared/mep-takeoff.js';

/**
 * 双控行程图矩阵测试（PR #255 结构性收尾，2026-11-17）。
 *
 * 背景：第 6–14 轮 Codex 审出的洞全在行程图构造里，根因是同一规则写在两处。
 * 收尾把规则收成一处（见 shared/mep-takeoff.ts 图规格），本文件按“接入点位置 ×
 * 路由有效性 × stub 高度 × 开关 × 回路归属”穷举已知维度；每个格子一个小用例、
 * 期望值手算。改行程图先加格子再改代码。
 *
 * 三条不变量（与代码内规格同源）：
 *  一、进图集合：只有 physical、非待激活的强电路由进图；
 *  二、节点身份：每个物理点恰好一个节点（坐标 key 与点位 ID 以零长身份边连通）；
 *  三、长度口径：每段在每个接入点切分，下引长度按开关统一口径。
 *
 * 覆盖表（格子 → 测试）：
 *  接入点位置：
 *    段内（J1）…………… mep-takeoff.test.ts「第 7 轮」
 *    段端点（J2）………… 同文件「第 6 轮」
 *    自己 stub 底（J3）… 同文件「第 12 轮」
 *    别人安装点（J4）… 同文件「第 13 轮」
 *    待激活路由 via（J5）… 本文件「待激活路由的 via 点不得切分有效路线」
 *  路由有效性：
 *    正常（V1）…………… 各测试
 *    待激活端点（V2）… 本文件「待激活路由的 via 点不得切分有效路线」
 *    非 physical（V3）… 本文件「非 physical 与弱电路由不得提供切分点」
 *    非强电层（V4）…… 同上（弱电分 run）
 *  stub 高度：
 *    高于安装点（H1）… 第 11/12/13 轮测试
 *    等于安装点（H2）… 第 6 轮测试（stub 为 0）
 *    低于安装点（H3）… 本文件「折线低于安装点时 stub 计 0、仍连通」
 *  开关：
 *    开（F1）…………… 第 12/13 轮测试
 *    关（F2）…………… 第 13 轮「stub 边长须受下引补计开关控制」+ 本文件 H3 分 run
 *  回路归属：
 *    同回路（C1）……… 各测试
 *    不同回路（C2）…… 本文件「跨回路分支不得连通」
 *  三开关星形 ………… mep-takeoff.test.ts「双控行程取开关间最小子树」
 *  重复折线首点 ……… 同文件「第 10 轮」
 *  连通性缺口：
 *    双控组分属多分量… 本文件「双控组开关分属不连通分量时须登记连通性缺口」
 *    跨回路开关……… 本文件「跨回路分支不得连通」（Codex major，PR #255 跟进 #256：
 *      成员在别的回路有路由时，覆盖度不报漏、components 只剩一个分量，须另查）
 */

type MiniPoint = { id: string; height: number; deferred?: boolean };
type MiniRoute = {
  id: string;
  from: string | { x: number; z: number };
  to: string | { x: number; z: number };
  points: Array<{ x: number; y: number; z: number }>;
  layer?: string;
  physical?: boolean;
};

const miniRules = (includeTerminalDrop: boolean): MepTakeoffRules => ({
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
  include_terminal_drop: includeTerminalDrop,
  panel: { main_switch_poles: 1, spd_modules: 1, spare_ratio: 0, round_up: false },
});

/** 最小双控输入：点位 + 路由 + 回路 + 控制声明，返回附加线量与未覆盖点位。 */
function travelerCase(input: {
  points: MiniPoint[];
  routes: MiniRoute[];
  circuits: Array<{ id: string; members: string[] }>;
  switches: string[];
  target: string;
  includeTerminalDrop?: boolean;
}): { extra: number; unroutedIds: string[]; unresolvedIds: string[] } {
  const routes = input.routes.map((r) => ({
    id: r.id,
    layer: r.layer ?? 'strong_power',
    from: r.from,
    to: r.to,
    route_kind: 'physical',
  }) as unknown as Parameters<typeof computeMepTakeoff>[0]['routes'][number]);
  const resolution = {
    total: routes.length,
    resolved: routes.length,
    unresolved: 0,
    diagnostics: [],
    routes: input.routes.map((r, index) => ({
      route: routes[index],
      from: r.points[0],
      to: r.points[r.points.length - 1],
      points: r.points,
      viaPoints: r.points.slice(1, -1),
      unresolved: [],
      diagnostics: [],
      metadata: { physicalRoute: r.physical ?? true, routeKind: 'physical' },
    })),
  } as unknown as Parameters<typeof computeMepTakeoff>[0]['resolution'];
  const out = computeMepTakeoff({
    electrical: input.points.map((p) => ({
      id: p.id,
      room: 'living',
      type: p.id.startsWith('sw') ? 'switch' : 'light',
      height: p.height,
      ...(p.deferred ? { status: 'pending', position_status: 'pending' } : {}),
    })) as unknown as Parameters<typeof computeMepTakeoff>[0]['electrical'],
    plumbing: [],
    circuits: input.circuits.map((c) => ({
      id: c.id,
      wire_size: '1.5mm²(φ16)',
      breaker: '漏保',
      member_point_ids: c.members,
    })),
    controls: [{ id: 'ctl1', switch_point_ids: input.switches, target_point_ids: [input.target] }],
    routes,
    resolution,
    rules: miniRules(input.includeTerminalDrop ?? true),
  });
  return {
    extra: out.wire.dualControlExtraM,
    unroutedIds: out.coverage.unroutedPoints.map((p) => p.id),
    unresolvedIds: out.unresolved.map((u) => u.id),
  };
}

// 两条有效路由十字交叉：r1 沿 x 走 (0,0)→(2,0)，r2 沿 z 走 (1,1)→(1,-1)，
// 交点 (1,0,2.5) 是两段的内部点、不是任一路由的顶点。开关 stub 均为 0
// （安装高 2.5 = 折线标高），故连通时行程恰为 2m × 1.05 = 2.1m。
const CROSS_POINTS: MiniPoint[] = [
  { id: 'swA', height: 2.5 },
  { id: 'swB', height: 2.5 },
  { id: 'light1', height: 2.5 },
];
const CROSS_ROUTES: MiniRoute[] = [
  // r1 以灯位收尾（light1 是受控灯，须有 physical route，否则进未覆盖清单）；
  // r2 以坐标收尾（分支端点不必是点位）。
  { id: 'r1', from: 'swA', to: 'light1', points: [{ x: 0, y: 2.5, z: 0 }, { x: 2, y: 2.5, z: 0 }] },
  { id: 'r2', from: 'swB', to: { x: 1, z: -1 }, points: [{ x: 1, y: 2.5, z: 1 }, { x: 1, y: 2.5, z: -1 }] },
];
const CROSS_CIRCUITS = [{ id: 'c1', members: ['swA', 'swB', 'light1'] }];

test('矩阵基线：两条有效路由十字交叉、交点不是顶点时不连通', () => {
  // 对照：交点 (1,0,2.5) 不在任何路由的折线点里，两段不切分、无共享节点，
  // 行程计 0。后面三个格子都在这组几何上加一条第三路由，只变第三路由的性质。
  const { extra, unroutedIds } = travelerCase({
    points: CROSS_POINTS,
    routes: CROSS_ROUTES,
    circuits: CROSS_CIRCUITS,
    switches: ['swA', 'swB'],
    target: 'light1',
  });
  assert.equal(extra, 0, `十字交叉无共享顶点时行程应为 0，实际 ${extra}`);
  assert.deepEqual(unroutedIds, [], '三点位都有 physical route，覆盖度不得报漏');
});

test('待激活路由的 via 点不得切分有效路线（Codex blocking，PR #255 复审第 14 轮）', () => {
  // J5/V2 格：第三路由 rP 端点 swP 待激活（status 与 position_status 均为
  // pending），折线 (1,3)→(1,0)→(1,-2)，via 点恰在交点 (1,0,2.5)。
  // 旧建图切分点收集没用主循环的 deferredEndpoint 排除，rP 的 via 点进了切分，
  // 两条有效路线在 (1,0) 处被切开、共享节点，行程从 0 变成 2.1m；基础导线量、
  // unresolved、unroutedPoints 全不变，静默抬高导线采购量。
  // 结构性收尾：切分点收集与图边构造共用 isTravelerRoute，待激活路由既不进边、
  // 也不提供切分点。
  const pendingRoute: MiniRoute = {
    id: 'rP',
    from: 'swP',
    to: { x: 1, z: -2 },
    points: [{ x: 1, y: 2.5, z: 3 }, { x: 1, y: 2.5, z: 0 }, { x: 1, y: 2.5, z: -2 }],
  };
  const { extra, unroutedIds } = travelerCase({
    points: [...CROSS_POINTS, { id: 'swP', height: 2.5, deferred: true }],
    routes: [...CROSS_ROUTES, pendingRoute],
    circuits: [{ id: 'c1', members: ['swA', 'swB', 'light1', 'swP'] }],
    switches: ['swA', 'swB'],
    target: 'light1',
  });
  assert.equal(extra, 0, `待激活路由不得改变行程，实际 ${extra}`);
  assert.deepEqual(unroutedIds, [], '待激活点位不进未覆盖清单，有效点位都有 physical route');
});

test('非 physical 与弱电路由不得提供切分点', () => {
  // V3/V4 格：第三路由与待激活格同一几何、同一交点，只变性质——
  // (a) 非 physical（需求路由）：主循环只显形不计量；
  // (b) 弱电层：不在 covered_layers 内。
  // 两者都不进图、也不提供切分点，行程保持 0。swX 只有这条非计量路由，
  // 本来就在未覆盖清单里（断言只看行程，不看覆盖度）。
  const thirdRoute = (id: string, layer: string | undefined, physical: boolean | undefined): MiniRoute => ({
    id,
    from: 'swX',
    to: { x: 1, z: -2 },
    points: [{ x: 1, y: 2.5, z: 3 }, { x: 1, y: 2.5, z: 0 }, { x: 1, y: 2.5, z: -2 }],
    ...(layer !== undefined ? { layer } : {}),
    ...(physical !== undefined ? { physical } : {}),
  });
  for (const [label, route] of [
    ['非 physical', thirdRoute('rQ', undefined, false)],
    ['弱电层', thirdRoute('rW', 'weak_power', true)],
  ] as const) {
    const { extra } = travelerCase({
      points: [...CROSS_POINTS, { id: 'swX', height: 2.5 }],
      routes: [...CROSS_ROUTES, route],
      circuits: [{ id: 'c1', members: ['swA', 'swB', 'light1', 'swX'] }],
      switches: ['swA', 'swB'],
      target: 'light1',
    });
    assert.equal(extra, 0, `${label}路由不得改变行程，实际 ${extra}`);
  }
});

test('跨回路分支不得连通', () => {
  // C2 格：r2 换到回路 c2（swB 在 c2 成员里），仍穿过交点 (1,0,2.5)。
  // 切分点按回路分桶，r2 的点进 c2 的桶、r1 的段只认 c1 的切分点；且控制目标
  // 灯在 c1，行程只在 c1 的边上找路。两处都不得跨回路串线，行程计 0。
  // 跨回路缺口还须登记（Codex major，PR #255 跟进 #256）：swB 在 c2 有物理路由，
  // 覆盖度按全局 drawnPointIds 算它已路由、components 在 c1 图里只剩 [swA]，
  // 两处都不报——缺口只能由控制循环另查。
  const { extra, unroutedIds, unresolvedIds } = travelerCase({
    points: CROSS_POINTS,
    routes: CROSS_ROUTES,
    circuits: [
      { id: 'c1', members: ['swA', 'light1'] },
      { id: 'c2', members: ['swB'] },
    ],
    switches: ['swA', 'swB'],
    target: 'light1',
  });
  assert.equal(extra, 0, `跨回路分支不得连通，实际 ${extra}`);
  assert.deepEqual(unroutedIds, [], 'swB 在 c2 有物理路由，覆盖度不得报漏——缺口不在覆盖度里、在 unresolved 里');
  assert.ok(unresolvedIds.includes('ctl1'),
    `跨回路开关 swB 有路由却不在目标回路 c1 的行程图里，unresolved 须登记控制组 ctl1，实际 unresolved=${JSON.stringify(unresolvedIds)}`);
});

test('折线低于安装点时 stub 计 0、仍连通', () => {
  // H3 格：两开关安装高 2.5，折线却在 y=1（低于安装点），下引落差为负——
  // 与 to 端同口径不计（器具自带尾段），stubAt 取 0；两路由在灯位 (1,0,1)
  // 共享节点，行程 = 2m × 1.05 = 2.1m。开关关掉后仍为 2.1m（stub 本来就是 0，
  // 开关不改变此格）。
  const points: MiniPoint[] = [
    { id: 'swA', height: 2.5 },
    { id: 'swB', height: 2.5 },
    { id: 'light', height: 2.5 },
  ];
  const routes: MiniRoute[] = [
    { id: 'rA', from: 'swA', to: 'light', points: [{ x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }] },
    { id: 'rB', from: 'swB', to: 'light', points: [{ x: 2, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }] },
  ];
  for (const includeTerminalDrop of [true, false]) {
    const { extra, unroutedIds } = travelerCase({
      points,
      routes,
      circuits: [{ id: 'c1', members: ['swA', 'swB', 'light'] }],
      switches: ['swA', 'swB'],
      target: 'light',
      includeTerminalDrop,
    });
    assert.ok(Math.abs(extra - 2.1) < 1e-9,
      `折线低于安装点时行程应为 2m × 1.05 = 2.1m（开关${includeTerminalDrop ? '开' : '关'}），实际 ${extra}`);
    assert.deepEqual(unroutedIds, [], '三点位都有 physical route，覆盖度不得报漏');
  }
});

test('双控组开关分属不连通分量时须登记连通性缺口（Codex major，PR #255 跟进）', () => {
  // Codex 最小用例：同回路两开关各接一条物理上不连通的路由——r1 沿 z=0、
  // r2 沿 z=5，两线无交点、无共享节点。行程计 0（未画线不进量、不估算），
  // 但缺口必须显形：unresolved 须登记该控制组，否则报价会把未画全的双控
  // 网络显示为完整计价。未画线的开关不在图里，已由覆盖度显形，不在此重复报。
  const points: MiniPoint[] = [
    { id: 'swA', height: 2.5 },
    { id: 'swB', height: 2.5 },
    { id: 'light1', height: 2.5 },
  ];
  const routes: MiniRoute[] = [
    { id: 'r1', from: 'swA', to: 'light1', points: [{ x: 0, y: 2.5, z: 0 }, { x: 2, y: 2.5, z: 0 }] },
    { id: 'r2', from: 'swB', to: { x: 2, z: 5 }, points: [{ x: 0, y: 2.5, z: 5 }, { x: 2, y: 2.5, z: 5 }] },
  ];
  const { extra, unroutedIds, unresolvedIds } = travelerCase({
    points,
    routes,
    circuits: [{ id: 'c1', members: ['swA', 'swB', 'light1'] }],
    switches: ['swA', 'swB'],
    target: 'light1',
  });
  assert.equal(extra, 0, `不连通的双控组行程应为 0（不估算未画线），实际 ${extra}`);
  assert.deepEqual(unroutedIds, [], '三点位都有 physical route，缺口不在覆盖度里、在 unresolved 里');
  assert.ok(unresolvedIds.includes('ctl1'),
    `双控组分属两个连通分量，unresolved 须登记控制组 ctl1，实际 unresolved=${JSON.stringify(unresolvedIds)}`);
});
