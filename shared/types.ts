/**
 * Shared types for the 3D roaming + AI co-design system.
 * Keep this file dependency-free so it can be imported by both
 * the browser app and the Node.js server.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface CameraState {
  position: Vec3;
  target?: Vec3;
  direction?: Vec3;
}

export interface ResolvedOpening {
  id: string;
  type: string; // 'door' | 'window' | 'cased_opening'（垭口：只开墙洞，无门扇）
  x: number;
  z: number;
  width: number;
  height: number;
  sill?: number;
  room?: string;
  swing?: 'inward' | 'outward';
  hinge?: 'start' | 'end';
}

export interface RoomLayout {
  id: string;
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  type: 'public' | 'private' | 'service';
  /** Boundary participates in location/adjacency checks but has no implicit room floor/ceiling or room-level takeoff. */
  semantic_only?: boolean;
  needs_waterproof?: boolean;
  area?: number;
  wallOpenings?: ResolvedOpening[];
  /** 房间墙面完成面意图源为 config/house.yaml 的 room.wall_finish；预算/成本据此判定涂装范围。 */
  wall_finish?: 'paint' | 'tile' | 'unpainted';
  /** 非矩形房间的边界多边形（矩形房间缺省，按 x/z/width/depth 还原）；供共墙按面材质判定贴邻侧。 */
  points?: CurtainPoint[];
}

export interface IndoorUnit {
  roomId: string;
  type: 'ceiling' | 'wall' | 'cabinet';
  note?: string;
}

export interface OutdoorUnit {
  location: 'platform' | 'entry_garden' | 'south_balcony';
  w: number;
  d: number;
  h: number;
}

/**
 * HVAC 方案常量（2026-10-13 阶段 3 删除）。
 *
 * 原 `HvacScheme` 带 `price_per_unit` / `price_range` 两个字段，值来自 shared/houseData.ts 的
 * 七套 invented 报价表（A1 30,500 / A2 29,000 / … / F2 31,500 + 七个 invented 区间），
 * 与 DEC-2026-10-04-R1 的合同成交价 36,000 并存。现在选型/单价/取证态一律读
 * config/hvac.yaml 的 `commercial` 块（shared/hvac-plans.ts 做纯映射），类型里不再留价格字段，
 * 免得下次又有人往代码里写一口价。
 */

export interface TopicOption {
  id: string;
  name: string;
  description?: string;
  price?: string | number;
  pros?: string[];
  cons?: string[];
  color?: string;
  data?: unknown;
}

/** A generic 3D object reference. The app casts this to Three.js Object3D. */
export type Object3DRef = unknown;

export interface RoomObject {
  id: string;
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  points?: CurtainPoint[];
  mesh?: Object3DRef;
}

export interface CaptureBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface CaptureOptions {
  bounds?: CaptureBounds;
  includeFurniture?: boolean;
  includeViewOnly?: boolean;
  view?: 'top-down' | 'high-perspective';
  size?: number;
}

export interface RoomAuditCaptureOptions {
  bounds: CaptureBounds;
  size?: number;
}

export interface SceneApi {
  clearTopicObjects(topicId: string): void;
  addObject(topicId: string, objectId: string, obj: Object3DRef): void;
  getRoom(roomId: string): RoomObject | undefined;
  getPlatformRoomId(): string | undefined;
  highlightObject(objectId: string): void;
  setCameraTarget(targetId: string): void;
  rooms: Record<string, RoomObject>;
}

export interface Topic {
  id: string;
  name: string;
  options: TopicOption[];
  /** selection 为完整分房状态（default + roomOverrides）；支持分房的 topic（floor/paint/wall）消费它，其余 topic 可忽略 */
  apply(scene: SceneApi, optionId: string, selection?: TopicSelection): string[];
  validate?(scene: SceneApi, optionId: string): string[];
}

export interface MaterialItem {
  id: string;
  category: string;
  topic_id?: string;
  name: string;
  brand: string;
  model: string;
  spec: string;
  unit: string;
  price_per_unit: number;
  coverage_per_unit: number;
  loss_rate: number;
  supplier: string;
  online_link: string;
  sample_acquired: boolean;
  sample_date: string | null;
  status: string;
  notes: string;
  alternative_group?: string;
  calc_mode?: 'area' | 'length' | 'count' | 'fixed';
  pros?: string[];
  cons?: string[];
  price_source?: string;
  appearance?: MaterialAppearance;
  data?: Record<string, unknown>;
}

/** Pixel rectangle in a manufacturer atlas image. Coordinates are measured from the top-left. */
export interface MaterialAtlasFace {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MaterialManufacturerAtlas {
  atlasUrl: string;
  /** Stable asset digest/version; include this when replacing an image at the same URL. */
  atlasHash?: string;
  status?: 'partial' | 'reference' | 'complete';
  declaredFaceCount?: number;
  faces: MaterialAtlasFace[];
}

/** A user-facing atlas available only to temporary in-browser material previews. */
export interface MaterialPreviewAtlasConfig {
  id: string;
  label: string;
  atlasUrl: string;
  atlasHash?: string;
  status: 'partial' | 'reference' | 'complete';
  declaredFaceCount?: number;
  /** Regular contact-sheet layout, in source image pixels, excluding cell gutters. */
  grid: {
    x: number;
    y: number;
    columns: number;
    rows: number;
    cellWidth: number;
    cellHeight: number;
    gapX: number;
    gapY: number;
    inset?: number;
  };
  source: string;
  note: string;
}

export type MaterialAppearanceSource =
  | { kind: 'procedural' }
  | { kind: 'image'; textureUrl: string; contentHash?: string }
  | ({ kind: 'manufacturer_atlas' } & MaterialManufacturerAtlas);

/** Shared material contract. Existing untagged appearances continue to use procedural rendering. */
export interface MaterialAppearance {
  type: string;
  color: string;
  /** Explicit source selection; absent source preserves legacy procedural behavior. */
  source?: MaterialAppearanceSource;
  /** Temporary preview override. Keep both procedural parameters and manufacturerAtlas in one candidate. */
  mode?: 'procedural' | 'image' | 'manufacturer_atlas';
  /** Optional atlas asset, independent from `mode`, so the same SKU can preview both render modes. */
  manufacturerAtlas?: MaterialManufacturerAtlas;
  /** Legacy single-image mode retained for existing callers/configuration. */
  textureUrl?: string;
  species?: string;
  pattern?: string;
  variety?: string;
  tile_mm?: number | [number, number];
  /** Runtime validates the two dimensions; number[] preserves compatibility with existing YAML-derived callers. */
  plank_mm?: number[];
  seed?: number;
  grout_mm?: number;
  grout_color?: string;
  finish?: string;
  roughness?: number;
  tone_var?: number;
  grain_var?: number;
  seam?: number;
  /** Temporary preview rotation in degrees; 0 preserves the current world-X plank direction. */
  rotationDeg?: number;
  [key: string]: unknown;
}

export interface MaterialsYaml {
  notes?: string[];
  preview_assets?: MaterialPreviewAtlasConfig[];
  materials: MaterialItem[];
}

export interface OpeningDef {
  id: string;
  type: string;
  wall: string;
  anchor: string;
  offset: number;
  width: number;
  height: number;
  sill?: number;
  room?: string;
  swing?: 'inward' | 'outward';
  hinge?: 'start' | 'end';
}

export interface HouseRoom {
  id: string;
  name?: string;
  type?: 'public' | 'private' | 'service';
  wall_finish?: 'paint' | 'tile' | 'unpainted';
  needs_waterproof?: boolean;
  [key: string]: unknown;
}

export interface HouseYaml {
  project: Record<string, unknown>;
  rooms: Array<HouseRoom>;
  gift_areas: Array<HouseRoom>;
  mechanical_electrical_plumbing: Record<string, unknown>;
  constraints: Record<string, unknown>;
  furnishings?: FurnishingsYaml;
  electrical?: ElectricalMarker[];
}

export type PhaseId = 'full' | 'phase_1_basic_occupancy';

export interface PhaseFurnishingRule {
  /**
   * 阶段归属按稳定 ID 指名（issue #98 方案 §四①）：准入该阶段的 placed 家具条目 id
   * （house.yaml 的 `id:`，如 `ld.wall_cabinet_tall`）。一期是冻结范围——新家具没被
   * 点名就不进该阶段：不会被同名 type 顺手带进来，也不会被同名 type 顺手排掉。
   */
  include_ids?: string[];
  exclude_ids?: string[];
  /**
   * 迁移期兼容（将逐步清退）：按 type 批量匹配，新声明一律用 include_ids /
   * exclude_ids。现存唯一合法用途是指名 count-only 条目（无 x/z、无 id，ID 指不到
   * 它们）——窗帘/灯具/床垫/龙头等预算计数条目只能靠 type 进阶段。
   */
  include_types?: string[];
  exclude_types?: string[];
  exclude_placed?: boolean;
}

export interface PhaseScope {
  label: string;
  budget_authority?: string;
  budget_ceiling_ref?: string;
  curtain_rooms: 'all' | string[];
  /** Policy for furnishing types/rooms without an explicit rule. */
  default_furnishing_policy?: 'include' | 'exclude';
  /** Declarative budget topics omitted from this phase's dynamic estimate. */
  budget_exclude_topics?: string[];
  furnishing_rules?: Record<string, PhaseFurnishingRule>;
}

/**
 * 阶段预算权限元数据（原 server/phase-scope.ts 声明，2026-11-09 迁到此处）：
 * /api/project 的 phaseMeta.budget 与阶段预算接口共用它。shared/ 不得反向依赖
 * server/（见 shared/model-package-links.ts 头注），故随 PhaseScope 一起放共享侧。
 */
export interface PhaseBudgetMeta {
  ceilingCny?: number;
  allocatedCny?: number;
  unallocatedCny?: number;
  authority?: string;
}

export interface TopicSelection {
  default: string | null;
  roomOverrides: Record<string, string>;
}

export interface CurrentScheme {
  updatedAt: string;
  selections: Record<string, TopicSelection>;
}

export interface DecisionLogEntry {
  id: string;
  topic: string;
  roomId: string | null;
  optionId: string | null;
  previousOptionId: string | null;
  archiveId: string | null;
  path: string;
  reason?: string;
  source: string;
  createdAt: string;
}

export type CurtainState = 'open' | 'privacy' | 'blackout';

export interface CurtainPresentationState {
  default: CurtainState;
  roomOverrides: Record<string, CurtainState>;
  updatedAt: string;
}

/** 窗帘渲染投影条目（shared/curtain-projection.ts 构建） */
export interface CurtainRenderItem {
  id: string;
  /** 来自 overlay 元素的 room 字段 */
  roomId: string;
  kind: 'sheer_blackout' | 'blinds';
  /** 归一化后的有效状态 */
  state: CurtainState;
  expectedVisibleNodes: string[];
}

export interface CurtainRenderProjection {
  source: {
    default: CurtainState;
    /** 归一化并删除冗余 override 后的结果（不修改输入文件） */
    roomOverrides: Record<string, CurtainState>;
    /** 审计字段，不进入 snapshotSha256 */
    updatedAt: string;
  };
  effectiveByRoom: Record<string, CurtainState>;
  curtains: CurtainRenderItem[];
  snapshotSha256: string;
}

/** 主卧 R6 窗帘软包络预演；不作为硬碰撞或地面禁区。 */
export interface CurtainSoftEnvelopePreview {
  roomId: string;
  topBox: { z: [number, number]; ceilingOnly: true; confidence: 'confirmed'; status: 'confirmed' };
  closedDrop: {
    wallZ: number;
    interiorOffset: number;
    thickness: number;
    z: [number, number];
    confidence: 'inferred';
    status: 'site_pending';
    conflictLevel: 'warning';
    acceptance: 'BLOCKED';
  };
  openStack: { end: null; thickness: null; confidence: 'site_pending'; status: 'site_pending' };
  checkedObjects: string[];
  retainedObjects: string[];
  floorHardExclusion: null;
  status: 'site_pending';
}

export interface CurtainSoftEnvelopePreviewDocument {
  schema: 'curtain-soft-envelope-preview/v1';
  iterationId: string;
  previews: CurtainSoftEnvelopePreview[];
}

/** 声明式主卧 R6 窗帘预演契约，不进入 SceneElement/collision。 */
export const MASTER_BEDROOM_R6_CURTAIN_SOFT_ENVELOPE: CurtainSoftEnvelopePreview = {
  roomId: 'master_bedroom',
  topBox: { z: [8.7, 8.95], ceilingOnly: true, confidence: 'confirmed', status: 'confirmed' },
  closedDrop: {
    wallZ: 9.8,
    interiorOffset: 0.12,
    thickness: 0.12,
    z: [9.56, 9.68],
    confidence: 'inferred',
    status: 'site_pending',
    conflictLevel: 'warning',
    acceptance: 'BLOCKED',
  },
  openStack: { end: null, thickness: null, confidence: 'site_pending', status: 'site_pending' },
  checkedObjects: ['master_bedside_cabinet_350_south', 'master_hot_season_low_dresser'],
  retainedObjects: ['master_hot_season_low_dresser'],
  floorHardExclusion: null,
  status: 'site_pending',
};

export function isCurtainSoftEnvelopePreview(value: unknown): value is CurtainSoftEnvelopePreview {
  if (!value || typeof value !== 'object') return false;
  const preview = value as Partial<CurtainSoftEnvelopePreview>;
  return preview.roomId === 'master_bedroom'
    && preview.topBox?.ceilingOnly === true
    && preview.topBox.confidence === 'confirmed'
    && preview.topBox.status === 'confirmed'
    && Array.isArray(preview.topBox.z)
    && preview.topBox.z[0] === 8.7
    && preview.topBox.z[1] === 8.95
    && preview.closedDrop?.thickness === 0.12
    && preview.closedDrop.confidence === 'inferred'
    && preview.closedDrop.status === 'site_pending'
    && preview.closedDrop.conflictLevel === 'warning'
    && preview.closedDrop.acceptance === 'BLOCKED'
    && Array.isArray(preview.checkedObjects)
    && preview.floorHardExclusion === null
    && preview.status === 'site_pending';
}

export interface VisualCommand {
  commandId: string;
  type: 'set_camera_target' | 'highlight_object' | 'set_curtain_state';
  payload: unknown;
  createdAt: string;
  expiresAt: string;
}

export interface ViewContext {
  objectId: string;
  updatedAt: string;
}

export interface SelectionPatch {
  topic: string;
  optionId: string | null;
  roomId?: string | null;
  reason?: string;
}

export interface DesignOption {
  id: string;
  topicId: string;
  name: string;
  description: string;
  price_per_unit: number;
  coverage_per_unit: number;
  loss_rate: number;
  data: unknown;
}

export interface CatalogTopic {
  id: string;
  name: string;
  perRoom: boolean;
  options: DesignOption[];
}

export interface Risk {
  id: string;
  severity: 'high' | 'medium' | 'low';
  message: string;
  topic: string;
  roomId: string | null;
}

export interface ConstraintViolation {
  id: string;
  description: string;
  topic: string;
  roomId: string | null;
  requirement: {
    topic: string;
    minValue?: { field: string; value: number };
    fields?: string[];
  };
}

export interface DesignCheckResult {
  risks: Risk[];
  constraintViolations: ConstraintViolation[];
}

export interface BudgetLineItem {
  topic: string;
  roomId: string | null;
  optionId: string;
  quantity: number;
  unitPrice: number;
  coveragePerUnit: number;
  lossRate: number;
  cost: number;
}

export interface BudgetCategory {
  key: string;
  budget: number;
  actual: number;
  manualActual: number;
  autoActual: number;
  status: 'draft' | 'ok' | 'near' | 'over' | 'reserved' | 'unpriced';
  notes: string;
  /**
   * 待报价的人工计价行：数量已实算，rate 未定，因此未计入 actual（显形而非静默归零）。
   */
  pendingLabor?: Array<{ area: string; quantity: number; unit: string; reason: string }>;
  /**
   * 有实算量但**没有计价归属**的材料条目（DEC-2026-10-13 阶段 2 第二半，瓦工科目专用）。
   *
   * 与 `pendingLabor` 的分工：pendingLabor 是「rate 待报价」，这里是「量算出来了但不知道该按哪档
   * 计价」——例如生活阳台地面（control.yaml 记其口径未裁）、反边/海棠角/底盒开孔/壁龛
   * （overlay 无声明源，`shared/masonry-takeoff.ts` 不派生）。数量为 null 表示连量都无从派生。
   * 这些条目一律**不计入 actual**，但必须显形：静默不计就是静默归零，与静默发明同一类病。
   */
  pendingQuantity?: Array<{ id: string; quantity: number | null; unit: string; reason: string }>;
  /**
   * 候选价门控（2026-10-13 阶段 1，**纯加法**）：`autoActual` 中 status 属于
   * measured / confirmed / quoted_sheet / contracted / provided_by_developer /
   * user_budget_confirmed 的材料金额，即「已取证」的那一半。
   * 其余全部进 `candidateActual`：candidate / pending_verification / estimated /
   * owner_reported / rejected，以及没有 status 字段的合成选项（当前只有 hvac）。
   *
   * 为什么挂在科目上而不是 snapshot 顶层：OverviewMenu 的逐科渲染与 MCP 的
   * categoryDeltas 要能直接复用，才能回答「哪个科目超支是候选价造成的」。
   *
   * 不变量：`verifiedActual + candidateActual === autoActual`。人工（computeLabor）与
   * 人工录入（manualActual）都不进这两档，只进 `actual`。
   *
   * optional 是阶段 1 的接口约束：消费方（含 app 侧测试夹具）可以继续只造原有字段。
   * 本阶段**不动** `actual` / `autoActual` / `totalActual` 的口径——把 candidate 剔出
   * actual 是阶段 5 的独立一次改动，须配 baseline 前后对照。
   */
  verifiedActual?: number;
  /** 见 `verifiedActual`：未取证（候选/待核验/无 status）的材料金额，先让它显形。 */
  candidateActual?: number;
}

export interface BudgetAttribution {
  topItems: BudgetLineItem[];
  overBy: number;
  ratio: number;
}

export interface TileBudgetPreview {
  status: 'comparison_overlay_only';
  includedInTotalActual: false;
  includedInCategoryTotals: false;
  scopeNote: string;
  dryFloorMaterialAndOrdinaryLaborByCandidate: Array<{
    candidateId: string;
    displayName: string;
    netAreaSqm: number;
    modeledDryFloorMaterialYuan: number;
    ordinaryLaborRateYuanPerSqm: number;
    ordinaryLaborSubtotalYuan: number;
    sameScopeSubtotalYuan: number;
    scopeNote: string;
    excludesBathroom: true;
    excludesWalls: true;
    excludesBalcony: true;
    excludesOtherExtras: true;
    includedInOwnerLaborBudgetPool: false;
  }>;
}

export interface PaintBudgetPreview {
  status: 'comparison_overlay_only';
  includedInTotalActual: false;
  includedInCategoryTotals: false;
  scopeNote: string;
  scope: {
    entries: Array<{
      id: string;
      wall: string;
      room: string;
      along: [number, number];
      bottom: number;
      top: number;
      wallLength: number;
      /** 毛面积：声明区间 × 全高（未扣洞）。 */
      grossAreaSqm: number;
      /** 拆洞后的实刷矩形（3D 每块面对一个）。 */
      rects: Array<{ from: number; to: number; bottom: number; top: number }>;
      /** 净面积 = Σ rects。 */
      netAreaSqm: number;
      /** 落在本段声明里的门/窗洞。 */
      gaps: Array<{ id: string; kind: 'door' | 'window'; from: number; to: number; bottom: number; top: number; areaSqm: number }>;
    }>;
    paintRoomCount: number;
    wallRegionEntryCount: number;
    wallAreaByRoom: Record<string, number>;
    /** 毛墙面面积（含门洞窗洞）。 */
    grossWallAreaSqm: number;
    doorGapAreaSqm: number;
    /** 窗洞占位（当前 0：窗全在玻璃幕墙上）。 */
    windowGapAreaSqm: number;
    /** 净墙面面积 = 毛 − 门洞 − 窗洞。 */
    netWallAreaSqm: number;
    ceilingAreaByRoom: Record<string, number>;
    ceilingAreaSqm: number;
    grossAreaSqm: number;
    /** 墙 + 顶的净面积（默认计费口径）。 */
    netAreaSqm: number;
    highlightedIn3d: 'walls_only';
  };
  material: {
    id: string;
    name: string;
    brand: string;
    unit: string;
    pricePerUnit: number;
    coveragePerUnit: number;
    lossRate: number;
    priceYuanPerSqmPerCoat: number;
  };
  labor: {
    rateYuanPerSqm: number;
    rateSource: string;
    scopeNote: string;
  };
  reconciliation: {
    pkgId: string;
    plannedCny: number;
    ownerTargetCny: number;
    modeledRangeCny: [number, number];
    selectedScenarioId: null;
  };
  scenarios: Array<{
    scenarioId: string;
    topcoats: number;
    deductOpenings: boolean;
    areaSqm: number;
    topcoatBuckets: number;
    primerBuckets: number;
    totalBuckets: number;
    materialYuan: number;
    laborRateYuanPerSqm: number;
    laborYuan: number;
    subtotalYuan: number;
    vsPlannedDeltaYuan: number;
    vsOwnerTargetDeltaYuan: number;
  }>;
  /** 外部报价折算（证据，非本模型假设）；覆盖范围未确认的只对照、不划等号。 */
  quotes: Array<{
    quoteId: string;
    source: string;
    form: string;
    rateYuanPerSqm: number;
    areaSqm: number;
    totalYuan: number;
    vsPlannedDeltaYuan: number;
    vsOwnerTargetDeltaYuan: number;
    vsBrushingModelDeltaYuan: number;
    impliedAllowanceYuanPerSqm: number;
    coverage: string;
    coats: string;
    quoteStatus: string;
    observedAt?: string;
    evidence?: string;
    materialId?: string;
    note?: string;
  }>;
  assumptions: Array<{
    key: string;
    value: number | string | boolean;
    status: 'from_overlay_declaration' | 'from_materials_yaml' | 'from_budget_base_json' | 'assumed_unconfirmed';
    source: string;
    note?: string;
  }>;
  feesStatus: Record<string, string>;
  warnings: string[];
}

export interface BudgetSnapshot {
  totalBudget: number;
  totalActual: number;
  /** Optional view context; totalBudget remains the category baseline sum. */
  phase?: PhaseId;
  /** Execution ceiling for the selected phase, sourced from its control file. */
  phaseCeiling?: number;
  /** Allocated execution amount for the selected phase, sourced from its control file. */
  phaseAllocated?: number;
  /** Remaining unallocated amount for the selected phase, sourced from its control file. */
  phaseUnallocated?: number;
  projectCeiling?: number;
  overCeilingBy?: number;
  /**
   * 作废口径留档（config/budget/base.json 的四池快照），只读展示、不参与任何计算。
   * 经 schedule/phase-1/control.yaml `budget_reconciliation.historical_baseline` 段露出，
   * 该段自带 `status: historical_reference_only` 与 source 标注。
   */
  historicalBaseline?: {
    source: string;
    totalBudgetCny: number;
    projectCeilingCny: number;
    status: string;
  };
  categories: BudgetCategory[];
  lineItems: BudgetLineItem[];
  attribution?: Record<string, BudgetAttribution>;
  /** Dry-floor tile + ordinary labor comparison; informational overlay excluded from budget totals. */
  tileBudgetPreview?: TileBudgetPreview;
  /** 涂漆范围/用量/人工与 PKG-080 对账；同为只读叠加，不并入预算总额。 */
  paintBudgetPreview?: PaintBudgetPreview;
  /**
   * 吊顶报价卡片对比（DEC-2026-10-08-C03）。`active` 那一家就是当前 actual 的来源；
   * 其余候选仅并排展示，未生效不影响任何金额。工程量一律来自 ceiling takeoff。
   */
  ceilingQuotes?: {
    activeId: string;
    source: 'quote' | 'base.json';
    comparison: Array<{
      id: string;
      contractor: string;
      quoted_at: string | null;
      status: string;
      active: boolean;
      comparable: boolean;
      comparability_notes: string[];
      total: number | null;
      deltaVsActive: number | null;
      pendingRows: string[];
      /** C12：本家明确不报的行（≠ 待报价：不报的项目进总额，待报价的项目卡住总额）。 */
      outOfScopeRows: string[];
      /** C12：本家已报价的范围，便于与别家比。 */
      coveredScope: string;
      rows: Array<{ key: string; label: string; quantity: number; unit: string; per_unit: number | null; rate_source: string; subtotal: number | null; out_of_scope: boolean }>;
    }>;
  };
}

export interface DataConfidence {
  geometry: string;
  structure: string;
  mep: string;
  materials: { candidate: number; confirmed: number; total: number };
  surveyCompleted: boolean;
  sourceDoc?: string;
  overallMaturity: 'inferred' | 'partial' | 'measured';
  warning: string;
}

export interface ValueBreakdownItem {
  roomId: string | null;
  roomName: string;
  topic: string;
  optionId: string;
  materialName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  cost: number;
}

export interface ValueAlternative {
  topic: string;
  fromOptionId: string | null;
  fromName: string;
  toOptionId: string;
  toName: string;
  savings: number;
  loses: string;
}

export interface CategoryValue {
  category: string;
  actual: number;
  budget: number;
  overBy: number;
  status: string;
  breakdown: ValueBreakdownItem[];
  alternatives: ValueAlternative[];
}

export interface ArchivedScheme {
  id: string;
  name: string;
  selections: Record<string, TopicSelection>;
  reason?: string;
  createdAt: string;
}

export interface DiffEntry {
  path: string;
  current: string | null;
  archived: string | null;
}

export interface DesignRulesConfig {
  version: string;
  objectMapping?: Array<{ pattern: string; topics: string[] }>;
  budget?: {
    baseCategoriesFrom?: string;
    topicCategories?: Record<string, string>;
    furnishingTypeToTopic?: Record<string, string>;
    lineItems?: Array<{ topic: string; quantityField?: string; calcMode?: string; applyRooms?: string[] }>;
  };
  risks?: Array<{
    id: string;
    severity: 'high' | 'medium' | 'low';
    message: string;
    when: { topic: string; options?: string[]; condition?: string };
  }>;
  constraints?: Array<{
    id: string;
    description: string;
    when: { topic: string; condition: string };
    require: { topic: string; minValue?: { field: string; value: number }; fields?: string[] };
  }>;
}

export interface LayoutRoom {
  id: string;
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  area?: number;
  perimeter?: number;
  /** 非矩形房间边界多边形（resolveRoom 输出）；共墙按面材质的贴邻侧判定用。 */
  points?: CurtainPoint[];
}

export interface PlatformLayout {
  id: string;
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  area?: number;
}

export interface ResolvedWallSegment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  kind?: 'line' | 'arc';
  arcOwner?: string;
  radius?: number;
  cx?: number;
  cz?: number;
  arcStart?: { x: number; z: number };
  arcEnd?: { x: number; z: number };
}

export interface WallSegment {
  id?: string;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  segments?: Array<ResolvedWallSegment>;
  fromX?: number;
  fromZ?: number;
  fromRadius?: number;
  arcCenterX?: number;
  arcCenterZ?: number;
  openings?: ResolvedOpening[];
  /** 墙段两侧的房间 id（model-geometry 拓扑：boundary 同时含 from/to 顶点的房间），供渲染端按房间挂材质 */
  rooms?: string[];
  /** 面层配方（WallDef.finish 透传，2026-11-07 issue #98 S4 下沉）：贴砖带 + 涂装带。 */
  finish?: WallFinish;
  /** 墙线基准语义（WallDef.line_datum 透传，口径见其注释）。 */
  line_datum?: 'centerline';
  /** suppress 改判透传（WallDef.suppressed，2026-11-07 issue #98 S3）：消费方经 shared/suppression.ts。 */
  suppressed?: WallSuppression;
}

export interface OverlayPoint {
  x: number;
  z: number;
}

export interface CurtainPoint extends OverlayPoint {
  radius?: number;
  cx?: number;
  cz?: number;
}

export interface BaySillSegment {
  wallId: string;
  rooms?: string[];
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  kind?: 'line' | 'arc';
  arcOwner?: string;
  radius?: number;
  cx?: number;
  cz?: number;
  arcStart?: { x: number; z: number };
  arcEnd?: { x: number; z: number };
}

export interface BaySillWallReference {
  wallId: string;
  rooms?: string[];
  segments: BaySillSegment[];
}

/**
 * 墙脸贴砖带（2026-11-07 issue #98 第三阶段 S4：wall_region 下沉为墙对象特征）。
 *
 * 判据（issue #98 架构决议）：贴砖带没有独立身份/状态/生命周期——它的「墙 + 房间侧 +
 * along」就是定位，采购与状态都挂在墙与房间上。故不再是 overlay 平级元素，而是
 * `WallDef.finish.tile_bands[]` 的一项。
 *
 * 口径与原 wall_region 声明逐字一致（未改语义）：
 * - `along` 沿墙折线距离，自该墙 from 端累计；
 * - `height` 是带【顶标高】（不是带高）；`bottom` 缺省 0；
 * - `room` 声明该面归属房间（共墙两侧各贴各的脸，预算/审计按 (wall, room) 去重）；
 * - 渲染仍走墙中心线（检视态 depthTest=false 真透视），不加侧向偏移。
 */
export interface WallTileBand {
  id: string;
  room: string;
  along: [number, number];
  bottom?: number;
  height: number;
  zone?: 'visible' | 'covered';
  color?: string;
  reason?: string;
}

/** 墙脸涂漆带（S4：paint_region 下沉）。口径同 WallTileBand；height 缺省取墙高。 */
export interface WallPaintBand {
  id: string;
  room: string;
  along: [number, number];
  bottom?: number;
  height?: number;
  color?: string;
  reason?: string;
}

/**
 * 墙对象的面层配方（S4 下沉成果）。tile_bands 与 paint_bands 同住一个对象后，
 * 「砖漆互斥」（paint.bottom ≥ 同脸 tile 带顶）由 loader 一条机器规则校验——
 * 取代原 DEC-2026-10-09-P07 的 7 处人工对齐（parseOverlayFiles 内实现）。
 */
export interface WallFinish {
  tile_bands?: WallTileBand[];
  paint_bands?: WallPaintBand[];
}

/** bay_sill 构件的贴砖面（S4：sill_region 下沉为构件特征）。 */
export interface SillTileBand {
  id: string;
  face: 'front' | 'top' | 'underside';
  along?: [number, number];
  zone?: 'visible' | 'covered';
  color?: string;
  room?: string;
  reason?: string;
}

/** bay_sill 构件的涂装面（S4：paint_sill_region 下沉）。 */
export interface SillPaintBand {
  id: string;
  room: string;
  faces: Array<'underside' | 'front' | 'start_end' | 'end_end'>;
  finish: 'ordinary' | 'anti_mold';
  color?: string;
  reason?: string;
}

export interface BaySillFinish {
  tile?: SillTileBand[];
  paint?: SillPaintBand[];
}

/**
 * 房间顶面涂装特征（S4：paint_ceiling_region 下沉为房间特征）。
 *
 * 8 段原声明只写 room——其范围本就是几何推导（房间 footprint 减铝扣板投影，
 * shared/paint-scope.ts 的 ceilingAreaByRoom），所以声明只剩「这间房的顶面刷漆」这个意图，
 * 铝扣板扣减继续走几何，不写 exclude_aluminum 之类的镜像布尔。
 */
export interface RoomCeilingFinish {
  paint: boolean;
  reason?: string;
}

export interface CurtainRunPart {
  id: string;
  points: CurtainPoint[];
  wallRefs: string[];
}

export type SceneElement =
  // 面层配方自 2026-11-07 issue #98 第三阶段 S4 起不再是平级元素：wall_region /
  // paint_region 下沉为 wall.finish（tile_bands / paint_bands），sill_region /
  // paint_sill_region 下沉为 bay_sill.finish（tile / paint），paint_ceiling_region
  // 下沉为房间特征 ceiling_finish。overlay schema 15 → 10 类，SceneBuilder 的
  // case 分支改为对象属性驱动；检视态三层隔离（wall-tile / wall-paint / pipe-chase）
  // 的 userData.inspectionLayer 与开关原样保留。
  | { type: 'wall'; id: string; x1: number; z1: number; x2: number; z2: number; segments?: Array<{ x1: number; z1: number; x2: number; z2: number }>; openings?: ResolvedOpening[]; rooms?: string[]; finish?: WallFinish; line_datum?: 'centerline' }
  | { type: 'curtain_run'; id: string; points: CurtainPoint[]; height: number; closed?: boolean; parts?: CurtainRunPart[] }
  | { type: 'wall_run'; id: string; points: OverlayPoint[]; height: number }
  // 踢脚线常显条带（DEC-2026-10-28-R01/R02）：与墙特征面层的检视态不同，
  // 本类型在正常视图里就可见、不透明、贴房间侧墙面。height 必填且代码里不得给默认值——
  // 高度是可调数据。S5（2026-11-07）：24 段平级声明已删（finish-surfaces.yaml 退场），
  // 本类型保留为**派生产物**——由墙特征 finish.paint_bands[] 派生（非湿区房间逐段生成，
  // shared/skirting-derivation.ts），height/color 取 finish-defaults.yaml 的 skirting 锚点；
  // 消费方（SceneBuilder/DXF A-SKIRT/HouseScene 审计/碰撞豁免）零改动。
  | { type: 'skirting_region'; id: string; wall: string; room: string; along: [number, number]; bottom?: number; height: number; color?: string; reason?: string }
  // glass_infill / hinged_glass_door 已于 issue #98 第三阶段 S1 删除：overlay 0 元素
  // （hinged 自 DEC-2026-09-07-054 客卫玻璃门取消后无声明；glass_infill 从未启用），
  // schema 与全部消费分支同步退场，不保留墓碑。
  | { type: 'frosted_privacy'; id: string; points: CurtainPoint[]; height: number; sill?: number; offset?: number; finish: 'frosted_privacy' }
  // floor_region 的算量口径（DEC-2026-10-09-P16）：**默认计入**，标了 `excluded: true` 才排除。
  // 与旧 `costed` 相反——旧标志要求每条都手工 opt-in，等于把「这块地是不是已被某个 applyRooms
  // 房间算过」这件几何已知的事再手抄一遍（改一处忘另一处即双计/漏计）。现在「整块落在已计费
  // 房间内」由 shared/masonry-takeoff.ts 的 floorRegionInsideCostedRoom 按几何处理：普通过渡区跳过
  // （DEC-2026-10-13 阶段 2 第二半起唯一实现，server/budget-calculator.ts 只负责装配输入）；
  // `room + follow` 同时声明时表示已计费房间内部的独立地面材料区：从宿主房间面积扣出，
  // 再按 follow 房间的有效材质和干/湿费率计量；单独的 follow 仍表示外部过渡区。
  // `excluded` 只保留给几何说不清的例外（开发商已铺 / 业主裁定不铺），且必须带 reason。
  | { type: 'floor_region'; id: string; points: CurtainPoint[]; room?: string; reason?: string; follow?: string; excluded?: boolean }
  | { type: 'bay_sill'; id: string; points: OverlayPoint[]; depth: number; sill: number; height: number; reason?: string; wallRefs?: BaySillWallReference[]; along?: [number, number]; finish?: BaySillFinish }
  | { type: 'railing_run'; id: string; points: CurtainPoint[]; height: number }
  | { type: 'sliding_door_run'; id: string; points: OverlayPoint[]; height: number; panels?: number; open?: boolean }
  | { type: 'shower_screen'; id: string; points: OverlayPoint[]; height: number; sill?: number }
  | { type: 'curtain'; id: string; points: CurtainPoint[]; height: number; room?: string; kind?: 'sheer_blackout' | 'blinds'; offset?: number };

export interface CadLayoutYaml {
  version: string;
  source: string;
  unit: string;
  scale: number;
  origin: { x: number; z: number };
  export_date: string;
  rooms: LayoutRoom[];
  platform?: PlatformLayout;
  walls?: WallSegment[];
}

// ── Vertex 关系引擎新类型（Phase 1）──

export interface Vertex {
  id: string;
  x: number;
  z: number;
  radius?: number;
}

/**
 * 墙的 suppress 属性（2026-11-07 issue #98 第三阶段 S3）：该墙的实体盒不渲染、不碰撞、
 * 不可贴砖/涂漆/挂载，由 replacement 指定的围护对象（envelope curtain_run / railing_run）
 * 接管其实体表现。它不是"删除墙"——墙仍留在 model-geometry（topology / 家具宿主 /
 * MEP 穿墙判定都还在）。
 *
 * 改判来历：原 overlay.yaml 顶层 `suppress:`（8 条 wall/walls/region 选择器）有 10 处独立
 * 实现 + config/spatial-validation.yaml 的 overlay_replacements 镜像表，S3 把它们收敛成
 * 墙条目上的这一条属性 + replacement 对象 id 直引用。语义唯一权威实现在
 * shared/suppression.ts；region 包围盒选择器随镜像表一并退场（迁移前 0 使用）。
 */
export interface WallSuppression {
  reason: string;
  /** 接管该墙实体表现的围护对象 id（config/model/envelope/openings.yaml 的 curtain_run / railing_run）。 */
  replacement: string;
}

export interface WallDef {
  id: string;
  from: string;
  to: string;
  height: number;
  openings?: OpeningDef[];
  /** 结构类型：shear=剪力墙(禁开横槽/慎穿孔), fill=填充墙, curtain=幕墙(禁挂载), new_partition=新建隔墙 */
  structure?: 'shear' | 'fill' | 'curtain' | 'new_partition';
  /** 结构类型来源：confirmed=交房实测/图纸确认, inferred=邻户同户型图推断 */
  structure_status?: 'confirmed' | 'inferred';
  /**
   * suppress 改判（2026-11-07 issue #98 第三阶段 S3）：实体表现被围护对象接管。
   * 声明侧语义与字段口径见 WallSuppression；消费方一律经 shared/suppression.ts，
   * 禁止各自 flatMap overlay.suppress（那 10 处副本已删）。
   */
  suppressed?: WallSuppression;
  /**
   * 墙线基准语义（2026-11-06 业主口径 A，落实 pending #76）：centerline = 模型线即渲染墙盒
   * 中心线，完成面 = 线 ± WALL_THICKNESS/2。挂墙家具的宿主墙必须声明（verify-furniture-placement
   * 强制）；当前唯一合法值 centerline——脸/心翻转待 #76 量房裁定后扩枚举并同步全部消费方
   * （furniture-placement / InfrastructureBuilder / DXF），不得只改声明。
   */
  line_datum?: 'centerline';
  /**
   * 面层配方（2026-11-07 issue #98 第三阶段 S4 下沉）：该墙脸上的贴砖带与涂装带。
   * 原 overlay.yaml 的 wall_region(18)/paint_region(31) 平级元素，按 issue #98 判据
   * （无独立身份/状态/生命周期）下沉为墙对象特征。along/height/bottom/room 口径见
   * WallTileBand；砖漆互斥由 parseOverlayFiles() 机器校验。
   */
  finish?: WallFinish;
}

export interface RoomDef {
  id: string;
  name: string;
  boundary: string[];
  height: number;
  type?: string;
  /** Semantic boundary only; visible surfaces and quantities must come from explicit overlay/config declarations. */
  semantic_only?: boolean;
  /**
   * 顶面涂装特征（S4：paint_ceiling_region 下沉）。只表达「这间房顶面刷漆」的意图；
   * 范围由几何推导（房间 footprint − 铝扣板投影），不在此声明扣减明细。
   */
  ceiling_finish?: RoomCeilingFinish;
}

export interface PlatformDef {
  id: string;
  name: string;
  boundary: string[];
  height: number;
}

/**
 * 结构梁（issue #98 第六阶段 S2-A：把 `原量房台账（已于 S2-B 退场）` 的「梁体推断」表
 * 与「邻户实测参考」里的梁体读数上到几何对象本体）。
 *
 * 全部条目都是**量房待填目标**：`structure_status: inferred` + `not_for_construction: true`，
 * 不得作为开孔/穿梁/压标高的施工依据。邻户实测读数的权威副本住
 * `config/hvac.yaml` 的 `reference_constraints`（外部原件
 * `survey/neighbor_ys01_original_structure_2025-06.png` 只在那处登记一次），
 * 这里的 `inferred.neighbor_ref` 是**指针**，不复制数字——避免第二份真相。
 */
export interface BeamDef {
  id: string;
  /** 梁的走向：east_west = 东西向梁，north_south = 南北向梁。 */
  orientation: 'east_west' | 'north_south';
  /** 定位线（米，model-geometry 局部坐标）：东西向梁给 z 与 x 范围，南北向梁给 x 与 z 范围。 */
  line: { x1: number; x2: number; z1: number; z2: number };
  /** 结构类型来源。梁体推断一律 inferred——自家量房前无 confirmed 梁。 */
  structure_status: 'inferred';
  /** true = 不得作为施工依据（推断值，量房后才可进交底）。 */
  not_for_construction: true;
  /** 推断依据：height/width 为区间时给 [min, max]；basis 说清凭什么推；neighbor_ref 指 hvac 约束 id。 */
  inferred: {
    height?: [number, number];
    width?: [number, number] | number;
    basis: string;
    neighbor_ref?: string;
  };
  note?: string;
}

export interface VertexLayoutYaml {
  version: string;
  unit: string;
  scale: number;
  origin: { x: number; z: number };
  vertices: Vertex[];
  rooms: RoomDef[];
  platform?: PlatformDef;
  walls: WallDef[];
  /**
   * 结构梁（issue #98 S2-A 从 pending-site-data 台账上对象）。当前只作登记与测试读取，
   * 无运行期几何消费方——梁是量房待填项，`not_for_construction: true`。
   */
  beams?: BeamDef[];
}

export interface ResolvedRoom extends RoomLayout {
  points?: CurtainPoint[];
  area?: number;
  boundary_count: number;
}

export interface ResolvedWall {
  id: string;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  height: number;
  segments?: Array<{ x1: number; z1: number; x2: number; z2: number }>;
  openings?: ResolvedOpening[];
  fromX?: number;
  fromZ?: number;
  fromRadius?: number;
  arcCenterX?: number;
  arcCenterZ?: number;
  rooms?: string[];
  bayRooms?: string[];
  structure?: 'shear' | 'fill' | 'curtain' | 'new_partition';
  structure_status?: 'confirmed' | 'inferred';
  /** 面层配方（WallDef.finish 透传，2026-11-07 issue #98 S4 下沉）。 */
  finish?: WallFinish;
  /** 墙线基准语义（WallDef.line_datum 透传，口径见其注释）。 */
  line_datum?: 'centerline';
  /** suppress 改判透传（WallDef.suppressed，2026-11-07 issue #98 S3）：消费方经 shared/suppression.ts。 */
  suppressed?: WallSuppression;
}

export interface ResolvedLayout {
  rooms: ResolvedRoom[];
  platform?: ResolvedRoom;
  walls: ResolvedWall[];
  vertices: Vertex[];
  openEdges: Array<{ room: string; from: string; to: string }>;
}

export type CalcMode = 'area' | 'length' | 'count' | 'fixed';

export interface FurnitureDef {
  roomId: string;
  type: string;
  position: { x: number; z: number };
  rotation?: number;
}

export interface ElectricalMarker {
  roomId: string;
  type: 'switch' | 'outlet' | 'network' | 'curtain_power';
  wall: 'north' | 'south' | 'east' | 'west';
  height: number;
  offset: number;
}

export type ElectricalPointType =
  | 'socket'
  | 'switch'
  | 'switch_2way'
  | 'network'
  | 'usb'
  | 'floor_socket'
  | 'strong_panel'
  | 'weak_panel'
  | 'ac_controller'
  | 'ceiling_light'
  | 'pendant'
  | 'dome'
  | 'wall_lamp'
  | 'downlight'
  | 'led_strip'
  | 'track_light'
  // 2026-10-05 起夜路径低位引导灯/床头小夜灯（DEC-2026-10-05-R15）：安装高度 0.25–0.40m，
  // 由 verify 规则强制区间；不复用 ceiling_light/downlight，避免污染天花净空校验。
  | 'night_light';

export type ElectricalPointStatus = 'measured' | 'likely' | 'inferred' | 'pending';

/**
 * 构件工程状态词（issue #98 第六阶段 S2-A「状态上对象」）。
 *
 * 电气/给排水/吊顶三类构件**只有一个**能写状态的字段：`status`。词汇在既有
 * measured / likely / inferred / pending 之上补两个词，与 `config/state-model.yaml`
 * 的 `status_vocabulary` 逐键对齐：
 *
 *   measured   现场实测几何（电气/给排水既有精度词）
 *   likely     未核实估计（电气/给排水既有精度词，词汇表映射为 inferred）
 *   inferred   图纸/邻户图/设计推断，未经自家量房核实
 *   pending    明确待量房/待选型/待深化图/待裁定——**必须同时声明 `blocker`**
 *   confirmed  有成交/裁定依据的确认（HVAC anchor 既有词，S2-A 起三类构件同词同义）
 *   undeclared 显形申报「本构件状态未申报」——**必须同时声明 `blocker`**（卡在什么上）
 *
 * 为什么 electrical 曾经的 `position_status` 退场：它是第二个能写构件状态的字段
 * （采集器二选一读），同一事实两处可写。S2-A 后位置精度不再是独立状态字段，
 * 「位置待核」由 `status: pending` + `blocker.kind: site_measurement` 承载；
 * 仅 `shared/mep-takeoff.ts` 的算量延期仍按 `position_status === 'pending'` 判定的
 * 两个预留占位点（sock_child_ac / sock_kitchen_oven）保留该字段，见其 schema 注。
 */
export type ComponentStatus = ElectricalPointStatus | 'confirmed' | 'undeclared';

/** 阻塞项类别（`blocker.kind`）：这个构件卡在哪一类事上。 */
export type BlockerKind =
  | 'site_measurement'       // 量房待测
  | 'pending_selection'      // 待选型（SKU/型号/方案未定）
  | 'pending_vendor_drawing' // 待深化图（厂家/橱柜/柜商出图）
  | 'pending_adjudication'   // 待裁定（业主/设计决策未拍板）
  | 'unclosed_conflict';     // 冲突未闭（两处口径互相矛盾）

/** 阻塞项责任方（`blocker.owner`）：谁推动才能解锁。可多值。 */
export type BlockerOwner =
  | '业主' | '设计' | '量房' | '厂家' | '商家'
  | '电工' | '柜商' | '运营商' | '物业' | '燃气公司';

/**
 * 构件自带的未决声明（issue #98 S2-A）：`status` 为 pending / undeclared 时必填。
 *
 * 四个字段合起来回答决策铁律第 2 条的三问——谁负责（owner）、什么事件能解锁
 * （trigger）、为什么卡（rationale）、什么条件下结论反转（reverses_if）。
 * 缺任何一项 = 这条未决没有 owner 与期限，等于没写。
 */
export interface ComponentBlocker {
  kind: BlockerKind;
  owner: BlockerOwner[];
  /** 短语：什么事件能解锁（如「厂家深化图到手」「量房实测梁底」）。 */
  trigger: string;
  /** 散文：什么条件下结论反转。 */
  reverses_if: string;
  /** 散文：为什么卡。 */
  rationale: string;
}

export type ElectricalPointServiceability = 'usable' | 'blocked' | 'superseded';
export type WallSide = 'north' | 'south' | 'east' | 'west';
export interface FurnitureFaceMountAnchor {
  kind: 'furniture_face';
  furnitureId: string;
  face: WallSide;
  /** Distance from the furniture finish face to the fixture body. */
  surfaceGap?: number;
}

export interface ElectricalFixtureAppearance {
  style: 'warm_white_matte_modular';
  module: 'five_hole_replaceable_usb_c' | 'two_way_rocker';
  faceplate_width: number;
  faceplate_height: number;
  projection: number;
  panel_group?: {
    id: string;
    role: 'north' | 'south';
    center_spacing: number;
    union_width: number;
  };
}

export interface ElectricalPoint {
  id: string;
  room: string;
  type: ElectricalPointType;
  /**
   * 绝对坐标（issue #98 第四阶段 S3 起只属于绝对定位来源）：C/D/E/F 组点位（顶面灯位/
   * 建筑服务基准/地面排水口/器具邻接点）以声明 x/z 为唯一事实源。沿墙与挂载点位不再
   * 声明 x/z——平面位置由 wall + along / mount 解算（shared/point-placement.ts），
   * S1/S2 的迁移期断言（解析结果 == 声明值，容差 0.005m）已全绿并随字段一并删除。
   */
  x?: number;
  z?: number;
  wall?: string;
  wallSide?: WallSide;
  /** 沿墙距离（米），起算 = 墙段起点顶点沿折线累计（shared/point-placement.ts）。 */
  along?: number;
  /** 离开完成面的附加量（米，带符号；默认 0 = 完成面）。 */
  face_offset?: number;
  /** 家具挂载定位来源（issue #98 S2 真挂载：位置 = 宿主脸 + along + face_offset，解析见 shared/point-placement.ts）。 */
  mount?: { furniture_id: string; face: WallSide; surface_gap?: number; along: number; face_offset?: number };
  /** 锚点引用定位来源（S4：F 组转家具挂载 / 暖通 ref 通道）。 */
  anchor?: { source: string; id: string };
  /** 显式绝对坐标意图（C/D/E/F 组：顶面灯位/建筑服务基准/地面排水/器具邻接点）。 */
  absolute?: boolean;
  /** 宿主意图标注（只作文档与校验输入，不参与解算）。 */
  host_intent?: string;
  mountAnchor?: FurnitureFaceMountAnchor;
  temp?: number;
  count?: number;
  heads?: number;
  recessed?: boolean;
  width?: number;
  depth?: number;
  height?: number;
  mount_height?: number;
  body_height?: number;
  status?: ComponentStatus;
  /**
   * 位置精度（历史字段，2026-11-08 S2-A 起**不再是构件状态字段**）。
   *
   * 构件状态唯一来源是 `status`（见 ComponentStatus 注）。本字段只剩一个消费者：
   * `shared/mep-takeoff.ts` 的算量延期判定（`status === 'pending' && position_status === 'pending'`
   * = 「点位尚未具备可报价/施工的稳定归属」）。当前仅 sock_child_ac / sock_kitchen_oven
   * 两个预留占位点声明它；其余点位的「位置待核」已由 `status: pending` + `blocker` 承载。
   */
  position_status?: ElectricalPointStatus;
  /** 未决声明：`status` 为 pending / undeclared 时必填（issue #98 S2-A）。 */
  blocker?: ComponentBlocker;
  /** Machine-readable endpoint usability; point geometry may remain for history/rendering after it stops being serviceable. */
  serviceability_status?: ElectricalPointServiceability;
  /**
   * 智能开关零线口径（2026-10 电气 lint (c) `switch_neutral_policy_undeclared` 的落点）：
   * `true` = 底盒已预留零线（智能开关可回零线供电）、`false` = 单火线方案不回零。
   * 缺省即"未声明"，lint 会按 warning 登记；note 里写"零线/中性线/neutral"等价于显式声明。
   * 依据：config/house.yaml 智能家居条目承诺"智能开关零线"，schema 侧长期无字段可机器核验。
   */
  neutral?: boolean;
  appearance?: ElectricalFixtureAppearance;
  note?: string;
}

export type ElectricalTopologyStatus = 'confirmed' | 'proposed' | 'pending';
export type ElectricalPanelKind = 'strong' | 'weak';
export type ElectricalCircuitPurpose = 'lighting' | 'hvac_power' | 'dedicated_load' | 'ordinary_power';
export type ElectricalControlKind = 'switch' | 'switch_2way' | 'switch_multiway';

export interface ElectricalTopologyPanel {
  id: string;
  kind: ElectricalPanelKind;
  status: ElectricalTopologyStatus;
  source_point_id: string;
}

export interface ElectricalTopologyCircuit {
  id: string;
  panel_id: string;
  purpose: ElectricalCircuitPurpose;
  status: ElectricalTopologyStatus;
  member_point_ids: string[];
  dedicated_load?: boolean;
  // 2026-11-07 issue #98 S3：source_circuit_id（点位侧 circuit 词汇 → 回路 id 的间接层）已废——
  // 点位侧 circuit 字段退役后没有读者，留着就是一份会对不上的死映射。
  capacity?: string;
  wire_size?: string;
  breaker?: string;
  note?: string;
}

export interface ElectricalTopologyControl {
  id: string;
  kind: ElectricalControlKind;
  status: ElectricalTopologyStatus;
  switch_point_ids: string[];
  target_point_ids: string[];
  note?: string;
}

export interface ElectricalTopology {
  version: string;
  panels: ElectricalTopologyPanel[];
  circuits: ElectricalTopologyCircuit[];
  controls: ElectricalTopologyControl[];
  pending_parameters: string[];
}

export interface ElectricalLintIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
  id?: string;
}

export interface ElectricalLintResult {
  errors: ElectricalLintIssue[];
  warnings: ElectricalLintIssue[];
  counts: { errors: number; warnings: number; circuits: number; controls: number; coveredPoints: number; uncoveredPoints: number };
}

// 2026-10-04 A6：新增 `leb`（局部等电位端子箱）。GB 55038-2025 7.4.7 要求设局部等电位
// 联结的场所应做 LEB，本项目主卫/客卫均在列。**枚举值补齐不等于可以造点位**——
// 端子箱位置未知，config/plumbing.yaml 里一个 leb 点都没建，登记见
// 原量房台账 #43（已退场，未决项现由对象 blocker 承载）；位置/联结清单回来后再落点。
// 2026-10-05 给排水 v1 落地：新增 `drain_riser` / `gas_meter` / `duct` —— 分别对应
// pending-site-data #6/#7/#16/#19（排水立管）、#9/#18（燃气表）、#10/#17（厨房排烟道，
// 业主 2026-10-05 批准并入 plumbing.yaml，不新建 ductwork.yaml）。三个值都只承载
// **已登记的推断锚点**：坐标必须能在 原量房台账（已于 S2-B 退场） 找到出处，一个数都不新造。
export type PlumbingPointType = 'faucet' | 'toilet' | 'shower' | 'drain' | 'washer' | 'faucet_outdoor' | 'leb' | 'drain_riser' | 'gas_meter' | 'duct' | 'water_supply' | 'water_heater';

/**
 * 给排水点位精度等级。取值口径与 原量房台账（已于 S2-B 退场） 的三级精度一致
 * （`inferred` 图纸/规范推断 → `measured` 现场量房确认），并沿用电气点位的
 * `status` 字段先例（shared/types.ts ElectricalPointStatus）：「先推断、后实测」。
 */
export type PlumbingPointStatus = 'measured' | 'likely' | 'inferred' | 'pending';
/** 施工状态：点位是否可以进入施工交底。口径与 MEP 路线 construction_status 一致。 */
export type PlumbingConstructionStatus = 'confirmed' | 'inferred' | 'pending';

export interface PlumbingPoint {
  id: string;
  room: string;
  type: PlumbingPointType;
  /** 绝对坐标（S3 起只属于绝对定位来源）：建筑服务基准/地面排水口等 C/D/E 组点位的事实源。 */
  x?: number;
  z?: number;
  wall?: string;
  wallSide?: WallSide;
  /** 沿墙距离（米），起算 = 墙段起点顶点沿折线累计（shared/point-placement.ts）。 */
  along?: number;
  /** 离开完成面的附加量（米，带符号；默认 0 = 完成面）。 */
  face_offset?: number;
  /** 家具挂载定位来源（S4 启用）。 */
  mount?: { furniture_id: string; face: WallSide; surface_gap?: number };
  /** 锚点引用定位来源（S4 启用）。 */
  anchor?: { source: string; id: string };
  /** 显式绝对坐标意图（C/D/E/F 组）。 */
  absolute?: boolean;
  /** 宿主意图标注（只作文本与校验输入，不参与解算）。 */
  host_intent?: string;
  note?: string;
  height?: number;
  /** 精度等级（推断/实测口径）。构件状态的唯一字段（issue #98 S2-A）。 */
  status?: ComponentStatus;
  /** 未决声明：`status` 为 pending / undeclared 时必填（issue #98 S2-A）。 */
  blocker?: ComponentBlocker;
  /** 施工状态：pending = 不作为施工依据，量房升级后才可进交底。 */
  construction_status?: PlumbingConstructionStatus;
  /** 推断坐标的不确定度（米）。仅推断点位填写，量房后删除。 */
  uncertainty_m?: number;
  /** true = 明确声明不作为施工依据（推断坐标/未冻结 SKU）。 */
  not_for_construction?: boolean;
  /** 管路/设备口径直径（米），如排水立管 0.075、排烟道 0.15。 */
  diameter?: number;
  /**
   * 给水水温口径（算量分冷热桶用）。mixed = 冷热双进（台盆/淋浴/洗衣机）。
   * 由 shared/mep-takeoff.ts 读取，禁止从 note 文字推断。
   */
  water_temp?: 'hot' | 'cold' | 'mixed';
  /** 给水管公称口径（PPR，mm）。仅给水类点位声明。 */
  water_dn?: 20 | 25 | 32;
  /** 排水管公称口径（PVC-U，mm）。分级见 docs/mep-construction-guidance.md §3.4（de110/de75/de50）。 */
  drain_dn?: 50 | 75 | 110;
}

export const VALID_CEILING_TYPES = [
  'drop',
  'integrated',
  'cove',
  'none',
  'ac_indoor',
  'aluminum_buckle',
] as const;

/** 吊顶工艺/计价类别（算量与高亮口径，与渲染类型正交）。真源在 shared/ceiling-takeoff.ts。 */
import type { CeilingPricingForm, CeilingTradeClass } from './ceiling-takeoff.js';
export type { CeilingPricingForm, CeilingTradeClass };

export interface CeilingZone {
  id: string;
  room: string;
  type: (typeof VALID_CEILING_TYPES)[number];
  thickness?: number;
  area?: [number, number, number, number];
  corner_radius?: number;
  /** 逐角圆角（米），键为平面角 nw/ne/se/sw；声明的角覆盖 corner_radius。 */
  corner_radii?: Partial<Record<'nw' | 'ne' | 'se' | 'sw', number>>;
  /** 阴角圆弧（米）：加材料把内凹角改成圆角拐肘，键同为平面角。 */
  concave_fillets?: Partial<Record<'nw' | 'ne' | 'se' | 'sw', number>>;
  /**
   * 镜像凹弧的开口象限（DEC-2026-10-08-R05）：键为角，值为该凹弧填补的开口象限，
   * 必须等于镜像弧心象限（sw→nw, se→sw, ne→se, nw→ne）。用于跨分区拐肘——
   * 门头盒 SE 凹弧填西南开口、与门厅吊顶西缘相切；不声明则走默认方向。
   */
  concave_fillets_open?: Partial<Record<'nw' | 'ne' | 'se' | 'sw', 'nw' | 'ne' | 'se' | 'sw'>>;
  /** 立面凹弧（米）：键为边 north/east/south/west，沿该边立面与房间平顶交线加四分之一圆弧过渡。 */
  cove_fillets?: Partial<Record<'north' | 'east' | 'south' | 'west', number>>;
  /** 铝扣板分格缝声明（仅 type: aluminum_buckle 生效）。 */
  buckle_panel?: { module: number; seam_width?: number; seam_color?: string };
  /**
   * 工艺/计价类别：与渲染类型（type）正交，供算量与高亮分区着色用。
   * 省略时按 type 回退（aluminum_buckle→aluminum_buckle，其余 drop/integrated→gypsum_board），
   * **不靠 id 命名推断**（见 shared/ceiling-takeoff.ts）。
   */
  trade?: CeilingTradeClass;
  /**
   * 计价形态（DEC-2026-10-08-C12）：同一个 drop 类型下，边吊按**米**、满吊平顶按**㎡**计价，
   * 本案单价差一倍以上（160 元/米 vs 155 元/㎡）。不写 → takeoff 记 unclassifiedPricingFormIds，
   * **不猜**。省略时不允许回退默认值：猜错的代价是总额差上千元。
   */
  pricing_form?: CeilingPricingForm;
  inspection_layer?: string;
  inspection_opacity?: number;
  x?: number;
  z?: number;
  height?: number;
  model?: string;
  power_point?: string;
  note?: string;
  /**
   * 分区自身的显式工程状态（issue #98 S1-B 补录通道）。S2-A 起词汇与电气/给排水
   * 完全同源（`ComponentStatus`），并新增 confirmed / undeclared 两个词。
   * 不写 = 未申报（派生为 undeclared）。被 hvac anchor 引用的分区（ac_*）不读
   * 本字段——anchor 的权威状态优先。
   */
  status?: ComponentStatus;
  /** 未决声明：`status` 为 pending / undeclared 时必填（issue #98 S2-A）。 */
  blocker?: ComponentBlocker;
}

export type HvacStatus = 'confirmed' | 'inferred' | 'pending';
export type HvacSystem = 'refrigerant' | 'power' | 'condensate' | 'supply_air' | 'return_air' | 'access' | 'decorative';

export interface VrfOutdoorUnit {
  id: string;
  platform: string;
  x: number;
  z: number;
  direction: string;
  width: number;
  depth: number;
  height: number;
  model: string;
  note?: string;
}

export interface HvacReference {
  source: 'outdoor' | 'ceiling' | 'electrical';
  id: string;
}

export interface HvacAnchor {
  id: string;
  status: HvacStatus;
  system: HvacSystem;
  ref?: HvacReference;
  position?: Vec3;
  reason?: string;
  /** 未决的结构化声明（issue #98 S2-A，与 reason 二选一）。 */
  blocker?: ComponentBlocker;
}

export interface HvacTerminal {
  id: string;
  status: HvacStatus;
  system: HvacSystem;
  position: Vec3;
  reason?: string;
  /** 未决的结构化声明（issue #98 S2-A，与 reason 二选一）。 */
  blocker?: ComponentBlocker;
  kind?: 'terminal' | 'condensate_drain_candidate' | 'decorative_louver';
  confirmed?: boolean;
  render_interior?: boolean;
  render_coordination?: boolean;
  mount_face?: 'north' | 'south' | 'east' | 'west' | 'bottom';
  /** 风口长度（米），缺省按 system 给默认值（送风 0.8 / 回风 0.6）。 */
  length?: number;
  /** 风口面板面漆：matte_white=标准浅灰塑料百叶（缺省）；matte_black=通长隐藏式风槽黑色内衬定制（客餐厅效果槽，DEC-2026-10-05-R16）。 */
  finish?: 'matte_white' | 'matte_black';
  /** 风口渲染语言：panel=带外框成品百叶（缺省）；linear_slot=通长线性槽（满长连续叶片、无外框、无状态方框；DEC-2026-10-07-R03 客餐厅三层线）。 */
  render_style?: 'linear_slot' | 'panel';
  /** 风口面板高度（米）显式覆盖；缺省按 system 默认（回风 0.25 / 其余 0.15）。合同附件名义尺寸见 reason。 */
  grille_height?: number;
  /** 检修口服务的内机 ceiling id（如 ac_dining）；仅 system=access 的终端使用，DEC-2026-10-27-R03。 */
  serves_unit?: string;
}

export interface HvacReferenceConstraint {
  id: string;
  status: Exclude<HvacStatus, 'confirmed'>;
  source: 'survey/neighbor_ys01_original_structure_2025-06.png';
  uncertainty_m: 0.15;
  not_for_construction: true;
  range: { x1: number; x2: number; z1: number; z2: number };
  reference_bottom_drop_m?: number;
  reference_beam_bottom_y?: number;
  risk: string;
  reason: string;
  survey_confirmation: string;
}

export interface HvacRoute {
  id: string;
  status: HvacStatus;
  system: HvacSystem;
  from: string;
  to: string;
  via?: string[];
  topology_role?: 'equipment_outlet' | 'branch' | 'shared_trunk';
  constraint_refs?: string[];
  reason?: string;
}

export interface HvacDiagram {
  anchors: HvacAnchor[];
  terminals: HvacTerminal[];
  routes: HvacRoute[];
  reference_constraints: HvacReferenceConstraint[];
}

export interface HvacLoadDesignRoom {
  room: string;
  basis: string;
  load_kw: number;
  indoor: string;
  note?: string;
}

export interface HvacLoadDesign {
  status: 'proposed' | 'confirmed';
  basis: string;
  indoor_nominal_kw_total: number;
  outdoor_nominal_kw: number;
  connection_ratio: string;
  diversity_note?: string;
  budget_impact?: string;
  rooms: HvacLoadDesignRoom[];
}

export interface ProjectHvacFacts {
  plans: Array<{
    id: string;
    kind: 'vrf_ducted';
    outdoor: VrfOutdoorUnit;
    load_design?: HvacLoadDesign;
    diagram: HvacDiagram;
  }>;
}

export interface ProjectRenderFacts {
  electrical: ElectricalPoint[];
  plumbing: PlumbingPoint[];
  ceiling: CeilingZone[];
  hvac: ProjectHvacFacts;
}

export type TrackLightHeadPurpose = 'coffee_table' | 'sofa' | 'living_seating' | 'living_south_or_corner';

export interface TrackLightHeadConfig {
  offset: { x: number; z: number };
  target: Vec3;
  purpose?: TrackLightHeadPurpose;
  role?: string;
}

export interface TrackLightResolvedHead {
  position: Vec3;
  target: Vec3;
  direction: Vec3;
  mountPosition: Vec3;
  headPosition: Vec3;
  lensPosition: Vec3;
  purpose?: TrackLightHeadPurpose;
  role?: string;
}

export interface TrackLightConfig {
  id: string;
  type: 'track_light';
  length: number;
  heads: TrackLightHeadConfig[];
  /** Whether each head target.y is relative to, or absolute in, world Y. */
  target_y_mode?: 'relative' | 'absolute';
  direction: Vec3;
  beam: number;
  energy: number;
  rotation: Vec3;
  resolvedHeads?: TrackLightResolvedHead[];
}

export interface WallLampConfig {
  id: string;
  type: 'wall_lamp';
  style: 'adjustable_short_cylinder';
  finish: 'matte_black';
  backplateDiameter: number;
  headDiameter: number;
  headLength: number;
  armLength: number;
  maxProjection: number;
  control: {
    kind: 'integral_push_button';
    location: 'backplate_bottom';
  };
  adjustability: {
    yawDeg: [number, number];
    tiltDeg: [number, number];
  };
}

export interface SculpturalDomeConfig {
  id: string;
  type: 'dome';
  style: 'suspended_offset_side_arch_opal_lantern';
  finish: 'satin_warm_bronze';
  outerWidth: number;
  outerDepth: number;
  totalThickness: number;
  /** Ceiling to the diffuser's lower face. */
  diffuserDrop: number;
  /** Maximum diffuser diameter at the ceiling-facing rim. */
  diffuserDiameter: number;
  /** Diffuser diameter at the lower emitting face. */
  diffuserBottomDiameter: number;
  diffuserThickness: number;
  housingBandHeight: number;
  /** Radial stand-off for the side shell so it does not z-fight with the diffuser surface. */
  housingBandOffset: number;
  canopyDiameter: number;
  canopyThickness: number;
  suspensionRodRadius: number;
  suspensionRods: Array<{
    ceiling: { x: number; z: number };
    /** Side-shell attachment measured upward from the diffuser's bottom face. */
    diffuser: { x: number; z: number; heightFromBottom: number };
  }>;
  arcSpan: number;
  arcRise: number;
  arcDepthExtension: number;
  arcTubeRadius: number;
  arcFootDiameter: number;
  arcFootHeight: number;
  arcOffset: { x: number; z: number };
}

/**
 * 2026-10-16 DEC-2026-10-16-R5：客厅主灯改 10 头球泡半吸顶造型。
 * 与 SculpturalDomeConfig 同属 type 'dome'，用 style 字面量区分；
 * 两者都保留作通用能力（同 track_light / wall_lamp 的处理）。
 */
export interface MultiGlobeChandelierConfig {
  id: string;
  type: 'dome';
  style: 'multi_globe_semi_flush_chandelier';
  finish: 'chrome_black_opal' | 'antique_wood_copper_opal';
  /** Fixture envelope diameter along x. */
  outerWidth: number;
  /** Fixture envelope diameter along z. */
  outerDepth: number;
  /** Ceiling anchor plane to the lowest visible point. */
  totalThickness: number;
  canopyDiameter: number;
  canopyThickness: number;
  stemRadius: number;
  stemLength: number;
  jointBallDiameter: number;
  hubUpperDiscDiameter: number;
  hubUpperDiscThickness: number;
  hubUpperDiscCenterOffsetY: number;
  hubDiscGap: number;
  hubLowerDiscDiameter: number;
  hubLowerDiscThickness: number;
  hubLowerDiscCenterOffsetY: number;
  hubFinialDiameter: number;
  armTubeRadius: number;
  /** Control-point bow of the swept arm, metres; direction follows the tier sweep. */
  armBow: number;
  socketDiameter: number;
  socketHeight: number;
  globeDiameter: number;
  /** Optional vertical globe dimension; omitted means a spherical globe. */
  globeHeight?: number;
  armTiers: Array<{
    count: number;
    /** Rotation of this tier's first arm, degrees. */
    angularOffsetDeg: number;
    globeRadius: number;
    /** Globe centre height relative to the ceiling anchor (negative below the ceiling). */
    globeCenterOffsetY: number;
    hubAttachment: 'upper_disc' | 'lower_disc';
    /** Radial distance from the fixture axis where the arm meets the hub disc. */
    armStartRadius: number;
    /** Height of the hub attachment relative to the ceiling anchor. */
    armStartOffsetY: number;
    /** Vertical Bézier bow direction relative to the root-to-socket chord; endpoints may be at either height. */
    sweep: 'rise' | 'droop';
    /**
     * Ring tilt in degrees about the east-west axis: positive droops the
     * south (near) side and lifts the north (far) side. 0 = flat ring.
     * Reproduces the product's varied globe depths instead of a flat ring.
     */
    tiltDeg: number;
  }>;
}

/**
 * 2026-10-16 R12：餐厅吊灯改半吸顶（DEC-2026-10-16-R12）。
 * 与其它 dome 变体同属 type 'dome'/'ceiling_light'，用 style 字面量区分。
 */
export interface SemiFlushDomeConfig {
  id: string;
  type: 'ceiling_light';
  style: 'semi_flush_ceiling_light';
  /** 餐厅半吸顶无黑色件（黑只留在客厅主灯 hub），标签须与 SemiFlushDomeGeometry 实际材质一致。 */
  finish: 'chrome_opal';
  /** Fixture envelope diameter along x. */
  outerWidth: number;
  /** Fixture envelope diameter along z. */
  outerDepth: number;
  /** Ceiling anchor plane to the lowest visible point. */
  totalThickness: number;
  canopyDiameter: number;
  canopyThickness: number;
  /** Stem length between the canopy bottom and the diffuser top. */
  stemLength: number;
  stemRadius: number;
  /** Shallow dome diffuser: wider upper rim, narrower lower face. */
  diffuserTopDiameter: number;
  diffuserBottomDiameter: number;
  diffuserDepth: number;
  /** Thin metal rim at the diffuser lower face. */
  rimTubeRadius: number;
}

/** 2026-10-17 R8：餐厅奶油云团灯主图比例预演；具体泡数/吊球长度是视觉估值。 */
export interface CloudOrbCeilingLightConfig {
  id: string;
  type: 'ceiling_light';
  style: 'antique_cloud_orb_ceiling_light';
  finish: 'walnut_pe_opal';
  /** Known body envelope from the owner-provided parameter image. */
  outerDiameter: number;
  canopyThickness: number;
  diffuserDepth: number;
  /** Decorative PE lobes are a visual approximation from the product image. */
  cloudRingRadius: number;
  lobeLayers: 2;
  lobesPerLayer: number;
  layerOffsetDeg: number;
  lobeTangentialDiameter: number;
  lobeRadialDiameter: number;
  lobeHeight: number;
  wireRadius: number;
  /** Cord length is measured from the canopy underside to the wood-orb top. */
  hangingBalls: Array<{
    id: string;
    xOffset: number;
    zOffset: number;
    cordLength: number;
    diameter: number;
  }>;
}

export type DetailedLightingFixtureConfig = TrackLightConfig | WallLampConfig | SculpturalDomeConfig | MultiGlobeChandelierConfig | SemiFlushDomeConfig | CloudOrbCeilingLightConfig;
export interface LightingRenderConfig {
  fixtures: DetailedLightingFixtureConfig[];
}

/**
 * Render-only anchor adjustments; never write these values back to MEP facts.
 *
 * `anchorY_offset` 是**相对** config/electrical.yaml `height`（施工安装完成面）的
 * 渲染挂点偏移（米，正数更高）。派生锚点 = height + anchorY_offset，只在
 * shared/project-render-facts-projection.ts 一处计算。本结构里**不存在**第二个
 * 高度绝对值——那正是重构前 `anchorY` 与 `height` 双写 8 处不一致的病根。
 */
export interface RenderLightingOverride {
  id: string;
  anchorY_offset: number;
  offsetX?: number;
  offsetZ?: number;
  /** 偏移依据：为什么这个渲染挂点不等于安装完成面。facts 契约 c.light_height_parity 强制必填。 */
  basis: string;
  /** 历史审计留档（Blender 基线审计记录 / 整改决议），与 basis 互补。 */
  reason: string;
  applies_to: ['web', 'blender'];
}

export interface RenderLightingFixture {
  id: string;
  room: string;
  type: ElectricalPointType;
  position: Vec3;
  temperatureK: number;
  enabled: boolean;
  // 2026-11-07 issue #98 S3：circuit 直传已删——它唯一的来源是退役的点位侧 circuit 字段，
  // 渲染链没有任何消费者；回路归属改由 shared/point-circuits.ts 按 topology 单一派生，
  // 在真正消费它的地方（DXF 标注 / dressing-map / mep-takeoff 覆盖报告）显形。
  heads?: number;
  recessed?: boolean;
  /** Wall centerline host for wall-mounted fixtures. */
  wallId?: string;
  /** Cardinal direction from the wall into the owning room. */
  wallSide?: WallSide;
  /** Explicit cabinet/furniture face anchor for wall-free mounted fixtures. */
  mountAnchor?: FurnitureFaceMountAnchor;
}

export interface ImplementedHvacProjection {
  status: 'implemented';
  planId: 'A2';
  diagram: HvacDiagram;
}

export interface UnimplementedHvacProjection {
  status: 'unimplemented';
  planId: string | null;
}

export interface ProjectRenderFactsProjection {
  version: string;
  lighting?: LightingRenderConfig;
  lightingFixtures: RenderLightingFixture[];
  plumbing: PlumbingPoint[];
  ceiling: CeilingZone[];
  hvac: ImplementedHvacProjection | UnimplementedHvacProjection;
  materials: {
    floor: TopicSelection;
  };
  presentation: {
    curtains: CurtainRenderProjection;
  };
}

export interface FurnishingCutout {
  kind: string;
  id: string;
  center?: [number, number];
  offset?: [number, number];
  size: [number, number];
}

/**
 * 挂载派生摆位（issue #98 PR-3）：家具不再写绝对 x/z，改挂到另一件已定位家具的槽位上，
 * 由 shared/furniture-placement.ts 从宿主位置与宿主布局参数推出世界坐标。
 * 与 wall/wall_side/along 并列的一种定位声明，三者互斥（同时声明即诊断失败）。
 */
export interface FurnitureMount {
  /** 宿主家具的稳定对象 id（house.yaml 条目上的 `id`，如 `gbath.vanity`）。 */
  furniture_id: string;
  /** 宿主家具上的槽位名（当前唯一受支持值：`robot_bay`）。 */
  slot: string;
}

/**
 * 锚点派生摆位（issue #98 PR-10）：家具位置改从**另一份配置里的锚点对象**推出，
 * 不再手写绝对坐标。与 wall/wall_side/along、mount 并列且互斥。
 *
 * 首个用户是主卫冷凝水遮蔽链三件（condensate_pipe_ac_outlet 等）：它们的接口坐标
 * 原先在 house.yaml、FixtureFactory 配方、MEP via 点里各写一份，改一段不跟随另一段。
 * 现在整条链由 shared/condensate-chain.ts 从锚点单一解算。
 */
export interface FurnitureAnchor {
  /**
   * 锚点来源：
   * - `hvac`：config/hvac.yaml `diagram.anchors` 的 id（如 `indoor_master`，ref ceiling `ac_master`）；
   * - `chain`：shared/condensate-chain.ts 解出的链上点（`unit` / `box_turn` / `wardrobe_east_band`）。
   */
  source: 'hvac' | 'chain';
  /** 锚点 id（hvac 锚点 id 或链上点名）。 */
  id: string;
}

/**
 * 客卫台盆柜（type:'vanity'）布局参数（DEC-2026-11-05-R5 定案「仓+抽屉」）。
 * 柜体分割的唯一声明源：3D FixtureFactory.buildVanity、摆位解算（robot_dock 挂载）、
 * DXF/校验外框全部读这里，FURNITURE_DIMS 不再存 vanity 尺寸（同一数字只留一处）。
 * 抽屉区宽度不声明，由 `width − robot_bay_width` 算出。
 */
export interface VanityLayoutDecl {
  /** 柜宽（沿墙，m）：可用跨度 = 南墙南脸至东墙段南端，两端贴死。 */
  width: number;
  /**
   * 柜深（carcass 包络，m）：背沿贴宿主墙完成面。校验与 DXF 外框按本值出口径；
   * 三只把手是正面装饰件、突出柜面 20mm（局部外深 0.52，不进外框——2026-11-06 Codex minor 口径）。
   */
  depth: number;
  /** 柜高（m）：通高到盆底；头顶余量兼作台盆排水过管走廊，不得加固定层板。 */
  height: number;
  /** 机器人仓区宽（沿墙，m）：贴北端（排水穿墙端）。 */
  robot_bay_width: number;
  /**
   * 仓净宽（m）= 基站宽 + 两侧间隙：机器人的占用要求。resolveVanityLayout 门禁保证
   * 仓区内腔（= robot_bay_width − 2×panel_thickness）≥ 本值；几何上门按内腔宽度生成，
   * 本值不直接进几何，避免同一个开口出现两个宽度。
   */
  robot_bay_clear_width: number;
  /** 板厚（m）：端板/隔板/门板厚度。 */
  panel_thickness: number;
}

/** resolveVanityLayout 解出的布局（含派生量），供 FixtureFactory 与挂位解算共用。 */
export interface VanityLayout extends VanityLayoutDecl {
  /** 抽屉区宽（m）= width − robot_bay_width（剩余尺寸算出，不声明）。 */
  drawer_width: number;
}

export interface FurnishingItem {
  type: string;
  /**
   * 可选稳定工程对象 ID（如 `gbath.vanity`）。声明后即为 runtime objectId，房间内重排不变；
   * 未声明沿用 `furniture:${room}:${type}:${index}`（见 shared/furniture-object-id.ts）。全屋唯一。
   */
  id?: string;
  /** Original house.yaml array index, attached to phase API responses for edits. */
  sourceIndex?: number;
  count?: number;
  x?: number;
  z?: number;
  rotation?: number;
  wall?: string;
  wall_side?: WallSide;
  along?: number;
  /** Minimum finish-face retreat for a wall-anchored body (metres). */
  wall_clearance?: number;
  /** Declarative dimensions for a continuous cabinet run (metres). */
  length?: number;
  /** Declarative width override for a single cabinet module (metres). When present, placement and render use it instead of the catalog width (e.g. the study south leg: 2.21 vs catalog 1.70). */
  width?: number;
  depth?: number;
  cabinetHeight?: number;
  countertopThickness?: number;
  cutouts?: FurnishingCutout[];
  /** 挂载派生摆位：挂到 `furniture_id` 的 `slot` 上，世界坐标由解算推出，禁写 x/z。 */
  mount?: FurnitureMount;
  /** 锚点派生摆位：挂到另一份配置的锚点对象上（见 FurnitureAnchor），禁写 x/z。 */
  anchor?: FurnitureAnchor;
  /** type:'vanity' 的柜体分割参数；缺失或非法即定位诊断失败（不静默按默认值建模）。 */
  vanity_layout?: VanityLayoutDecl;
}

/** Explicit countertop-only bridge; it creates no cabinet body. */
export interface KitchenCountertopBridgeFurnishing extends FurnishingItem {
  type: 'kitchen_countertop_bridge';
  length: number;
  depth: number;
  countertopThickness: number;
}

export interface FurnishingsYaml {
  [roomId: string]: FurnishingItem[];
}

export interface PlacedFurnishing {
  type: string;
  x: number;
  z: number;
  rotation: number;
  wall?: string;
  wall_side?: WallSide;
  along?: number;
  wall_clearance?: number;
  length?: number;
  depth?: number;
  cabinetHeight?: number;
  countertopThickness?: number;
  cutouts?: FurnishingCutout[];
}

export interface RoomFurnishings {
  placed: PlacedFurnishing[];
  counts: Record<string, number>;
}

export interface FurnitureAabb {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface PartitionWardrobeDoorAabb extends FurnitureAabb {
  doorIndex: number;
  state: 'closed' | 'open';
}

/** Pure R5 candidate geometry helper; opening is a validation envelope, not a construction clearance claim. */
export function getPartitionWardrobeDoorAabbs(state: 'closed' | 'open' = 'closed'): PartitionWardrobeDoorAabb[] {
  const center = { x: 2.20, z: 5.25 };
  const doorWidth = 0.40;
  const closedSouthFace = 5.55;
  const doorThickness = 0.025;
  const openProjection = 0.40;
  const doors = Array.from({ length: 4 }, (_, doorIndex) => {
    const minX = center.x - 0.80 + doorIndex * doorWidth;
    const maxX = minX + doorWidth;
    if (state === 'closed') {
      return { doorIndex, state, minX, maxX, minZ: closedSouthFace - doorThickness, maxZ: closedSouthFace };
    }

    // The declared front is the cabinet's south face. Each leaf rotates toward +z
    // around its actual left/right hinge; the plan AABB therefore stays at the
    // hinge strip in x and expands only southward, never toward the west.
    const hingeX = doorIndex % 2 === 0 ? minX : maxX;
    return {
      doorIndex,
      state,
      minX: hingeX === minX ? hingeX : hingeX - doorThickness,
      maxX: hingeX === minX ? hingeX + doorThickness : hingeX,
      minZ: closedSouthFace + doorThickness,
      maxZ: closedSouthFace + doorThickness + openProjection,
    };
  });
  return doors;
}

/**
 * 主卫冷凝水遮蔽链三件（issue #98 PR-10）：协调示意家具，摆位改锚点派生
 * （shared/condensate-chain.ts 单一解算），绝对 x/z 对这三件已废——
 * resolver 见到绝对坐标即诊断失败，防止第二份坐标源静默回来。
 * 清单放 types.ts 而非 condensate-chain.ts：resolver 与链模块都要读，
 * 放中间模块会成循环依赖。
 */
export const CONDENSATE_CHAIN_FURNITURE_TYPES = [
  'condensate_pipe_ac_outlet',
  'mb_vanity_pvc_wardrobe_entry',
  'mb_vanity_pvc_service_chase',
] as const;
export type CondensateChainFurnitureType = (typeof CONDENSATE_CHAIN_FURNITURE_TYPES)[number];

export const FURNITURE_DIMS: Record<string, { width: number; depth: number }> = {
  bed_180: { width: 1.8, depth: 2.0 },
  bed_150: { width: 1.5, depth: 2.0 },
  wardrobe_240: { width: 2.4, depth: 0.6 },
  master_wardrobe_tall_240: { width: 2.4, depth: 0.6 }, // 主卧修正版高柜：2.4×0.6×2.7m，东西向、柜门朝北，东端贴 w_mb_east
  wardrobe_180: { width: 1.8, depth: 0.6 },
  kitchen_countertop_bridge: { width: 0.6, depth: 0.6 },
  shelf: { width: 0.8, depth: 0.4 }, // DEC-023 置物架（开架，h2.0）
  bath_side_cabinet: { width: 0.45, depth: 0.5 }, // 2026-08-21 主卫干区封闭侧柜 h2.0
  // DEC-045 主卫东墙独立对象：rotation=270 后 width 沿墙 z、depth 朝 west；
  // wall anchor 是自身中心，local y 才是高度层次；柜体与悬浮板沿墙同轴组成一套墙面家具。
  mb_vanity_base_cabinet: { width: 1.38, depth: 0.565 }, // 2026-09-07：1.38m×0.565m×0.62m；摆位 AABB x[1.96,2.525] z[2.92,4.30]（背面=墙线 2.60−半墙厚 0.06−wall_clearance 0.015=2.525；2026-11-06 口径 A 校验共享化后按真实摆位更正，旧 x[1.975,2.54] 系忽略 clearance 的幻影包络），同时避开东墙与主卫南墙
  mirror_cabinet_gbath: { width: 0.66, depth: 0.14 }, // DEC-2026-09-09-R2 客卫镜柜（y[1.10,2.00] 挂墙，沿墙 0.66m——2026-11-06 随 DEC-2026-11-05-R5 柜体北移由 0.70 收窄，北缘避南墙南脸 3.61）
  heated_towel_rack: { width: 0.55, depth: 0.10 }, // DEC-2026-10-17-R20 客卫电热毛巾架：梯式 0.55W(沿墙)×0.10D(凸出)×0.75H，挂墙 y[1.05,1.80]；SKU 未选型，图示代理尺寸
  robot_dock_gbath: { width: 0.41, depth: 0.433 }, // DEC-2026-09-09-R6 客卫扫地机基站（藏悬空台盆柜下；2026-11-02 本 PR 改为云鲸 JX 超薄上下水版 YJCC034 实尺寸 410×433×280mm，柜体底缘 0.30 不动）
  // 2026-11-07（issue #98 PR-11）条带柜组 FURNITURE_DIMS 清理：两块悬浮板
  // （mb_vanity_lower_board / mb_vanity_main_board）的尺寸声明已在 PR-9「条带柜组摆位统一」
  // 随条目迁进 house.yaml 行内 width/depth（同一数字只留一处），目录条目删。
  // 其余 mb_* 条目**保留**——全仓 grep 确认仍有真实读者，删了会破门禁：
  //   mb_vanity_base_cabinet：house.yaml 行内不写尺寸（PR-9 测试明令「行内不写第二套」），
  //     挂墙解算的 along 合法域/退让与 verify-furniture 的柜组包络专项都读目录；
  //   mb_vanity_pvc_box：同上（挂墙解算 + 冷凝链 alongWallZSpan/wallRunSpan 派生读它）；
  //   condensate_pipe_ac_outlet：verify-furniture 的居中方框（itemAabb）用它算 AABB，
  //     且该型不在 MB_CONDENSATE_TYPES 豁免集里，方框要参与房间边界/门扫/重叠检查；
  //   mb_vanity_pvc_wardrobe_entry / mb_vanity_pvc_service_chase：verify-furniture 仍按
  //     目录算它们的（豁免）方框，目录值是「零件长度须与相邻段接口坐标一致」的声明参照
  //     （FixtureFactory 链构建器不持长度常量），删了只多两条 no-dims 警告、无迁移去处。
  condensate_pipe_ac_outlet: { width: 0.40, depth: 0.46 }, // ac_master 内冷凝水出口→延伸空调盒/衣柜顶部服务带；厂家出口位置 pending，横向取机身中心轴 x=3.70
  mb_vanity_pvc_box: { width: 1.20, depth: 0.08 }, // w_mbath_east 西侧冷凝水墙行 (2.50,4.30)->(2.50,3.10)；中心离墙完成面约40mm，wall anchor 使用 w_mbath_east west，管径/坡度待深化
  mb_vanity_pvc_wardrobe_entry: { width: 1.175, depth: 0.03 }, // 延伸空调盒/衣柜顶部服务带内的西行段
  mb_vanity_pvc_service_chase: { width: 0.925, depth: 0.06 }, // 衣柜顶部至 w_mbath_south 穿点及主卫吊顶内短折/下引
  mb_washbasin_cabinet: { width: 1.05, depth: 0.50 }, // 2026-09-02 初版：西让 5cm 百叶升降缝、东留 5cm 门套缝，收宽 1.10→1.05 且盆居中（假定玻璃通高，待量房终核）；2026-09-01 取消梳妆膝位，东侧封闭抽屉收纳
  master_dressing_table: { width: 0.90, depth: 0.45 }, // 2026-09-03 改 900W×450D×750H 四腿开放式独立桌并迁西侧北段：rotation=90 后长边沿世界 z、正面（抽屉/座位侧）朝东，桌面镜/桌灯在局部 -z 侧
  dressing_stool: { width: 0.42, depth: 0.40 }, // 可完整收进 master_dressing_table 台下的专用小凳
  master_hot_season_low_dresser: { width: 1.40, depth: 0.48 }, // 2026-09-04 R1 主卧南侧窗带轻中古六抽矮柜：1400W×480D×850H（h<2.07 不挡窗带）；rotation=180 局部 +z 正面转朝北对房间
  master_north_wall_wardrobe_600: { width: 0.60, depth: 0.58 }, // R6 主卧北墙衣柜（已 superseded，保留供历史数据解析）：600W×580D×2050H
  master_north_wall_wardrobe_950: { width: 0.95, depth: 0.58 }, // 主卧北墙定制衣柜：950W×580D×2800H，三扇窄平开门+顶部固定木饰面门头；冷凝水管槽隐藏在顶部；位置由 config/house.yaml 的当前方案决定
  master_north_wall_wardrobe_650: { width: 0.65, depth: 0.58 }, // R7 历史收窄版主卧北墙定制衣柜：650W×580D×2450H，两扇窄平开门朝南，非通顶
  master_wardrobe_top_pelmet: { width: 0.95, depth: 0.58 }, // 通顶950衣柜顶部的独立薄收口/东侧竖向填板；主体固定门头由衣柜对象表达，不承担 HVAC 责任
  master_freestanding_wardrobe_062: { width: 0.62, depth: 0.60 }, // 历史 R3 类型：保留尺寸供旧数据解析，不再作为主卧 placed 对象
  master_partition_wardrobe_1600: { width: 1.60, depth: 0.60 }, // R5 横向隔断柜：四扇窄门，rotation=0 时逻辑 AABB x[1.40,3.00]、z[4.95,5.55]
  master_bedside_cabinet_350_north: { width: 0.38, depth: 0.35 }, // R6 候选 380W×350D×500H，runtime 高 495–505mm；北侧中心 z=6.245
  master_bedside_cabinet_350_south: { width: 0.38, depth: 0.35 }, // R6 候选 380W×350D×500H，runtime 高 495–505mm；南侧中心 z=8.555，闭帘候选软包络冲突仅 warning/BLOCKED
  master_dressing_connection_storage: { width: 0.70, depth: 0.40 }, // R5 独立连接收纳段：recipe/runtime AABB 对齐，维护/安装条件仍 site_pending
  master_bedside_cabinet_north: { width: 0.24, depth: 0.30 }, // 历史 R3 类型，保留兼容尺寸但不再 placed
  master_bedside_tray_south: { width: 0.20, depth: 0.26 }, // 历史 R3 类型，保留兼容尺寸但不再 placed
  study_seasonal_wardrobe_wall: { width: 1.70, depth: 0.55 }, // 2026-09-03 书房东墙季节后台柜：1.70m 沿墙×0.55m 深×2.40m 高（非通顶）；rotation=270 后长边沿世界 z、柜门朝西
  towel_set: { width: 0.04, depth: 0.28 }, // Blender add_bath_fixtures 比例的声明式毛巾杆+毛巾，按东墙贴靠投影登记
  sofa_3seat: { width: 2.8, depth: 0.9 },
  dining_table: { width: 1.4, depth: 0.8 },
  dining_chair: { width: 0.45, depth: 0.45 },
  tv_stand: { width: 1.8, depth: 0.4 },
  tv_65: { width: 1.45, depth: 0.25 },
  floor_lamp: { width: 0.32, depth: 0.32 },
  plant_fiddle: { width: 0.5, depth: 0.5 },
  coffee_table: { width: 0.7, depth: 0.7 },
  shoe_cabinet: { width: 1.5, depth: 0.35 },
  garden_entry_station: { width: 1.1, depth: 0.38 }, // 可移动鞋柜+自立洞洞板，不挂墙
  entry_half_height_cabinet: { width: 2.0, depth: 0.35 }, // 门内右手定制半高柜，沿 z=3.10-5.10 向客厅延伸
  wall_cabinet_tall: { width: 1.35, depth: 0.35 }, // 西墙实体墙段 z=5.55-6.90
  tv_wall_low: { width: 2.1, depth: 0.4 }, // DEC-029 西墙柜墙 TV 区悬空低柜（沿墙长度×进深，z 6.9-9.0）
  desk: { width: 1.2, depth: 0.6 },
  bookshelf: { width: 0.8, depth: 0.3 },
  squat_rack: { width: 1.515, depth: 0.95 },
  barbell_olympic: { width: 2.2, depth: 0.08 },
  weight_plate_set: { width: 0.63, depth: 0.42 },
  bench_adjustable: { width: 1.24, depth: 0.55 },
  adjustable_dumbbell_pair: { width: 0.55, depth: 0.45 }, // 2026-09-03 可调哑铃对含底座包络（渲染用；2026-10-05 轻训练套整体删除，recipe/dims 保留备用）
  rollable_training_mat: { width: 0.25, depth: 0.25 }, // 2026-09-03 卷起态圆筒（立放 footprint；渲染用；2026-10-05 删除，dims 保留备用）
  rubber_training_mat: { width: 1.8, depth: 1.6 },
  low_weight_storage: { width: 0.95, depth: 0.42 },
  low_room_cabinet: { width: 0.40, depth: 1.20 }, // 2026-08-26 书房东墙低柜，世界 footprint 0.40×1.20m；配置 rotation=0 沿东墙南北向展开，柜门朝西，不是健身器材收纳
  chair: { width: 0.5, depth: 0.5 },
  fridge: { width: 0.833, depth: 0.600 }, // HR-518WUFIPZ visual-trial body footprint; height is rendered by FixtureFactory (1.910m)
  coffee_machine_em450: { width: 0.220, depth: 0.285 }, // User-supplied EM450 SKU dimensions; height is rendered by FixtureFactory (0.305m)
  mijia_tea_bar_pro: { width: 0.310, depth: 0.315 }, // User-supplied Mijia Tea Bar Pro dimensions; height is rendered by FixtureFactory (1.155m)
  waterbar_low_sideboard_400_preview: { width: 0.390, depth: 0.400 }, // Freestanding modular low cabinet candidate; top height 0.92m is rendered by FixtureFactory
  waterbar_low_cabinet_800_preview: { width: 0.800, depth: 0.420 }, // 800mm wall run ×420mm depth; total height 0.85m in FixtureFactory
  // V6 (2026-10-17): bay is on the 106mm narrow face, so local width=0.106 (local +x → world north
  // after rotationY=90°) and local depth=0.312 (local +z → world east). Height 0.28m.
  mijia_instant_dispenser_s1_preview: { width: 0.106, depth: 0.312 }, // User-supplied S1 countertop dispenser dimensions; height 0.28m
  mijia_ro_purifier_1400g_under_sink_preview: { width: 0.163, depth: 0.445 }, // User-supplied purifier body footprint; height 0.379m
  gas_stove: { width: 0.75, depth: 0.6 },
  range_hood: { width: 0.9, depth: 0.5 },
  sink: { width: 0.8, depth: 0.6 },
  // vanity 尺寸已随 issue #98 PR-3 迁到 config/house.yaml `gbath.vanity` 的 vanity_layout 声明
  // （FURNITURE_DIMS 与条目声明不得重复存同一数字）；目录不再存 vanity 宽深。
  toilet: { width: 0.4, depth: 0.6 }, // 2026-08-21 马桶落位（对齐 FixtureFactory 模型 footprint）
  exhaust_fan: { width: 0.3, depth: 0.3 },
  washer: { width: 0.6, depth: 0.6 }, // 2026-08-23 阳台洗烘叠放（贴 w_balc_west，与 dryer 同 footprint）
  dryer: { width: 0.6, depth: 0.6 }, // 叠放洗衣机上方，与 washer 同位（STACKED_PAIRS 豁免重叠）
  dishwasher: { width: 0.6, depth: 0.6 }, // 2026-08-23 厨下（北墙地柜留位 x∈[8.5,9.1]，水槽柜西侧紧邻）
  water_heater: { width: 0.36, depth: 0.16 }, // 2026-08-23 燃气壁挂（⚠️暂定位，pending-site-data #26）
};

export interface LaborRate {
  /** null = 待报价：数量照算并显形进 BudgetCategory.pendingLabor，但不计入 actual。 */
  rate: number | null;
  unit: string;
  area: string;
}

export interface BudgetCategoryRaw {
  budget: number;
  material: number;
  /** 单条（既有分类）或多条（DEC-2026-10-08-C02 起 carpentry 按㎡/延长米分行）。 */
  labor?: LaborRate | LaborRate[];
  actual: number;
  status: string;
  notes: string;
}

export interface LayoutOption {
  name: string;
  path: string;
  rooms: Array<{ id: string; name: string }>;
  platform?: { id: string; name: string };
}

export interface SelectionDiff {
  topic: string;
  current: string | null;
  compare: string | null;
  priceDelta: number;
}

export interface SchemeDiff {
  budget: number;
  selections: SelectionDiff[];
  risks: {
    added: Array<{ id: string; severity: string }>;
    removed: Array<{ id: string; severity: string }>;
  };
}

export interface StructuralDiffEntry {
  roomId: string;
  current: { area: number };
  compare: { area: number };
  delta: number;
}

export interface CompareSchemesResult {
  current: { scheme: CurrentScheme; budget: BudgetSnapshot; risks: DesignCheckResult };
  compare: { scheme: CurrentScheme; budget: BudgetSnapshot; risks: DesignCheckResult };
  diff: SchemeDiff;
  structural?: {
    roomsOnlyInCurrent: string[];
    roomsOnlyInCompare: string[];
    areaDelta: StructuralDiffEntry[];
  };
}
