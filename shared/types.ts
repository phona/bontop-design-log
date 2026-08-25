/**
 * Shared types for the 3D roaming + AI co-design system.
 * Keep this file dependency-free so it can be imported by both
 * the browser app and the Node.js MCP server.
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
  needs_waterproof?: boolean;
  area?: number;
  wallOpenings?: ResolvedOpening[];
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

export interface HvacScheme {
  id: string;
  name: string;
  /** 预算用一口价（CNY），与 `materials.yaml` 的 `price_per_unit` 语义一致 */
  price_per_unit: number;
  /** 展示用的价格区间文本，如 "2.8–3.0 万" */
  price_range?: string;
  desc: string;
  outdoorUnits: OutdoorUnit[];
  indoorUnits: IndoorUnit[];
  pros: string[];
  cons: string[];
}

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
  appearance?: { type: string; color: string };
  data?: Record<string, unknown>;
}

export interface MaterialsYaml {
  notes?: string[];
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
  wall_finish?: 'paint' | 'tile';
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

export interface VisualCommand {
  commandId: string;
  type: 'set_camera_target' | 'highlight_object';
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
  status: 'draft' | 'ok' | 'near' | 'over' | 'reserved';
  notes: string;
}

export interface BudgetAttribution {
  topItems: BudgetLineItem[];
  overBy: number;
  ratio: number;
}

export interface BudgetSnapshot {
  totalBudget: number;
  totalActual: number;
  projectCeiling?: number;
  overCeilingBy?: number;
  categories: BudgetCategory[];
  lineItems: BudgetLineItem[];
  attribution?: Record<string, BudgetAttribution>;
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

export interface WallSegment {
  id?: string;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  segments?: Array<{ x1: number; z1: number; x2: number; z2: number }>;
  fromX?: number;
  fromZ?: number;
  fromRadius?: number;
  arcCenterX?: number;
  arcCenterZ?: number;
  openings?: ResolvedOpening[];
  /** 墙段两侧的房间 id（model-geometry 拓扑：boundary 同时含 from/to 顶点的房间），供渲染端按房间挂材质 */
  rooms?: string[];
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

export type SceneElement =
  | { type: 'wall'; id: string; x1: number; z1: number; x2: number; z2: number; segments?: Array<{ x1: number; z1: number; x2: number; z2: number }>; openings?: ResolvedOpening[]; rooms?: string[] }
  | { type: 'curtain_run'; id: string; points: CurtainPoint[]; height: number; closed?: boolean; exteriorOffset?: number }
  | { type: 'wall_run'; id: string; points: OverlayPoint[]; height: number }
  | {
      type: 'glass_infill';
      id: string;
      wall: string;
      width: number;
      height: number;
      sill: number;
    }
  | { type: 'floor_region'; id: string; points: CurtainPoint[]; room?: string; reason?: string; follow?: string }
  | { type: 'bay_sill'; id: string; points: CurtainPoint[]; depth: number; sill: number; height: number; plateThickness: number; reason?: string }
  | { type: 'railing_run'; id: string; points: CurtainPoint[]; height: number }
  | { type: 'sliding_door_run'; id: string; points: OverlayPoint[]; height: number; panels?: number; open?: boolean }
  | { type: 'shower_screen'; id: string; points: OverlayPoint[]; height: number; sill?: number }
  | { type: 'curtain'; id: string; points: CurtainPoint[]; height: number; room?: string; kind?: 'sheer_blackout' | 'blinds' };

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

export interface WallDef {
  id: string;
  from: string;
  to: string;
  height: number;
  openings?: OpeningDef[];
}

export interface RoomDef {
  id: string;
  name: string;
  boundary: string[];
  height: number;
  type?: string;
}

export interface PlatformDef {
  id: string;
  name: string;
  boundary: string[];
  height: number;
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
  | 'ceiling_light'
  | 'pendant'
  | 'dome'
  | 'wall_lamp'
  | 'downlight'
  | 'led_strip';

export type ElectricalPointStatus = 'measured' | 'likely' | 'inferred' | 'pending';
export type WallSide = 'north' | 'south' | 'east' | 'west';

export interface ElectricalPoint {
  id: string;
  room: string;
  type: ElectricalPointType;
  x: number;
  z: number;
  wall?: string;
  wallSide?: WallSide;
  temp?: number;
  count?: number;
  width?: number;
  depth?: number;
  height?: number;
  status?: ElectricalPointStatus;
  position_status?: ElectricalPointStatus;
  note?: string;
}

export type PlumbingPointType = 'faucet' | 'toilet' | 'shower' | 'drain' | 'washer' | 'faucet_outdoor';

export interface PlumbingPoint {
  id: string;
  room: string;
  type: PlumbingPointType;
  x: number;
  z: number;
  wall?: string;
  wallSide?: WallSide;
  note?: string;
  height?: number;
}

export const VALID_CEILING_TYPES = [
  'drop',
  'integrated',
  'cove',
  'none',
  'ac_indoor',
  'aluminum_buckle',
] as const;

export interface CeilingZone {
  id: string;
  room: string;
  type: (typeof VALID_CEILING_TYPES)[number];
  thickness?: number;
  area?: [number, number, number, number];
  x?: number;
  z?: number;
  height?: number;
  model?: string;
  power_point?: string;
  note?: string;
}

export type HvacStatus = 'confirmed' | 'inferred' | 'pending';
export type HvacSystem = 'refrigerant' | 'power' | 'condensate' | 'supply_air' | 'return_air' | 'access';

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
}

export interface HvacTerminal {
  id: string;
  status: HvacStatus;
  system: HvacSystem;
  position: Vec3;
  reason?: string;
  kind?: 'terminal' | 'condensate_drain_candidate';
  confirmed?: boolean;
  render_interior?: boolean;
  render_coordination?: boolean;
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
  constraint_refs?: string[];
  reason?: string;
}

export interface HvacDiagram {
  anchors: HvacAnchor[];
  terminals: HvacTerminal[];
  routes: HvacRoute[];
  reference_constraints: HvacReferenceConstraint[];
}

export interface ProjectHvacFacts {
  plans: Array<{
    id: string;
    kind: 'vrf_ducted';
    outdoor: VrfOutdoorUnit;
    diagram: HvacDiagram;
  }>;
}

export interface ProjectRenderFacts {
  electrical: ElectricalPoint[];
  plumbing: PlumbingPoint[];
  ceiling: CeilingZone[];
  hvac: ProjectHvacFacts;
}

/** Render-only anchor adjustments; never write these values back to MEP facts. */
export interface RenderLightingOverride {
  id: string;
  anchorY: number;
  offsetX?: number;
  offsetZ?: number;
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
  lightingFixtures: RenderLightingFixture[];
  plumbing: PlumbingPoint[];
  ceiling: CeilingZone[];
  hvac: ImplementedHvacProjection | UnimplementedHvacProjection;
  materials: {
    floor: TopicSelection;
  };
}

export interface FurnishingItem {
  type: string;
  count?: number;
  x?: number;
  z?: number;
  rotation?: number;
  /** Declarative dimensions for a continuous cabinet run (metres). */
  length?: number;
  depth?: number;
  cabinetHeight?: number;
  countertopThickness?: number;
}

export interface FurnishingsYaml {
  [roomId: string]: FurnishingItem[];
}

export interface PlacedFurnishing {
  type: string;
  x: number;
  z: number;
  rotation: number;
  length?: number;
  depth?: number;
  cabinetHeight?: number;
  countertopThickness?: number;
}

export interface RoomFurnishings {
  placed: PlacedFurnishing[];
  counts: Record<string, number>;
}

export const FURNITURE_DIMS: Record<string, { width: number; depth: number }> = {
  bed_180: { width: 1.8, depth: 2.0 },
  bed_150: { width: 1.5, depth: 2.0 },
  wardrobe_240: { width: 2.4, depth: 0.6 },
  wardrobe_240_split: { width: 2.4, depth: 0.8 }, // DEC-023 西段 1.2m 加深 0.8 + 东段 1.2m 标准 0.6（footprint 取最深）
  wardrobe_180: { width: 1.8, depth: 0.6 },
  shelf: { width: 0.8, depth: 0.4 }, // DEC-023 置物架（开架，h2.0）
  bath_side_cabinet: { width: 0.45, depth: 0.5 }, // 2026-08-21 主卫干区封闭侧柜 h2.0
  bath_entry_shelf: { width: 0.8, depth: 0.5 }, // 主卫门口北墙多层开放架 h2.0
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
  chair: { width: 0.5, depth: 0.5 },
  fridge: { width: 0.7, depth: 0.7 },
  gas_stove: { width: 0.75, depth: 0.6 },
  range_hood: { width: 0.9, depth: 0.5 },
  sink: { width: 0.8, depth: 0.6 },
  vanity: { width: 0.8, depth: 0.4 },
  toilet: { width: 0.4, depth: 0.6 }, // 2026-08-21 马桶落位（对齐 FixtureFactory 模型 footprint）
  exhaust_fan: { width: 0.3, depth: 0.3 },
  washer: { width: 0.6, depth: 0.6 }, // 2026-08-23 阳台洗烘叠放（贴 w_balc_west，与 dryer 同 footprint）
  dryer: { width: 0.6, depth: 0.6 }, // 叠放洗衣机上方，与 washer 同位（STACKED_PAIRS 豁免重叠）
  dishwasher: { width: 0.6, depth: 0.6 }, // 2026-08-23 厨下（北墙地柜留位 x∈[8.5,9.1]，水槽柜西侧紧邻）
  water_heater: { width: 0.36, depth: 0.16 }, // 2026-08-23 燃气壁挂（⚠️暂定位，pending-site-data #26）
};

export interface LaborRate {
  rate: number;
  unit: string;
  area: string;
}

export interface BudgetCategoryRaw {
  budget: number;
  material: number;
  labor?: LaborRate;
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
