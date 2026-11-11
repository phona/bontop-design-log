/**
 * schedule 控制源的共享 loader（自装交互审批第一步，2026-11-02）。
 *
 * 存在理由：scripts/schedule/control.ts 是 1105 行零 export 的纯脚本，import
 * 即读文件、即校验、即 process.exit——server 与前端无法复用，而交互审批的
 * 只读 API 需要的正是同一份判定。本模块把「加载 + 校验 + 派生」抽成无副作用
 * 的 loadScheduleState(root)，control.ts 退化为「loader + 渲染器 + CLI」的薄壳
 * （渲染输出逐字不变，tests/server/control-contract-validation.test.ts 钉的
 * 错误文案在这里原样保留）。
 *
 * 铁律：判定规则只有这一份。UI / API 只消费本模块的输出，不得另写一套。
 * 模型包关联的解析（loadModelPackageLinks）仍留在 server/model-package-links.ts
 * 单一实现，由调用方注入——shared/ 不反向依赖 server/。
 *
 * 2026-11-10（issue #202 切片 B）：①新增排程扩展声明的校验——顶层 work_calendar、
 * PKG 级 constraints、SCH 级 coordination（docs/schedule-coordination-design.md §2.1(d)，
 * 全部 error 级）；②buildScheduleSnapshot 纯增量产出 schedule / coordination 两个键
 * （§6.1）。排程算法本身不在这里：单一实现住 shared/schedule-projection.ts，本文件
 * 只做声明校验与投影接线，不写第二套日历或前向传播。
 *
 * 2026-11-11（PR #216 Codex blocking，设计 §14）loader 层结构性重做：
 * - B1 验收指纹只哈希显式白名单的 checkSpec + packageSpec（CHECK_SPEC_HASH_FIELDS /
 *   PACKAGE_SPEC_HASH_FIELDS），coordination、包名/描述/顺序/依赖/责任角色、阻塞项文案等
 *   非 spec 字段不进哈希——它们的变更不得让既有通过记录变 stale。
 * - B2 检查记录窗口（F2 正名，设计 §2.2/§15.9）：只有 gateStatus(pkg) === 'passed' 且非
 *   waived 的包才派生首末 passed 检查日期窗口，部分通过不生成。该窗口是「门禁 passed 的
 *   完成证据登记在哪些检查日」的证据窗口，**不是施工实际起止**——实际开工时间从未记录，
 *   保持未知；早先以「实际窗口/完工事实」命名的自述属于过度声称，已随 F2 正名退场。
 * - B3 该窗口以真实日期（{start_date,end_date}，模块入参 check_windows）交给模块，
 *   ord 映射归模块；非法 checked_at 是记录级数据错误（audit 校验即报），gate passed 的包
 *   只要有一条 passed 记录的 checked_at 非法就不派生窗口并报 diagnostic error——不许拿
 *   其余合法日期拼出偏短窗口、丢掉最晚的检查证据日期。
 * - B4 投影从 buildScheduleSnapshot 装配期前移到 loadScheduleState：投影错误与既有校验
 *   同走 state.errors（route 在 build 之前 503），build 只消费已存投影。
 * - §16（业主裁定 A）：检查记录窗口只作证据，不参与 forecast。无 scenario 时 forecast
 *   与 baseline 相同；差异只来自 scenario，以及未来才会有的显式实际开工事实。
 * - §17（业主裁定 A）：锚点未定不再把检查窗口判成 invalid_check_window。快照把模块返回的
 *   日期与可空序数一并映射（first_date/last_date + first_ord/last_ord）。序数 null 原样
 *   交付，不兜成 0，也不换成名义纪元序数。
 *
 * 排程投影相关 loader 诊断错误码（设计 §2.2/§14/B5/§15.9/§16/§17，error 级）：
 * - check_window_unresolved：gate_status=passed 但该包没有任何可用的 checked_at（YYYY-MM-DD）。
 * - check_window_invalid_checked_at：gate_status=passed 且至少一条 passed 记录的 checked_at
 *   不是真实存在的 YYYY-MM-DD；即使另有合法日期也不派生窗口（最晚检查证据日期未知，
 *   不得丢掉）。这两条在送进模块之前拦住：单包坏日期不得让 projectSchedule 抛错，
 *   否则整份投影变 null（B3）。因此审计记录里的非法日期不会变成
 *   `projection_failed — [invalid_check_window]`。
 * - constraint_resolved_without_anchor：锚点未定时存在带日期的 resolved not_before 约束，
 *   模块不按 1970 名义纪元造序数（跳过抬升），loader 显形该事实。约束是计划输入，
 *   没有坐标就还不生效；检查窗口不是约束，不要再并成一句「与 B5 同一原则」（§17）。
 * - schedule projection: projection_failed — [code]：ProjectionError 的 code 原样透传，不是
 *   未映射的兜底。invalid_check_window 只留给模块真的收到的坏窗口（日期串非法或起止颠倒，
 *   §17）。锚点未定不再抛这个码：检查窗口的日期原样进快照，序数为 null（待定）。
 *   null 不是 0，也不是名义纪元序数——0 是锚点前一个工作日的合法序数。
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as yaml from 'js-yaml';
import { computeGateStatus } from './gate-status.js';
import { contractArchivePathProblem, isValidCalendarDateText } from './contract-archive.js';
import { DECISION_GATES_PATH, loadDecisionGates, openGatesByCheck, type Decision, type DecisionGates } from './decision-gates.js';
import { MODEL_PACKAGE_LINKS_PATH, authorityFilePaths } from './model-package-links.js';
import type { LoadedModelPackageLinks, ModelPackageLinks } from './model-package-links.js';
import { ALL_MODEL_TARGET } from './package-objects.js';
import { collectDeclaredFurnitureIds, type DeclaredFurnitureIdEntry } from './furniture-object-id.js';
import { collectFinishRecipeIds } from './finish/input.js';
import type { FurnishingsYaml } from './types.js';
import {
  projectSchedule,
  validateDag,
  ProjectionError,
  type ProjectionCheckDates,
  type ProjectionCalendar,
  type ProjectionConstraint,
  type ProjectionPackage,
  type ScheduleProjection,
} from './schedule-projection.js';

type AnyRecord = Record<string, any>;

export const CONTROL_REL_PATH = 'schedule/phase-1/control.yaml';
export const ACCEPTANCE_REL_PATH = 'config/acceptance.yaml';
export const ROADMAP_REL_PATH = 'schedule/roadmap.yaml';

/**
 * 工程对象域的 authority source（issue #191 Codex blocking 第 7 轮）。
 *
 * `model-package-links.yaml` 的 authorities 映射里混了两类条目：
 *   - **工程对象域**（本清单）：模型几何、围护/面层、家具、电气、给排水、电气拓扑、
 *     MEP 路由、HVAC、吊顶。它们的声明是**工程输入**。
 *   - **分期与执行文件**（不在本清单）：`phase_scope` / `phase_1_budget` /
 *     `phase_2_scope` / `phase_3_scope`。其中 `phase_1_budget` 指向
 *     `schedule/phase-1/control.yaml`，而该文件的 `audit_log.records` **就是验收通过
 *     记录本身**——是执行产出，不是工程输入。
 *
 * 为什么必须分开：project_scope 包的指纹按「全模型」扩到全部权威文件时，若把执行文件
 * 也圈进去，存一条通过记录就会改变这条记录保存下来的 project_data_sha256，重新加载后
 * staleAuditReason 立即判 stale——付款门槛永远无法稳定通过（自指循环）。
 * 检查定义的变化由 check_spec_sha256 单独覆盖（checkSpecHash 只哈希显式的验收标准白名单，
 * 见 CHECK_SPEC_HASH_FIELDS / PACKAGE_SPEC_HASH_FIELDS 与设计 §14/B1），
 * 不需要靠整份 control.yaml 进项目数据指纹。
 */
export const ENGINEERING_AUTHORITY_SOURCES: readonly string[] = [
  'model_geometry',
  'overlay',
  'furnishings',
  'electrical',
  'plumbing',
  'electrical_topology',
  'mep_routes',
  'hvac',
  'ceiling',
];

/**
 * checkSpecHash 的 check 侧输入白名单（设计 §14/B1，PR #216 Codex blocking）。
 *
 * 指纹的语义是「验收标准规格」：只有这里点名的字段变了，才允许把已 passed 的验收记录
 * 判成 stale。coordination（预约 status/actor/confirmed_at）是执行期的协调事实，会随
 * 约人过程变化，把它混进指纹会让 gate_status 从 passed 无故退回 pending——因此：
 * - coordination 与任何未来新增的非 spec 键都不进哈希（见 CHECK_NON_SPEC_KEYS）；
 * - 新增 check 字段时必须显式决定进哪一边，tests/server/schedule-loader-contract.test.ts
 *   遍历 control.yaml 与 packageChecks 派生视图（含 acceptance.yaml 引用型验收项）的实际
 *   键集合，白名单外且未在排除清单里的键会让测试当场点名——新 spec 字段静默不进哈希与
 *   非 spec 字段悄悄进哈希两个方向都拦。
 *
 * 字段并集：控制源 check（control.yaml）与引用型验收项（acceptance.yaml 经 packageChecks
 * 摊平）都在这份白名单的语义里。`rooms`（检查范围）、`when`（检查时机）、`standard_ref`
 * （判定依据的引用出处）与判定标准本身同属规格——前三者在旧实现里随整个 check 对象一起
 * 进过哈希，收窄白名单时不得静默丢掉。
 */
export const CHECK_SPEC_HASH_FIELDS = [
  'id',
  'item',
  'severity',
  'checkpoint',
  'method',
  'pass_condition',
  'evidence_required',
  'can_run_while_blocked',
  'does_not_release_construction',
  'owner_roles',
  'rooms',
  'when',
  'standard_ref',
] as const;

/**
 * 引用型验收项的源字段 → 指纹槽位归一（快照视图同一条回退：`pass_condition ?? standard`、
 * `evidence_required` 由 acceptance 的 `evidence` 映射），所以改 standard / evidence 仍然换
 * 指纹，但指纹里只出现一个槽位，不会因两条来源并存产生重复语义。
 */
export const CHECK_SPEC_FIELD_ALIASES: Readonly<Record<string, readonly string[]>> = {
  pass_condition: ['standard'],
  evidence_required: ['evidence'],
};

/**
 * 已知、显式决定「不进验收指纹」的 check 键（控制源 check 与引用型验收项字段的并集）：
 * - coordination：预约协调事实，随约人过程变化，且按设计 §5 不得进入任何门禁/就绪判定；
 * - knowledge：验收背景说明（decision-gates.ts 头注已声明它没有机器强制），改它不改变判定标准；
 * - objects：`from_packages` 是「哪几个包引用这条验收项」的挂接登记，不是判定标准；其与
 *   acceptance_refs 的一致性由 config/facts.yaml 的 c.acceptance_objects 契约对账；
 * - phase / phase_name：acceptanceById 注入的阶段元数据，不属验收规格。
 */
export const CHECK_NON_SPEC_KEYS = ['coordination', 'knowledge', 'objects', 'phase', 'phase_name'] as const;

/**
 * checkSpecHash 的 package 侧输入白名单（设计 §14/B1 的同类收口，2026-11-11 复审）。
 *
 * 指纹语义是「这条检查的验收标准」。包级字段里只有 `id` 属于规格——它是哈希作用域，
 * 保证不同包的同名检查不会共享指纹。其余包级键全部是执行/协调/预算/展示信息：
 * 改名、改描述、调顺序、改依赖、改责任角色、换阻塞项或改阻塞项文案，都不改变
 * 「这项检查怎么算通过」，因此不得让已 passed 记录变 stale（否则 gate 退回 pending）。
 * 对象范围（targets）不在这里：它由 config/facts.yaml 的 c.package_targets 对账，
 * 且 model-package-links.yaml 本身就在项目数据指纹里。
 *
 * 与 check 侧同一个反向围栏：新增包级键必须显式决定进 PACKAGE_SPEC_HASH_FIELDS 还是
 * PACKAGE_NON_SPEC_KEYS，tests/server/schedule-loader-contract.test.ts 逐个包键点名。
 */
export const PACKAGE_SPEC_HASH_FIELDS = ['id'] as const;

/**
 * 显式决定「不进验收指纹」的包级键：当前 control.yaml 全部包键（除 id）＋已知的 waiver。
 * - name / description / sequence / dependencies / owner_roles：命名、排序、依赖与角色分派，
 *   不影响判定标准；
 * - blockers：门禁前置条件（读的是 blocker 对象），不是验收标准；其文案变化同样不得 stale；
 * - checks / acceptance_refs：检查成员登记；增删检查由 gateStatus 按当前检查集判定，
 *   单条检查的标准变化由 check 侧白名单覆盖；
 * - budget / budget_pool / duration_workdays / constraints / readiness / status：预算、
 *   工期、排程约束与执行状态，不是验收标准；
 * - gate_label / payment_gate：门禁展示与付款闸 ID，不改变「怎么算通过」；
 * - include_site_data_ledger：项目数据指纹的范围开关（旧量房台账退场后的遗留键）；
 * - targets：对象范围登记，由 c.package_targets 对账并经 model-package-links.yaml 进项目指纹；
 * - waiver：豁免事实（执行期裁定），豁免不改变检查标准。
 */
export const PACKAGE_NON_SPEC_KEYS = [
  'acceptance_refs',
  'blockers',
  'budget',
  'budget_pool',
  'checks',
  'constraints',
  'dependencies',
  'description',
  'duration_workdays',
  'gate_label',
  'include_site_data_ledger',
  'name',
  'owner_roles',
  'payment_gate',
  'readiness',
  'sequence',
  'status',
  'targets',
  'waiver',
] as const;

export interface ScheduleState {
  root: string;
  errors: string[];
  control: AnyRecord;
  acceptance: AnyRecord;
  roadmap: AnyRecord;
  modelPackageLinks: ModelPackageLinks;
  decisionGates: DecisionGates;
  openDecisionGates: Decision[];
  openGatedCheckCount: number;
  openGates: Map<string, Decision[]>;
  roadmapPhaseIds: Set<string>;
  packageIds: Set<string>;
  checkIds: Set<string>;
  componentIds: Set<string>;
  usedCheckIds: Set<string>;
  packageCheckKeys: Set<string>;
  quoteRecordIds: Set<string>;
  phaseControls: Map<string, AnyRecord>;
  hotWaterDecision: AnyRecord | undefined;
  acceptanceById: Map<string, AnyRecord>;
  blockerById: Map<string, AnyRecord>;
  orderedPackages: AnyRecord[];
  auditByCheckKey: Map<string, AnyRecord>;
  quoteRound: AnyRecord;
  quoteRoundRecords: AnyRecord[];
  quoteRecords: AnyRecord[];
  appliancePackage: AnyRecord | undefined;
  pendingBudgetGaps: AnyRecord[];
  knownPendingGap: number;
  unpricedComponents: AnyRecord[];
  roundTargetTotal: number;
  roundQuotedTotal: number;
  poolTotals: Map<string, number>;
  allocated: number;
  fixed: number;
  // ─── 派生判定（渲染器与 API 共用，规则只有这一份）───
  money: (value: number | null) => string;
  moneyOrPending: (value: number | null) => string;
  range: (value: AnyRecord) => string;
  list: (value: unknown[] | undefined) => string;
  escapeCell: (value: unknown) => string;
  sha256: (value: string) => string;
  unique: <T>(values: T[]) => T[];
  fileSnapshot: (paths: string[]) => Record<string, string>;
  snapshotDigest: (snapshot: Record<string, string>) => string;
  scopeSummary: (selector: AnyRecord) => string;
  packageModelLinks: (packageId: string) => AnyRecord[];
  /** 工作包的对象 targets（control.yaml 的显式登记；缺失时回退到链接解析结果）。 */
  packageTargets: (pkg: AnyRecord) => string[];
  /** 验收项对象集：引用它的工作包 targets 并集（`*` 吸收为全模型）。 */
  acceptanceObjectIds: Map<string, string[]>;
  packageProjectPaths: (pkg: AnyRecord) => string[];
  packageProjectSnapshot: (pkg: AnyRecord) => Record<string, string>;
  packageProjectFingerprint: (pkg: AnyRecord) => string;
  phaseInputPaths: (phaseId: string, phaseControlPath: string) => string[];
  phaseDataInputPaths: (phaseId: string) => string[];
  projectInputPaths: string[];
  snapshotComment: (snapshot: Record<string, string>) => string;
  fingerprintLine: (paths: string[]) => { snapshot: Record<string, string>; text: string };
  header: (title: string, sourcePath: string, inputPaths: string[]) => string;
  packageChecks: (pkg: AnyRecord) => AnyRecord[];
  packageGateLabel: (pkg: AnyRecord) => string;
  checkSpecHash: (pkg: AnyRecord, checkId: string) => string;
  staleAuditReason: (pkg: AnyRecord, checkId: string, record: AnyRecord) => string[];
  auditStatusFor: (packageId: string, checkId: string) => string | undefined;
  gateStatus: (pkg: AnyRecord) => string;
  auditDisplay: (packageId: string, checkId: string) => { box: string; result: string };
  glossarySection: () => string;
  blockerIsClosed: (blocker: AnyRecord | undefined) => boolean;
  packageWaiverIsValid: (pkg: AnyRecord) => boolean;
  packagePrerequisiteIssues: (pkg: AnyRecord) => string[];
  effectiveReadiness: (pkg: AnyRecord) => string;
  effectivePackageStatus: (pkg: AnyRecord) => string;
  packageGateIssues: string[];
  currentPackage: AnyRecord | undefined;
  nextCheckpoint: (pkg: AnyRecord) => AnyRecord | undefined;
  /**
   * load 期完成校验并算出的排程投影（设计 §14/B4）。
   * null = 投影失败（ProjectionError 已按 `schedule projection: projection_failed — [code]`
   * 写进 errors）；调用方见到 errors 非空即不得消费快照（route 在 build 之前 503）。
   * buildScheduleSnapshot 只消费此字段，不得在装配期再调用 projectSchedule。
   */
  scheduleProjection: ScheduleProjection | null;
}

/**
 * 加载 + 校验 + 派生。返回 errors（由调用方决定退出/呈现），不退出、不打印。
 * modelPackageLinks 由调用方注入（server/model-package-links.ts 是唯一解析器）。
 */
export function loadScheduleState(root: string, options: { modelPackageLinks: LoadedModelPackageLinks }): ScheduleState {
  const phaseDir = path.join(root, 'schedule/phase-1');
  const controlPath = path.join(phaseDir, 'control.yaml');
  const acceptancePath = path.join(root, ACCEPTANCE_REL_PATH);
  const roadmapPath = path.join(root, ROADMAP_REL_PATH);
  const controlRelPath = CONTROL_REL_PATH;
  const acceptanceRelPath = ACCEPTANCE_REL_PATH;
  const roadmapRelPath = ROADMAP_REL_PATH;
  const control = yaml.load(fs.readFileSync(controlPath, 'utf8')) as AnyRecord;
  const acceptance = yaml.load(fs.readFileSync(acceptancePath, 'utf8')) as AnyRecord;
  const roadmap = yaml.load(fs.readFileSync(roadmapPath, 'utf8')) as AnyRecord;
  // 成本项 targets（issue #98 PR-8，按对象算账）的合法取值域 = house.yaml furnishings
  // 已声明的稳定对象 id。对象 id 的唯一实现在 furniture-object-id.ts，这里只取清单，
  // 不另写第二套 id 公式。
  // 2026-11-07（issue #98 第三阶段 S6）另取面层配方 id 全集：targets **不收**配方——
  // 它们与对象 id 同为稳定字符串，只能按配方住处（shared/finish/input.ts）枚举后拦截。
  const house = yaml.load(fs.readFileSync(path.join(root, 'config/house.yaml'), 'utf8')) as { furnishings?: FurnishingsYaml };
  const furnitureObjects: DeclaredFurnitureIdEntry[] = collectDeclaredFurnitureIds(house.furnishings ?? {});
  const furnitureObjectById = new Map(furnitureObjects.map((entry) => [entry.id, entry]));
  const finishRecipeIds = collectFinishRecipeIds();
  const modelPackageLinks = options.modelPackageLinks;
  const decisionGates = loadDecisionGates(root);
  const openDecisionGates = decisionGates.decisions.filter((decision) => decision.scope === 'acceptance' && decision.status === 'open');
  const openGatedCheckCount = new Set(openDecisionGates.flatMap((decision) => decision.blocks ?? [])).size;
  const openGates = openGatesByCheck(decisionGates);

  const money = (value: number | null) => value == null ? '—' : `¥${value.toLocaleString('zh-CN')}`;
  const moneyOrPending = (value: number | null) => value == null ? '待报价/待算量' : money(value);
  const range = (value: AnyRecord) => value.min === value.max ? `${value.min}天` : `${value.min}—${value.max}天`;
  const list = (value: unknown[] | undefined) => value?.length ? value.join('、') : '无';
  const escapeCell = (value: unknown) => String(value ?? '—').replaceAll('|', '\\|').replaceAll('\n', '<br>');
  const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
  const unique = <T>(values: T[]) => [...new Set(values)];

  function fileSnapshot(paths: string[]): Record<string, string> {
    return Object.fromEntries(unique(paths).sort().map((file) => {
      const absolute = path.resolve(root, file);
      if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
        throw new Error(`schedule input is missing or not a file: ${file}`);
      }
      return [file, sha256(fs.readFileSync(absolute, 'utf8'))];
    }));
  }

  function snapshotDigest(snapshot: Record<string, string>): string {
    return sha256(JSON.stringify(Object.entries(snapshot).sort(([left], [right]) => left.localeCompare(right))));
  }

  function scopeSummary(selector: AnyRecord): string {
    return Object.entries(selector)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : String(value)}`)
      .join('; ');
  }

  function packageModelLinks(packageId: string): AnyRecord[] {
    return modelPackageLinks.links.filter((link) => link.budget_ref.id === packageId) as AnyRecord[];
  }

  /**
   * 对象 targets（issue #191）：control.yaml 的显式登记优先；缺失时回退到链接解析结果。
   * 回退只保证 UI/查询在登记缺失时仍可运行——「登记 == 解析」由 config/facts.yaml 的
   * c.package_targets 契约强制，不靠本函数的回退兜底。
   */
  function packageTargets(pkg: AnyRecord): string[] {
    if (Array.isArray(pkg.targets) && pkg.targets.length) return [...pkg.targets];
    const derived = new Set<string>();
    for (const link of packageModelLinks(pkg.id)) {
      const resolution = modelPackageLinks.objectResolutions?.[link.id];
      for (const id of resolution?.objectIds ?? []) derived.add(id);
    }
    return [...derived].sort();
  }

  /**
   * 链接是否需要按**整份权威文件**建指纹（宁可过度 stale，不漏报）：
   * - 显式 project_scope（PKG-000/005/010/142/170/900 的整项目声明）；
   * - 解析器不可用（注入的 mock / 旧调用方）或该链接存在 unresolved 选择器——
   *   此时无法确定对象边界，退回整份文件是唯一安全方向。
   */
  function linkNeedsWholeAuthority(link: AnyRecord): boolean {
    const resolution = modelPackageLinks.objectResolutions?.[link.id];
    if (!resolution) return true;
    return resolution.projectScope || resolution.unresolved.length > 0;
  }

  function packageProjectPaths(pkg: AnyRecord): string[] {
    const links = packageModelLinks(pkg.id);
    const paths = [MODEL_PACKAGE_LINKS_PATH, 'schedule/phase-scope.yaml', 'config/acceptance.yaml', DECISION_GATES_PATH];
    for (const link of links) {
      if (!linkNeedsWholeAuthority(link)) continue;
      // project_scope 的语义是「全模型」：边界收窄不到对象，就按**全部工程对象域**建指纹。
      // 不能只按该链接 scope 恰好列出的那几份——6 个 project_scope 链接里有 5 个只列了
      // model_geometry，那样 house/electrical/overlay 等对象域的变化就不会让它们 stale，
      // 而它们的 targets 是 `*`、验收项对象集也按 `*` 派生，等于声明了「跟任何对象变」
      // 却只跟几何变（issue #191 独立复核 high：改 house.yaml 的 study.chair 时 PKG-170
      // 不 stale，而它唯一的验收项是甲醛检测）。
      // 解析不出（unresolved）的链接仍按其 scope 列出的文件整份计入——那是「不知道边界」，
      // 不是「边界是全模型」，按 scope 算已是安全方向，不该借道全量。
      if (modelPackageLinks.objectResolutions?.[link.id]?.projectScope) {
        // **只扩工程对象域，不扩 schedule/execution 文件**（issue #191 Codex blocking 第 7 轮）：
        // authorities 里混了两类——`phase_scope` / `phase_*_budget` / `phase_*_scope` 是
        // 分期与执行文件，其中 phase_1_budget 指向 schedule/phase-1/control.yaml，
        // 而该文件的 `audit_log.records` **就是验收通过记录本身**。
        // 若把它圈进指纹，存一条通过记录就会改变这条记录保存下来的 project_data_sha256，
        // 重新加载后 staleAuditReason 立即判 stale——付款门槛永远无法稳定通过（自指）。
        // 检查定义的变化由 check_spec_sha256 单独覆盖（checkSpecHash 只哈希显式的验收
        // 标准白名单，见 CHECK_SPEC_HASH_FIELDS / PACKAGE_SPEC_HASH_FIELDS 与设计 §14/B1），
        // 不需要靠整份 control.yaml 进项目数据指纹。
        paths.push(...ENGINEERING_AUTHORITY_SOURCES.flatMap((source) => authorityFilePaths(modelPackageLinks.authorities[source] ?? source)));
        continue;
      }
      for (const scope of link.scope ?? []) {
        const authorityPath = modelPackageLinks.authorities[scope.source];
        if (authorityPath) paths.push(...authorityFilePaths(authorityPath));
      }
    }
    // 2026-11-08 S2-B：原量房手账退场。include_site_data_ledger / BLK-SURVEY-DATA-FREEZE
    // 的「量房数据未冻结」语义改由对象 blocker 承接——见 shared/pending-count.ts。
    return unique(paths).sort();
  }

  /**
   * 对象粒度指纹（issue #191，替代整份权威文件求和）。
   *
   * 结构：**结构性文件**（整份）+ `object:<source>:<id>` → 对象声明 sha256。
   * 按对象的是每个链接 scope 解析出的对象声明（见 shared/package-objects.ts）；
   * 按整份的是 model-package-links.yaml 自身、phase-scope.yaml、acceptance.yaml 的结构与
   * decision-gates.yaml——改这四份会影响所有包的判定，本就该整份计。project_scope 链接按
   * **全部**权威文件整份计入（它的 targets 是 `*`，见 packageProjectPaths），解析不出的链接
   * 按其 scope 列出的文件整份计入；两者方向都偏过度 stale。
   */
  function packageProjectSnapshot(pkg: AnyRecord): Record<string, string> {
    const snapshot = fileSnapshot(packageProjectPaths(pkg));
    for (const link of packageModelLinks(pkg.id)) {
      if (linkNeedsWholeAuthority(link)) continue;
      const resolution = modelPackageLinks.objectResolutions?.[link.id];
      for (const [key, digest] of Object.entries(resolution?.digests ?? {})) snapshot[`object:${key}`] = digest;
    }
    return snapshot;
  }

  function packageProjectFingerprint(pkg: AnyRecord): string {
    return snapshotDigest(packageProjectSnapshot(pkg));
  }

  /**
   * 验收项对象集（issue #191 决策 2）：= 引用该验收项的工作包 targets 并集。
   * 任一引用包是 `*`（全模型）→ 结果收敛为 `*`（并集含全模型即全模型）。
   */
  const acceptanceObjectIds = new Map<string, string[]>();
  for (const pkg of control.work_packages ?? []) {
    const targets = packageTargets(pkg);
    for (const ref of pkg.acceptance_refs ?? []) {
      const existing = acceptanceObjectIds.get(ref) ?? [];
      if (existing.includes(ALL_MODEL_TARGET)) continue;
      const merged = new Set([...existing, ...targets]);
      acceptanceObjectIds.set(ref, merged.has(ALL_MODEL_TARGET) ? [ALL_MODEL_TARGET] : [...merged].sort());
    }
  }

  function phaseInputPaths(phaseId: string, phaseControlPath: string): string[] {
    const links = modelPackageLinks.links.filter((link) => link.phase_id === phaseId);
    const paths = [phaseControlPath, roadmapRelPath, 'schedule/phase-scope.yaml', MODEL_PACKAGE_LINKS_PATH, acceptanceRelPath, DECISION_GATES_PATH];
    if (phaseId === 'phase_2_function_upgrade' || phaseId === 'phase_3_styling') paths.push('schedule/phase-1/control.yaml');
    if (phaseId === 'phase_3_styling') paths.push('schedule/phase-2/control.yaml');
    for (const link of links) {
      for (const scope of link.scope ?? []) {
        const authorityPath = modelPackageLinks.authorities[scope.source];
        if (authorityPath) paths.push(...authorityFilePaths(authorityPath));
      }
    }
    return unique(paths).sort();
  }

  function phaseDataInputPaths(phaseId: string): string[] {
    const links = modelPackageLinks.links.filter((link) => link.phase_id === phaseId);
    const paths = ['schedule/phase-scope.yaml', MODEL_PACKAGE_LINKS_PATH, acceptanceRelPath, DECISION_GATES_PATH];
    if (phaseId === 'phase_2_function_upgrade' || phaseId === 'phase_3_styling') paths.push('schedule/phase-1/control.yaml');
    if (phaseId === 'phase_3_styling') paths.push('schedule/phase-2/control.yaml');
    for (const link of links) {
      for (const scope of link.scope ?? []) {
        const authorityPath = modelPackageLinks.authorities[scope.source];
        if (!authorityPath) continue;
        for (const file of authorityFilePaths(authorityPath)) {
          if (!file.startsWith('schedule/phase-')) paths.push(file);
        }
      }
    }
    return unique(paths).sort();
  }

  const projectInputPaths = unique([
    roadmapRelPath,
    'schedule/phase-scope.yaml',
    'schedule/phase-1/control.yaml',
    'schedule/phase-2/control.yaml',
    'schedule/phase-3/control.yaml',
    'config/acceptance.yaml',
    DECISION_GATES_PATH,
    MODEL_PACKAGE_LINKS_PATH,
    ...Object.values(modelPackageLinks.authorities).flatMap(authorityFilePaths),
  ]).sort();

  const errors: string[] = [];
  const roadmapPhaseIds = new Set<string>();
  const packageIds = new Set<string>();
  const checkIds = new Set<string>();
  const componentIds = new Set<string>();
  const usedCheckIds = new Set<string>();
  const packageCheckKeys = new Set<string>();
  const quoteRecordIds = new Set<string>();
  const phaseControls = new Map<string, AnyRecord>();
  const hotWaterDecision = control.appliance_quote_register?.hot_water_decision;
  const acceptanceById = new Map<string, AnyRecord>();
  const blockerIds = new Set<string>((control.global_blockers ?? []).map((item: AnyRecord) => item.id));
  const poolIds = new Set<string>((control.budget_pools ?? []).map((item: AnyRecord) => item.id));
  const blockerStatusValues = new Set<string>(control.control.blocker_status_values ?? []);
  for (const blocker of control.global_blockers ?? []) {
    if (!blockerStatusValues.has(blocker.status)) errors.push(`${blocker.id}: invalid blocker status ${blocker.status}`);
  }

  for (const phase of acceptance.phases ?? []) {
    for (const item of phase.items ?? []) {
      if (acceptanceById.has(item.id)) errors.push(`duplicate acceptance id: ${item.id}`);
      acceptanceById.set(item.id, {...item, phase: phase.phase, phase_name: phase.name});
    }
  }

  for (const phase of roadmap.phases ?? []) {
    if (roadmapPhaseIds.has(phase.id)) errors.push(`duplicate roadmap phase id: ${phase.id}`);
    roadmapPhaseIds.add(phase.id);
  }
  for (const phase of roadmap.phases ?? []) {
    for (const dependency of phase.depends_on ?? []) {
      if (!roadmapPhaseIds.has(dependency)) errors.push(`${phase.id}: unknown phase dependency ${dependency}`);
    }
    const phaseControlPath = path.join(root, phase.directory, 'control.yaml');
    if (!fs.existsSync(phaseControlPath)) {
      errors.push(`${phase.id}: missing ${phaseControlPath}`);
      continue;
    }
    const phaseControl = yaml.load(fs.readFileSync(phaseControlPath, 'utf8')) as AnyRecord;
    phaseControls.set(phase.id, phaseControl);
    if (phaseControl.phase_id !== phase.id) errors.push(`${phase.id}: control phase_id mismatch`);
    const phaseGateIds = new Set<string>((phaseControl.activation_gates ?? []).map((gate: AnyRecord) => gate.id));
    const phaseAuditIds = new Set<string>();
    for (const record of phaseControl.audit?.records ?? []) {
      if (phaseAuditIds.has(record.id)) errors.push(`${phase.id}: duplicate audit record id ${record.id}`);
      phaseAuditIds.add(record.id);
      if (!phaseGateIds.has(record.gate_id)) errors.push(`${phase.id}/${record.id}: unknown activation gate ${record.gate_id}`);
      if (!(phaseControl.audit?.record_schema?.status_values ?? []).includes(record.status)) errors.push(`${phase.id}/${record.id}: invalid audit status ${record.status}`);
      if (!record.checked_at || !record.checked_by) errors.push(`${phase.id}/${record.id}: missing checked_at or checked_by`);
      if (!Array.isArray(record.evidence)) errors.push(`${phase.id}/${record.id}: evidence must be an array`);
      if (record.status === 'passed' && (!record.evidence.length || !record.gate_spec_sha256 || !record.project_data_sha256)) {
        errors.push(`${phase.id}/${record.id}: passed gate requires evidence and current gate/project data fingerprints`);
      }
      if (record.supersedes && !phaseAuditIds.has(record.supersedes)) errors.push(`${phase.id}/${record.id}: supersedes must reference an earlier audit record`);
    }
    if (phase.id === control.phase_id) {
      if (phase.budget.ceiling_cny !== control.control.phase_ceiling_cny) errors.push(`${phase.id}: roadmap ceiling mismatch`);
      if (phase.budget.allocated_cny !== control.control.allocated_cny) errors.push(`${phase.id}: roadmap allocated mismatch`);
      if (phase.budget.unallocated_cny !== control.control.unallocated_cny) errors.push(`${phase.id}: roadmap unallocated mismatch`);
    } else {
      if (phase.budget.estimate_min_cny !== phaseControl.budget.estimate_min_cny) errors.push(`${phase.id}: roadmap minimum mismatch`);
      if (phase.budget.estimate_max_cny !== phaseControl.budget.estimate_max_cny) errors.push(`${phase.id}: roadmap maximum mismatch`);
      if (phaseControl.budget.estimate_min_cny > phaseControl.budget.estimate_max_cny) errors.push(`${phase.id}: invalid budget range`);
      if (phaseControl.items?.length) {
        const itemMin = phaseControl.items.reduce((sum: number, item: AnyRecord) => sum + item.estimate_min_cny, 0);
        const itemMax = phaseControl.items.reduce((sum: number, item: AnyRecord) => sum + item.estimate_max_cny, 0);
        if (itemMin < phaseControl.budget.estimate_min_cny || itemMax > phaseControl.budget.estimate_max_cny) {
          errors.push(`${phase.id}: item range ${itemMin}-${itemMax} exceeds phase range`);
        }
      }
    }
  }

  for (const pkg of control.work_packages ?? []) {
    if (packageIds.has(pkg.id)) errors.push(`duplicate package id: ${pkg.id}`);
    packageIds.add(pkg.id);
    if (!control.control.status_values.includes(pkg.status)) errors.push(`${pkg.id}: invalid status ${pkg.status}`);
    if (!control.control.readiness_values.includes(pkg.readiness)) errors.push(`${pkg.id}: invalid readiness ${pkg.readiness}`);
    if (!poolIds.has(pkg.budget_pool)) errors.push(`${pkg.id}: unknown budget pool ${pkg.budget_pool}`);
    if (typeof pkg.budget?.planned_cny !== 'number' || pkg.budget.planned_cny < 0) errors.push(`${pkg.id}: planned_cny must be a non-negative number`);
    for (const component of pkg.budget?.components ?? []) {
      if (componentIds.has(component.id)) errors.push(`duplicate cost component id: ${component.id}`);
      componentIds.add(component.id);
      if (!component.id || !component.name || !component.description || !component.quantity_basis || !component.status) {
        errors.push(`${pkg.id}: incomplete cost component ${component.id ?? '(missing id)'}`);
      }
      if (component.planned_cny != null && (typeof component.planned_cny !== 'number' || component.planned_cny < 0)) {
        errors.push(`${component.id}: planned_cny must be null or a non-negative number`);
      }
      // 成本项对象归属（issue #98 PR-8）：可选 `targets: [对象稳定 id]`。只收非空字符串
      // 数组、全屋唯一且指向 placed 对象——count-only 条目无 runtime 对象可归属；
      // 没有 DEC/台账映射的归属未定对象就不写 targets，不许用占位对象假装归属。
      // 2026-11-07（issue #98 PR-11）口径修正：targets 登记的是「对象→成本项」关联，
      // 不是金额裁定——COST-150-01 按 DEC-2026-10-07-R02 裁定④登记条带柜组 7 件，
      // 金额边界（含不含 P2-100 的 3000-5000）仍是开放决策 D19，由
      // cost:by-object 单对象视图的「关联决策门禁」节显形。PR-8 曾把 COST-150-01
      // 当作「归属未定就不写 targets」的例子，随 PR-11 取代。
      // 2026-11-07（issue #98 第三阶段 S6）新增一道显式拦截：**面层配方 id 不得进 targets**。
      // S4 起墙贴砖带/涂装带、防水台与飘窗的贴砖/涂装面、S5 起派生的踢脚带都是宿主对象
      // 身上的派生量（109 个配方），不是对象。配方 id 与对象 id 同为稳定字符串、任何 schema
      // 都区分不了，故按 shared/finish/input.ts 的配方 id 全集拦在第一道（迁移设计 §5.7：
      // 否则按对象算账视图被 109 个配方稀释，业主看到的是「一间房 40 条成本行」）。
      // 拦截文案点名配方住在哪，写错的人知道该改成什么。
      if (component.targets !== undefined) {
        const targets = component.targets;
        if (!Array.isArray(targets) || targets.length === 0 || targets.some((target: unknown) => typeof target !== 'string' || !target.trim())) {
          errors.push(`${component.id}: targets 必须是非空的对象稳定 id 字符串数组`);
        } else {
          const seenTargets = new Set<string>();
          for (const target of targets) {
            if (finishRecipeIds.has(target)) {
              errors.push(`${component.id}: cost target "${target}" 是面层配方 id（墙 finish.tile_bands/paint_bands、防水台/飘窗 finish.tile/paint，或由其派生的踢脚带），不是对象——targets 只收对象 id，配方量是派生量、写进 quantity_basis，不进 targets`);
              continue;
            }
            const objectEntry = furnitureObjectById.get(target);
            if (!objectEntry) {
              errors.push(`${component.id}: cost target "${target}" 不是 config/house.yaml furnishings 已声明的对象稳定 id`);
            } else if (objectEntry.placement === 'count_only') {
              errors.push(`${component.id}: cost target "${target}" 是 count-only 条目，无 runtime 对象可归属`);
            }
            if (seenTargets.has(target)) errors.push(`${component.id}: duplicate cost target "${target}"`);
            seenTargets.add(target);
          }
        }
      }
    }
    const components = pkg.budget?.components ?? [];
    if (components.length && components.every((component: AnyRecord) => component.planned_cny != null)) {
      const componentTotal = components.reduce((sum: number, component: AnyRecord) => sum + component.planned_cny, 0);
      if (componentTotal !== pkg.budget.planned_cny) errors.push(`${pkg.id}: cost components=${componentTotal}, package=${pkg.budget.planned_cny}`);
    }
    if (!(pkg.acceptance_refs?.length || pkg.checks?.length)) errors.push(`${pkg.id}: no acceptance checks`);
    for (const blocker of pkg.blockers ?? []) {
      if (!blockerIds.has(blocker)) errors.push(`${pkg.id}: unknown blocker ${blocker}`);
    }
    for (const ref of pkg.acceptance_refs ?? []) {
      if (!acceptanceById.has(ref)) errors.push(`${pkg.id}: unknown acceptance ref ${ref}`);
      usedCheckIds.add(ref);
      packageCheckKeys.add(`${pkg.id}:${ref}`);
    }
    for (const check of pkg.checks ?? []) {
      if (checkIds.has(check.id) || acceptanceById.has(check.id)) errors.push(`duplicate check id: ${check.id}`);
      checkIds.add(check.id);
      usedCheckIds.add(check.id);
      packageCheckKeys.add(`${pkg.id}:${check.id}`);
      if (!check.evidence_required?.length) errors.push(`${check.id}: missing evidence_required`);
      if (check.can_run_while_blocked && check.does_not_release_construction !== true) {
        errors.push(`${check.id}: can_run_while_blocked requires does_not_release_construction: true`);
      }
    }
  }

  // DEC-2026-10-05-R12 复审补的门禁：flow 映射里的裸标量含半角逗号会被 js-yaml 在逗号处截断，
  // 残段变成带逗号的垃圾键（值为 undefined）。出现这类键说明 description/quantity_basis 尾部条款
  // 已从解析层静默丢失——报错并要求给值加双引号（同 COST-030-02 先例）。
  //
  // 2026-10-12 修正：原实现只查半角逗号 ','，但截断发生在「18,500」「4,000」「3,684」这类
  // 千分位里的半角逗号，而**残段垃圾键里往往只剩全角逗号「，」**——COST-060-02/060-04/120-01
  // 三条因此长期静默丢失尾部条款（description 截在「约4」「预算池18」「轨道灯约3」）。
  // 现同时查半角与全角；任一命中即报。
  const COMMA_CHARS = [',', '，'];
  for (const pkg of control.work_packages ?? []) {
    for (const component of pkg.budget?.components ?? []) {
      const truncatedKeys = Object.keys(component).filter((key: string) => COMMA_CHARS.some((ch) => key.includes(ch)));
      if (truncatedKeys.length) {
        errors.push(`${component.id ?? pkg.id}: flow 标量疑被逗号截断（垃圾键：${truncatedKeys.join(' / ')}）——请给含逗号（半角 , 或全角 ，）的 description/quantity_basis 加双引号`);
      }
    }
  }

  for (const quote of control.appliance_quote_register?.records ?? []) {
    if (quoteRecordIds.has(quote.id)) errors.push(`duplicate appliance quote id: ${quote.id}`);
    quoteRecordIds.add(quote.id);
    if (!componentIds.has(quote.component_id)) errors.push(`${quote.id}: unknown appliance cost component ${quote.component_id}`);
    if (!quote.category || !quote.brand || !quote.model || !quote.key_spec || !quote.fit_status || !quote.source_url || !quote.source_checked_at) {
      errors.push(`${quote.id}: incomplete appliance quote record`);
    }
    if (typeof quote.public_reference_cny !== 'number' || quote.public_reference_cny < 0) {
      errors.push(`${quote.id}: public_reference_cny must be a non-negative number`);
    }
  }
  if (!hotWaterDecision?.category || !hotWaterDecision?.preferred_model || !hotWaterDecision?.fallback_model) {
    errors.push('appliance quote register: incomplete hot water decision');
  } else {
    const hotWaterModels = new Set((control.appliance_quote_register?.records ?? [])
      .filter((quote: AnyRecord) => quote.component_id === 'COST-160-05')
      .map((quote: AnyRecord) => quote.model));
    if (!hotWaterModels.has(hotWaterDecision.preferred_model)) errors.push(`hot water preferred model missing from quote register: ${hotWaterDecision.preferred_model}`);
    if (!hotWaterModels.has(hotWaterDecision.fallback_model)) errors.push(`hot water fallback model missing from quote register: ${hotWaterDecision.fallback_model}`);
  }

  for (const pkg of control.work_packages ?? []) {
    for (const dependency of pkg.dependencies ?? []) {
      if (!packageIds.has(dependency)) errors.push(`${pkg.id}: unknown dependency ${dependency}`);
      if (dependency === pkg.id) errors.push(`${pkg.id}: self dependency`);
    }
  }

  // ─── 排程扩展声明校验（issue #202 切片 B；docs/schedule-coordination-design.md §2.1(d)）───
  // work_calendar / PKG constraints / SCH coordination 三类新事实只描述排程，不参与门禁与
  // 就绪判定（设计 §5 的机器保险丝是 facts 契约，不在这份代码里）。全部 error 级：
  // 带坏排程声明的控制源必须在 load 阶段显形，快照消费方（route）见到 errors 即 503——
  // 所以这些校验放 load 而不是放快照装配：route 的 503 判定发生在 buildScheduleSnapshot 之前。
  validateScheduleControlExtensions(control, errors, blockerStatusValues);
  // 跨包环的显形校验：未知依赖/自依赖已由上面的逐包检查原样报出，这里只补它们报不出的环。
  // 「依赖环」措辞的单一来源是 schedule-projection.ts 的 validateDag，这里按前缀取环、
  // 加 dependency_cycle 码前缀，不复制它的报错文案。
  for (const dagIssue of validateDag(scheduleProjectionPackages(control).map(projectionPackageInput))) {
    if (!dagIssue.startsWith('依赖环')) continue;
    errors.push(`dependency_cycle: ${dagIssue}`);
  }

  const quoteRound = control.hard_finish_quote_rounds ?? {};
  const quoteRoundRecords: AnyRecord[] = quoteRound.records ?? [];
  const quoteRoundPriceTypes: string[] = quoteRound.record_schema?.price_type_values ?? [];
  const quoteRoundIds = new Set<string>();
  for (const record of quoteRoundRecords) {
    if (quoteRoundIds.has(record.id)) errors.push(`duplicate hard finish quote round id: ${record.id}`);
    quoteRoundIds.add(record.id);
    const roundPkg = (control.work_packages ?? []).find((item: AnyRecord) => item.id === record.pkg_id);
    if (!roundPkg) errors.push(`${record.id}: unknown pkg_id ${record.pkg_id}`);
    const roundComponentIds = new Set((roundPkg?.budget?.components ?? []).map((item: AnyRecord) => item.id));
    for (const componentId of record.component_ids ?? []) {
      if (!roundComponentIds.has(componentId)) errors.push(`${record.id}: component ${componentId} not in ${record.pkg_id}`);
    }
    if (!quoteRoundPriceTypes.includes(record.price_type)) errors.push(`${record.id}: invalid price_type ${record.price_type}`);
    if (typeof record.owner_target_cny !== 'number' || record.owner_target_cny < 0) errors.push(`${record.id}: owner_target_cny must be a non-negative number`);
    if (record.owner_current_cny != null && (typeof record.owner_current_cny !== 'number' || record.owner_current_cny < 0)) {
      errors.push(`${record.id}: owner_current_cny must be null or a non-negative number`);
    }
    if (!record.item || !record.round_id || !record.status) errors.push(`${record.id}: incomplete hard finish quote round record`);
    if (record.supersedes && !quoteRoundIds.has(record.supersedes)) errors.push(`${record.id}: supersedes must reference an earlier round record`);
    if (record.status === 'locked' && (record.locked_cny == null || !record.contract_ref)) {
      errors.push(`${record.id}: status locked requires locked_cny and contract_ref`);
    }
    if (record.contract != null) {
      // 合同结构化登记（2026-10-23 收口）：带 contract 块的轮次即已转合同，登记
      // 字段是成本总表守卫（cost-summary.ts）的机读单源。口径在这里就钉死，不
      // 许带病数据流到生成器才炸：金额须与 locked_cny 一致；deal_status 只认
      // signed（唯一「已成交」取值）；signed_at 须为真实日历日期的
      // YYYY-MM-DD（严格回读比对，与成本守卫共用 isValidCalendarDateText；
      // 登记处已加引号走字符串形态）；includes/excludes 必须在位；
      // archive_paths 逐条为 {path, sha256}：path 经共用核查
      // contractArchivePathProblem 钉死在 contracts/ 归档区内（规范路径、
      // 非符号链接、realpath 不出界）、sha256 为 64 位十六进制（登记时钉
      // 死的原件字节哈希）、文件真实存在且非空；哈希与文件字节的实算比
      // 对在成本守卫（cost-summary.ts）做，数据层这里只钉形态、范围与在位。
      const contract = record.contract;
      if (typeof contract !== 'object' || Array.isArray(contract)) {
        errors.push(`${record.id}: contract must be a mapping`);
      } else {
        if (typeof contract.amount_cny !== 'number' || contract.amount_cny <= 0) {
          errors.push(`${record.id}: contract.amount_cny must be a positive number`);
        } else if (contract.amount_cny !== record.locked_cny) {
          errors.push(`${record.id}: contract.amount_cny=${contract.amount_cny} 与 locked_cny=${record.locked_cny} 不一致——登记金额与锁定金额必须同值`);
        }
        if (contract.deal_status !== 'signed') {
          errors.push(`${record.id}: contract.deal_status must be signed (got ${contract.deal_status})`);
        }
        const signedAtText = contract.signed_at instanceof Date
          ? contract.signed_at.toISOString().slice(0, 10)
          : contract.signed_at;
        // 严格日历校验（复审第二轮 P2）：Date.parse 会把 2026-02-30 归一
        // 化成 03-02 而不报 NaN——必须逐项回读比对（isValidCalendarDateText
        // 与成本守卫共用）。control.yaml 里 signed_at 已加引号走字符串形
        // 态，归一化在解析期就不存在；Date 形态仅为兼容未加引号的旧写法。
        if (typeof signedAtText !== 'string' || !isValidCalendarDateText(signedAtText)) {
          errors.push(`${record.id}: contract.signed_at must be a real YYYY-MM-DD calendar date (got ${contract.signed_at})`);
        }
        if (typeof contract.includes !== 'string' || !contract.includes) {
          errors.push(`${record.id}: contract.includes missing`);
        }
        if (typeof contract.excludes !== 'string' || !contract.excludes) {
          errors.push(`${record.id}: contract.excludes missing`);
        }
        if (!Array.isArray(contract.archive_paths) || contract.archive_paths.length === 0) {
          errors.push(`${record.id}: contract.archive_paths must be a non-empty array`);
        } else {
          for (const archiveEntry of contract.archive_paths) {
            if (typeof archiveEntry !== 'object' || archiveEntry === null || Array.isArray(archiveEntry)) {
              errors.push(`${record.id}: contract.archive_paths 条目必须是 {path, sha256} 登记（got ${archiveEntry === null ? 'null' : typeof archiveEntry}）`);
              continue;
            }
            const archivePath = archiveEntry.path;
            const archiveSha256 = archiveEntry.sha256;
            if (typeof archivePath !== 'string') {
              errors.push(`${record.id}: contract.archive_paths 的 path 必须是 contracts/ 归档区内的规范路径字符串（got ${archivePath}）`);
              continue;
            }
            if (typeof archiveSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(archiveSha256)) {
              errors.push(`${record.id}: contract.archive_paths 条目 ${archivePath} 的 sha256 必须是 64 位十六进制（got ${archiveSha256}）`);
              continue;
            }
            // 路径边界与实体核查与成本守卫共用 contractArchivePathProblem
            // （复审第二轮 P1）：规范路径（.. / . 段越界）、非符号链接、
            // realpath 不离开 contracts/、文件存在非空，一处口径两处生效。
            const archiveProblem = contractArchivePathProblem(archivePath, root);
            if (archiveProblem) errors.push(`${record.id}: ${archiveProblem}`);
          }
        }
      }
    }
    if (record.evidence_path) {
      // 证据存在性必须看**内容**，不能只看路径。fs.existsSync 对目录恒为 true 且不看条目，
      // 于是「一个只放了 README.md 的空目录」会被判成有证据——QR-2026-10-03-08
      // （唯一一条 price_type: quoted_sheet、¥9,537）的 evidence_path 指向
      // contracts/2026-10-03/，该目录下只有 1119 字节的 README.md、没有任何报价单原件，
      // 却长期通过本检查。判定改为：
      //   - 指向文件 → 必须存在且非空（size > 0）；
      //   - 指向目录 → 目录内至少要有一个**非 README** 的条目（README/说明文件与
      //     点文件不算证据，否则又是同一漏洞换了个壳）。
      const evidenceAbs = path.join(root, record.evidence_path);
      let evidenceError: string | null = null;
      try {
        const stat = fs.statSync(evidenceAbs);
        if (stat.isDirectory()) {
          const entries = fs.readdirSync(evidenceAbs)
            .filter((entry: string) => !entry.startsWith('.') && !entry.toLowerCase().startsWith('readme'));
          if (!entries.length) {
            evidenceError = `evidence_path 是目录但只有 README/说明文件，没有报价单或合同原件：${record.evidence_path}`;
          }
        } else if (stat.size === 0) {
          evidenceError = `evidence_path 指向空文件（0 字节）：${record.evidence_path}`;
        }
      } catch {
        evidenceError = `evidence_path does not exist: ${record.evidence_path}`;
      }
      if (evidenceError) errors.push(`${record.id}: ${evidenceError}`);
    }
  }
  const roundTargetTotal = quoteRoundRecords.reduce((sum: number, record: AnyRecord) => sum + (record.owner_target_cny ?? 0), 0);
  const roundQuotedTotal = quoteRoundRecords
    .filter((record: AnyRecord) => record.price_type === 'quoted_sheet')
    .reduce((sum: number, record: AnyRecord) => sum + (record.owner_current_cny ?? record.owner_target_cny ?? 0), 0);
  if (quoteRound.round_summary?.all_in_target_cny != null && roundTargetTotal !== quoteRound.round_summary.all_in_target_cny) {
    errors.push(`hard finish quote rounds: records=${roundTargetTotal}, round_summary.all_in_target_cny=${quoteRound.round_summary.all_in_target_cny}`);
  }
  if (quoteRound.round_summary?.quoted_sheet_only_cny != null && roundQuotedTotal !== quoteRound.round_summary.quoted_sheet_only_cny) {
    errors.push(`hard finish quote rounds: quoted_sheet=${roundQuotedTotal}, round_summary.quoted_sheet_only_cny=${quoteRound.round_summary.quoted_sheet_only_cny}`);
  }

  const poolTotals = new Map<string, number>();
  for (const pkg of control.work_packages ?? []) {
    poolTotals.set(pkg.budget_pool, (poolTotals.get(pkg.budget_pool) ?? 0) + pkg.budget.planned_cny);
  }
  for (const pool of control.budget_pools ?? []) {
    if ((poolTotals.get(pool.id) ?? 0) !== pool.planned_cny) {
      errors.push(`${pool.id}: packages=${poolTotals.get(pool.id) ?? 0}, pool=${pool.planned_cny}`);
    }
  }
  const allocated = (control.budget_pools ?? []).reduce((sum: number, pool: AnyRecord) => sum + pool.planned_cny, 0);
  if (allocated !== control.control.allocated_cny) errors.push(`allocated mismatch: computed=${allocated}, declared=${control.control.allocated_cny}`);
  if (allocated + control.control.unallocated_cny !== control.control.phase_ceiling_cny) errors.push('allocated + unallocated != phase ceiling');
  const fixed = (poolTotals.get('hard_finish') ?? 0) + (poolTotals.get('hvac') ?? 0);
  if (fixed !== control.control.fixed_works_cny) errors.push(`fixed works mismatch: computed=${fixed}, declared=${control.control.fixed_works_cny}`);
  if (control.budget_reconciliation?.phase_1_ceiling_cny !== control.control.phase_ceiling_cny) errors.push('budget reconciliation ceiling mismatch');

  const pendingBudgetGaps = (control.work_packages ?? [])
    .filter((pkg: AnyRecord) => (pkg.budget.estimated_need_cny ?? pkg.budget.planned_cny) > pkg.budget.planned_cny)
    .map((pkg: AnyRecord) => ({
      ...pkg,
      gap_cny: pkg.budget.estimated_need_cny - pkg.budget.planned_cny,
    }));
  const knownPendingGap = pendingBudgetGaps.reduce((sum: number, pkg: AnyRecord) => sum + pkg.gap_cny, 0);
  const unpricedComponents = (control.work_packages ?? []).flatMap((pkg: AnyRecord) =>
    (pkg.budget?.components ?? [])
      .filter((component: AnyRecord) => component.planned_cny == null)
      .map((component: AnyRecord) => ({package_id: pkg.id, ...component})),
  );
  const quoteRecords = control.appliance_quote_register?.records ?? [];
  const appliancePackage = control.work_packages.find((pkg: AnyRecord) => pkg.id === 'PKG-160');

  const auditByCheckKey = new Map<string, AnyRecord>();
  const auditRecordIds = new Set<string>();
  for (const record of control.audit_log?.records ?? []) {
    if (auditRecordIds.has(record.id)) errors.push(`duplicate audit record id: ${record.id}`);
    auditRecordIds.add(record.id);
    if (!packageIds.has(record.package_id)) errors.push(`${record.id}: unknown package ${record.package_id}`);
    const checkKey = `${record.package_id}:${record.check_id}`;
    if (!packageCheckKeys.has(checkKey)) errors.push(`${record.id}: check ${record.check_id} does not belong to ${record.package_id}`);
    if (!control.audit_log.record_schema.status_values.includes(record.status)) errors.push(`${record.id}: invalid audit status ${record.status}`);
    if (!record.checked_at || !record.checked_by) errors.push(`${record.id}: missing checked_at or checked_by`);
    else if (normalizeCalendarDateText(record.checked_at) === undefined) {
      // checked_at 是检查记录日期的坐标：非空还不够，必须是真实存在的 YYYY-MM-DD。
      // 否则下游 deriveCheckWindowsFromAudits 会把这条记录静默跳过（B3「静默删证据」同类）。
      errors.push(`${record.id}: invalid checked_at ${JSON.stringify(record.checked_at)}（须为真实存在的 YYYY-MM-DD）`);
    }
    if (!Array.isArray(record.evidence)) errors.push(`${record.id}: evidence must be an array`);
    if (record.status === 'passed' && record.evidence.length === 0) errors.push(`${record.id}: passed result requires evidence`);
    if (record.supersedes && !auditRecordIds.has(record.supersedes)) errors.push(`${record.id}: supersedes must reference an earlier record`);
    auditByCheckKey.set(checkKey, record);
  }

  const snapshotComment = (snapshot: Record<string, string>) => `<!-- schedule-input-snapshot:${JSON.stringify(snapshot)} -->\n`;
  const fingerprintLine = (paths: string[]) => {
    const snapshot = fileSnapshot(paths);
    return {
      snapshot,
      text: `> 项目数据指纹：\`sha256:${snapshotDigest(snapshot)}\`（${Object.keys(snapshot).length} 个输入文件；验证时会检查本页是否过期）\n`,
    };
  };
  const header = (title: string, sourcePath: string, inputPaths: string[]) => {
    const {snapshot, text} = fingerprintLine(inputPaths);
    const phaseStatus = title.startsWith('一期')
      ? `当前阶段：${control.control.current_gate}；总体状态：${control.control.status}`
      : `维护源：${sourcePath}`;
    return `${snapshotComment(snapshot)}# ${title}\n\n> 自动生成：请勿直接编辑。维护源：\`${sourcePath}\`  \n${text}> 控制源声明更新日期：${control.updated_at}  \n> ${phaseStatus}\n\n`;
  };
  const packageChecks = (pkg: AnyRecord) => [
    // 引用型验收项的必需证据以 acceptance.yaml 的 evidence 为准（渲染与指纹同源）；
    // 维护源未定义 evidence 时才回退泛称，避免清单只剩「照片或检测记录」而丢失具体证据要求。
    ...(pkg.acceptance_refs ?? []).map((ref: string) => {
      const item = acceptanceById.get(ref);
      return {...item, id: ref, checkpoint: '引用', evidence_required: item?.evidence?.length ? item.evidence : ['照片或检测记录']};
    }),
    ...(pkg.checks ?? []),
  ];
  const packageGateLabel = (pkg: AnyRecord) => pkg.gate_label ?? '付款门槛';
  /**
   * 验收标准指纹（设计 §14/B1）：check 侧与 package 侧都只哈希显式白名单字段。
   * coordination / 预约状态、包名/描述/顺序/依赖/责任角色、阻塞项文案等非 spec 字段
   * 不参与——它们的变更不得让既有通过记录变 stale（那会把 gate_status 退回 pending，
   * 并影响下游就绪）。新增 check 或 package 字段默认不进指纹，须显式决定
   * （见 CHECK_SPEC_HASH_FIELDS / PACKAGE_SPEC_HASH_FIELDS 两份头注）。
   */
  const checkSpecHash = (pkg: AnyRecord, checkId: string) => {
    const check = packageChecks(pkg).find((item: AnyRecord) => item.id === checkId);
    if (!check) return '';
    const packageSpec: AnyRecord = {};
    for (const field of PACKAGE_SPEC_HASH_FIELDS) packageSpec[field] = pkg[field] ?? null;
    const checkSpec: AnyRecord = {};
    for (const field of CHECK_SPEC_HASH_FIELDS) {
      // 引用型验收项把判定标准/必需证据放在 standard / evidence 上（快照视图同一条回退），
      // 归一到 pass_condition / evidence_required 一个槽位：改 standard 同样换指纹。
      const candidates = [field, ...(CHECK_SPEC_FIELD_ALIASES[field] ?? [])];
      const value = candidates.map((key) => check[key]).find((item) => item !== undefined && item !== null);
      checkSpec[field] = value ?? null;
    }
    return sha256(JSON.stringify({packageSpec, checkSpec}));
  };
  const staleAuditReason = (pkg: AnyRecord, checkId: string, record: AnyRecord): string[] => {
    const reasons: string[] = [];
    const currentCheckHash = checkSpecHash(pkg, checkId);
    if (!record.check_spec_sha256) reasons.push('验收记录缺少检查标准指纹');
    else if (record.check_spec_sha256 !== currentCheckHash) reasons.push('检查标准已变化');
    const currentProjectHash = packageProjectFingerprint(pkg);
    if (!record.project_data_sha256) reasons.push('验收记录缺少项目数据指纹');
    else if (record.project_data_sha256 !== currentProjectHash) reasons.push('项目数据已变化');
    return reasons;
  };
  const auditStatusFor = (packageId: string, checkId: string) => {
    const record = auditByCheckKey.get(`${packageId}:${checkId}`);
    if (!record) return undefined;
    if (record.status === 'passed') {
      const pkg = control.work_packages.find((item: AnyRecord) => item.id === packageId);
      if (pkg && staleAuditReason(pkg, checkId, record).length) return 'stale';
    }
    return record.status;
  };
  const gateStatus = (pkg: AnyRecord) => {
    return computeGateStatus(
      packageChecks(pkg),
      auditStatusFor,
      pkg.id,
    );
  };
  const auditDisplay = (packageId: string, checkId: string) => {
    const record = auditByCheckKey.get(`${packageId}:${checkId}`);
    if (!record) return {box: '[ ]', result: 'pending'};
    const pkg = control.work_packages.find((item: AnyRecord) => item.id === packageId);
    if (record.status === 'passed' && pkg) {
      const reasons = staleAuditReason(pkg, checkId, record);
      if (reasons.length) return {box: '[~]', result: `stale；${reasons.join('、')}；须复验并追加记录`};
    }
    const box = record.status === 'passed' ? '[x]' : record.status === 'failed' ? '[!]' : '[-]';
    const evidence = record.evidence?.length ? `；证据：${record.evidence.join('、')}` : '';
    return {box, result: `${record.status}；${record.checked_by}；${record.checked_at}${evidence}`};
  };
  const glossarySection = () => {
    let markdown = '## 装修术语通俗解释\n\n| 专业说法 | 通俗解释 |\n|---|---|\n';
    for (const entry of control.glossary ?? []) {
      markdown += `| ${escapeCell(entry.term)} | ${escapeCell(entry.plain_description)} |\n`;
    }
    return markdown;
  };

  const blockerById = new Map<string, AnyRecord>((control.global_blockers ?? []).map((item: AnyRecord) => [item.id, item]));
  const orderedPackages = control.work_packages.filter((pkg: AnyRecord) => pkg.sequence < 900).sort((a: AnyRecord, b: AnyRecord) => a.sequence - b.sequence);

  function blockerIsClosed(blocker: AnyRecord | undefined): boolean {
    if (!blocker) return false;
    if (blocker.status === 'resolved') {
      return Boolean(blocker.resolved_by && blocker.resolved_at && blocker.resolution_evidence?.length);
    }
    if (blocker.status === 'waived') {
      return Boolean(blocker.waived_by && blocker.waiver_reason && blocker.resolution_evidence?.length);
    }
    return false;
  }

  function packageWaiverIsValid(pkg: AnyRecord): boolean {
    return Boolean(pkg.waiver?.approved_by && pkg.waiver?.reason && pkg.waiver?.evidence?.length);
  }

  function packagePrerequisiteIssues(pkg: AnyRecord): string[] {
    const issues: string[] = [];
    for (const dependencyId of pkg.dependencies ?? []) {
      const dependency = control.work_packages.find((item: AnyRecord) => item.id === dependencyId);
      if (!dependency) {
        issues.push(`缺少依赖包 ${dependencyId}`);
        continue;
      }
      const complete = dependency.status === 'passed'
        ? gateStatus(dependency) === 'passed' && (dependency.blockers ?? []).every((id: string) => blockerIsClosed(blockerById.get(id)))
        : dependency.status === 'waived' && packageWaiverIsValid(dependency);
      if (!complete) issues.push(`依赖包 ${dependencyId} 尚未通过当前验收或豁免`);
    }
    for (const blockerId of pkg.blockers ?? []) {
      if (!blockerIsClosed(blockerById.get(blockerId))) issues.push(`阻塞项 ${blockerId} 尚未有证据关闭`);
    }
    return issues;
  }

  function effectiveReadiness(pkg: AnyRecord): string {
    if (pkg.readiness === 'ready' && packagePrerequisiteIssues(pkg).length) return 'blocked';
    return pkg.readiness;
  }

  function effectivePackageStatus(pkg: AnyRecord): string {
    if (pkg.status === 'passed' && (effectiveReadiness(pkg) !== 'ready' || gateStatus(pkg) !== 'passed')) {
      return gateStatus(pkg) === 'pending' ? 'stale_or_unverified' : 'blocked_by_precondition';
    }
    if (['in_progress', 'ready_for_inspection'].includes(pkg.status) && effectiveReadiness(pkg) === 'blocked') {
      return 'blocked_by_precondition';
    }
    return pkg.status;
  }

  const packageGateIssues = control.work_packages.flatMap((pkg: AnyRecord) => {
    const issues: string[] = [];
    const prerequisiteIssues = packagePrerequisiteIssues(pkg);
    if (pkg.readiness === 'ready' && prerequisiteIssues.length) {
      issues.push(`${pkg.id}: readiness=ready 但${prerequisiteIssues.join('、')}`);
    }
    if (['in_progress', 'ready_for_inspection'].includes(pkg.status) && effectiveReadiness(pkg) !== 'ready') {
      issues.push(`${pkg.id}: status=${pkg.status} 但开工前置条件未满足`);
    }
    if (pkg.status === 'passed' && (effectiveReadiness(pkg) !== 'ready' || gateStatus(pkg) !== 'passed')) {
      issues.push(`${pkg.id}: status=passed 但依赖、阻塞项或当前验收门槛未通过`);
    }
    if (pkg.status === 'waived' && !packageWaiverIsValid(pkg)) {
      issues.push(`${pkg.id}: status=waived 缺少批准人、原因或证据`);
    }
    return issues;
  });
  for (const blocker of control.global_blockers ?? []) {
    if (['resolved', 'waived'].includes(blocker.status) && !blockerIsClosed(blocker)) {
      packageGateIssues.push(`${blocker.id}: 已关闭状态缺少责任人、日期或证据`);
    }
  }

  const currentPackage = orderedPackages.find((pkg: AnyRecord) => !(
    (pkg.status === 'passed' && effectiveReadiness(pkg) === 'ready' && gateStatus(pkg) === 'passed')
    || (pkg.status === 'waived' && packageWaiverIsValid(pkg))
  ));

  function nextCheckpoint(pkg: AnyRecord): AnyRecord | undefined {
    const pending = packageChecks(pkg).filter((check: AnyRecord) => auditStatusFor(pkg.id, check.id) !== 'passed');
    if (effectiveReadiness(pkg) === 'blocked') {
      return pending.find((check: AnyRecord) => check.can_run_while_blocked) ?? pending[0];
    }
    return pending[0];
  }

  // ─── 排程投影（设计 §14/B2/B3/B4）：load 期算完，错误与既有校验同走 state.errors ───
  // route 的 503 判定在 buildScheduleSnapshot 之前（server/routes.ts:414-419）：投影若留到
  // 装配期，失败只会追加到已经检查过 errors 的状态里，API 会 200 返回空排程；verify:schedule
  // 只跑 loader，也只有在 load 期投影才能看见这些错误（「无效配置通过校验」的洞）。
  /**
   * 检查记录窗口派生（F2 正名，设计 §2.2/§15.9；§16 起不进 forecast）。
   *
   * 只有 gateStatus(pkg) === 'passed' 的包才生成窗口——该判据是「全部检查当前 passed」；
   * 部分通过、pending、failed 的包不生成，绝不拿单条检查通过冒充整包完工。
   * status: waived 的包不生成（豁免没有 checked_at 证据日期）。
   *
   * 窗口 = 全部 passed 检查的 checked_at 的 [最早, 最晚] 真实日期（YYYY-MM-DD）。语义是
   * **首末 passed 检查日期的证据窗口**，回答「门禁 passed 的完成证据登记在哪些日子」；
   * 它**不是施工实际起止**——检查通过时间不等于施工开始/结束时间（拆墙检查在拆完后才做，
   * 全部检查同日登记时多日施工会被压成一天），实际开工时间从未记录，保持未知。
   *
   * 交给模块的入参仍是 check_windows: {start_date, end_date}（日期，不是序数）。模块返回
   * 日期 + 可空序数：锚点就绪时映射成 ord 并扩展 ordinals 地平线；锚点为 null 时日期原样
   * 返回、序数为 null，不扩展地平线、不抛错（设计 §17）。两种情况都不覆盖 forecast、
   * 不顺延后继（设计 §16）。无 scenario 时 forecast 与 baseline 相同。ord 映射归
   * shared/schedule-projection.ts，loader 不查 ordinals 反查，也不把 null 序数改写成 0。
   * 任何一条 passed 记录的 checked_at 非法都不生成窗口：剩下合法日期拼出的窗口会丢掉
   * 最晚的检查证据日期（B3「静默删证据」同类），因此整包判为未解析，坏日期不送进模块。
   */
  function deriveCheckWindowsFromAudits(packages: AnyRecord[]): Record<string, {first_date: string; last_date: string}> {
    const windows: Record<string, {first_date: string; last_date: string}> = {};
    for (const pkg of packages) {
      if (pkg.status === 'waived') continue;
      if (gateStatus(pkg) !== 'passed') continue;
      const dates: string[] = [];
      const invalidRecords: string[] = [];
      for (const check of packageChecks(pkg)) {
        if (auditStatusFor(pkg.id, check.id) !== 'passed') continue;
        const record = auditByCheckKey.get(`${pkg.id}:${check.id}`);
        // 非法 checked_at 已在 audit_log 段按记录报错；这里再对检查记录证据显形，并且绝不
        // 静默跳过——有一条非法就不生成窗口，不许用其余合法日期拼出偏短窗口。
        const checkedAt = normalizeCalendarDateText(record?.checked_at);
        if (typeof checkedAt !== 'string') {
          invalidRecords.push(record?.id ? `${record.id}(${check.id})` : check.id);
          continue;
        }
        dates.push(checkedAt);
      }
      if (dates.length === 0) {
        errors.push(`${pkg.id}: check_window_unresolved — gate_status=passed 但没有任何可用的 checked_at（须为 YYYY-MM-DD），无法派生检查记录窗口；门禁完成证据不得静默丢弃（实际施工起止从未记录，保持未知）`);
        continue;
      }
      if (invalidRecords.length > 0) {
        errors.push(`${pkg.id}: check_window_invalid_checked_at — gate_status=passed 但以下 passed 记录的 checked_at 不是真实存在的 YYYY-MM-DD：${invalidRecords.join('、')}；检查记录窗口无法确定，不派生窗口（补录合法日期后重载）`);
        continue;
      }
      dates.sort();
      windows[pkg.id] = {first_date: dates[0], last_date: dates[dates.length - 1]};
    }
    return windows;
  }

  const projectedRaw = scheduleProjectionPackages(control);
  const projectionPackages = projectedRaw.map(projectionPackageInput);
  const declaredCalendar = readWorkCalendarSnapshot(control);
  const projectionCalendar: ProjectionCalendar = {...declaredCalendar.calendar, anchor_date: declaredCalendar.anchor_date};
  // 设计 §14.6/B5：锚点未定时，带日期的 resolved not_before 没有真实坐标可映射——模块按
  // 「不造 1970 名义序数」跳过抬升，loader 必须显形，否则约束被静默丢掉。
  if (projectionCalendar.anchor_date === null) {
    for (const pkg of projectedRaw) {
      if (!Array.isArray(pkg.constraints)) continue;
      for (const constraint of pkg.constraints) {
        if (constraint?.type !== 'not_before' || constraint?.status !== 'resolved') continue;
        const date = normalizeCalendarDateText(constraint?.date);
        if (typeof date !== 'string') continue;
        const label = typeof constraint.id === 'string' && constraint.id ? constraint.id : `${pkg.id}.constraints[?]`;
        errors.push(`${label}: constraint_resolved_without_anchor — 约束已 resolved 且带日期 ${date}，但 work_calendar.anchor_date 为 null：没有真实日期坐标系，投影跳过该约束的抬升`);
      }
    }
  }
  let scheduleProjection: ScheduleProjection | null = null;
  try {
    // 检查记录窗口（见 deriveCheckWindowsFromAudits）：真实日期交给模块的 check_windows。
    // 它不是施工实际起止，也不参与 forecast（设计 §16）。
    const checkWindows = deriveCheckWindowsFromAudits(projectedRaw);
    const checkWindowInputs: Record<string, ProjectionCheckDates> = Object.fromEntries(
      Object.entries(checkWindows).map(([pkgId, window]) => [pkgId, {start_date: window.first_date, end_date: window.last_date}]),
    );
    scheduleProjection = projectSchedule({
      packages: projectionPackages,
      calendar: projectionCalendar,
      constraints: projectionConstraintsByPackage(projectedRaw),
      ...(Object.keys(checkWindowInputs).length ? {check_windows: checkWindowInputs} : {}),
    });
  } catch (error) {
    // 错误码透传，文案与旧装配期口径一致（消费方按 `schedule projection: projection_failed — [code]` 识别）。
    // 这里不再吞成空骨架：errors 非空 → route 在 build 之前 503。
    const code = error instanceof ProjectionError ? error.code : 'projection_failed';
    errors.push(`schedule projection: projection_failed — [${code}] ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    root, errors, control, acceptance, roadmap, modelPackageLinks, decisionGates,
    openDecisionGates, openGatedCheckCount, openGates,
    roadmapPhaseIds, packageIds, checkIds, componentIds, usedCheckIds, packageCheckKeys,
    quoteRecordIds, phaseControls, hotWaterDecision, acceptanceById, blockerById,
    orderedPackages, auditByCheckKey,
    quoteRound, quoteRoundRecords, quoteRecords, appliancePackage,
    pendingBudgetGaps, knownPendingGap, unpricedComponents,
    roundTargetTotal, roundQuotedTotal, poolTotals, allocated, fixed,
    money, moneyOrPending, range, list, escapeCell, sha256, unique,
    fileSnapshot, snapshotDigest, scopeSummary, packageModelLinks,
    packageTargets, acceptanceObjectIds,
    packageProjectPaths, packageProjectSnapshot, packageProjectFingerprint,
    phaseInputPaths, phaseDataInputPaths, projectInputPaths,
    snapshotComment, fingerprintLine, header, packageChecks, packageGateLabel,
    checkSpecHash, staleAuditReason, auditStatusFor, gateStatus, auditDisplay, glossarySection,
    blockerIsClosed, packageWaiverIsValid, packagePrerequisiteIssues,
    effectiveReadiness, effectivePackageStatus, packageGateIssues,
    currentPackage, nextCheckpoint, scheduleProjection,
  };
}

// ─── next-action：把「现在干什么」从既有数据里推导出来（设计稿 §7） ──────────────
// 三条线索全部已在上面算出：readiness 就绪包、open 门禁、未报价组件；再加系统外
// 阻塞项单列。排序按「解除下游数量」——依赖拓扑深度，不是拍脑袋。

export type NextActionKind = 'ready_package' | 'decision_gate' | 'quote_pending' | 'external_blocker';

export interface NextActionItem {
  kind: NextActionKind;
  ref: string;
  title: string;
  detail: string;
  unblocks: number;
  package_id?: string;
}

/** 依赖拓扑：每个包被多少下游包（含传递）依赖。 */
function downstreamCounts(state: ScheduleState): Map<string, number> {
  const dependents = new Map<string, Set<string>>();
  for (const pkg of state.control.work_packages ?? []) {
    for (const dependency of pkg.dependencies ?? []) {
      if (!dependents.has(dependency)) dependents.set(dependency, new Set());
      dependents.get(dependency)!.add(pkg.id);
    }
  }
  const counts = new Map<string, number>();
  const countFrom = (id: string, seen: Set<string>): number => {
    if (counts.has(id)) return counts.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    let total = 0;
    for (const dependent of dependents.get(id) ?? []) {
      total += 1 + countFrom(dependent, seen);
    }
    counts.set(id, total);
    return total;
  };
  for (const pkg of state.control.work_packages ?? []) countFrom(pkg.id, new Set());
  return counts;
}

export function computeNextActions(state: ScheduleState): NextActionItem[] {
  const downstream = downstreamCounts(state);
  const items: NextActionItem[] = [];

  for (const pkg of state.orderedPackages) {
    if (state.effectiveReadiness(pkg) !== 'ready') continue;
    if (state.gateStatus(pkg) === 'passed') continue;
    const next = state.nextCheckpoint(pkg);
    items.push({
      kind: 'ready_package',
      ref: pkg.id,
      title: `${pkg.id}｜${pkg.name} 可以开工/验收`,
      detail: next
        ? `${state.escapeCell(next.item)}（${next.id}）；通过标准：${state.escapeCell(next.pass_condition ?? next.standard ?? '')}`
        : pkg.description,
      unblocks: downstream.get(pkg.id) ?? 0,
      package_id: pkg.id,
    });
  }

  for (const decision of state.openDecisionGates) {
    items.push({
      kind: 'decision_gate',
      ref: decision.id,
      title: `拍板 ${decision.id}：${decision.topic}`,
      detail: `${decision.question ?? ''}${(decision.blocks ?? []).length ? `；阻塞检查：${(decision.blocks ?? []).join('、')}` : ''}`,
      unblocks: (decision.blocks ?? []).length,
    });
  }

  const unpricedByPackage = new Map<string, AnyRecord[]>();
  for (const component of state.unpricedComponents) {
    if (!unpricedByPackage.has(component.package_id)) unpricedByPackage.set(component.package_id, []);
    unpricedByPackage.get(component.package_id)!.push(component);
  }
  for (const [packageId, components] of [...unpricedByPackage.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const pkg = state.control.work_packages.find((item: AnyRecord) => item.id === packageId);
    const names = components.slice(0, 5).map((component: AnyRecord) => component.name).join('、');
    items.push({
      kind: 'quote_pending',
      ref: packageId,
      title: `${pkg?.name ?? packageId}（${packageId}）有 ${components.length} 个费用项待询价`,
      detail: `${names}${components.length > 5 ? ' 等' : ''}；「待报价/待算量」不是 0 元`,
      unblocks: downstream.get(packageId) ?? 0,
      package_id: packageId,
    });
  }

  for (const blocker of state.control.global_blockers ?? []) {
    if (state.blockerIsClosed(blocker)) continue;
    const blockedPackages = (state.control.work_packages ?? []).filter((pkg: AnyRecord) => (pkg.blockers ?? []).includes(blocker.id));
    const unblocks = blockedPackages.reduce((sum: number, pkg: AnyRecord) => sum + 1 + (downstream.get(pkg.id) ?? 0), 0);
    items.push({
      kind: 'external_blocker',
      ref: blocker.id,
      title: `等外部方：${blocker.item}`,
      detail: `解除条件：${blocker.clears_when}；责任角色：${state.list(blocker.owner_roles)}`,
      unblocks,
    });
  }

  const kindRank: Record<NextActionKind, number> = {ready_package: 0, decision_gate: 1, quote_pending: 2, external_blocker: 3};
  return items.sort((left, right) =>
    right.unblocks - left.unblocks
    || kindRank[left.kind] - kindRank[right.kind]
    || left.ref.localeCompare(right.ref));
}

// ─── snapshot：给只读 API / 前端的结构化投影（纯数据，可 JSON 序列化） ──────────

export interface ScheduleCheckView {
  id: string;
  item: string;
  source: 'acceptance' | 'package';
  severity?: string;
  checkpoint?: string;
  method?: string;
  pass_condition?: string;
  evidence_required: string[];
  can_run_while_blocked?: boolean;
  audit_status?: string;
  stale_reasons?: string[];
  /** 当前审计记录（auditByCheckKey 的最后一条）。id 是复验 supersedes 的锚点：
   *  validateDraft 要求 supersedes 必须等于本包本检查的当前记录 id。 */
  audit?: {id: string; checked_by?: string; checked_at?: string; evidence?: string[]; supersedes?: string};
  open_gates?: string[];
  check_spec_sha256: string;
  /** 验收项对象集的派生来源（issue #191）：引用该条的工作包；对象集 = 这些包 targets 并集。 */
  objects_from_packages?: string[];
}

export interface SchedulePackageView {
  id: string;
  name: string;
  sequence: number;
  description: string;
  status: string;
  readiness: string;
  effective_readiness: string;
  effective_status: string;
  dependencies: string[];
  owner_roles: string[];
  payment_gate: string;
  gate_label: string;
  gate_status: string;
  blockers: Array<{id: string; item?: string; status?: string; clears_when?: string; closed: boolean}>;
  budget: {
    planned_cny: number | null;
    contracted_cny: number | null;
    paid_cny: number | null;
    forecast_cny: number | null;
    estimated_need_cny?: number | null;
    funding_status?: string;
    allocation_status?: string;
    component_count: number;
    unpriced_count: number;
  };
  checks: ScheduleCheckView[];
  /** 工作包对象 targets（issue #191；`*` = 显式全模型范围）。 */
  targets: string[];
  project_fingerprint: string;
}

/** 排程投影视图（issue #202 切片 B；docs/schedule-coordination-design.md §6.1）。 */
export interface ScheduleOrdinalView { ord: number; date: string | null; }
/** 单包窗口：start_ord 取 min 口径起点，end_ord_min/end_ord_max 是 min/max 两口径末端。 */
export interface ScheduleWindowView { start_ord: number; end_ord_min: number; end_ord_max: number; }
export interface ScheduleConstraintView { id: string; type: string; status: string; date: string | null; detail?: string; }
export interface SchedulePackageProjectionView {
  duration_workdays: { min: number; max: number };
  baseline: ScheduleWindowView;
  forecast: ScheduleWindowView;
  /**
   * 检查记录窗口（F2 正名，设计 §2.2/§15.9；§16 起不进 forecast；§17 起带日期与可空序数）。
   * 语义是「门禁 passed 的完成证据登记在哪些检查日」，**不是施工实际起止**——实际开工时间
   * 从未记录，保持未知。也不覆盖 forecast、不顺延后继；无 scenario 时 forecast 与 baseline 相同。
   * first_date/last_date 是 checked_at 的首末日，锚点未定时也保留。
   * first_ord/last_ord 只在锚点就绪时才是 number（可为 0 或负值）；锚点为 null 时为 null
   * （待定）。null 与 0 不是一回事，禁止用 0 或名义纪元序数填这个空。
   * 窗口本身为 null = 未形成整包检查证据（部分通过 / waived / pending），
   * 绝不拿单条检查通过冒充整包完工。
   */
  check_window: {
    first_date: string;
    last_date: string;
    first_ord: number | null;
    last_ord: number | null;
  } | null;
  /** 未满足依赖 + 未关闭阻塞项的解释性汇总（只解释，不参与排程计算）。 */
  blocking_reasons: string[];
  constraints: ScheduleConstraintView[];
}
export interface ScheduleProjectionView {
  /** 排程零点；null = 尚未定锚（此时 ordinals 的 date 全 null，UI 只显示「第 N 工作日」）。 */
  anchor_date: string | null;
  calendar: { workdays: number[]; rest_dates: string[]; extra_workdates: string[] };
  ordinals: ScheduleOrdinalView[];
  /** key = PKG id；只含主车道（sequence < 900）——PKG-900 侧车道不参与排程（设计 §4）。 */
  packages: Record<string, SchedulePackageProjectionView>;
}
/** SCH 协调快照（设计 §2.1(c)）：只描述「何时、谁到场、什么方式」，不是门禁输入。 */
export interface ScheduleCoordinationView {
  package_id: string;
  required_roles: string[];
  mode: 'onsite' | 'remote' | 'notify';
  lead_time_workdays: number;
  owner_role: string;
  status: string;
  actor: { name: string | null; org: string | null };
  confirmed_at: string | null;
  escalation: string;
}

export interface ScheduleSnapshot {
  phase: {
    id: string;
    status: string;
    current_gate: string;
    ceiling_cny: number;
    allocated_cny: number;
    unallocated_cny: number;
    known_pending_gap_cny: number;
  };
  counts: {
    packages: number;
    checks: number;
    cost_components: number;
    unpriced_components: number;
    open_decision_gates: number;
    open_gated_checks: number;
    ready_packages: number;
  };
  data_fingerprint: string;
  packages: SchedulePackageView[];
  decision_gates: {open: Array<{id: string; topic: string; scope: string; blocks: string[]; question?: string}>; decided_count: number};
  global_blockers: Array<{id: string; item?: string; status?: string; clears_when?: string; owner_roles?: string[]; closed: boolean}>;
  next_actions: NextActionItem[];
  stale_audits: string[];
  package_gate_issues: string[];
  // ─── 排程投影（issue #202 切片 B，§6.1 纯增量两键；既有字段一个不动）───
  // buildScheduleSnapshot 恒产出这两个键；类型上可选只因 app 侧 4 个测试 fixture
  // 手造 ScheduleSnapshot 字面量（NextActionPanel/SchedulePanel/FlowChartPanel/
  // ScheduleDetailPanel 的 .test.ts），收编它们超出「只改 schedule-state.ts」的边界。
  // UI 消费按 undefined 兜底即为「503 或旧快照」形态。
  schedule?: ScheduleProjectionView;
  /** key = SCH id；稀疏——没有 coordination 块的 SCH 不出现，不造空对象。 */
  coordination?: Record<string, ScheduleCoordinationView>;
}

export function computeStaleAudits(state: ScheduleState): string[] {
  return (state.control.audit_log?.records ?? []).flatMap((record: AnyRecord) => {
    if (record.status !== 'passed') return [];
    const pkg = state.control.work_packages.find((item: AnyRecord) => item.id === record.package_id);
    if (!pkg) return [];
    const reasons = state.staleAuditReason(pkg, record.check_id, record);
    return reasons.length ? [`${record.package_id}/${record.check_id}: ${reasons.join('、')}`] : [];
  });
}

// ─── 排程扩展：声明校验与快照装配（issue #202 切片 B；设计 §2.1 / §4 / §6.1）────────
// 算法不在这里：日历展开、DAG、min/max 前向传播的单一实现是
// shared/schedule-projection.ts（检查记录窗口只作证据，不钉 forecast，设计 §16）。本节只做三件事——①校验新声明字段（load 阶段，error 级）；
// ②把 control.yaml 的声明喂给投影（含从 audit_log 派生的检查记录窗口）；③把投影结果
// 与 coordination 声明摊平成快照两键。

/** 约束 type 枚举（设计 §2.1(b)）。 */
const CONSTRAINT_TYPES = ['not_before', 'not_after', 'time_window'];
/** SCH coordination 的 mode / status 枚举（设计 §2.1(c)）。 */
const COORDINATION_MODES = ['onsite', 'remote', 'notify'];
const COORDINATION_STATUSES = ['unassigned', 'pending_invite', 'invited', 'confirmed', 'cancelled'];
/** 「等人响应」的中间态：这两个状态必须写明 escalation（没人响应时怎么办）。 */
const COORDINATION_PENDING_STATUSES = ['pending_invite', 'invited'];

/**
 * control.yaml 日期声明归一。null/undefined → null（null 是合法声明值，不是缺字段，
 * 同「0 是合法声明值」口径）；js-yaml 会把未加引号的日期解析成 Date，归一回
 * YYYY-MM-DD（同 contract.signed_at 的既有先例）；其余必须是真实存在的 YYYY-MM-DD
 * 串，返回 undefined 表示「声明非法」——报错交给校验层，这里不静默改值。
 */
function normalizeCalendarDateText(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : value;
  if (typeof text !== 'string' || !isValidCalendarDateText(text)) return undefined;
  return text;
}

function validateWorkCalendar(calendar: unknown, errors: string[], blockerStatusValues: Set<string>): void {
  if (!calendar || typeof calendar !== 'object' || Array.isArray(calendar)) {
    errors.push('work_calendar: work_calendar_invalid — 缺少顶层 work_calendar 段（排程投影的必需输入；anchor_date: null 是合法声明值，不是缺字段）');
    return;
  }
  const cal = calendar as AnyRecord;
  if (!Array.isArray(cal.workdays) || cal.workdays.some((day: unknown) => !Number.isInteger(day) || (day as number) < 0 || (day as number) > 6)) {
    errors.push(`work_calendar.workdays: work_calendar_invalid — 必须是 0-6 的整数数组（0=周日 … 6=周六，got ${JSON.stringify(cal.workdays)}）`);
  }
  for (const field of ['rest_dates', 'extra_workdates'] as const) {
    const values = cal[field];
    if (!Array.isArray(values)) {
      errors.push(`work_calendar.${field}: work_calendar_invalid — 必须是 YYYY-MM-DD 日期串数组（got ${JSON.stringify(values)}）`);
      continue;
    }
    for (const value of values) {
      if (typeof value !== 'string' || !isValidCalendarDateText(value)) {
        errors.push(`work_calendar.${field}: work_calendar_invalid — 非法日期 ${JSON.stringify(value)}（须为真实存在的 YYYY-MM-DD）`);
      }
    }
  }
  const anchorDate = normalizeCalendarDateText(cal.anchor_date);
  if (anchorDate === undefined) {
    errors.push(`work_calendar.anchor_date: work_calendar_invalid — 须为 null 或真实存在的 YYYY-MM-DD（got ${JSON.stringify(cal.anchor_date)}）`);
  }
  if (typeof cal.anchor_status !== 'string' || !blockerStatusValues.has(cal.anchor_status)) {
    errors.push(`work_calendar.anchor_status: work_calendar_invalid — 取值须同 control.blocker_status_values（got ${JSON.stringify(cal.anchor_status)}）`);
  }
  // 填锚点日期的前提是锚点事实已 resolved（BLK-HANDOVER 关闭后才允许定排程零点）；
  // 「有日期但没拍板」= 用未成立的假设排施工，必须拦下。
  if (typeof anchorDate === 'string' && cal.anchor_status !== 'resolved') {
    errors.push(`work_calendar.anchor_date: anchor_date_without_resolved_status — anchor_date=${anchorDate} 但 anchor_status=${JSON.stringify(cal.anchor_status)}，锚点日期必须等 anchor_status: resolved 才允许填`);
  }
}

function validatePackageConstraints(pkg: AnyRecord, errors: string[], blockerStatusValues: Set<string>): void {
  const constraints = pkg.constraints;
  if (constraints === undefined || constraints === null) return;
  if (!Array.isArray(constraints)) {
    errors.push(`${pkg.id}: constraints_invalid — 必须是约束数组（got ${typeof constraints}）`);
    return;
  }
  // 约束 status 复用 control.blocker_status_values；「未决」= 除 resolved/waived 外的取值
  // （site_pending / alignment_required）——日期未定的约束只能停在未决态，带结论没日期等于丢事实。
  const pendingStatuses = [...blockerStatusValues].filter((status) => status !== 'resolved' && status !== 'waived');
  constraints.forEach((constraint: AnyRecord, index: number) => {
    const label = typeof constraint?.id === 'string' && constraint.id ? constraint.id : `${pkg.id}.constraints[${index}]`;
    if (!constraint || typeof constraint !== 'object' || Array.isArray(constraint)) {
      errors.push(`${label}: constraint_invalid — 约束必须是 {id, type, status, date, …} 映射（got ${JSON.stringify(constraint)}）`);
      return;
    }
    if (!CONSTRAINT_TYPES.includes(constraint.type)) {
      errors.push(`${label}: constraint_type_invalid — type 须为 not_before|not_after|time_window（got ${JSON.stringify(constraint.type)}）`);
    }
    if (typeof constraint.status !== 'string' || !blockerStatusValues.has(constraint.status)) {
      errors.push(`${label}: constraint_status_invalid — status 取值须同 control.blocker_status_values（got ${JSON.stringify(constraint.status)}）`);
    }
    const date = normalizeCalendarDateText(constraint.date);
    if (date === undefined) {
      errors.push(`${label}: constraint_date_invalid — date 须为 null 或真实存在的 YYYY-MM-DD（got ${JSON.stringify(constraint.date)}）`);
    } else if (date === null && typeof constraint.status === 'string' && blockerStatusValues.has(constraint.status) && !pendingStatuses.includes(constraint.status)) {
      errors.push(`${label}: constraint_status_invalid — date 为 null 时 status 必须是未决值（${pendingStatuses.join(' / ')}），got ${constraint.status}`);
    }
  });
}

function validateCheckCoordination(label: string, block: unknown, errors: string[], blockerStatusValues: Set<string>): void {
  if (block === undefined || block === null) return;
  if (typeof block !== 'object' || Array.isArray(block)) {
    errors.push(`${label}: coordination_invalid — coordination 必须是映射（got ${JSON.stringify(block)}）`);
    return;
  }
  const coordinationBlock = block as AnyRecord;
  if (!COORDINATION_MODES.includes(coordinationBlock.mode)) {
    errors.push(`${label}: coordination_mode_invalid — mode 须为 onsite|remote|notify（got ${JSON.stringify(coordinationBlock.mode)}）`);
  }
  if (!COORDINATION_STATUSES.includes(coordinationBlock.status)) {
    errors.push(`${label}: coordination_status_invalid — status 须为 unassigned|pending_invite|invited|confirmed|cancelled（got ${JSON.stringify(coordinationBlock.status)}）`);
  }
  // 决策铁律第 1 条：新部件必须回答「它不工作时怎么办」。等人响应的中间态没写升级路径 = 没写。
  if (COORDINATION_PENDING_STATUSES.includes(coordinationBlock.status)
    && (typeof coordinationBlock.escalation !== 'string' || !coordinationBlock.escalation.trim())) {
    errors.push(`${label}: coordination_pending_without_escalation — status=${coordinationBlock.status} 而 escalation 为空：必须写明没人确认时怎么办（升级给谁、何时触发）`);
  }
  // 已确认却不知道谁确认的 = 不可追溯的确认，等于没确认。
  const actor = coordinationBlock.actor;
  if (coordinationBlock.status === 'confirmed'
    && (!actor || typeof actor !== 'object' || Array.isArray(actor)
      || typeof actor.name !== 'string' || !actor.name.trim())) {
    errors.push(`${label}: coordination_confirmed_without_actor — status=confirmed 而 actor.name 为空：确认必须落到可追溯的确认人`);
  }
  if (!Array.isArray(coordinationBlock.required_roles) || coordinationBlock.required_roles.length === 0
    || coordinationBlock.required_roles.some((role: unknown) => typeof role !== 'string' || !role.trim())) {
    errors.push(`${label}: coordination_roles_invalid — required_roles 必须是非空的角色字符串数组（到场要求，不是责任归属，got ${JSON.stringify(coordinationBlock.required_roles)}）`);
  }
  if (typeof coordinationBlock.owner_role !== 'string' || !coordinationBlock.owner_role.trim()) {
    errors.push(`${label}: coordination_roles_invalid — owner_role 必须是非空角色（协调组织者：谁去约人）`);
  }
  if (!Number.isInteger(coordinationBlock.lead_time_workdays) || (coordinationBlock.lead_time_workdays as number) < 0) {
    errors.push(`${label}: coordination_lead_time_invalid — lead_time_workdays 必须是非负整数工作日（got ${JSON.stringify(coordinationBlock.lead_time_workdays)}）`);
  }
  if (normalizeCalendarDateText(coordinationBlock.confirmed_at) === undefined) {
    errors.push(`${label}: coordination_confirmed_at_invalid — confirmed_at 须为 null 或真实存在的 YYYY-MM-DD（got ${JSON.stringify(coordinationBlock.confirmed_at)}）`);
  }
}

/** 排程扩展声明的一站式校验（load 阶段调用；全部 error 级，见 §2.1(d)）。 */
function validateScheduleControlExtensions(control: AnyRecord, errors: string[], blockerStatusValues: Set<string>): void {
  validateWorkCalendar(control.work_calendar, errors, blockerStatusValues);
  for (const pkg of control.work_packages ?? []) {
    validatePackageConstraints(pkg, errors, blockerStatusValues);
    for (const check of pkg.checks ?? []) {
      const label = typeof check?.id === 'string' && check.id ? check.id : `${pkg.id}.checks[?]`;
      validateCheckCoordination(label, check?.coordination, errors, blockerStatusValues);
    }
  }
}

/** 排程投影的输入包集：只收主车道（sequence < 900，设计 §4）——PKG-900 侧车道不参与排程。 */
function scheduleProjectionPackages(control: AnyRecord): AnyRecord[] {
  return (control.work_packages ?? []).filter((pkg: AnyRecord) => pkg.sequence < 900);
}

/** control.yaml 包声明 → 投影输入。工期缺失时留 undefined，让投影的 invalid_duration 显形，不造 0。 */
function projectionPackageInput(pkg: AnyRecord): ProjectionPackage {
  return {
    id: pkg.id,
    sequence: pkg.sequence,
    dependencies: Array.isArray(pkg.dependencies) ? [...pkg.dependencies] : [],
    duration_workdays: { min: pkg.duration_workdays?.min, max: pkg.duration_workdays?.max },
  };
}

/** PKG constraints 按包 id 归组（投影输入与快照视图共用同一份归组，不抄两遍）。 */
function projectionConstraintsByPackage(packages: AnyRecord[]): Record<string, ProjectionConstraint[]> {
  const grouped: Record<string, ProjectionConstraint[]> = {};
  for (const pkg of packages) {
    if (!Array.isArray(pkg.constraints) || pkg.constraints.length === 0) continue;
    grouped[pkg.id] = pkg.constraints.map((constraint: AnyRecord) => ({
      id: constraint?.id,
      type: constraint?.type,
      status: constraint?.status,
      date: normalizeCalendarDateText(constraint?.date) ?? null,
      ...(typeof constraint?.detail === 'string' ? { detail: constraint.detail } : {}),
    }));
  }
  return grouped;
}

function declaredDateList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item: unknown) => normalizeCalendarDateText(item))
    .filter((item): item is string => typeof item === 'string');
}

/** work_calendar 声明的宽容读取（快照键用）：非法成员已被 load 校验报错，这里只滤掉不投。 */
function readWorkCalendarSnapshot(control: AnyRecord): { anchor_date: string | null; calendar: { workdays: number[]; rest_dates: string[]; extra_workdates: string[] } } {
  const declared = control.work_calendar && typeof control.work_calendar === 'object' && !Array.isArray(control.work_calendar)
    ? control.work_calendar as AnyRecord
    : {};
  const anchorDate = normalizeCalendarDateText(declared.anchor_date);
  return {
    anchor_date: typeof anchorDate === 'string' ? anchorDate : null,
    calendar: {
      workdays: Array.isArray(declared.workdays)
        ? declared.workdays.filter((day: unknown): day is number => Number.isInteger(day) && (day as number) >= 0 && (day as number) <= 6)
        : [],
      rest_dates: declaredDateList(declared.rest_dates),
      extra_workdates: declaredDateList(declared.extra_workdates),
    },
  };
}

/** SCH coordination 声明 → 快照（稀疏：只收声明了 coordination 块的检查；key = SCH id）。 */
function buildCoordinationSnapshot(state: ScheduleState): Record<string, ScheduleCoordinationView> {
  const snapshot: Record<string, ScheduleCoordinationView> = {};
  for (const pkg of state.control.work_packages ?? []) {
    for (const check of pkg.checks ?? []) {
      const block = check?.coordination;
      // 畸形块（非映射）已在 load 校验报成 coordination_invalid；这里只摊平正常块
      if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
      snapshot[check.id] = {
        package_id: pkg.id,
        required_roles: Array.isArray(block.required_roles) ? [...block.required_roles] : [],
        mode: block.mode,
        lead_time_workdays: block.lead_time_workdays,
        owner_role: block.owner_role,
        status: block.status,
        actor: { name: block.actor?.name ?? null, org: block.actor?.org ?? null },
        confirmed_at: normalizeCalendarDateText(block.confirmed_at) ?? null,
        escalation: block.escalation,
      };
    }
  }
  return snapshot;
}

/**
 * 排程投影装配（buildScheduleSnapshot 的 schedule 键）——只消费 load 期已存的投影
 * （设计 §14/B4）。这里不再调用 projectSchedule、不再追加 errors、也不再有「装配期 catch
 * 后返回空骨架」的分支：投影失败时 state.scheduleProjection 为 null 且 state.errors 已非空，
 * route 在 build 之前就 503；空骨架只是让类型完整，不是可消费的降级排程。
 */
function buildScheduleProjectionView(state: ScheduleState): ScheduleProjectionView {
  const declared = readWorkCalendarSnapshot(state.control);
  const projection = state.scheduleProjection;
  if (!projection) {
    // 只有 load 期投影失败才会走到这里：loadScheduleState 已把原因写进 errors，route 在
    // 调用 build 之前就按 errors 503（server/routes.ts 的 /schedule/state）。下面的空表
    // 不是可消费排程，只是让 ScheduleProjectionView 类型完整；「直接构造 ScheduleState 却
    // 漏填投影」属于契约破坏，这里立即报错而不是静默降级成空排程（B4 的主题）。
    if (state.errors.length === 0) {
      throw new Error('scheduleProjection 缺失且 errors 为空：ScheduleState 契约被破坏（投影必须在 loadScheduleState 内完成）');
    }
    return {
      anchor_date: declared.anchor_date,
      calendar: declared.calendar,
      ordinals: [],
      packages: {},
    };
  }

  const projectedRaw = scheduleProjectionPackages(state.control);
  const constraints = projectionConstraintsByPackage(projectedRaw);

  const schedulePackages: Record<string, SchedulePackageProjectionView> = {};
  for (const pkg of projectedRaw) {
    const projected = projection.packages[pkg.id];
    if (!projected) continue; // 投影按同一包集计算，缺项只会是内部错误；防御性跳过
    schedulePackages[pkg.id] = {
      duration_workdays: { min: pkg.duration_workdays?.min, max: pkg.duration_workdays?.max },
      baseline: projected.baseline,
      forecast: projected.forecast,
      // 模块 check_window 是 {start_date, end_date, start_ord, end_ord}；
      // 快照沿用 {first_date, last_date, first_ord, last_ord}，四者都从模块返回值映射。
      // 序数原样透传：null 是「锚点未定、待定」（§17），0 是锚点前工作日的合法序数。
      // 不许 `?? 0`、不许 `||`、不许改写成 1970 名义纪元序数。
      // 这是检查记录的证据窗口，不是施工实际起止，也不参与 forecast（设计 §16）。
      check_window: projected.check_window === null
        ? null
        : {
            first_date: projected.check_window.start_date,
            last_date: projected.check_window.end_date,
            first_ord: projected.check_window.start_ord,
            last_ord: projected.check_window.end_ord,
          },
      // 阻塞解释单一来源：packagePrerequisiteIssues 已汇总「依赖未过」与
      // 「阻塞项 X 尚未有证据关闭」（未关闭 blocker 的汇总就在其中），不另写第二套阻塞判定。
      blocking_reasons: state.packagePrerequisiteIssues(pkg),
      constraints: constraints[pkg.id] ?? [],
    };
  }

  return {
    anchor_date: declared.anchor_date,
    calendar: declared.calendar,
    // 无锚点时 UI 契约「未知保持未知，不造年月日」：date 全 null，ord 照常
    ordinals: projection.ordinals.map((entry) => ({
      ord: entry.ord,
      date: declared.anchor_date === null ? null : entry.date,
    })),
    packages: schedulePackages,
  };
}

export function buildScheduleSnapshot(state: ScheduleState): ScheduleSnapshot {
  // 全量工作包（含 sequence=900 的 PKG-900 硬装预备金）：进度图要把它作为
  // 常驻侧车道显示（设计稿 §9），orderedPackages 的 <900 过滤只服务于
  // 「当前推进位置」的施工顺序语义，不适配可视图。
  const allPackages = [...state.control.work_packages].sort((left: AnyRecord, right: AnyRecord) => left.sequence - right.sequence);
  const packages: SchedulePackageView[] = allPackages.map((pkg: AnyRecord) => {
    const acceptanceRefs = new Set<string>(pkg.acceptance_refs ?? []);
    const checks: ScheduleCheckView[] = state.packageChecks(pkg).map((check: AnyRecord) => {
      const auditStatus = state.auditStatusFor(pkg.id, check.id);
      const record = state.auditByCheckKey.get(`${pkg.id}:${check.id}`);
      const openGateIds = (state.openGates.get(check.id) ?? []).map((decision) => decision.id);
      return {
        id: check.id,
        item: check.item,
        source: acceptanceRefs.has(check.id) ? 'acceptance' : 'package',
        severity: check.severity,
        checkpoint: check.checkpoint,
        method: check.method,
        pass_condition: check.pass_condition ?? check.standard,
        evidence_required: check.evidence_required ?? [],
        can_run_while_blocked: check.can_run_while_blocked === true ? true : undefined,
        audit_status: auditStatus,
        stale_reasons: auditStatus === 'stale' && record
          ? state.staleAuditReason(pkg, check.id, record)
          : undefined,
        audit: record
          ? {id: record.id, checked_by: record.checked_by, checked_at: record.checked_at, evidence: record.evidence, supersedes: record.supersedes}
          : undefined,
        open_gates: openGateIds.length ? openGateIds : undefined,
        objects_from_packages: Array.isArray(check.objects?.from_packages) && check.objects.from_packages.length
          ? check.objects.from_packages
          : undefined,
        check_spec_sha256: state.checkSpecHash(pkg, check.id),
      };
    });
    const components = pkg.budget?.components ?? [];
    return {
      id: pkg.id,
      name: pkg.name,
      sequence: pkg.sequence,
      description: pkg.description,
      status: pkg.status,
      readiness: pkg.readiness,
      effective_readiness: state.effectiveReadiness(pkg),
      effective_status: state.effectivePackageStatus(pkg),
      dependencies: pkg.dependencies ?? [],
      owner_roles: pkg.owner_roles ?? [],
      payment_gate: pkg.payment_gate,
      gate_label: state.packageGateLabel(pkg),
      gate_status: state.gateStatus(pkg),
      blockers: (pkg.blockers ?? []).map((id: string) => {
        const blocker = state.blockerById.get(id);
        return {
          id,
          item: blocker?.item,
          status: blocker?.status,
          clears_when: blocker?.clears_when,
          closed: state.blockerIsClosed(blocker),
        };
      }),
      budget: {
        planned_cny: pkg.budget?.planned_cny ?? null,
        contracted_cny: pkg.budget?.contracted_cny ?? null,
        paid_cny: pkg.budget?.paid_cny ?? null,
        forecast_cny: pkg.budget?.forecast_cny ?? null,
        estimated_need_cny: pkg.budget?.estimated_need_cny ?? null,
        funding_status: pkg.budget?.funding_status,
        allocation_status: pkg.budget?.allocation_status,
        component_count: components.length,
        unpriced_count: components.filter((component: AnyRecord) => component.planned_cny == null).length,
      },
      checks,
      targets: state.packageTargets(pkg),
      project_fingerprint: state.packageProjectFingerprint(pkg),
    };
  });

  return {
    phase: {
      id: state.control.phase_id,
      status: state.control.control.status,
      current_gate: state.control.control.current_gate,
      ceiling_cny: state.control.control.phase_ceiling_cny,
      allocated_cny: state.control.control.allocated_cny,
      unallocated_cny: state.control.control.unallocated_cny,
      known_pending_gap_cny: state.knownPendingGap,
    },
    counts: {
      packages: packages.length,
      checks: state.usedCheckIds.size,
      cost_components: state.componentIds.size,
      unpriced_components: state.unpricedComponents.length,
      open_decision_gates: state.openDecisionGates.length,
      open_gated_checks: state.openGatedCheckCount,
      ready_packages: packages.filter((pkg) => pkg.effective_readiness === 'ready').length,
    },
    data_fingerprint: state.snapshotDigest(state.fileSnapshot(state.projectInputPaths)),
    packages,
    decision_gates: {
      open: state.openDecisionGates.map((decision) => ({
        id: decision.id,
        topic: decision.topic,
        scope: decision.scope,
        blocks: decision.blocks ?? [],
        question: decision.question,
      })),
      decided_count: state.decisionGates.decisions.filter((decision) => decision.status === 'decided').length,
    },
    global_blockers: (state.control.global_blockers ?? []).map((blocker: AnyRecord) => ({
      id: blocker.id,
      item: blocker.item,
      status: blocker.status,
      clears_when: blocker.clears_when,
      owner_roles: blocker.owner_roles,
      closed: state.blockerIsClosed(blocker),
    })),
    next_actions: computeNextActions(state),
    stale_audits: computeStaleAudits(state),
    package_gate_issues: state.packageGateIssues,
    // 排程投影与 SCH 协调快照（issue #202 切片 B，§6.1 纯增量两键）。
    // coordination 只描述排程到场事实，不进入上方任何门禁/就绪判定（设计 §5）。
    schedule: buildScheduleProjectionView(state),
    coordination: buildCoordinationSnapshot(state),
  };
}
