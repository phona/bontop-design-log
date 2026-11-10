import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { load as parseYaml } from 'js-yaml';
import { collectElements } from '../shared/element-sources.js';
import {
  DEFAULT_STATE_MODEL,
  deriveElementStates,
  type ElementState,
  type IssueLike,
  type StateModel,
  type StateWarning,
} from '../shared/element-state.js';

/**
 * 构件级工程状态服务：把 `npm run state:project` 的同一份派生搬到 HTTP 上，
 * 让浏览器里的 3D 也能回答「这个构件确认到什么程度、卡在谁、和谁冲突」。
 *
 * 三条约束（与 CLI 同一套，不另写一份真相）：
 * 1. **只派生不存储**：权威仍在 config/*.yaml 的 `status` / `blocker` 字段与 verifier，
 *    本服务每次请求现算（或读缓存），不落盘、不引入第二份状态。
 *    2026-11-08 issue #98 S2-A：**不读 原量房台账（已于 S2-B 退场）**——状态与「卡在谁」
 *    全部来自对象自身的 status / blocker（业主裁定①③⑤）。
 * 2. **fail-closed**：任何一份输入读不到 / 解析失败 → 抛错，由路由转 503。
 *    绝不返回空 states 假装「没有状态」——那比报错更危险。
 * 3. **conflicts 路径缓存**：跑三个 verifier 约 3 秒，不能每次请求都跑；
 *    模块级缓存 + `refresh` 强制重算，payload 带 `cachedAt` 让人知道数据新旧。
 */

const ROOT = path.resolve(import.meta.dirname, '..');

export interface ElementStateSummary {
  total: number;
  byStatus: Record<string, number>;
  byKind: Record<string, number>;
  undeclared: number;
  conflicted: number;
  pending: number;
}

/** app 侧按此契约消费；字段与 `shared/element-state.ts` 的 ElementState 一一对应，不重画。 */
export interface ElementStatePayload {
  version: 1;
  withConflicts: boolean;
  /** 带 conflicts 时为本次（或缓存）计算时间；不带 conflicts 时为 null。 */
  cachedAt: string | null;
  summary: ElementStateSummary;
  states: ElementState[];
  warnings: StateWarning[];
}

export interface GetElementStateOptions {
  /** 附 verifier 结论（conflicts / conflicted 状态）。默认 false——不跑 verifier，毫秒级返回。 */
  withConflicts?: boolean;
  /** 忽略 conflicts 缓存强制重算。只在 withConflicts 时有意义。 */
  refresh?: boolean;
}

// config/state-model.yaml 的词汇表键名是蛇形 status_vocabulary（coverage 矩阵
// config/facts.yaml 按此名登记 reader）；此前这里继承 StateModel 读到的是驼峰
// statusVocabulary，蛇形键静默走 DEFAULT_STATE_MODEL——CLI（state-projection.ts）
// 已于 S1-B 改读蛇形，服务端读者同一文件同一键，必须同口径，否则 CLI 与 API 静默分叉。
// 默认值与 YAML 内容逐键相同，故无行为差；但今后改词汇表只有 CLI 会变。
interface StateModelConfig {
  priority?: StateModel['priority'];
  status_vocabulary?: StateModel['statusVocabulary'];
  issue_sources?: string[];
}

function readYaml<T>(file: string): T {
  return parseYaml(readFileSync(path.join(ROOT, file), 'utf8')) as T;
}

/**
 * verifier 名 → 入口脚本。与 `scripts/project/state-projection.ts` 的 VERIFIER_SCRIPTS 一致。
 */
const VERIFIER_SCRIPTS: Record<string, string> = {
  'verify-spatial': 'scripts/verify/spatial/verify-spatial.ts',
  'verify-penetration': 'scripts/verify/penetration/verify-penetration.ts',
  'verify-electrical': 'scripts/verify/electrical/verify-electrical-lint.ts',
};

/**
 * 跑指定 verifier 并把它们的 issue 归一成 IssueLike（`entity` 与 `id` 两种写法都接）。
 *
 * **为何与 `scripts/project/state-projection.ts` 的 collectIssues 重复**：那份写在
 * `scripts/` 下，server 引它会把脚本执行体（含 `main()` 自执行）拖进服务依赖图；
 * 而 `shared/` 本轮不许改，没有可放的共享处。两处必须同步修改。
 *
 * 与 CLI 的**唯一差异**：CLI 把失败源记进 `failed` 列表继续跑，这里**抛错**。
 * 端点上「少跑一个 verifier」等于少报一批冲突，是「假装没有状态」——
 * 按 fail-closed 要求，输入异常必须显形，不能降级成空结论。
 */
function collectIssues(sources: string[]): IssueLike[] {
  const issues: IssueLike[] = [];
  for (const source of sources) {
    const script = VERIFIER_SCRIPTS[source];
    if (!script) throw new Error(`state-model declares unknown issue source: ${source}`);
    const result = spawnSync('npx', ['tsx', script, '--json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    // verifier 发现 error 时退出码非零是**正常结论**，不是失败；只看 stdout 能否解析出 issue 形状。
    if (result.error) throw new Error(`${source} failed to spawn: ${result.error.message}`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout ?? '');
    } catch {
      throw new Error(`${source} produced unparseable output (exit ${result.status ?? 'null'})`);
    }
    const candidate = parsed as { report?: { issues?: IssueLike[] }; issues?: IssueLike[]; errors?: IssueLike[]; warnings?: IssueLike[] };
    const buckets = [candidate.report?.issues, candidate.issues, candidate.errors, candidate.warnings];
    let recognized = 0;
    for (const bucket of buckets) {
      if (Array.isArray(bucket)) {
        issues.push(...bucket);
        recognized += 1;
      }
    }
    // 一个 bucket 都没有 = 输出形状不对（脚本崩了 / 换了 CLI 契约）。
    // 空数组是合法结论（这个 verifier 当前没有 issue），不能与「解析失败」混为一谈。
    if (recognized === 0) throw new Error(`${source} produced no issue buckets — refusing to read a broken verifier as "no conflicts"`);
  }
  return issues;
}

/**
 * 现算一次投影。`issues` 为空数组 = 不带 conflicts 的路径（只读配置 + 台账，不跑 verifier）。
 *
 * `modelConfig` 只提供 priority / status_vocabulary / issue_sources；台账腐烂核对的
 * 承载文件表在 shared/envelope-sources.ts（S6，见 collectDanglingLedgerRefs 注释）。
 */
export function projectElementStates(
  issues: IssueLike[],
  modelConfig: StateModelConfig = readYaml<StateModelConfig>('config/state-model.yaml'),
): ElementStatePayload {
  const model: StateModel = {
    priority: modelConfig.priority ?? DEFAULT_STATE_MODEL.priority,
    statusVocabulary: modelConfig.status_vocabulary ?? DEFAULT_STATE_MODEL.statusVocabulary,
  };

  const elements = collectElements();
  const result = deriveElementStates({ elements, issues, model });

  return {
    version: 1,
    // 两个字段的「真实值」由调用方填：不带 conflicts 时就是这里的 false/null；
    // 带 conflicts 时 getElementState 会用计算时间覆写。
    withConflicts: false,
    cachedAt: null,
    summary: result.summary,
    // 与 CLI 同序：按 status 再按 id，app 与 `npm run state:project` 逐行可比。
    states: [...result.states].sort((a, b) => a.status.localeCompare(b.status) || a.id.localeCompare(b.id)),
    warnings: result.warnings,
  };
}

/**
 * conflicts 路径的模块级缓存。跑三个 verifier 约 3 秒，不能每次请求都跑；
 * 只缓存**带 conflicts** 的结果——不带 conflicts 的路径只读四份配置 + 台账，
 * 毫秒级且必须反映最新配置，缓存它只会让 3D 看到陈旧状态。
 */
let conflictsCache: { cachedAt: string; payload: ElementStatePayload } | undefined;

/**
 * 取构件级工程状态投影。
 *
 * - `withConflicts: false`（默认）：不跑 verifier，现算，`cachedAt === null`。
 * - `withConflicts: true`：跑 verifier 并归一 issue；结果进缓存，`cachedAt` 为本次计算时间。
 *   后续请求命中缓存直接返回同一 `cachedAt`；`refresh: true` 忽略缓存重算并刷新时间戳。
 *
 * 任何输入读不到 / 解析失败 → 抛错（路由转 503），不返回空 states。
 */
export function getElementState(options: GetElementStateOptions): ElementStatePayload {
  const withConflicts = options.withConflicts === true;
  const refresh = options.refresh === true;

  if (!withConflicts) return projectElementStates([]);

  if (refresh || !conflictsCache) {
    const modelConfig = readYaml<StateModelConfig>('config/state-model.yaml');
    const issueSources = modelConfig.issue_sources ?? ['verify-spatial', 'verify-penetration', 'verify-electrical'];
    // 先采 issue 再投影：采集中途抛错时缓存保持旧值（或空），不会写进半份结果。
    const issues = collectIssues(issueSources);
    const cachedAt = new Date().toISOString();
    conflictsCache = { cachedAt, payload: { ...projectElementStates(issues, modelConfig), withConflicts: true, cachedAt } };
  }

  // 浅拷贝：多个请求共享同一份缓存，别让某个调用方改到别人看到的 states/warnings。
  return { ...conflictsCache.payload };
}

