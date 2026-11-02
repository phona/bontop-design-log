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
 * **2026-11-02 更新**：点位级高亮已由 PR #54 落地（highlightPoints 逐实例着色），
 * select.ids 归一化为场景 objectId 约定（见 POINT_SOURCE_PREFIXES）；layers/trade/
 * plan_ids 仍不展开，`select {all: true}` 对点位来源仍只判全项目范围（P2-9）。
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
   * 点位 id 集合（场景 objectId 形式：`electrical:sock_living_ac` 等）。第三步已落地：
   * HouseScene.highlightPoints 按 batchUserData 逐实例着色（未合批单件走 emissive 兜底），
   * 反查索引同样用这批 id（拾取侧解析出的 objectId 带同一前缀）。
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

/**
 * 点位来源 → 场景 objectId 前缀（InfrastructureBuilder.ts:188 `objectId: \`${category}:\` + point.id`，
 * InteriorLightingSystem.ts:251 电气灯具同约定）。links 的 select.ids 是**裸 id**（sock_living_ac），
 * 场景 batchUserData.objectId 一律**带前缀**（electrical:sock_living_ac）——2026-11-02 真实浏览器
 * 验证发现两边不匹配时，ids 选择器的点位高亮经 UI 全部静默 no-op（targetIds.has(objectId) 永不命中），
 * 点位反查也同样断（索引键裸 id vs 拾取带回前缀 id）。mock 测试照不到是因为 mock 用了裸 id。
 * 归一化只此一处：高亮与反查索引都消费这里的输出，改一处两边同时对。
 */
const POINT_SOURCE_PREFIXES: Record<string, string> = {
  electrical: 'electrical:',
  plumbing: 'plumbing:',
  ceiling: 'ceiling:',
  hvac: 'hvac:',
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
    // ids = 点位级（sock_*/ac_*/faucet_* 等）。归一化成场景 objectId 约定
    // （<来源>:<裸 id>，见 POINT_SOURCE_PREFIXES）：合批渲染按 batchUserData.objectId
    // 逐实例命中（HouseScene.highlightPoints，第三步已落地），反查索引也按这个键
    // （拾取侧 targetFromIntersects 解析出的就是带前缀 id）。裸 id 直接进集合会
    // 两边都静默不命中——2026-11-02 浏览器实证，勿回退。
    for (const id of select.ids ?? []) {
      const prefix = POINT_SOURCE_PREFIXES[scope.source];
      if (prefix) {
        pointIds.add(`${prefix}${id}`);
      } else {
        // 未登记的来源带 ids：前缀约定未知，宁肯显形也不静默造一个对不上的键
        unresolved.push(`${scope.source}.ids: ${(select.ids ?? []).join(',')}（未登记的点位来源，objectId 前缀约定未知，不高亮也不进反查）`);
        break;
      }
    }
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
    // 能反查归属包；高亮侧同样消费这批 id（第三步已落地，见 pointIds 注释）。
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
