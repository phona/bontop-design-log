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
  apply(scene: SceneApi, optionId: string): string[];
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
  | { type: 'wall'; id: string; x1: number; z1: number; x2: number; z2: number; segments?: Array<{ x1: number; z1: number; x2: number; z2: number }>; openings?: ResolvedOpening[] }
  | { type: 'curtain_run'; id: string; points: CurtainPoint[]; height: number; closed?: boolean }
  | { type: 'wall_run'; id: string; points: OverlayPoint[]; height: number }
  | {
      type: 'glass_infill';
      id: string;
      wall: string;
      width: number;
      height: number;
      sill: number;
    }
  | { type: 'floor_region'; id: string; points: CurtainPoint[]; room?: string; reason?: string }
  | { type: 'bay_sill'; id: string; points: OverlayPoint[]; depth: number; sill: number; height: number; reason?: string }
  | { type: 'railing_run'; id: string; points: CurtainPoint[]; height: number };

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

export interface FurnishingItem {
  type: string;
  count?: number;
  x?: number;
  z?: number;
  rotation?: number;
}

export interface FurnishingsYaml {
  [roomId: string]: FurnishingItem[];
}

export interface PlacedFurnishing {
  type: string;
  x: number;
  z: number;
  rotation: number;
}

export interface RoomFurnishings {
  placed: PlacedFurnishing[];
  counts: Record<string, number>;
}

export const FURNITURE_DIMS: Record<string, { width: number; depth: number }> = {
  bed_180: { width: 1.8, depth: 2.0 },
  bed_150: { width: 1.5, depth: 2.0 },
  wardrobe_240: { width: 2.4, depth: 0.6 },
  wardrobe_180: { width: 1.8, depth: 0.6 },
  sofa_3seat: { width: 2.8, depth: 0.9 },
  dining_table: { width: 1.4, depth: 0.8 },
  dining_chair: { width: 0.45, depth: 0.45 },
  tv_stand: { width: 1.8, depth: 0.4 },
  desk: { width: 1.2, depth: 0.6 },
  bookshelf: { width: 0.8, depth: 0.3 },
  chair: { width: 0.5, depth: 0.5 },
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
