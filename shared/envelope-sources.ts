/**
 * 来源注册表（issue #98 第三阶段 S6，2026-11-07）——「源名 → 权威文件 → 场景 objectId 前缀」
 * 的唯一真相。
 *
 * 由来：S1 把 `config/layout/overlay.yaml` / `config/ceiling.yaml` 搬进
 * `config/model/envelope/` 后，取证（迁移设计 §4.3）发现**六张以上表各自把文件路径当身份**：
 *   config/state-model.yaml `element_bearing_files`（file → 前缀）
 *   shared/pending-ledger.ts   `ELEMENT_BEARING_FILES`（同上，代码默认值）
 *   shared/element-sources.ts  `ELEMENT_SOURCES`（源名 → 路径）
 *   config/mep-takeoff.yaml    `sources.ceiling`（路径）
 *   shared/project-render-facts-schema.ts `ref.source` 枚举（源名手抄）
 *   shared/element-state.ts    `ledgerIndex` 按 `endsWith('ceiling.yaml')` 猜前缀
 *   config/model-package-links.yaml `authorities`（源名 → 路径）
 * 每搬一次文件就要同步七八处；漏一处的形态是「台账腐烂核对静默漏判 / 高亮静默 no-op」。
 * issue #98 明说「文件路径不构成身份」——本表把身份收敛成**源名**，路径与前缀都是派生量。
 *
 * 收录范围：上面每张表里出现过的源全部在册（electrical / plumbing / hvac / overlay / ceiling）。
 * 只收 envelope 两个源会逼出「半张表」——element-state 与 pending-ledger 的 file→前缀
 * 反查本来就要跨这四个源才完整，缺一个就得保留一条 endsWith 猜测分支。
 *
 * 纯数据、零 I/O：shared/ 各模块与 server/ 直接 import；YAML 侧（state-model /
 * mep-takeoff / model-package-links）不再各自登记路径，其读者改读本表，或由
 * server/model-package-links.ts 的装载时断言把 YAML 值钉成本表的镜像。
 */

/** 一个来源的权威文件与场景 objectId 前缀。 */
export interface SourceSpec {
  /** 权威文件。可多个：overlay 是「openings + floor-zones + finish-defaults」三文件合并文档。 */
  readonly files: readonly [string, ...string[]];
  /**
   * 场景 objectId 前缀（SceneBuilder.setSceneObjectMetadata / InfrastructureBuilder）。
   * `''` = 裸 id（overlay 构件、墙、家具：id 本身就是 objectId）；
   * `'electrical:'` 等 = 合批点位/吊顶分区的带前缀 objectId。
   */
  readonly objectIdPrefix: string;
}

export const SOURCES = {
  electrical: { files: ['config/electrical.yaml'], objectIdPrefix: 'electrical:' },
  plumbing: { files: ['config/plumbing.yaml'], objectIdPrefix: 'plumbing:' },
  hvac: { files: ['config/hvac.yaml'], objectIdPrefix: 'hvac:' },
  /**
   * 围护构件合并文档（原 config/layout/overlay.yaml，S1 拆分）。注意源名仍是 `overlay`
   * ——model-package-links 的 authorities 与 package-scope 的 OBJECT_ID_SOURCES 都用它，
   * 改名会一次动两处消费方且不带来任何净减。其 objectId 是**裸 id**（构件 id 本身就是
   * 场景 objectId，SceneBuilder.addOverlayElement 的 `setSceneObjectMetadata(mesh, type, id)`）。
   */
  overlay: {
    files: [
      'config/model/envelope/openings.yaml',
      'config/model/envelope/floor-zones.yaml',
      'config/model/envelope/finish-defaults.yaml',
    ],
    objectIdPrefix: '',
  },
  /** 吊顶分区与空调设备位（原 config/ceiling.yaml，S1 搬迁）。objectId 带 `ceiling:` 前缀。 */
  ceiling: { files: ['config/model/envelope/ceiling.yaml'], objectIdPrefix: 'ceiling:' },
} as const satisfies Record<string, SourceSpec>;

export type SourceName = keyof typeof SOURCES;

/** 全部源名（按注册表声明序）。 */
export const SOURCE_NAMES = Object.keys(SOURCES) as SourceName[];

/** 源名 → 场景 objectId 前缀（迁移设计 §5.3 的 SOURCE_PREFIXES）。 */
export const SOURCE_PREFIXES: Readonly<Record<SourceName, string>> = Object.freeze(
  Object.fromEntries(SOURCE_NAMES.map((name) => [name, SOURCES[name].objectIdPrefix])) as Record<SourceName, string>,
);

/** 单文件源的权威路径。多文件源（overlay）调用即抛错——合并文档的读取入口是 server/overlay-merge.ts。 */
export function sourceFile(name: SourceName): string {
  const files = SOURCES[name].files;
  if (files.length !== 1) {
    throw new Error(`source "${name}" 有 ${files.length} 个权威文件，不是单文件源：请走合并读取入口，不要在这里猜一个`);
  }
  return files[0];
}

/** 文件路径 → 源名（反查）。不在册的路径返回 undefined——调用方必须显形，不许按后缀猜。 */
export function sourceNameOfFile(file: string): SourceName | undefined {
  return (Object.keys(SOURCES) as SourceName[]).find((name) => (SOURCES[name].files as readonly string[]).includes(file));
}

/**
 * hvac.yaml `anchor.ref.source` 可指向的源名。手抄字面量会与注册表漂移（S1 搬迁后
 * `config/ceiling.yaml` 这个路径从所有表里消失，源名 `ceiling` 不变）——这里从注册表取，
 * 写错源名在编译期就断。
 */
export const CEILING_SOURCE = 'ceiling' satisfies SourceName;

/**
 * 承载**场景构件**的源（会被 shared/element-sources.ts 的 collectElements 采成带
 * objectId 的 ElementInput）。这是 SOURCES 的子集，区别在：
 *   - `hvac` 只被读作 ceiling 构件状态的绑定来源（collectCeilingHvacAnchors），
 *     自身不产出 `hvac:` 元素；
 *   - `overlay` 的构件 objectId 是裸值（无前缀），不进「按前缀拼 objectId」的核对。
 * 台账腐烂核对（pending-ledger / state-projection / element-state-service）按本子集 gate：
 * 用全集会把指向 config/hvac.yaml 的台账行（如 #3a `reference_constraints`）误报成
 * 「构件已不存在」——那是字段描述不是元素 id，classifyTarget 的 type_reference 分支救不了它。
 */
export const ELEMENT_BEARING_SOURCES = ['electrical', 'plumbing', 'ceiling'] as const satisfies readonly SourceName[];

/** 该文件是否承载场景构件（台账腐烂核对的 gate；与改造前 state-model.yaml 的三行同集合）。 */
export function isElementBearingFile(file: string): boolean {
  return ELEMENT_BEARING_SOURCES.some((name) => (SOURCES[name].files as readonly string[]).includes(file));
}
