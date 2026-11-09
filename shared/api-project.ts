/**
 * GET /api/project 的响应形状——API 边界的唯一类型来源（2026-11-09 issue #98 轨道③）。
 *
 * 由来：`StateSync.fetchProject` 曾签 `Promise<any>`、`App.projectData` 是 any、
 * `HouseScene.ProjectData` 是凭印象手抄的第二份——整条边界没有类型，「字段声明在 A、
 * 实际下发在 B」的漂移编译器完全看不见（renderFactsProjection 就是这么错了五轮：
 * 服务端把它随 `house` 下发，消费方按顶层读，值恒为 undefined）。
 *
 * 权威 = `server/routes.ts` 的 `/project` 路由实际下发（res.json 的对象字面量，
 * 2026-11-09 对照逐字段抄录）。**本文件是该形状的唯一手写处**：
 * `StateSync.fetchProject` 的返回类型、`App.projectData`、`HouseScene.ProjectData`
 * 全部从这里派生，不再各抄一份。改下发形状先改这里，typecheck 会拦住全部消费方。
 *
 * 边界说明（轨道边界）：本类型只保证「服务端此刻下发什么被单一、如实地声明」。
 * 下发层级本身的修正（例如 renderFactsProjection 究竟该在 house 内还是顶层）
 * 属轨道①；这里以服务端当前实际下发为准，不做预支。
 */

import type {
  CeilingZone,
  ElectricalPoint,
  FurnishingsYaml,
  MaterialAppearance,
  MaterialPreviewAtlasConfig,
  PhaseBudgetMeta,
  PhaseId,
  PhaseScope,
  PlumbingPoint,
  ProjectRenderFactsProjection,
  RoomLayout,
  SceneElement,
} from './types.js';
import type { ModelPackageLink } from './model-package-links.js';
import type { EnvironmentConfig } from './environment-schema.js';

/**
 * house 内随项目数据一次下发的建场输入（routes.ts `/project` 的 house 字面量）。
 * 字段与路由逐条对照：rooms/platform/furnishings/furnishingsAll/electrical/plumbing/
 * ceilingZones/sceneElements/layoutSource/condensatePenetration/renderFactsProjection。
 */
export interface ProjectApiHouse {
  /** 全量房间（中心坐标，见 AGENTS.md 坐标系约定）；含 semantic_only 语义房。 */
  rooms: RoomLayout[];
  /** 入户花园等服务台地；无声明时路由仍发该键，JSON 序列化后为缺省。 */
  platform?: RoomLayout;
  /** 阶段可见家具（几何渲染用）。**定位宿主不用它**——见 furnishingsAll。 */
  furnishings: FurnishingsYaml;
  /** 未按阶段过滤的全量家具：仅用于 mountHosts 定位宿主（阶段可见性与定位宿主是两个关注点）。 */
  furnishingsAll: FurnishingsYaml;
  /** 电气点位全量清单（render-facts 就绪时取投影，否则直读 config/electrical.yaml）。 */
  electrical: ElectricalPoint[];
  /** 给排水点位全量清单：sceneElements 不含点位，前端只有这一条路拿到 plumbing。 */
  plumbing: PlumbingPoint[];
  /** 吊顶分区（同 electrical/plumbing：render-facts 优先，否则直读配置）。 */
  ceilingZones: CeilingZone[];
  /** 墙体 + overlay 合并后的场景元素，并按阶段过滤窗帘。 */
  sceneElements: SceneElement[];
  /** 布局来源标识（布局切换时回传给服务端）。 */
  layoutSource: string;
  /** 主卫冷凝链 MEP 穿墙锚点；派生失败时路由发 undefined（JSON 后缺省），下游链条显形。 */
  condensatePenetration?: { x: number; z: number };
  /**
   * render-facts 投影。**服务端实际随 `house` 下发**（routes.ts 的条件 spread 写在
   * house 字面量内），不是顶层字段——历史上手抄类型把它写在顶层，消费方按顶层读，
   * 于是恒为 undefined（错了几轮的正是这一处）。投影端点未就绪时整个键不下发，故可选。
   */
  renderFactsProjection?: ProjectRenderFactsProjection;
}

/**
 * 预算科目行（/api/project 的 budgetCategories，原 server/project-catalog.ts 声明，
 * 2026-11-09 迁到此处）：budgetBase 各类目的原始行，键由服务端 Object.entries 补。
 * 注意与 shared/types.ts 的 `BudgetCategory`（预算快照科目，带 manualActual/autoActual/
 * pendingLabor 等派生字段）**不是同一个形状**，勿混用。
 */
export interface BudgetCategory {
  key: string;
  budget: number;
  actual: number;
  status: string;
  notes: string;
}

/** 主题摘要：只有计数，没有 options（ HouseScene 曾按手抄类型读 topic.options，恒为空）。 */
export interface ProjectApiTopic {
  id: string;
  name: string;
  perRoom: boolean;
  optionCount: number;
}

/** 材质预演素材（floor/paint 两类）+ 图集资产。 */
export interface ProjectApiMaterialPreview {
  materials: Array<{ id: string; topic_id?: string; appearance?: MaterialAppearance }>;
  atlases: MaterialPreviewAtlasConfig[];
}

/** GET /api/project 的完整响应。 */
export interface ProjectApiResponse {
  /** 解析后的阶段 id（full / phase_1_basic_occupancy）。 */
  phase: PhaseId;
  /** 阶段声明与该阶段预算权限元数据（routes.ts：`{...phaseScopes[phase], budget: …}`）。 */
  phaseMeta: PhaseScope & { budget: PhaseBudgetMeta };
  /** 模型包链接；非 full 阶段按 phase_id 过滤。 */
  modelPackageLinks: ModelPackageLink[];
  house: ProjectApiHouse;
  topics: ProjectApiTopic[];
  materialPreview: ProjectApiMaterialPreview;
  budgetCategories: BudgetCategory[];
  /** 环境/气候配置（光照/日照/湿度分析用）；未就绪时为 null。 */
  environment: EnvironmentConfig | null;
}
