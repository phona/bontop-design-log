/**
 * hvac terminal 三项几何对账 lint（issue #98 第五阶段 S2 hvac 侧，业主 2026-11-08 裁定①②④）。
 *
 * 由来（phase5-survey.md §1.4 审计小结）：暖通侧「引用卫生干净 + 几何对账空缺」——
 * `scripts/verify/` 无一直读 terminal.position，校验器不校验任何位置关系。本文件补三个
 * 纯函数检查（无 I/O，输入是已解析对象），消费方：
 *   - tests/server/hvac-terminal-placement-guard.test.ts（test:server 门禁 + 绿/红变异固化）；
 *   - validateProjectHvacFacts（shared/project-render-facts-schema.ts）把 access offset 断言
 *     升为加载期硬门禁。
 *
 * 三项检查与裁定的对应：
 *   ① lintHvacTerminalCeilingBands —— 裁定一「风口必须落在吊顶带内」：terminal.position
 *      （单一源，不动）必须落在宿主房间某个吊顶分区的 area 边界内。这是物理必需
 *      （百叶装不进吊顶带就是废口），不是人造检查；**不是** zone 派生断言（§6.3-1 父对象
 *      口径未裁，停止条件 -1 禁止写解算分支——本检查只判「在带内/不在带内」，不计算派生值）。
 *   ② lintHvacAccessOffsets —— 裁定一落地：access 检修口 = 宿主 + 显式结构化 offset，
 *      断言 offset == position − serves_unit 宿主 position（容差 0.005m，验收铁律①）。
 *      坐标真值仍只有 position 一份，offset 是可校验的关系声明。
 *   ③ lintHvacLdDecoBandFill —— LD-deco 铺满 lint（§4.2 LD-deco 行 / §5.3 指标 7）：
 *      同一行上装饰段与功能段必须精确铺满带边界（ceiling_living area x 向），不留缝隙也不
 *      重叠；R18 附则的有意空白作为显式例外登记（例外本身受反向执法：不许为铺满把空白堵上）。
 */
import type { CeilingZone, HvacAnchor, HvacRoute, HvacTerminal } from './types.js';
import type { ResolvedMepRoute } from './mep-hvac-coordination-schema.js';
import { normalizeCeilingZone } from './ceiling-zone.js';

export type HvacTerminalLintLevel = 'error' | 'warning';
export interface HvacTerminalLintIssue {
  level: HvacTerminalLintLevel;
  code: string;
  message: string;
  terminalId?: string;
}

/**
 * S2 新增字段的局部交叉类型。`shared/types.ts` 不在本切片文件清单内，故这里以交叉类型
 * 承载 `offset`（access 检修口）——zod schema（project-render-facts-schema.ts）已把字段
 * 纳入 strict 解析，运行期形状由 superRefine + lintHvacAccessOffsets 保证一致。
 */
export type HvacTerminalWithOffset = HvacTerminal & { offset?: { x: number; z: number } };

/** 同上：schematic_only（裁定四的示意标注）的局部交叉类型，types.ts 不在本切片清单内。 */
export type HvacAnchorWithSchematicOnly = HvacAnchor & { schematic_only?: boolean };

/**
 * 同上：power 取电锚点的 serves_unit（issue #98 S3 显式化「哪个 anchor 服务哪台内机」）的
 * 局部交叉类型，types.ts 不在本切片清单内。zod schema（project-render-facts-schema.ts 的
 * HvacAnchorSchema）已把字段纳入 strict 解析并限 system=power。
 */
export type HvacAnchorWithServesUnit = HvacAnchor & { serves_unit?: string };

/**
 * 侧装口（mount_face ∈ north/south/east/west）的面容差（米）。
 *
 * 依据：既有声明惯例里侧装百叶中心线与分区面线差 0.010m——supply_living z=5.56 对
 * ceiling_living 南界 5.55（DEC-2026-10-15-C02「随新南边界 z=5.55 外移至中心 z=5.56」）、
 * supply_study z=6.16 对 ceiling_study_ac 南界 6.15、supply_child z=3.69 对 ceiling_child_ac
 * 北界 3.70（DEC-2026-10-28-R03 同款）。百叶面板骑在吊顶带立面上，中心线越出面线半板厚
 * 是装配语言不是漂移；0.02 > 0.010 惯例差、远小于有意义的位移，底装口不享受容差。
 */
export const TERMINAL_FACE_PLANE_TOLERANCE_M = 0.02;

/** 转写/对账断言容差（米）：验收铁律①的 0.005m，同第四阶段 S1/S2 节奏。 */
export const HVAC_ASSERT_TOLERANCE_M = 0.005;

/** LD-deco 行分组与铺满判定的精确容差（米）：段端 = 相邻段边或带边，是字面同一数值。 */
export const LD_DECO_EXACT_EPSILON_M = 1e-6;

/** LD-deco 行 z 分组容差（米）：同一行各段 z 是同一字面值，0.005 只吸收手改抖动。 */
export const LD_DECO_ROW_EPSILON_M = 0.005;

/**
 * R18 附则有意空白登记（显式例外，不许为铺满把空白堵上）。
 *
 * 证据：phase5-survey.md §3-7「两条底面行恰好铺满 [7.20,13.40]（A survey2 §C 实跑 tiles
 * band exactly），侧面南行缺口 [13.2,13.4]、北行缺口 [7.2,7.7]（R18 附则写明的有意空白）」；
 * 北行空白的 config 内声明见 hvac.yaml supply_dining / LD-deco-side-north reason
 * 「西端 x[7.20,7.70] 保持与餐厅西服务带 ceiling_dining_west_band 的正交交接、不贴百叶
 * （R18 附则）」。blank x1/x2 必须与带边界或相邻段端字面相等（ld_deco_row_gap 联合执法）。
 */
export interface LdDecoIntentionalBlank {
  mount_face: 'north' | 'south' | 'east' | 'west' | 'bottom';
  z: number;
  x1: number;
  x2: number;
  basis: string;
}
export const LD_DECO_INTENTIONAL_BLANKS: readonly LdDecoIntentionalBlank[] = [
  {
    mount_face: 'north', z: 4.30, x1: 7.20, x2: 7.70,
    basis: 'R18 附则：与 ceiling_dining_west_band 正交交接、不贴百叶（hvac.yaml supply_dining reason；phase5-survey.md §3-7 北行缺口）',
  },
  {
    mount_face: 'south', z: 5.56, x1: 13.20, x2: 13.40,
    basis: 'R18 附则：南侧立面东端有意空白（phase5-survey.md §3-7 南行缺口，A survey2 §C 实测）',
  },
];

export interface HvacTerminalLintInput {
  terminals: readonly HvacTerminalWithOffset[];
  ceiling: readonly CeilingZone[];
  /** 宿主房间经 route 链（indoor_* anchor → terminal）解析时需要；access 走 serves_unit。 */
  anchors?: readonly HvacAnchor[];
  routes?: readonly HvacRoute[];
}

function issue(level: HvacTerminalLintLevel, code: string, message: string, terminalId?: string): HvacTerminalLintIssue {
  return { level, code, message, terminalId };
}

function bandZones(ceiling: readonly CeilingZone[]): CeilingZone[] {
  return ceiling.filter((zone) => zone.area !== undefined);
}

/** 侧装口享面容差（见 TERMINAL_FACE_PLANE_TOLERANCE_M），底装/检修口必须严格在界内。 */
function zoneContainsPoint(zone: CeilingZone, x: number, z: number, sideTolerance: number): boolean {
  const [x1, z1, x2, z2] = zone.area as [number, number, number, number];
  return x >= x1 - sideTolerance && x <= x2 + sideTolerance && z >= z1 - sideTolerance && z <= z2 + sideTolerance;
}

function terminalFaceTolerance(terminal: HvacTerminal): number {
  return terminal.mount_face !== undefined && terminal.mount_face !== 'bottom' ? TERMINAL_FACE_PLANE_TOLERANCE_M : 0;
}

/**
 * terminal 的宿主房间（若可解析）：access 走 serves_unit → ac_*.room；supply/return 走
 * route 链（from = ref ceiling ac_* 的 indoor anchor，to = 本 terminal）→ ac_*.room。
 * LD-deco 无宿主声明 → 返回 undefined（退化为「任意吊顶分区」的粗检查）。
 * 只读既有声明（route/ref/serves_unit），**不发明 placement:{ref} 类新声明**（裁定一）。
 */
function resolveHostRoomId(terminal: HvacTerminal, anchors: readonly HvacAnchor[], routes: readonly HvacRoute[], zoneById: Map<string, CeilingZone>): string | undefined {
  if (terminal.serves_unit !== undefined) return zoneById.get(terminal.serves_unit)?.room;
  if (terminal.system === 'supply_air' || terminal.system === 'return_air') {
    for (const route of routes) {
      if (route.to !== terminal.id) continue;
      const from = anchors.find((anchor) => anchor.id === route.from);
      if (from?.ref?.source === 'ceiling') {
        const room = zoneById.get(from.ref.id)?.room;
        if (room !== undefined) return room;
      }
    }
  }
  return undefined;
}

/**
 * 裁定一：「风口必须落在吊顶带内」。对每个非冷凝候选 terminal（25 个吊顶口），其
 * position 必须落在宿主房间（可解析时）某个带 area 的吊顶分区边界内；落在所有分区之外
 * 即 error。冷凝候选是 y=0.10 地面独立物理量（§4.2「合法单源」行），不是风口，不参与。
 */
export function lintHvacTerminalCeilingBands(input: HvacTerminalLintInput): HvacTerminalLintIssue[] {
  const issues: HvacTerminalLintIssue[] = [];
  const { terminals, ceiling, anchors = [], routes = [] } = input;
  const bands = bandZones(ceiling);
  const zoneById = new Map(ceiling.map((zone) => [zone.id, zone]));
  for (const terminal of terminals) {
    if (terminal.kind === 'condensate_drain_candidate') continue;
    const hostRoom = resolveHostRoomId(terminal, anchors, routes, zoneById);
    const candidates = hostRoom === undefined ? bands : bands.filter((zone) => zone.room === hostRoom);
    if (hostRoom !== undefined && candidates.length === 0) {
      issues.push(issue('error', 'terminal_host_room_without_band',
        `宿主房间 ${hostRoom} 没有任何带 area 的吊顶分区，${terminal.id} 无法核对落位（分区数据缺失或 room 字段漂移）`, terminal.id));
      continue;
    }
    const tolerance = terminalFaceTolerance(terminal);
    const hit = candidates.find((zone) => zoneContainsPoint(zone, terminal.position.x, terminal.position.z, tolerance));
    if (!hit) {
      const detail = candidates.map((zone) => {
        const [x1, z1, x2, z2] = zone.area as [number, number, number, number];
        const dx = Math.max(x1 - terminal.position.x, terminal.position.x - x2, 0);
        const dz = Math.max(z1 - terminal.position.z, terminal.position.z - z2, 0);
        return `${zone.id}(越出 x=${dx.toFixed(3)}/z=${dz.toFixed(3)})`;
      }).join(', ');
      issues.push(issue('error', 'terminal_outside_ceiling_band',
        `风口 ${terminal.id} (${terminal.position.x},${terminal.position.z}) 不在${hostRoom ? `宿主房间 ${hostRoom} 的` : '任何'}吊顶分区带内`
        + `（百叶装不进吊顶带就是废口；侧装面容差 ${TERMINAL_FACE_PLANE_TOLERANCE_M}m）。候选：${detail || '无'}`, terminal.id));
    }
  }
  return issues;
}

/**
 * 裁定一落地：access 检修口 = 宿主 + 结构化 offset，断言
 *   offset == position − serves_unit 宿主 position（容差 0.005m）。
 * 坐标真值仍只有 position 一份；offset 是机器可校验的关系声明，取代 reason 散文。
 */
export function lintHvacAccessOffsets(input: Pick<HvacTerminalLintInput, 'terminals' | 'ceiling'>): HvacTerminalLintIssue[] {
  const issues: HvacTerminalLintIssue[] = [];
  const zoneById = new Map(input.ceiling.map((zone) => [zone.id, zone]));
  for (const terminal of input.terminals) {
    if (terminal.offset !== undefined && terminal.system !== 'access') {
      issues.push(issue('error', 'terminal_offset_outside_access',
        `${terminal.id} 声明了 offset 但 system=${terminal.system}——offset 仅限 access 检修口（宿主+偏移关系声明）`, terminal.id));
    }
    if (terminal.system !== 'access') continue;
    if (terminal.serves_unit === undefined) {
      issues.push(issue('error', 'access_serves_unit_missing', `access 检修口 ${terminal.id} 未声明 serves_unit（宿主内机 ceiling id）`, terminal.id));
      continue;
    }
    if (terminal.offset === undefined) {
      issues.push(issue('error', 'access_offset_missing', `access 检修口 ${terminal.id} 未声明结构化 offset（= position − 宿主 position；裁定一 2026-11-08）`, terminal.id));
      continue;
    }
    const host = zoneById.get(terminal.serves_unit);
    if (!host) {
      issues.push(issue('error', 'access_offset_host_missing', `access 检修口 ${terminal.id} 的宿主 ${terminal.serves_unit} 不存在`, terminal.id));
      continue;
    }
    const hostPos = normalizeCeilingZone(host);
    if (hostPos.x === undefined || hostPos.z === undefined) {
      issues.push(issue('error', 'access_offset_host_position_missing', `宿主 ${host.id} 无 x/z 且无 area，${terminal.id} 的 offset 无法对账`, terminal.id));
      continue;
    }
    const expectedX = terminal.position.x - hostPos.x;
    const expectedZ = terminal.position.z - hostPos.z;
    if (Math.abs(terminal.offset.x - expectedX) > HVAC_ASSERT_TOLERANCE_M || Math.abs(terminal.offset.z - expectedZ) > HVAC_ASSERT_TOLERANCE_M) {
      issues.push(issue('error', 'access_offset_mismatch',
        `${terminal.id} 的 offset (${terminal.offset.x},${terminal.offset.z}) ≠ position − 宿主 ${host.id} position `
        + `= (${expectedX.toFixed(3)},${expectedZ.toFixed(3)})（容差 ${HVAC_ASSERT_TOLERANCE_M}m）——真值只有 position 一份，两处必须恒等`, terminal.id));
    }
  }
  return issues;
}

interface LdDecoSegment { terminal: HvacTerminalWithOffset; start: number; end: number; }

function segmentOf(terminal: HvacTerminalWithOffset): LdDecoSegment | undefined {
  if (terminal.length === undefined) return undefined;
  return { terminal, start: terminal.position.x - terminal.length / 2, end: terminal.position.x + terminal.length / 2 };
}

/**
 * LD-deco 铺满 lint（§5.3 指标 7「8 + 铺满 lint」结局）：带 = 吊顶带边界（宿主分区的
 * area x 向）；同一行（mount_face + z）上装饰段与功能段必须精确铺满带边界，不留缝隙
 * 也不重叠；登记的 R18 有意空白是唯一合法缺口，且任何段压进空白即 error（不许堵上）。
 * 只检查「含装饰段的行」：检修口/纯功能行不属 LD 三层线语言。
 */
export function lintHvacLdDecoBandFill(input: Pick<HvacTerminalLintInput, 'terminals' | 'ceiling'>): HvacTerminalLintIssue[] {
  const issues: HvacTerminalLintIssue[] = [];
  const { terminals, ceiling } = input;
  const deco = terminals.filter((terminal) => terminal.kind === 'decorative_louver');
  if (deco.length === 0) return issues;
  const bands = bandZones(ceiling);
  // 带分区 = 含最多装饰段的分区：相邻分区共享边线（ceiling_living 北缘 z=4.30 与
  // ceiling_entry_foyer 南缘同线），边界段会同时命中两个 bbox——按多数决解出宿主带，
  // 真并列（无法唯一）才报歧义。
  const ranked = bands
    .map((zone) => ({
      zone,
      hits: deco.filter((segment) => {
        const tolerance = terminalFaceTolerance(segment);
        return zoneContainsPoint(zone, segment.position.x, segment.position.z, tolerance);
      }).length,
    }))
    .filter((entry) => entry.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  if (ranked.length === 0 || (ranked.length > 1 && ranked[0]!.hits === ranked[1]!.hits)) {
    const tied = ranked.filter((entry) => entry.hits === (ranked[0]?.hits ?? 0)).map((entry) => entry.zone.id);
    issues.push(issue('error', 'ld_deco_band_zone_ambiguous',
      `装饰段的宿主带无法唯一解析（并列：${tied.join(', ') || '无任何分区命中'}）——LD-deco 带边界检查挂起`, deco[0]!.id));
    return issues;
  }
  const band = ranked[0]!.zone;
  const bandX1 = (band.area as [number, number, number, number])[0];
  const bandX2 = (band.area as [number, number, number, number])[2];

  // 行分组：带内、声明了长度的 terminal，按 (mount_face, z) 聚合（z 用 0.005 容差吸手改抖动）。
  interface Row { mountFace: string; z: number; segments: LdDecoSegment[]; }
  const rows: Row[] = [];
  for (const terminal of terminals) {
    if (terminal.kind === 'condensate_drain_candidate') continue;
    const tolerance = terminalFaceTolerance(terminal);
    if (!zoneContainsPoint(band, terminal.position.x, terminal.position.z, tolerance)) continue;
    if (terminal.mount_face === undefined) continue;
    const segment = segmentOf(terminal);
    if (!segment) continue;
    const row = rows.find((candidate) => candidate.mountFace === terminal.mount_face && Math.abs(candidate.z - terminal.position.z) <= LD_DECO_ROW_EPSILON_M);
    if (row) row.segments.push(segment);
    else rows.push({ mountFace: terminal.mount_face, z: terminal.position.z, segments: [segment] });
  }

  const blanksFor = (row: Row): LdDecoIntentionalBlank[] => LD_DECO_INTENTIONAL_BLANKS.filter((blank) =>
    blank.mount_face === row.mountFace && Math.abs(blank.z - row.z) <= LD_DECO_ROW_EPSILON_M);

  for (const row of rows) {
    const hasDeco = row.segments.some((segment) => segment.terminal.kind === 'decorative_louver');
    const blanks = blanksFor(row);
    if (!hasDeco) {
      if (blanks.length > 0) {
        issues.push(issue('warning', 'ld_deco_blank_row_missing',
          `登记的有意空白所在行 (${row.mountFace}, z=${row.z}) 已没有任何段——空白登记失去宿主行，请复核登记或行位`, row.segments[0]?.terminal.id));
      }
      continue;
    }
    const rowId = `行 (${row.mountFace}, z=${row.z})`;
    for (const segment of row.segments) {
      if (segment.terminal.length === undefined) {
        issues.push(issue('error', 'ld_deco_row_segment_without_length', `${rowId} 的 ${segment.terminal.id} 未声明 length，无法参与铺满判定`, segment.terminal.id));
      }
      if (segment.start < bandX1 - LD_DECO_EXACT_EPSILON_M || segment.end > bandX2 + LD_DECO_EXACT_EPSILON_M) {
        issues.push(issue('error', 'ld_deco_row_out_of_band',
          `${rowId} 的 ${segment.terminal.id} 段 [${segment.start.toFixed(3)},${segment.end.toFixed(3)}] 越出带边界 [${bandX1},${bandX2}]`, segment.terminal.id));
      }
      for (const blank of blanks) {
        if (segment.start < blank.x2 - LD_DECO_EXACT_EPSILON_M && segment.end > blank.x1 + LD_DECO_EXACT_EPSILON_M) {
          issues.push(issue('error', 'ld_deco_row_fills_intentional_blank',
            `${rowId} 的 ${segment.terminal.id} 段 [${segment.start.toFixed(3)},${segment.end.toFixed(3)}] 压进 R18 有意空白 [${blank.x1},${blank.x2}]`
            + `——不许为了铺满把有意空白堵上（${blank.basis}）`, segment.terminal.id));
        }
      }
    }
    const sorted = [...row.segments].sort((a, b) => a.start - b.start);
    let cursor = bandX1;
    let blankIndex = 0;
    for (const segment of sorted) {
      if (blankIndex < blanks.length && Math.abs(cursor - blanks[blankIndex].x1) <= LD_DECO_EXACT_EPSILON_M
        && Math.abs(segment.start - blanks[blankIndex].x1) > LD_DECO_EXACT_EPSILON_M
        && segment.start >= blanks[blankIndex].x2 - LD_DECO_EXACT_EPSILON_M) {
        cursor = blanks[blankIndex].x2;
        blankIndex += 1;
      }
      if (segment.start > cursor + LD_DECO_EXACT_EPSILON_M) {
        issues.push(issue('error', 'ld_deco_row_gap',
          `${rowId} 在 [${cursor.toFixed(3)},${segment.start.toFixed(3)}] 有缝隙——同一行上装饰段与功能段必须精确铺满带边界`, segment.terminal.id));
      } else if (segment.start < cursor - LD_DECO_EXACT_EPSILON_M) {
        issues.push(issue('error', 'ld_deco_row_overlap',
          `${rowId} 的 ${segment.terminal.id} 段起点 ${segment.start.toFixed(3)} 与前段末端 ${cursor.toFixed(3)} 重叠——不许重叠`, segment.terminal.id));
      }
      cursor = Math.max(cursor, segment.end);
    }
    if (blankIndex < blanks.length && Math.abs(cursor - blanks[blankIndex].x1) <= LD_DECO_EXACT_EPSILON_M) {
      cursor = blanks[blankIndex].x2;
      blankIndex += 1;
    }
    if (cursor < bandX2 - LD_DECO_EXACT_EPSILON_M) {
      issues.push(issue('error', 'ld_deco_row_gap',
        `${rowId} 在 [${cursor.toFixed(3)},${bandX2.toFixed(3)}] 未铺满带边界（若为有意空白须先登记 LD_DECO_INTENTIONAL_BLANKS）`, row.segments[0]?.terminal.id));
    }
  }
  return issues;
}

/** 三项检查合并入口（test:server 与后续 verify:all 接线共用）。 */
export function lintHvacTerminals(input: HvacTerminalLintInput): HvacTerminalLintIssue[] {
  return [
    ...lintHvacTerminalCeilingBands(input),
    ...lintHvacAccessOffsets(input),
    ...lintHvacLdDecoBandFill(input),
  ];
}

/**
 * branch_dining ↔ MEP refrigerant-dining via 节点的跨文件逐位 parity 门禁
 * （issue #98 S2-B 验伪轮修复：业主裁定三只裁了「对齐到 2.6」，对齐本身不产生门禁——
 * 既有 junction↔hvac-anchor 等值断言（mep-hvac-coordination-schema.ts:238-252）只遍历
 * MEP junctions（2026-11-14 全带泵重画后 MEP junctions 为空——R25 汇流节点已删除），branch_dining 是 hvac.yaml route
 * via 引用的锚点、refrigerant-dining 的 (8.00,4.30,2.60) 是 MEP yaml 的 via 内联点，两文件
 * 之间此前无任何机器对账，变异 branch_dining y→2.55 时上述断言零红（空转面，独立验伪员
 * m2-dining255 实测）。§6.1-8 明文不许留无门禁的中间态，故补此对账。
 *
 * 范围有意收窄：对账表只登记裁定三明确认定的同源对（branch_dining reason「沿用 MEP
 * refrigerant-dining 显式协调节点」，DEC-2026-10-06-R5）；其余 4 个 branch_* 是 schematic_only
 * 示意（裁定四，离 MEP 折线 0.000–0.364m，MEP 不引用），不做 parity——把 22 条 diagram
 * route 全量对齐 MEP 属 §6.3-10 未裁口径，不许顺手写进数据。对账表是快照：扩展/收缩都是
 * 评审事件。判据与 junction 门禁同口径：逐位 ≤1e-6，两端任一漂移即红。
 */
export interface HvacMepNodeParityPair {
  anchorId: string;
  mepRouteId: string;
  viaIndex: number;
}
export const HVAC_MEP_NODE_PARITY_PAIRS: readonly HvacMepNodeParityPair[] = [
  { anchorId: 'branch_dining', mepRouteId: 'refrigerant-dining', viaIndex: 0 },
];
/** 跨文件逐位等值容差：与 junction↔anchor 门禁（schema.ts:247 同类比较）同口径。 */
export const HVAC_MEP_PARITY_EPSILON_M = 1e-6;

export function lintHvacMepNodeParity(input: {
  anchors: readonly HvacAnchorWithSchematicOnly[];
  /** 统一出口的已解路由（issue #98 二阶段 S1）：对账读 resolved.viaPoints，不读原始 route.via。 */
  mepRoutes: ReadonlyArray<ResolvedMepRoute>;
}): HvacTerminalLintIssue[] {
  const issues: HvacTerminalLintIssue[] = [];
  for (const pair of HVAC_MEP_NODE_PARITY_PAIRS) {
    const anchor = input.anchors.find((item) => item.id === pair.anchorId);
    if (!anchor) {
      issues.push(issue('error', 'mep_node_parity_pair_broken', `parity 对账的 hvac 锚点 ${pair.anchorId} 不存在（对账表失效，须复核 HVAC_MEP_NODE_PARITY_PAIRS）`));
      continue;
    }
    if (!anchor.position) {
      issues.push(issue('error', 'mep_node_parity_pair_broken', `parity 对账的 hvac 锚点 ${pair.anchorId} 无 position（对账表只覆盖内联坐标锚点）`));
      continue;
    }
    const resolved = input.mepRoutes.find((item) => item.route.id === pair.mepRouteId);
    if (!resolved) {
      issues.push(issue('error', 'mep_node_parity_pair_broken', `parity 对账的 MEP route ${pair.mepRouteId} 不存在（对账表失效，须复核 HVAC_MEP_NODE_PARITY_PAIRS）`));
      continue;
    }
    if (resolved.unresolved.includes('via')) {
      issues.push(issue('error', 'mep_node_parity_pair_broken', `MEP route ${pair.mepRouteId} 的 via 未解出（${resolved.diagnostics.join('；')}），无法与 ${pair.anchorId} 对账`));
      continue;
    }
    const node = resolved.viaPoints[pair.viaIndex];
    if (!node) {
      issues.push(issue('error', 'mep_node_parity_pair_broken', `MEP route ${pair.mepRouteId} 的 via[${pair.viaIndex}] 不存在，无法与 ${pair.anchorId} 对账`));
      continue;
    }
    if (node.y === undefined) {
      issues.push(issue('error', 'mep_node_parity_pair_broken',
        `MEP route ${pair.mepRouteId} 的 via[${pair.viaIndex}] 缺 y——对账表承诺三维逐位相等，缺维即 fail-closed`, pair.anchorId));
      continue;
    }
    const axes: Array<['x' | 'y' | 'z', number, number]> = [
      ['x', anchor.position.x, node.x],
      ['y', anchor.position.y, node.y],
      ['z', anchor.position.z, node.z],
    ];
    for (const [axis, hvacValue, mepValue] of axes) {
      if (Math.abs(hvacValue - mepValue) > HVAC_MEP_PARITY_EPSILON_M) {
        issues.push(issue('error', 'mep_node_parity_mismatch',
          `hvac 锚点 ${pair.anchorId} 的 ${axis}=${hvacValue} 与 MEP ${pair.mepRouteId} via[${pair.viaIndex}] 的 ${axis}=${mepValue}`
          + ` 漂移 ${Math.abs(hvacValue - mepValue).toFixed(4)}m（> ${HVAC_MEP_PARITY_EPSILON_M}）——该锚点 reason 自称沿用此 MEP 协调节点（裁定三/DEC-2026-10-06-R5），两侧必须逐位相等`, pair.anchorId));
      }
    }
  }
  return issues;
}

/**
 * power_* 取电锚点的三方配对 lint（issue #98 第五阶段 S3，任务书第 3 项①②）。
 *
 * 由来（phase5-survey.md §3-2）：「哪个插座供哪台内机」今天住 3 处——ceiling `ac_*.power_point`
 * （6 处，无运行时读者）、hvac `power_*` anchor ref（有读者）、electrical `host_intent` 散文
 * （5 处，sock_child_ac 缺）——但「哪个 anchor 服务哪台内机」只靠 id 里的房间名推断
 * （power_living ↔ ac_living），是隐式映射，不够作为唯一源。S3 给 6 个 power anchor 加显式
 * `serves_unit`（宿主内机 ceiling id），本检查把配对钉成机器断言（四条腿）：
 *   ① anchor.serves_unit 必须声明且指向真实存在的 ac_indoor ceiling 对象；
 *   ② anchor.ref 必须指向 electrical 取电点位，该点位声明的 host_intent（若声明）必须点名
 *      serves_unit；未声明 host_intent 记 warning（登记缺口：sock_child_ac，C FM-4）；
 *   ③ 以该 anchor 为起点的 power route 终点必须是 ref 指向同一 serves_unit 的 indoor anchor
 *      ——serves_unit 因此被 ref / route / host_intent 三面夹住，成为真值而非又一份散文；
 *   ④ 刻意与 S2 的 E8 三方配对测试（hvac-mep-drift-guard.test.ts，读 ceiling
 *      ac_*.power_point）并存：那份断言在 power_point 退场前仍是活门禁，两份配对在同一
 *      配置上必须同时全绿——power_point 的退场（本切片判定保留，消费方在另一路文件清单里）
 *      以本检查 + ④ 的并存绿为替代机制就位的证据。
 *
 * 消费方：tests/server/hvac-terminal-placement-guard.test.ts（test:server 绿/红变异固化）；
 * serves_unit 存在性校验（写错 id 加载期即抛）住 validateProjectHvacFacts，与本函数分工同
 * access offset 的「validate 管存在性、lint 管对账」两层结构。
 */
export interface HvacPowerPairingInput {
  anchors: readonly HvacAnchorWithServesUnit[];
  ceiling: readonly CeilingZone[];
  electrical: ReadonlyArray<{ id: string; host_intent?: string }>;
  routes?: readonly HvacRoute[];
}

export function lintHvacPowerPairing(input: HvacPowerPairingInput): HvacTerminalLintIssue[] {
  const issues: HvacTerminalLintIssue[] = [];
  const { anchors, ceiling, electrical, routes } = input;
  const zoneById = new Map(ceiling.map((zone) => [zone.id, zone]));
  const anchorById = new Map(anchors.map((anchor) => [anchor.id, anchor]));
  for (const anchor of anchors) {
    if (anchor.system !== 'power') continue;
    const servesUnit = anchor.serves_unit;
    if (servesUnit === undefined) {
      issues.push(issue('error', 'power_serves_unit_missing',
        `power 锚点 ${anchor.id} 未声明 serves_unit（服务内机 ceiling id）——「哪个 anchor 服务哪台内机」不得只靠 id 房间名推断（issue #98 S3）`, anchor.id));
      continue;
    }
    const unit = zoneById.get(servesUnit);
    if (!unit) {
      issues.push(issue('error', 'power_serves_unit_unknown', `power 锚点 ${anchor.id} 的 serves_unit ${servesUnit} 不存在`, anchor.id));
      continue;
    }
    if (unit.type !== 'ac_indoor') {
      issues.push(issue('error', 'power_serves_unit_not_indoor',
        `power 锚点 ${anchor.id} 的 serves_unit ${servesUnit} 不是 ac_indoor 内机对象（type=${unit.type}）`, anchor.id));
    }
    if (anchor.ref?.source !== 'electrical') {
      issues.push(issue('error', 'power_ref_not_electrical',
        `power 锚点 ${anchor.id} 的 ref 不是 electrical 取电点位（source=${anchor.ref?.source ?? '无 ref'}）`, anchor.id));
    } else {
      const point = electrical.find((item) => item.id === anchor.ref!.id);
      if (!point) {
        issues.push(issue('error', 'power_ref_point_missing',
          `power 锚点 ${anchor.id} 的 ref 指向不存在的 electrical 点位 ${anchor.ref.id}`, anchor.id));
      } else if (point.host_intent === undefined) {
        issues.push(issue('warning', 'power_host_intent_missing',
          `${point.id} 未声明 host_intent 散文（登记缺口：sock_child_ac，C FM-4）——配对由 anchor.serves_unit 承担`, anchor.id));
      } else if (!point.host_intent.includes(servesUnit)) {
        issues.push(issue('error', 'power_host_intent_mismatch',
          `${point.id} 的 host_intent「${point.host_intent}」未点名 serves_unit ${servesUnit}`, anchor.id));
      }
    }
    if (routes !== undefined) {
      const powerRoutes = routes.filter((route) => route.system === 'power' && route.from === anchor.id);
      if (powerRoutes.length === 0) {
        issues.push(issue('error', 'power_route_missing', `power 锚点 ${anchor.id} 没有任何以它为起点的 power route`, anchor.id));
        continue;
      }
      for (const route of powerRoutes) {
        const target = anchorById.get(route.to);
        if (!target || target.ref?.source !== 'ceiling' || target.ref.id !== servesUnit) {
          issues.push(issue('error', 'power_route_target_mismatch',
            `power route ${route.id} 的终点 ${route.to} 不是 ref 指向 ${anchor.id}.serves_unit=${servesUnit} 的 indoor anchor`
            + `（实际 ref=${target?.ref ? `${target.ref.source}:${target.ref.id}` : '无 ref 或终点不存在'}）`, anchor.id));
        }
      }
    }
  }
  return issues;
}
