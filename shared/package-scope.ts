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
 * plan_ids 仍不展开。**2026-11-04 更新（issue #65）**：`select {all: true}` 按来源
 * 分流——electrical/plumbing 的 all 展开成该分类**全部点位 id**（PKG-040 水电改造
 * 的本意「高亮全部水电点位」），不再短路成「全项目范围」；其他来源的 all 仍判
 * 全项目范围徽标。点位全量清单来自 project.house.electrical / project.house.plumbing
 * （config/electrical.yaml、config/plumbing.yaml 经 /api/project 下发），sceneElements
 * 里没有点位，别去那儿找。
 * **2026-11-04 更新（PR #76 codex major）**：链接显式声明 `mapping_status:
 * project_scope` 的整屋包（PKG-142 临时入住整屋放行等）不按选择器展开——
 * electrical/plumbing 的 select.all 也不拆成点位，一律 projectScope=true。
 * 否则 PKG-142 会按 #65 的新规则展出 137 个点位：详情面板据此计数并启用
 * 「在 3D 中高亮」，而 FlowChartPanel 按 project_scope 判全项目、禁用高亮，
 * 两个入口行为矛盾。issue #65 的 PKG-040 口径不受影响（它没有该声明）。
 * 服务端 assertSelector（server/model-package-links.ts）已保证选择器引用的
 * id 在权威文档里真实存在；本模块只负责「场景里能高亮什么」。
 */

export interface ProjectScopeInput {
  house: {
    rooms: Array<{id: string}>;
    sceneElements: Array<{id?: string; type?: string}>;
    /**
     * 电气点位全量清单（/api/project 的 house.electrical，权威 = config/electrical.yaml）。
     * 点位来源 `select {all: true}` 的展开源；缺了这个键就显形进 unresolved，不静默出 0 个点位。
     */
    electrical?: Array<{id?: string}>;
    /** 给排水点位全量清单（/api/project 的 house.plumbing，权威 = config/plumbing.yaml）。 */
    plumbing?: Array<{id?: string}>;
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
  /**
   * 显式全项目范围声明（config/model-package-links.yaml 的 `mapping_status:
   * project_scope`，如 PKG-142 临时入住整屋放行）。带此声明的链接不按选择器
   * 展开：electrical/plumbing 的 select.all 也不拆成点位（2026-11-04 PR #76
   * codex major——曾展成 137 个点位，详情面板启用高亮而流程图禁用，两入口
   * 矛盾），一律维持全项目范围语义（projectScope=true、不占反查）。
   */
  mapping_status?: 'mapped' | 'partial' | 'not_modelled' | 'project_scope';
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

/**
 * 家具来源（furnishings）的 `select.ids` → 场景 objectId **裸 id**（2026-11-06 issue #98 PR-4）。
 *
 * 家具 objectId 的唯一实现在 `shared/furniture-object-id.ts`：条目声明了 `id`
 * （如 `gbath.vanity`）就直接用它，未声明才退化成 `furniture:<room>:<type>:<index>`。
 * 它**不带来源前缀**（与 electrical:/plumbing: 点位约定相反），所以不能套
 * POINT_SOURCE_PREFIXES——套了会造出永远对不上的键，高亮与反查两边静默不命中。
 *
 * 取代的旧行为：furnishings 的 `types` 选择器（如 `types: [vanity]`）按 sceneElements 的
 * type 匹配，而 sceneElements 只有墙与叠加层区域（server/overlay-merge.ts 的
 * mergeSceneElements，walls + overlay.elements）、**不含家具**，所以这类选择器从来
 * 解析不出任何对象——silent no-op。ids 走本条分支后，按稳定 id 选家具的链接
 * （MODEL-PKG-100 选 gbath.vanity、MODEL-PKG-160 选 gbath.robot_dock）正查高亮
 * （App.highlightApprovalPackage）与反查归属（buildObjectPackageIndex →
 * revealPackageForObject）同时生效。
 */
const OBJECT_ID_SOURCES = new Set(['furnishings']);

/**
 * 点位来源的 `select {all: true}` → 项目数据里该分类的全部点位（2026-11-04 issue #65）。
 *
 * 键 = links 的 `source`，值 = `ProjectScopeInput.house` 下承载该分类全量清单的字段。
 * 只登记 electrical/plumbing：这两个来源在 /api/project 的 house 下有权威全量清单
 * （config/electrical.yaml、config/plumbing.yaml），`all` 的语义就是「该分类下全部点位」。
 * ceiling/hvac 等来源的 `all` 不在此表——house 下没有可比照的点位清单，继续判全项目范围。
 *
 * 用 Map 而非对象字面量：`source in obj` 会命中原型链（`toString` 之类当来源名时误判）。
 */
const POINT_SOURCE_ALL_FIELDS = new Map<string, 'electrical' | 'plumbing'>([
  ['electrical', 'electrical'],
  ['plumbing', 'plumbing'],
]);

/**
 * 该 scope 是否是「点位来源的 select.all」（electrical/plumbing 的 all）。
 * 供 UI 判几何能力用（FlowChartPanel 的 capabilityOf），与 resolvePackageScope 同一口径——
 * 徽标说「全项目范围」而 3D 又能高亮，或反过来，都来自两处各写一套判断。
 * 参数 select 收 `Record<string, unknown>`：调用方（FlowChartPanel 的 links、本文件的测试）
 * 手里的选择器形状不同，收窄成 `{all?: boolean}` 会逼它们做断言转换。
 */
export function isPointSourceAllSelector(scope: {source: string; select?: Record<string, unknown>}): boolean {
  return scope.select?.all === true && POINT_SOURCE_ALL_FIELDS.has(scope.source);
}

export function resolvePackageScope(link: PackageScopeLink, project: ProjectScopeInput): PackageScopeResolution {
  const roomIds = new Set<string>();
  const objectIds = new Set<string>();
  const pointIds = new Set<string>();
  const unresolved: string[] = [];
  let projectScope = false;

  const knownRoomIds = new Set(project.house.rooms.map((room) => room.id));
  const sceneElements = project.house.sceneElements ?? [];

  // 显式 project_scope 的整屋包（PKG-142 临时入住整屋放行等）不按选择器展开
  // （2026-11-04 PR #76 codex major）：electrical/plumbing 的 select.all 也不拆成
  // 点位。「全项目范围」是 mapping_status 的显式声明，与 FlowChartPanel capabilityOf
  // 的 project_scope 短路同口径——旧实现把 PKG-142 的水电 all 展成 137 个点位，
  // 详情面板据此计数并启用「在 3D 中高亮」，流程图的按钮却按 project_scope 禁用，
  // 两个入口相互矛盾。PKG-040（无该声明）的 #65 口径不受影响。
  const explicitProjectScope = link.mapping_status === 'project_scope';
  if (explicitProjectScope) projectScope = true;

  for (const scope of link.scope ?? []) {
    if (explicitProjectScope) continue;
    const select = scope.select ?? {};
    if (select.all === true) {
      // select.all 按来源分流（2026-11-04 issue #65）：点位来源（electrical/plumbing）的
      // all = 该分类全部点位——PKG-040 水电改造声明 electrical/plumbing select.all，本意
      // 「高亮全部水电点位」，旧实现一律短路成 projectScope，解析出 0 个点位、「在 3D 中
      // 高亮」因此被判「没有具体 3D 范围」而禁用。其他来源的 all 仍维持全项目范围徽标。
      const field = POINT_SOURCE_ALL_FIELDS.get(scope.source);
      if (!field) {
        projectScope = true;
        continue;
      }
      const points = project.house[field];
      if (!points) {
        // 项目数据里没有该分类清单（旧 payload / 测试 mock）：显形，不静默出 0 个点位
        unresolved.push(`${scope.source}.all: 项目数据里没有 house.${field}，展不开该分类全部点位（需 /api/project 下发）`);
        continue;
      }
      // 与 select.ids 同一套前缀归一化（<来源>:<裸 id>）：高亮侧按 batchUserData.objectId
      // 逐实例命中，反查索引也用这个键——两边同源，改一处两边同时对。
      const prefix = POINT_SOURCE_PREFIXES[scope.source];
      for (const point of points) {
        if (point.id) pointIds.add(`${prefix}${point.id}`);
      }
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
      // 家具来源的 ids 是场景 objectId 裸值（OBJECT_ID_SOURCES）：家具 objectId 不带
      // 来源前缀，走点位前缀归一化会造出对不上的键。
      if (OBJECT_ID_SOURCES.has(scope.source)) {
        objectIds.add(id);
        continue;
      }
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
  // mapping_status 透传给 resolvePackageScope：显式 project_scope 的整屋包不占反查
  links: Array<{id?: string; budget_ref?: {id?: string}; scope?: ScopeRef[]; mapping_status?: PackageScopeLink['mapping_status']}>,
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
