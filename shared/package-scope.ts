/**
 * 包级 3D 联动的作用域展开（自装交互审批第一步，2026-11-02）。
 *
 * 设计稿 §6：点包高亮范围。links[].scope 的选择器在这里展开成「房间 id 集合 +
 * 场景对象 id 集合」，消费方是 app 的 SchedulePanel（选中包 → HouseScene
 * 高亮）。数据全部来自前端已在拉的 /api/project（house.rooms + house.sceneElements）
 * 与 /api/model-package-links，不新增请求、不新增服务端投影。
 *
 * 第一步只做房间/墙/叠加层区域级（业主 2026-11-02 裁定：点位级选择器——
 * electrical/plumbing/ceiling/hvac 的 ids/layers/trade/plan_ids——挪到第三步，
 * 它们要逐类核对 BatchedMesh 的 batchUserData 桥接，风险后置）。展不开的
 * 选择器进 unresolved 由 UI 明示「本步高亮不到」，不静默丢弃、不硬凑。
 * 服务端 assertSelector（server/model-package-links.ts）已保证选择器引用的
 * id 在权威文档里真实存在；本模块只负责「场景里能高亮什么」。
 */

export interface ProjectScopeInput {
  house: {
    rooms: Array<{id: string}>;
    sceneElements: Array<{id?: string; type?: string}>;
  };
}

export interface PackageScopeResolution {
  /** 房间 id 集合（HouseScene 按 userData.roomId 匹配高亮）。 */
  roomIds: string[];
  /** 场景对象 id 集合（按 userData.objectId 匹配高亮；墙/叠加层区域/家具类）。 */
  objectIds: string[];
  /**
   * 点位 id 集合（电气/给排水/HVAC 的 sock_ / ac_ / faucet_ 等前缀 id）。
   * **本步不高亮**：点位走合批渲染（BatchedMesh），实例不在 traverse 的
   * mesh.userData 上逐件命中，要按 batchUserData 桥接扩展（第三步）。反查仍用
   * 它们——点点位对象的拾取链路是通的，能反查归属包。
   */
  pointIds: string[];
  /** true = 全项目范围（project_scope/select all）：不硬找 3D 位置。 */
  projectScope: boolean;
  /** 本步不展开的选择器（人读说明，UI 原样展示）。 */
  unresolved: string[];
}

interface ScopeSelector {
  all?: boolean;
  ids?: string[];
  plan_ids?: string[];
  room_ids?: string[];
  types?: string[];
  layers?: string[];
  trade?: string[];
  collections?: string[];
}

interface ScopeRef {
  source: string;
  select: ScopeSelector;
}

export interface PackageScopeLink {
  scope?: ScopeRef[];
}

/** collections → 场景元素类型。rooms 是伪集合（展开成全部房间 id）。 */
const COLLECTION_ELEMENT_TYPES: Record<string, string[]> = {
  rooms: [],
  walls: ['wall'],
};

export function resolvePackageScope(link: PackageScopeLink, project: ProjectScopeInput): PackageScopeResolution {
  const roomIds = new Set<string>();
  const objectIds = new Set<string>();
  const pointIds = new Set<string>();
  const unresolved: string[] = [];
  let projectScope = false;

  const knownRoomIds = new Set(project.house.rooms.map((room) => room.id));
  const sceneElements = project.house.sceneElements ?? [];

  for (const scope of link.scope ?? []) {
    const select = scope.select ?? {};
    if (select.all === true) {
      projectScope = true;
      continue;
    }
    for (const roomId of select.room_ids ?? []) {
      // 只高亮真实存在的房间（服务端 assertSelector 已校验，这里再收一道）
      if (knownRoomIds.has(roomId)) roomIds.add(roomId);
    }
    // ids = 点位级（sock_*/ac_*/faucet_* 等）：本步不进高亮集合（合批渲染命中不了，
    // 见 pointIds 注释），但进反查索引（点点位的拾取链路是通的）。
    for (const id of select.ids ?? []) pointIds.add(id);
    for (const type of select.types ?? []) {
      for (const element of sceneElements) {
        if (element.type === type && element.id) objectIds.add(element.id);
      }
    }
    for (const collection of select.collections ?? []) {
      if (collection === 'rooms') {
        for (const roomId of knownRoomIds) roomIds.add(roomId);
        continue;
      }
      const elementTypes = COLLECTION_ELEMENT_TYPES[collection];
      if (!elementTypes) {
        unresolved.push(`${scope.source}.collections: ${collection}`);
        continue;
      }
      for (const element of sceneElements) {
        if (element.type && elementTypes.includes(element.type) && element.id) objectIds.add(element.id);
      }
    }
    // 点位/方案级选择器：第一步不展开（见文件头说明）
    for (const field of ['layers', 'trade', 'plan_ids'] as const) {
      if ((select[field] ?? []).length) unresolved.push(`${scope.source}.${field}: ${(select[field] ?? []).join(',')}`);
    }
  }

  return {roomIds: [...roomIds], objectIds: [...objectIds], pointIds: [...pointIds], projectScope, unresolved};
}

/** 反查索引：场景对象 id → 包 id 列表（点 3D 对象回详情面板用）。 */
export function buildObjectPackageIndex(
  // id 可选：ModelPackageLink.id 本身可选，且本函数只用 budget_ref/scope
  links: Array<{id?: string; budget_ref?: {id?: string}; scope?: ScopeRef[]}>,
  project: ProjectScopeInput,
): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const link of links) {
    const packageId = link.budget_ref?.id;
    if (!packageId) continue;
    const {roomIds, objectIds, pointIds, projectScope} = resolvePackageScope(link, project);
    // 全项目范围的包（PKG-000/005/010/142/170 等）不占反查——否则点任何对象
    // 都跳它，噪声淹没真实归属
    if (projectScope) continue;
    // 点位也进索引：点电气/给排水对象的拾取链路（batchUserData 桥接）是通的，
    // 能反查归属包；只是本步不高亮它们（见 pointIds 注释）。
    for (const id of [...roomIds, ...objectIds, ...pointIds]) {
      const existing = index.get(id);
      if (existing) {
        if (!existing.includes(packageId)) existing.push(packageId);
      } else {
        index.set(id, [packageId]);
      }
    }
  }
  return index;
}
