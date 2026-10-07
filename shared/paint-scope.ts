/**
 * 涂装范围几何（DEC-2026-10-08-C05 建立、C06 补洞口扣除）。
 *
 * **唯一算法源**：3D 检视态（shared/render/SceneBuilder.ts）、成本核算
 * （server/paint-cost-comparison.ts）、预算 painting 科目（server/budget-calculator.ts）
 * 三处都必须走这里的函数，禁止任何一处另立口径。历史上正是因为三处各算一遍，
 * 才出现「3D 高亮盖住门、配置里手写 7.77㎡、预算用 0.75 拍系数」三个互不相认的数字。
 *
 * 两个铁律：
 *   ① 面积只来自 overlay.yaml 的 paint_region 声明，不在这里推导墙面范围；
 *   ② 门窗洞口一律按实扣除，且扣除量必须由声明/openings 实算，禁止手写常量。
 *      窗洞当前为 0——全部 8 樘窗都在 suppress 的玻璃幕墙/飘窗让路墙上（非涂装面），
 *      但机制必须留着：将来只要有窗声明落在实体墙上，就必须扣。
 */

/** 墙面几何最小契约：model-geometry 墙 / catalog 墙 / buildScene 输入墙都满足。 */
export interface PaintWallInput {
  id: string;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  segments?: Array<{ x1: number; z1: number; x2: number; z2: number }>;
  height?: number;
  /** model-geometry 的 openings（门/窗洞），坐标为洞口中心绝对值。 */
  openings?: Array<{
    id: string;
    type: string;
    x: number;
    z: number;
    width: number;
    height: number;
    sill?: number;
    room?: string;
  }>;
}

/** 窗洞声明（overlay 的 bay_sill / glass_infill），沿墙位置缺省时无法定位。 */
export interface PaintWindowInput {
  id: string;
  wall: string;
  /** 自墙 from 端累计的区间；缺省 = 声明不完整，不能参与扣除（会告警而不是静默放过）。 */
  along?: [number, number];
  /** 窗台高（洞底）。 */
  sill?: number;
  /** 窗带高（自 sill 起）。 */
  height: number;
}

export interface PaintRegionInput {
  id: string;
  wall: string;
  room: string;
  along: [number, number];
  bottom?: number;
  height?: number;
}

/** 一个待刷矩形（沿墙区间 × 竖向带）。 */
export interface PaintRect {
  from: number;
  to: number;
  bottom: number;
  top: number;
}

/** 穿过渡漆面的洞口（已裁剪到声明范围内）。 */
export interface PaintGap {
  id: string;
  kind: 'door' | 'window';
  from: number;
  to: number;
  bottom: number;
  top: number;
  areaSqm: number;
}

export interface PaintRegionResult extends PaintRegionInput {
  wallLength: number;
  bottom: number;
  top: number;
  /** 毛面积：声明区间 × 全高（未扣洞）。 */
  grossAreaSqm: number;
  /** 拆洞后的实刷矩形（3D 每块面对一个矩形）。 */
  rects: PaintRect[];
  /** 净面积 = Σ rects 面积。 */
  netAreaSqm: number;
  /** 落在本段声明里的洞口。 */
  gaps: PaintGap[];
}

export interface PaintScopeResult {
  regions: PaintRegionResult[];
  wallAreaByRoom: Record<string, number>;
  /** 毛墙面面积（含门洞窗洞）。 */
  grossWallAreaSqm: number;
  /** 门洞占位合计。 */
  doorGapAreaSqm: number;
  /** 窗洞占位合计（当前为 0：窗全在玻璃幕墙上）。 */
  windowGapAreaSqm: number;
  /** 净墙面面积 = 毛 − 门洞 − 窗洞 = Σ netAreaSqm。 */
  netWallAreaSqm: number;
  /** 顶面 footprint 按房汇总（调用方给）。 */
  ceilingAreaByRoom: Record<string, number>;
  ceilingAreaSqm: number;
  grossAreaSqm: number;
  netAreaSqm: number;
  /**
   * 声明缺失告警。当前唯一一类：窗声明落在有涂装声明的实体墙上、却没写 along
   * （无法定位 → 不能扣除 → 必须显形，绝不静默少扣）。
   */
  warnings: string[];
}

const EPS = 1e-9;
const r3 = (n: number): number => Math.round((n + Number.EPSILON) * 1000) / 1000;

/** 墙的折线总长（segments 优先，否则单段）。 */
export function paintWallLength(wall: PaintWallInput): number {
  const segments = wall.segments?.length
    ? wall.segments
    : [{ x1: wall.x1, z1: wall.z1, x2: wall.x2, z2: wall.z2 }];
  return segments.reduce(
    (sum, segment) => sum + Math.hypot(segment.x2 - segment.x1, segment.z2 - segment.z1),
    0,
  );
}

/**
 * 把墙上的 openings（model-geometry）投影成沿墙区间。
 * 与 layout-resolver 的解算一致：openings 的 x/z 是洞口**中心**绝对值，
 * 这里把它投影到墙 from→to 方向，得到 along 区间。
 */
export function doorGapsOnWall(wall: PaintWallInput): PaintGap[] {
  const segments = wall.segments?.length
    ? wall.segments
    : [{ x1: wall.x1, z1: wall.z1, x2: wall.x2, z2: wall.z2 }];
  const gaps: PaintGap[] = [];
  for (const opening of wall.openings ?? []) {
    // 在折线上找到离洞口中心最近的投影点（墙在当前模型里均为单段，保留折线通用性）。
    const total = paintWallLength(wall);
    let remaining = total;
    let along = -1;
    let segLength = 0;
    for (const segment of segments) {
      const dx = segment.x2 - segment.x1;
      const dz = segment.z2 - segment.z1;
      const length = Math.hypot(dx, dz);
      if (length <= EPS) continue;
      const t = ((opening.x - segment.x1) * dx + (opening.z - segment.z1) * dz) / (length * length);
      if (t < -1e-6 || t > 1 + 1e-6) {
        remaining -= length;
        continue;
      }
      const clamped = Math.min(1, Math.max(0, t));
      along = total - remaining + length * clamped;
      segLength = length;
      break;
    }
    if (along < 0 || segLength <= EPS) continue;
    const half = opening.width / 2;
    const bottom = opening.sill ?? 0;
    const top = bottom + opening.height;
    gaps.push({
      id: opening.id,
      kind: opening.type === 'door' ? 'door' : 'window',
      from: along - half,
      to: along + half,
      bottom,
      top,
      areaSqm: 0,
    });
  }
  return gaps;
}

/** 把一个矩形按洞口切掉，返回实刷矩形集合（可能多个）。 */
export function splitRectByGaps(rect: PaintRect, gaps: PaintGap[]): PaintRect[] {
  const clipped: PaintGap[] = [];
  for (const gap of gaps) {
    const from = Math.max(gap.from, rect.from);
    const to = Math.min(gap.to, rect.to);
    const bottom = Math.max(gap.bottom, rect.bottom);
    const top = Math.min(gap.top, rect.top);
    if (to - from <= EPS || top - bottom <= EPS) continue;
    clipped.push({ ...gap, from, to, bottom, top, areaSqm: 0 });
  }
  if (!clipped.length) return [rect];

  const bands = new Set<number>([rect.bottom, rect.top]);
  for (const gap of clipped) {
    bands.add(gap.bottom);
    bands.add(gap.top);
  }
  const sorted = [...bands].sort((a, b) => a - b);
  const out: PaintRect[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const bottom = sorted[i];
    const top = sorted[i + 1];
    if (top - bottom <= EPS) continue;
    // 完全覆盖本竖向带的洞口，才在该带内横向扣除
    const covered = clipped
      .filter((gap) => gap.bottom <= bottom + EPS && gap.top >= top - EPS)
      .map((gap) => [Math.max(gap.from, rect.from), Math.min(gap.to, rect.to)] as [number, number])
      .filter(([from, to]) => to - from > EPS)
      .sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [];
    for (const current of covered) {
      const last = merged[merged.length - 1];
      if (last && current[0] <= last[1] + EPS) last[1] = Math.max(last[1], current[1]);
      else merged.push([current[0], current[1]]);
    }
    let cursor = rect.from;
    for (const [from, to] of merged) {
      if (from - cursor > EPS) out.push({ from: r3(cursor), to: r3(from), bottom: r3(bottom), top: r3(top) });
      cursor = Math.max(cursor, to);
    }
    if (rect.to - cursor > EPS) out.push({ from: r3(cursor), to: r3(rect.to), bottom: r3(bottom), top: r3(top) });
  }
  return out;
}

/**
 * 计算涂装范围：逐段声明 → 毛面积、拆洞后的实刷矩形、净面积、门/窗洞占位、按房汇总。
 * `ceilingAreaByRoom` 由调用方给（房间 footprint），这里只负责汇总与总数。
 */
export function computePaintScope(
  walls: PaintWallInput[],
  regions: PaintRegionInput[],
  windows: PaintWindowInput[],
  options: { ceilingAreaByRoom?: Record<string, number>; suppressedWallIds?: Set<string> } = {},
): PaintScopeResult {
  const wallById = new Map(walls.map((wall) => [wall.id, wall]));
  const windowsByWall = new Map<string, PaintWindowInput[]>();
  for (const window of windows) {
    (windowsByWall.get(window.wall) ?? windowsByWall.set(window.wall, []).get(window.wall)!).push(window);
  }

  const results: PaintRegionResult[] = [];
  const warnings: string[] = [];
  const wallAreaByRoom: Record<string, number> = {};
  let grossWallAreaSqm = 0;
  let netWallAreaSqm = 0;
  let doorGapAreaSqm = 0;
  let windowGapAreaSqm = 0;

  for (const region of regions) {
    const wall = wallById.get(region.wall);
    if (!wall) throw new Error(`paint_region ${region.id} references unknown wall ${region.wall}`);
    if (options.suppressedWallIds?.has(region.wall)) {
      throw new Error(`paint_region ${region.id} references suppressed wall ${region.wall}`);
    }
    const wallLength = r3(paintWallLength(wall));
    const from = Math.min(region.along[0], region.along[1]);
    const to = Math.max(region.along[0], region.along[1]);
    if (from < -EPS || to > wallLength + EPS || to - from <= EPS) {
      throw new Error(`paint_region ${region.id}: along [${from}, ${to}] is outside wall ${region.wall} (length ${wallLength})`);
    }
    const bottom = region.bottom ?? 0;
    const top = region.height ?? wall.height ?? 2.8;
    if (!(top > bottom)) throw new Error(`paint_region ${region.id}: height ${top} must exceed bottom ${bottom}`);

    const rect: PaintRect = { from, to, bottom, top };
    const gaps: PaintGap[] = [];

    // 门洞：model-geometry 的 openings，按几何投影裁剪进本段声明
    for (const gap of doorGapsOnWall(wall)) {
      const clippedFrom = Math.max(gap.from, from);
      const clippedTo = Math.min(gap.to, to);
      const clippedBottom = Math.max(gap.bottom, bottom);
      const clippedTop = Math.min(gap.top, top);
      if (clippedTo - clippedFrom <= EPS || clippedTop - clippedBottom <= EPS) continue;
      const areaSqm = r3((clippedTo - clippedFrom) * (clippedTop - clippedBottom));
      gaps.push({ ...gap, from: clippedFrom, to: clippedTo, bottom: clippedBottom, top: clippedTop, areaSqm });
    }

    // 窗洞：overlay 的 bay_sill / glass_infill，只有写了 along 才能定位
    for (const window of windowsByWall.get(region.wall) ?? []) {
      if (!window.along) {
        if (!options.suppressedWallIds?.has(region.wall)) {
          warnings.push(
            `${window.id} 落在有涂装声明的实体墙 ${region.wall} 上但没写 along：无法定位 → 不能扣除窗洞（显形而非静默少扣）`,
          );
        }
        continue;
      }
      const wFrom = Math.min(window.along[0], window.along[1]);
      const wTo = Math.max(window.along[0], window.along[1]);
      const wBottom = window.sill ?? 0;
      const wTop = wBottom + window.height;
      const clippedFrom = Math.max(wFrom, from);
      const clippedTo = Math.min(wTo, to);
      const clippedBottom = Math.max(wBottom, bottom);
      const clippedTop = Math.min(wTop, top);
      if (clippedTo - clippedFrom <= EPS || clippedTop - clippedBottom <= EPS) continue;
      const areaSqm = r3((clippedTo - clippedFrom) * (clippedTop - clippedBottom));
      gaps.push({ id: window.id, kind: 'window', from: clippedFrom, to: clippedTo, bottom: clippedBottom, top: clippedTop, areaSqm });
    }

    const rects = splitRectByGaps(rect, gaps);
    const grossAreaSqm = r3((to - from) * (top - bottom));
    const netAreaSqm = r3(rects.reduce((sum, item) => sum + (item.to - item.from) * (item.top - item.bottom), 0));
    grossWallAreaSqm += grossAreaSqm;
    netWallAreaSqm += netAreaSqm;
    for (const gap of gaps) {
      if (gap.kind === 'door') doorGapAreaSqm += gap.areaSqm;
      else windowGapAreaSqm += gap.areaSqm;
    }
    wallAreaByRoom[region.room] = r3((wallAreaByRoom[region.room] ?? 0) + netAreaSqm);
    results.push({ ...region, along: [r3(from), r3(to)], wallLength, bottom, top, grossAreaSqm, rects, netAreaSqm, gaps });
  }

  const ceilingAreaByRoom = options.ceilingAreaByRoom ?? {};
  const ceilingAreaSqm = r3(Object.values(ceilingAreaByRoom).reduce((sum, value) => sum + value, 0));
  return {
    regions: results.sort((a, b) => a.id.localeCompare(b.id)),
    wallAreaByRoom,
    grossWallAreaSqm: r3(grossWallAreaSqm),
    doorGapAreaSqm: r3(doorGapAreaSqm),
    windowGapAreaSqm: r3(windowGapAreaSqm),
    netWallAreaSqm: r3(netWallAreaSqm),
    ceilingAreaByRoom,
    ceilingAreaSqm,
    grossAreaSqm: r3(grossWallAreaSqm + ceilingAreaSqm),
    netAreaSqm: r3(netWallAreaSqm + ceilingAreaSqm),
    warnings,
  };
}
