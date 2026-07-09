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

/** @deprecated 旧文件桥接模型，Spec 1 清理阶段删除 */
export interface Snapshot {
  mode: 'orbit' | 'first-person';
  camera: CameraState;
  lookingAt?: {
    objectId: string;
    type: string;
    room?: string;
  };
  visibleObjects: string[];
  selectedObjects: string[];
  activeTopic: string;
  selections: Record<string, string>;
  updatedAt: string;
}

/** @deprecated 旧文件桥接模型，Spec 1 清理阶段删除 */
export interface Command {
  id: string;
  type:
    | 'set_selection'
    | 'batch_set_selections'
    | 'set_camera_target'
    | 'highlight_object'
    | 'run_design_check';
  payload: unknown;
  reason?: string;
  createdAt: string;
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
  mesh?: Object3DRef;
}

export interface SceneApi {
  clearTopicObjects(topicId: string): void;
  addObject(topicId: string, objectId: string, obj: Object3DRef): void;
  getRoom(roomId: string): RoomObject | undefined;
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
}

export interface MaterialsYaml {
  notes?: string[];
  materials: MaterialItem[];
}

export interface HouseRoom {
  id: string;
  name?: string;
  type?: 'public' | 'private' | 'service';
  [key: string]: unknown;
}

export interface HouseYaml {
  project: Record<string, unknown>;
  rooms: Array<HouseRoom>;
  gift_areas: Array<Record<string, unknown>>;
  mechanical_electrical_plumbing: Record<string, unknown>;
  constraints: Record<string, unknown>;
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
  severity: 'warning' | 'error' | 'info';
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
  status: string;
  notes: string;
}

export interface BudgetSnapshot {
  totalBudget: number;
  totalActual: number;
  categories: BudgetCategory[];
  lineItems: BudgetLineItem[];
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
    lineItems?: Array<{ topic: string; quantityField?: string }>;
  };
  risks?: Array<{
    id: string;
    severity: 'warning' | 'error' | 'info';
    message: string;
    when: { topic: string; options?: string[]; condition?: string };
  }>;
  constraints?: Array<{
    id: string;
    description: string;
    when: { topic: string; condition: string };
    require: { topic: string; minValue?: { field: string; value: number } };
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

export interface CadLayoutYaml {
  version: string;
  source: string;
  unit: string;
  scale: number;
  origin: { x: number; z: number };
  export_date: string;
  rooms: LayoutRoom[];
  platform?: PlatformLayout;
}
