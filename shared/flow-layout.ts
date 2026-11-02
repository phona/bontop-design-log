/**
 * 依赖流程图的分层布局（自装审批流程图任务，2026-11-02）。
 *
 * 纯函数：吃包列表（id/dependencies/sequence），吐节点坐标语义（layer/row）
 * 与边列表。不碰 fs、不碰 DOM——面板（app/src/ui/FlowChartPanel.ts）只负责
 * 把 layer/row 映射成像素。数据来源是 GET /api/schedule/state 快照，不另读
 * control.yaml（单一实现铁律）。
 *
 * 分层规则：depth(pkg) = 无依赖 ? 0 : 1 + max(depth(依赖))。天然表达并行
 * （PKG-030/040 同接 PKG-020 → 同层）与汇合（PKG-070 等 030+040+050 →
 * 层号 = 三者最大 + 1）。层内按 sequence 排序保证确定性。
 * sequence >= 900 的包（PKG-900 硬装预备金）是常驻侧车道：不占工序、不参与
 * 依赖分层，sideLane = true，由面板单独渲染。
 */

export interface FlowLayoutNode {
  id: string;
  name: string;
  /** 依赖深度（sideLane 节点为 -1，由面板单独渲染）。 */
  layer: number;
  /** 层内行号（0 起，按 sequence 排序后确定）。 */
  row: number;
  sideLane: boolean;
}

export interface FlowLayoutEdge {
  /** 前置包（依赖方）。 */
  from: string;
  /** 后置包（被依赖方解锁的包）。 */
  to: string;
}

export interface FlowLayout {
  nodes: FlowLayoutNode[];
  edges: FlowLayoutEdge[];
  /** 主车道层数（不含侧车道）。 */
  layerCount: number;
  /** 每层节点数（面板算画布高度用）。 */
  layerSizes: number[];
}

export interface FlowLayoutPackage {
  id: string;
  name?: string;
  dependencies?: string[];
  sequence?: number;
}

const SIDE_LANE_SEQUENCE = 900;

export function computeFlowLayout(packages: FlowLayoutPackage[]): FlowLayout {
  const byId = new Map(packages.map((pkg) => [pkg.id, pkg]));
  const mainPackages = packages.filter((pkg) => (pkg.sequence ?? 0) < SIDE_LANE_SEQUENCE);
  const sidePackages = packages.filter((pkg) => (pkg.sequence ?? 0) >= SIDE_LANE_SEQUENCE);

  // 依赖深度：记忆化 + 路径防环（配置层禁止自依赖与未知依赖，但跨包环理论上
  // 仍可能漏过——真遇到时跳过该约束而不是把界面挂死，边照画）。
  const depths = new Map<string, number>();
  const depthOf = (id: string, path: Set<string>): number => {
    if (depths.has(id)) return depths.get(id)!;
    const pkg = byId.get(id);
    if (!pkg) return 0;
    let depth = 0;
    for (const dependency of pkg.dependencies ?? []) {
      if (path.has(dependency) || !byId.has(dependency)) continue;
      depth = Math.max(depth, 1 + depthOf(dependency, new Set([...path, id])));
    }
    depths.set(id, depth);
    return depth;
  };
  for (const pkg of mainPackages) depthOf(pkg.id, new Set());

  // 层内按 sequence（缺省用 id 字典序）排序，保证确定性
  const layerOrder = (left: FlowLayoutPackage, right: FlowLayoutPackage) =>
    (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER)
    || left.id.localeCompare(right.id);

  const nodes: FlowLayoutNode[] = [];
  const layerSizes: number[] = [];
  const byLayer = new Map<number, FlowLayoutPackage[]>();
  for (const pkg of mainPackages) {
    const layer = depths.get(pkg.id) ?? 0;
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer)!.push(pkg);
  }
  const layerCount = byLayer.size;
  for (let layer = 0; layer < layerCount; layer += 1) {
    const row = (byLayer.get(layer) ?? []).slice().sort(layerOrder);
    layerSizes.push(row.length);
    row.forEach((pkg, index) => {
      nodes.push({id: pkg.id, name: pkg.name ?? pkg.id, layer, row: index, sideLane: false});
    });
  }
  sidePackages.slice().sort(layerOrder).forEach((pkg, index) => {
    nodes.push({id: pkg.id, name: pkg.name ?? pkg.id, layer: -1, row: index, sideLane: true});
  });

  // 边：依赖 → 被依赖方。侧车道不参与（PKG-900 无依赖也无后置）。
  const edges: FlowLayoutEdge[] = [];
  for (const pkg of mainPackages) {
    for (const dependency of pkg.dependencies ?? []) {
      if (!byId.has(dependency)) continue;
      edges.push({from: dependency, to: pkg.id});
    }
  }
  edges.sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to));

  return {nodes, edges, layerCount, layerSizes};
}
