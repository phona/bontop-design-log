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
 * 下发层级已由疗法①（PR #162）定案并落地：`renderFactsProjection` 在**响应顶层**，
 * `server/routes.ts` 的条件 spread 写在 house 字面量闭合之后（2026-11-09 复核）。
 * 本文件跟随该事实，不改动层级。
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
 * ceilingZones/sceneElements/layoutSource/condensatePenetration。
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
  /** 主卫冷凝链 MEP 穿墙锚点；派生失败或**读取被隔离**（配置暂时不可解析）时路由不下发本键
   * （JSON 后缺省，后者见 placementClosureDiagnostics.condensatePenetrationError），下游链条显形。 */
  condensatePenetration?: { x: number; z: number };
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

/**
 * 交付诊断（宽容读取，issue #98 + PR #122 深审修复）：/api/project 不因**可预见的降级**
 * 500/503 掐死页面，而是随 **200** 响应下发本字段，页面显形问题并继续预览其余部分。
 *
 * **一条通道，三类条目**（PR #122 Codex blocking/major 修复后）：
 * - 点位闭合违例：mount 宿主断引用 / count-only 宿主无平面几何（逐条文案与交付断言一致）；
 * - 投影构造失败：render-facts 投影构造器抛错（如 `buildRenderLightingFixtures` 的
 *   fail-closed），此时响应**不下发** renderFactsProjection，错误并入 violations，
 *   并在 `projectionError` 给机器可读形态。投影是「数据源一次给全」的优化、不是正确性
 *   前提——页面少 HVAC 源仍可预览，但正式 DXF 导出与模型验证对同一断引用仍会失败。
 * - 冷凝锚点读取失败：`house.condensatePenetration` 的派生链重读并解析 MEP/电气/给排水/
 *   吊顶/HVAC 配置时抛错，此时响应**不下发** condensatePenetration，错误并入 violations，
 *   并在 `condensatePenetrationError` 给机器可读形态。锚点同样是「数据源一次给全」的优化、
 *   不是正确性前提——页面少锚点仍可预览，但正式 DXF/GLB 导出与验证脚本对同一份不可解析
 *   配置仍会失败（严格输出）。
 *
 * 键缺省 = 本次响应三类都正常。正式交付路径不因本字段放松（严格输出）。
 */
export interface PlacementClosureApiDiagnostics {
  /** 降级条数（= violations.length，三类条目合并计数）。 */
  count: number;
  /** 逐条人读诊断：哪一项降级、缺什么、可能原因（闭合违例与交付断言逐条文案一致）。 */
  violations: string[];
  /** 统一处理方向（统一诊断）：修配置而非放宽断言；正式交付路径仍会因此失败。 */
  guidance: string;
  /**
   * 投影构造失败的机器可读形态（存在即说明本次响应未下发 renderFactsProjection，
   * 且 violations 里必有对应条目）。缺失 = 投影未配置/未就绪或构造成功。
   */
  projectionError?: {
    /** 失败的构造阶段（当前只有 render-facts 投影一个产地）。 */
    stage: 'render-facts-projection';
    /** 原始错误文案（构造器的 fail-closed 信息，含具体点位/宿主/引用 id）。 */
    message: string;
  };
  /**
   * 冷凝锚点读取失败的机器可读形态（存在即说明本次响应未下发
   * `house.condensatePenetration`，且 violations 里必有对应条目）。
   * 缺失 = 锚点读取产地未注入/读取成功；注意派生「无锚」但未抛错时不产生本字段（既有 fail-closed 口径）。
   */
  condensatePenetrationError?: {
    /** 失败的读取阶段（当前只有主卫冷凝链穿墙锚点一个产地）。 */
    stage: 'condensate-penetration';
    /** 原始错误文案（配置读取/解析的 fail-closed 信息）。 */
    message: string;
  };
}

/** GET /api/project 的完整响应。 */
export interface ProjectApiResponse {
  /** 解析后的阶段 id（full / phase_1_basic_occupancy）。 */
  phase: PhaseId;
  /** 阶段声明与该阶段预算权限元数据（routes.ts：`{...phaseScopes[phase], budget: …}`）。 */
  phaseMeta: PhaseScope & { budget: PhaseBudgetMeta };
  /** 模型包链接；非 full 阶段按 phase_id 过滤。 */
  modelPackageLinks: ModelPackageLink[];
  /**
   * render-facts 投影。**服务端下发在响应顶层**（routes.ts 的条件 spread 在 house 字面量
   * 闭合之后，疗法① PR #162 归位），与 topics / materialPreview / budgetCategories 平级。
   * 投影端点未配置/未就绪、或**构造抛错被隔离**时整个键不下发（后者见
   * placementClosureDiagnostics.projectionError），故可选。
   */
  renderFactsProjection?: ProjectRenderFactsProjection;
  /**
   * 交付诊断（宽容读取）：点位 mount 宿主断引用、投影构造失败、或冷凝锚点读取失败时
   * 随 200 下发，与 renderFactsProjection 平级（响应顶层）。键缺省 = 本次响应无降级，
   * 页面照常预览。
   */
  placementClosureDiagnostics?: PlacementClosureApiDiagnostics;
  house: ProjectApiHouse;
  topics: ProjectApiTopic[];
  materialPreview: ProjectApiMaterialPreview;
  budgetCategories: BudgetCategory[];
  /** 环境/气候配置（光照/日照/湿度分析用）；未就绪时为 null。 */
  environment: EnvironmentConfig | null;
}
