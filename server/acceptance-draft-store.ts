/**
 * 验收 PR 草稿的服务端存储与提交流（自装审批第二步，2026-11-02）。
 *
 * 铁律落地：浏览器永不直接写仓库。本模块的写入全部发生在「分支 + commit +
 * PR」里，合并由业主亲手点；暂存数据只在 tmp/（过程物不进 git）。
 * 机械卡点复用 scripts/schedule/control.ts --check（与 npm run verify:schedule
 * 同一判定），提交前跑两遍：当前树必须干净通过，带上新记录后必须再次通过。
 *
 * control.yaml 的 audit_log 追加走**文本手术**而非 YAML 往返——该文件 169KB、
 * 注释即口径（record_schema 的 note、各轮次 dedup_rule），js-yaml dump 会全部
 * 毁掉。audit_log 是文件最后一个顶层段、records 现为 `records: []`，锚点唯一；
 * 形状不符时 fail-loud，绝不猜。
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { buildScheduleSnapshot, loadScheduleState } from '../shared/schedule-state.js';
import {
  ACCEPTANCE_EVIDENCE_REL_DIR, appendAuditRecords, projectAuditRecords, renderPrBody, validateDraft,
  type AcceptanceDraft, type AuditRecordProjection, type DraftValidation,
} from '../shared/acceptance-draft.js';
import { loadModelPackageLinks, MODEL_PACKAGE_LINKS_PATH } from './model-package-links.js';

const CONTROL_REL_PATH = 'schedule/phase-1/control.yaml';
// 证据根目录单一出处：shared/acceptance-draft.ts（passed 证据前缀校验同源）
const EVIDENCE_REL_DIR = ACCEPTANCE_EVIDENCE_REL_DIR;
const STAGING_DIR = 'tmp/capture/acceptance-staging';
const DRAFT_DIR = 'tmp/capture/acceptance-draft';

export class AcceptanceError extends Error {
  constructor(message: string, readonly detail?: unknown, readonly status?: number) {
    super(message);
  }
}

function repoRoot(): string {
  return process.cwd();
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sha256OfFile(absolute: string): string {
  return createHash('sha256').update(readFileSync(absolute)).digest('hex');
}

// ─── 草稿持久化（tmp/，一包一份） ────────────────────────────────────────────

function draftPath(packageId: string): string {
  return join(repoRoot(), DRAFT_DIR, `${packageId}.json`);
}

export function loadDraft(packageId: string): AcceptanceDraft {
  const file = draftPath(packageId);
  if (!existsSync(file)) return {package_id: packageId, results: []};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as AcceptanceDraft;
    if (parsed.package_id !== packageId || !Array.isArray(parsed.results)) return {package_id: packageId, results: []};
    // 只收对象条目：tmp/ 文件可能被外部改坏（null/字符串条目会让下游 .status 直接炸）。
    // 字段级形状问题不在这里猜，交给 validateDraft 记 issue（422，不是 500）。
    return {package_id: packageId, results: parsed.results.filter(isPlainRecord) as AcceptanceDraft['results']};
  } catch {
    return {package_id: packageId, results: []};
  }
}

export function saveDraft(draft: AcceptanceDraft): DraftValidation {
  const snapshot = buildScheduleSnapshot(loadScheduleState(repoRoot(), {modelPackageLinks: loadModelPackageLinks()}));
  const validation = validateDraft(draft, snapshot);
  if (!validation.ok) return validation;
  mkdirSync(join(repoRoot(), DRAFT_DIR), {recursive: true});
  writeFileSync(draftPath(draft.package_id), JSON.stringify(draft, null, 2));
  return validation;
}

// ─── 包/检查存在性校验（P0-1，路由与 store 内部共用的纵深防御） ───────────────

/**
 * 校验包与检查真实存在于当前快照（与 GET /api/schedule/state 同一 loader 同一
 * 判定）。package_id / check_id 是用户可控字符串且**直接进文件系统路径**
 * （join(root, dir, packageId, checkId)）——不校验时 `../evil` 即越界写任意
 * 位置。路由入口先调一次；store 内部（stageEvidence/finalizeEvidence）不信任
 * 路由，各自再校验一次。
 */
export function assertPackageCheckExists(packageId: string, checkId: string): void {
  const snapshot = buildScheduleSnapshot(loadScheduleState(repoRoot(), {modelPackageLinks: loadModelPackageLinks()}));
  const pkg = snapshot.packages.find((item) => item.id === packageId);
  if (!pkg) throw new AcceptanceError(`包 ${packageId} 不在当前快照里`);
  if (!pkg.checks.some((check) => check.id === checkId)) {
    throw new AcceptanceError(`检查 ${checkId} 不属于包 ${packageId}`);
  }
}

// ─── 证据暂存与落定 ─────────────────────────────────────────────────────────

export interface StagedEvidence {
  staging_path: string;
  sha256: string;
  size: number;
}

/** 上传落暂存区（tmp/，过程物不进 git）。dataBase64 由界面传来。 */
export function stageEvidence(packageId: string, checkId: string, filename: string, dataBase64: string): StagedEvidence {
  // 包/检查必须真实存在：packageId/checkId 直接拼进暂存路径，`../evil` 会写出
  // 暂存区（不信任路由，内部再校验一次——纵深防御）
  assertPackageCheckExists(packageId, checkId);
  if (!/^[\w.\-]+$/.test(filename) || filename === '.' || filename === '..') {
    throw new AcceptanceError(`文件名只能含字母数字与 . _ -（got ${filename}）`);
  }
  const dir = join(repoRoot(), STAGING_DIR, packageId, checkId);
  mkdirSync(dir, {recursive: true});
  const target = join(dir, filename);
  writeFileSync(target, Buffer.from(dataBase64, 'base64'));
  const stat = statSync(target);
  if (stat.size === 0) throw new AcceptanceError('证据文件不能为 0 字节');
  return {staging_path: join(STAGING_DIR, packageId, checkId, filename), sha256: sha256OfFile(target), size: stat.size};
}

/** 选为最终证据：从暂存区移入仓内最终路径（audit 记录引用它；随 PR 进 master）。 */
export function finalizeEvidence(packageId: string, checkId: string, stagingPath: string): {final_path: string; sha256: string} {
  // 同 stageEvidence：包/检查必须真实存在（finalDir 由它们拼出）
  assertPackageCheckExists(packageId, checkId);
  const normalized = resolve(repoRoot(), stagingPath);
  // 段根：暂存区/<packageId>/<checkId>/。只校验暂存根是不够的（P1-A）——别包/
  // 别检查的暂存证据会被 rename 进本包证据目录，旁路「passed 证据必须锚定本包
  // 本检查前缀」的校验；staging_path 指到暂存根或某包子目录时 renameSync 会搬
  // 走整个目录，随后 sha256OfFile 对目录读文件抛 500，而搬移已经发生。
  const segmentRoot = resolve(repoRoot(), STAGING_DIR, packageId, checkId);
  // 前缀检查必须带路径分隔符：裸 startsWith 会把同前缀目录也放过去。仓库路径
  // 统一 posix 风格，这里固定用 '/'（不用 path.sep——Windows 上 sep 是 '\\'，
  // 与 resolve() 的输出形态绑定会漏判）。段根本身是目录，同样被这条拒掉
  // （严格 startsWith，没有 `!==` 放行）。
  if (!normalized.startsWith(`${segmentRoot}/`)) {
    throw new AcceptanceError(`staging_path 必须在暂存区 ${STAGING_DIR}/${packageId}/${checkId}/ 段内且为普通文件（got ${stagingPath}）`);
  }
  // lstat 不看链接目标：符号链接一律拒（existsSync + renameSync 会跟随链接，
  // 把链外文件搬进证据目录），目录也拒（renameSync 搬目录后 sha256 读不了）。
  const entry = lstatSync(normalized, {throwIfNoEntry: false});
  if (!entry) throw new AcceptanceError(`暂存文件不存在：${stagingPath}`);
  if (!entry.isFile()) {
    throw new AcceptanceError(`staging_path 必须是普通文件（拒绝符号链接与目录）：${stagingPath}`);
  }
  // 目标文件名同样只允许字母数字与 . _ -（禁 `..` 之类把 rename 指到别处）
  const basename = normalized.split('/').pop()!;
  if (!/^[\w.\-]+$/.test(basename) || basename === '.' || basename === '..') {
    throw new AcceptanceError(`暂存文件名不合法（got ${basename}）`);
  }
  const finalDir = join(repoRoot(), EVIDENCE_REL_DIR, packageId, checkId);
  mkdirSync(finalDir, {recursive: true});
  const target = join(finalDir, basename);
  // 目标已存在时拒绝：renameSync 会静默覆盖已落定的证据（audit 记录可能已引用它）
  if (existsSync(target)) {
    throw new AcceptanceError(`目标证据已存在，拒绝覆盖：${join(EVIDENCE_REL_DIR, packageId, checkId, basename)}`);
  }
  renameSync(normalized, target);
  return {final_path: join(EVIDENCE_REL_DIR, packageId, checkId, basename), sha256: sha256OfFile(target)};
}

// ─── 机械卡点 ───────────────────────────────────────────────────────────────

export interface GateResult {
  ok: boolean;
  gates: Array<{name: string; ok: boolean; detail: string}>;
}

function runCommand(args: string[]): {status: number; output: string} {
  const result = spawnSync('node', ['--import', 'tsx', ...args], {cwd: repoRoot(), encoding: 'utf8', timeout: 180_000});
  return {status: result.status ?? -1, output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`};
}

/** 提交前机械卡点：控制源校验 + 草稿校验 + 证据在位 + 前置与阻塞 + 当前树 verify:schedule。 */
export function runPreSubmitGates(packageId: string): GateResult {
  const gates: GateResult['gates'] = [];
  const state = loadScheduleState(repoRoot(), {modelPackageLinks: loadModelPackageLinks()});
  gates.push({name: '控制源校验', ok: state.errors.length === 0, detail: state.errors.slice(0, 5).join('\n') || 'schedule control valid'});

  const draft = loadDraft(packageId);
  const snapshot = buildScheduleSnapshot(state);
  const validation = validateDraft(draft, snapshot);
  gates.push({
    name: '草稿校验',
    ok: validation.ok,
    detail: validation.issues.map((issue) => `${issue.check_id}: ${issue.message}`).join('\n') || `${draft.results.length} 条结果全部合法`,
  });

  const missing = draft.results.flatMap((result) => Array.isArray(result.evidence) ? result.evidence.filter((path): path is string => typeof path === 'string') : [])
    .filter((path) => !existsSync(join(repoRoot(), path)));
  gates.push({name: '证据文件在位', ok: missing.length === 0, detail: missing.length ? missing.join('\n') : '全部证据文件存在'});

  // ⑤ 前置与阻塞（P1-3）：依赖包/包级阻塞未关闭时，普通检查不得借本次提交混过
  // 卡点。唯一例外是 can_run_while_blocked 的预演项（设计 §4：通过它不解除
  // 施工 readiness）——草稿里所有 passed 都是预演项时仍放行，但 detail 注明
  // 「施工 readiness 保持 blocked」，防止把预演通过当成开工/付款条件。
  const gateRawPkg = (state.control.work_packages ?? []).find((item: {id: string}) => item.id === packageId);
  const prerequisiteIssues = gateRawPkg
    ? state.packagePrerequisiteIssues(gateRawPkg)
    : [`包 ${packageId} 不在控制源里`];
  const previewCheckIds = new Set(
    snapshot.packages.find((item) => item.id === packageId)?.checks
      .filter((check) => check.can_run_while_blocked === true)
      .map((check) => check.id) ?? [],
  );
  const passedCheckIds = draft.results.filter((result) => result.status === 'passed').map((result) => result.check_id);
  const onlyPreviewPassed = passedCheckIds.length > 0 && passedCheckIds.every((checkId) => previewCheckIds.has(checkId));
  gates.push({
    name: '前置与阻塞',
    ok: prerequisiteIssues.length === 0 || onlyPreviewPassed,
    detail: prerequisiteIssues.length === 0
      ? '依赖包与阻塞项均已关闭'
      : onlyPreviewPassed
        ? `仅预演项通过，施工 readiness 保持 blocked：${prerequisiteIssues.join('；')}`
        : `前置/阻塞未满足，不得提交：${prerequisiteIssues.join('；')}`,
  });

  const check = runCommand(['scripts/schedule/control.ts', '--check']);
  gates.push({name: 'verify:schedule（当前树）', ok: check.status === 0, detail: check.output.split('\n').slice(-6).join('\n')});

  return {ok: gates.every((gate) => gate.ok), gates};
}

// ─── 提交：分支 + commit + PR ───────────────────────────────────────────────

export interface SubmitResult {
  branch: string;
  commit: string;
  pr_url: string;
  records: AuditRecordProjection[];
  pr_body: string;
}

function git(args: string[]): {status: number; output: string} {
  const result = spawnSync('git', args, {cwd: repoRoot(), encoding: 'utf8', timeout: 120_000});
  return {status: result.status ?? -1, output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`};
}

function currentBranch(): string {
  const result = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (result.status !== 0) throw new AcceptanceError('git rev-parse 失败', result.output);
  return result.output.trim();
}

/** 纯：验收 PR 的基线分支只允许 master（提为函数供单测；规则只有这一处）。 */
export function isAcceptanceBaseBranch(branch: string): boolean {
  return branch.trim() === 'master';
}

/**
 * 纯：accept/<pkg>-<YYYYMMDD>-<HHMMSS>（本地时间）。日期+时间双后缀：同一天
 * 对同一包提交多次时不撞车（曾用纯日期，第二次 `git checkout -b` 直接失败）。
 */
export function acceptBranchName(packageId: string, now: Date): string {
  const pad = (part: number) => String(part).padStart(2, '0');
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `accept/${packageId}-${date}-${time}`;
}

/**
 * 从 `git status --porcelain` 行里取未跟踪文件集合（`?? ` 行）。git 会给含
 * 特殊字符的路径加双引号，剥掉（仓内路径均为 ASCII，不做完整 unescape）。
 */
function untrackedFromPorcelain(lines: string[]): Set<string> {
  return new Set(lines
    .filter((line) => line.startsWith('?? '))
    .map((line) => line.slice(3).trim())
    .map((path) => path.replace(/^"(.*)"$/, '$1')));
}

function porcelainLines(): string[] {
  const status = git(['status', '--porcelain']);
  if (status.status !== 0) throw new AcceptanceError('git status 失败', status.output);
  return status.output.split('\n').map((line) => line.trim()).filter(Boolean);
}

/**
 * 回滚到 master 原状。untrackedBefore 是提交前快照的未跟踪文件集合：只删
 * 快照之后**新出现**的未跟踪文件——提交前已存在的别包证据/本地杂物不碰
 * （P1-6；旧实现无差别 `git clean -fd` 整个 evidence 目录会误删别包证据）。
 */
function abortBranch(branch: string, reason: string, untrackedBefore: ReadonlySet<string>): never {
  git(['reset', '--quiet']);   // 清暂存：add 过又没 commit 的文件不被 clean 扫到，还会被带到 master
  git(['checkout', '--', '.']);
  // 只删快照之后新出现的未跟踪文件（status 本身失败时跳过清理，不 masking 回滚原因）
  const status = git(['status', '--porcelain']);
  if (status.status === 0) {
    const fresh = [...untrackedFromPorcelain(status.output.split('\n').map((line) => line.trim()).filter(Boolean))]
      .filter((path) => !untrackedBefore.has(path));
    if (fresh.length) git(['clean', '-fdq', '--', ...fresh]);
  }
  git(['checkout', 'master']);
  git(['branch', '-D', branch]);
  throw new AcceptanceError(`提交已中止并回滚：${reason}`, undefined, 409);
}

/**
 * 提交前基线校验（P1-C）：先 `git fetch origin master`，再比对本地 HEAD 与
 * origin/master。落后（behind>0）或分叉（ahead>0 且 behind>0）一律拒绝——否则
 * 会拿一份旧树跑完五道卡点并开出一个基线已过期的 PR。fetch 本身失败（离线、
 * 远端不可达）同样 fail-loud，不许静默跳过（跳过了就等于没校验）。
 * 返回两边短哈希与计数，供单测复述。
 */
export function assertBaselineUpToDate(): {localSha: string; remoteSha: string; ahead: number; behind: number} {
  const fetched = git(['fetch', 'origin', 'master']);
  if (fetched.status !== 0) {
    throw new AcceptanceError(
      `git fetch origin master 失败，无法确认提交基线（离线或远端不可达）：${fetched.output.trim().split('\n').slice(-2).join(' ')}`,
      fetched.output,
      409,
    );
  }
  const local = git(['rev-parse', '--short', 'HEAD']);
  if (local.status !== 0) throw new AcceptanceError('git rev-parse HEAD 失败', local.output, 409);
  const remote = git(['rev-parse', '--short', 'origin/master']);
  if (remote.status !== 0) {
    throw new AcceptanceError('git rev-parse origin/master 失败（fetch 成功但读不到远端引用）', remote.output, 409);
  }
  const counts = git(['rev-list', '--left-right', '--count', 'HEAD...origin/master']);
  if (counts.status !== 0) throw new AcceptanceError('git rev-list --left-right --count 失败', counts.output, 409);
  const [ahead, behind] = counts.output.trim().split(/\s+/).map(Number);
  if (!Number.isFinite(ahead) || !Number.isFinite(behind)) {
    throw new AcceptanceError(`无法解析本地与 origin/master 的 commit 关系：${counts.output.trim()}`, counts.output, 409);
  }
  const localSha = local.output.trim();
  const remoteSha = remote.output.trim();
  if (behind > 0 || ahead > 0) {
    const relation = behind > 0 && ahead > 0 ? '已分叉' : behind > 0 ? '本地落后' : '本地领先';
    throw new AcceptanceError(
      `本地 master 与 origin/master 不一致${relation}（本地 ${localSha}，origin/master ${remoteSha}；ahead ${ahead} / behind ${behind}）：`
      + '请先与 origin/master 对齐再提交',
      {localSha, remoteSha, ahead, behind},
      409,
    );
  }
  return {localSha, remoteSha, ahead, behind};
}

/**
 * 完整提交流（设计稿 §5）：卡点 → 建分支 → 写 audit_log → 落证据 → 重渲视图 →
 * 复跑卡点 → commit → push → 开 PR。任何一步失败都回滚到 master 原状。
 * 合并永远由业主在 GitHub 上亲手点——本模块只到开 PR 为止。
 */
export function submitAcceptance(packageId: string): SubmitResult {
  // 提交分支安全（P1-6）：验收 PR 以 master 为 base——若当前在特性分支上，
  // commit 会把该分支的历史一起带进 PR。先拒再跑卡点（便宜且 fail-fast）。
  const baseBranch = currentBranch();
  if (!isAcceptanceBaseBranch(baseBranch)) {
    throw new AcceptanceError(
      `当前分支是 ${baseBranch} 不是 master：验收 PR 必须以 master 为基线，请先切回 master 再提交`,
      undefined,
      409,
    );
  }
  // 基线关系校验（P1-C）：本地 master 必须与 origin/master 一致。放在分支检查
  // 之后、跑卡点与建分支之前——落后/分叉时基于旧树开 PR 没有意义，且卡点再绿
  // 也不代表基线有效。
  assertBaselineUpToDate();
  const gates = runPreSubmitGates(packageId);
  if (!gates.ok) {
    throw new AcceptanceError('机械卡点未通过，未创建任何分支', gates.gates.filter((gate) => !gate.ok));
  }
  const state = loadScheduleState(repoRoot(), {modelPackageLinks: loadModelPackageLinks()});
  const snapshot = buildScheduleSnapshot(state);
  const pkg = snapshot.packages.find((item) => item.id === packageId);
  if (!pkg) throw new AcceptanceError(`包 ${packageId} 不在快照里`);
  const draft = loadDraft(packageId);

  // 工作树必须只有本流程要提交的东西（evidence 未跟踪文件 + 无已修改的跟踪文件）
  const lines = porcelainLines();
  const dirtyTracked = lines.filter((line) => !line.startsWith('??'));
  if (dirtyTracked.length) throw new AcceptanceError('工作树有未提交的跟踪文件修改，先处理再提交', dirtyTracked);
  // 未跟踪文件快照（P1-6）：abort 时只删快照之后新出现的
  const untrackedBefore = untrackedFromPorcelain(lines);

  const branch = acceptBranchName(packageId, new Date());
  const existingCounts = new Map<string, number>();
  for (const record of state.control.audit_log?.records ?? []) {
    const key = `${record.package_id}:${record.check_id}`;
    existingCounts.set(key, (existingCounts.get(key) ?? 0) + 1);
  }
  // 指纹必须用 control.yaml 原始包对象算——snapshot 投影视图的 checks/blockers
  // 形状不同，算出的指纹与 verify:schedule 的 staleAuditReason 对不上，提交即
  // 判 stale（冒烟实测：检查标准已变化）
  const rawPkg = (state.control.work_packages ?? []).find((item: {id: string}) => item.id === packageId)!;
  const records = projectAuditRecords(draft, snapshot, {
    checkSpecSha256: (checkId) => state.checkSpecHash(rawPkg, checkId),
    projectDataSha256: state.packageProjectFingerprint(rawPkg),
  }, existingCounts);

  const created = git(['checkout', '-b', branch]);
  if (created.status !== 0) throw new AcceptanceError('创建分支失败', created.output);
  try {
    // ① audit_log 文本手术（原子写）
    const controlAbsolute = join(repoRoot(), CONTROL_REL_PATH);
    const originalText = readFileSync(controlAbsolute, 'utf8');
    const nextText = appendAuditRecords(originalText, records);
    const temporary = `${controlAbsolute}.tmp-${process.pid}`;
    writeFileSync(temporary, nextText);
    renameSync(temporary, controlAbsolute);

    // ② 重渲视图（生成物与生成器一致是卡点的一部分）
    const render = runCommand(['scripts/schedule/control.ts', '--render']);
    if (render.status !== 0) abortBranch(branch, `schedule:render 失败：${render.output.split('\n').slice(-4).join('\n')}`, untrackedBefore);

    // ③ 带上新记录复跑 verify:schedule（双指纹/stale 判定在这里生效）
    const recheck = runCommand(['scripts/schedule/control.ts', '--check']);
    if (recheck.status !== 0) abortBranch(branch, `verify:schedule（含新记录）失败：${recheck.output.split('\n').slice(-6).join('\n')}`, untrackedBefore);

    // ④ commit（显式路径，不 git add -A——避免把 .zcode/ 等无关文件带进分支；
    // 证据只加**本包**目录，别包未提交的证据不被扫进这次 PR）
    const evidenceDirRel = `${EVIDENCE_REL_DIR}/${packageId}`;
    const evidenceFiles = existsSync(join(repoRoot(), evidenceDirRel))
      ? readdirSync(join(repoRoot(), evidenceDirRel), {recursive: true}) as string[]
      : [];
    if (!evidenceFiles.length) abortBranch(branch, '没有证据文件可提交（passed 记录必须有证据）', untrackedBefore);
    const add = git(['add', CONTROL_REL_PATH, evidenceDirRel, 'schedule/phase-1/budget.md', 'schedule/phase-1/cost.md', 'schedule/phase-1/schedule.md', 'schedule/phase-1/checklist.md', 'schedule/checklist.md', 'schedule/phase-2/checklist.md', 'schedule/phase-3/checklist.md']);
    if (add.status !== 0) abortBranch(branch, `git add 失败：${add.output}`, untrackedBefore);
    const message = `accept(${packageId}): 验收提交 ${records.length} 条（界面生成草稿，卡点通过）\n\n${renderPrBody(draft, pkg, branch).split('\n').slice(0, 20).join('\n')}`;
    const commit = git(['commit', '-m', message]);
    if (commit.status !== 0) abortBranch(branch, `git commit 失败：${commit.output}`, untrackedBefore);
    const push = git(['push', '-u', 'origin', branch]);
    if (push.status !== 0) abortBranch(branch, `git push 失败：${push.output}`, untrackedBefore);
    const prBody = renderPrBody(draft, pkg, branch);
    const pr = spawnSync('gh', ['pr', 'create', '--base', 'master', '--head', branch, '--title', `accept(${packageId}): 验收提交`, '--body', prBody], {cwd: repoRoot(), encoding: 'utf8', timeout: 120_000});
    if (pr.status !== 0) {
      // PR 没开成但分支已推：保留分支，把开 PR 的命令交回界面（不静默丢失工作）
      git(['checkout', 'master']);
      throw new AcceptanceError('分支已推送但 gh pr create 失败；请手动开 PR 或重试', pr.stderr || pr.stdout);
    }
    const sha = git(['rev-parse', '--short', 'HEAD']);
    git(['checkout', 'master']);
    // 草稿与暂存是 tmp/ 过程物：PR 已开，清掉防界面拿旧草稿重复提交（P1-4）
    clearStaging(packageId);
    return {
      branch,
      commit: sha.output.trim(),
      pr_url: pr.stdout.trim(),
      records,
      pr_body: prBody,
    };
  } catch (error) {
    if (error instanceof AcceptanceError && error.message.includes('已中止并回滚')) throw error;
    throw error;
  }
}

/** 清理暂存区与草稿（过程物）。 */
export function clearStaging(packageId: string): void {
  rmSync(join(repoRoot(), STAGING_DIR, packageId), {recursive: true, force: true});
  rmSync(draftPath(packageId), {force: true});
}

// ─── 启动清扫：暂存区按年龄清一次（issue #84，2026-11-04） ───────────────────
//
// clearStaging 只有一个触发点：submitAcceptance 成功开完 PR。提交中途失败或业主
// 放弃提交时，暂存文件会一直躺在 tmp/capture/acceptance-staging 下——tmp/ 整目录
// 被 .gitignore，业主不可见，无声堆积。这里在 server 启动时补一次按年龄的清扫。
//
// 口径（宁可不清）：只删**修改时间早于 7 天**的条目，等于阈值算年轻一律不碰——
// 失败提交的暂存可能还要用来重试，「失败分可重试与不可重试」的判定不做。目录只在
// 自身超龄且已空时才删：超龄目录里只要有年轻文件就整个留下（否则整树删除会带走
// 年轻文件）。整个函数不抛：读不到/删不掉只记日志，绝不阻断启动。

export const STAGING_SWEEP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface StagingSweepEntry {
  /** 相对暂存区根的路径（posix 风格，由调用方收集） */
  path: string;
  mtimeMs: number;
}

export interface StagingSweepPlan {
  keep: string[];
  remove: string[];
}

/** 纯：按年龄把暂存条目切成 keep/remove。年龄 = nowMs - mtimeMs，等于阈值算年轻。 */
export function planStagingSweep(entries: readonly StagingSweepEntry[], nowMs: number, maxAgeMs: number): StagingSweepPlan {
  const keep: string[] = [];
  const remove: string[] = [];
  for (const entry of entries) {
    // 严格超龄才删：等于阈值（正好 7 天）留。时钟回拨/拷贝保留会让 age 为负，同样留。
    if (nowMs - entry.mtimeMs > maxAgeMs) remove.push(entry.path);
    else keep.push(entry.path);
  }
  return {keep, remove};
}

export interface StagingSweepFailure {
  path: string;
  message: string;
}

export interface StagingSweepResult {
  /** 暂存区目录是否存在。不存在 = 跳过（不是错误） */
  existed: boolean;
  /** 扫到的条目数（含目录） */
  scanned: number;
  removed: number;
  kept: number;
  /** 自身超龄但因里面还有年轻条目而未删的目录数 */
  nonEmptyDirsKept: number;
  failures: StagingSweepFailure[];
}

export interface StagingSweepOptions {
  /** 仓库根，默认 repoRoot()（= process.cwd()）。测试注入临时目录用 */
  root?: string;
  /** 默认 Date.now()。测试造时钟用 */
  nowMs?: number;
  /** 默认 STAGING_SWEEP_MAX_AGE_MS */
  maxAgeMs?: number;
  /** 默认 console.log */
  log?: (line: string) => void;
}

/**
 * 递归收集暂存区全部条目（含子目录）的 mtime。根就是 STAGING_DIR：tmp/ 其他子目录不进清单。
 *
 * **符号链接安全（codex 复审 blocking）**：readdirSync({recursive:true}) + statSync 会跟随
 * 目录符号链接——暂存区内一个指向仓内证据目录的 link 会让清单包含 link/old.jpg，随后
 * 删除循环的 lstatSync 只查最终分量、认不出祖先是 link，rmSync 就会删掉暂存区外的真实
 * 证据。改为手写遍历：一律 lstatSync（不跟随），**符号链接条目直接跳过**（不进清单、
 * 不沿它读、更不沿它删），从根上守住「只碰 acceptance-staging」的删除边界。
 */
function collectStagingEntries(stagingDir: string): StagingSweepEntry[] {
  const out: StagingSweepEntry[] = [];
  const rootStat = lstatSync(stagingDir, {throwIfNoEntry: false});
  // 链接根整体放弃：根都是链接时，「只碰暂存区」无从保证
  if (!rootStat || rootStat.isSymbolicLink() || !rootStat.isDirectory()) return out;
  const walk = (absDir: string, relDir: string): void => {
    let names: string[];
    try {
      names = readdirSync(absDir);
    } catch {
      return; // 读不到的目录跳过（外层删除循环会记 failure 或根本看不到它）
    }
    for (const name of names) {
      const abs = join(absDir, name);
      const rel = relDir ? `${relDir}/${name}` : name;
      let entry;
      try {
        entry = lstatSync(abs); // lstat：不跟随符号链接
      } catch {
        continue;
      }
      if (entry.isSymbolicLink()) continue; // 链接跳过：不沿它读、不沿它删
      out.push({path: rel, mtimeMs: entry.mtimeMs});
      if (entry.isDirectory()) walk(abs, rel);
    }
  };
  walk(stagingDir, "");
  return out;
}

function depthOf(relPath: string): number {
  let depth = 1;
  for (const char of relPath) if (char === '/' || char === '\\') depth++;
  return depth;
}

/**
 * 启动清扫入口：对暂存区做一次按年龄的清理并打一行日志。只碰 acceptance-staging
 * 自己；暂存区目录不存在 → 跳过不报错；删除失败（权限等）→ 记日志继续，不中断启动。
 */
export function sweepAcceptanceStaging(options: StagingSweepOptions = {}): StagingSweepResult {
  const root = options.root ?? repoRoot();
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? STAGING_SWEEP_MAX_AGE_MS;
  const log = options.log ?? ((line: string) => console.log(line));
  const stagingDir = join(root, STAGING_DIR);
  const result: StagingSweepResult = {
    existed: existsSync(stagingDir), scanned: 0, removed: 0, kept: 0, nonEmptyDirsKept: 0, failures: [],
  };
  if (!result.existed) {
    log(`[server] 暂存区清扫：${STAGING_DIR} 不存在，跳过`);
    return result;
  }
  // 暂存根本身是符号链接：拒绝（collectStagingEntries 对链接根返回空，这里显式记一笔）
  const rootStat = lstatSync(stagingDir, {throwIfNoEntry: false});
  if (rootStat?.isSymbolicLink()) {
    log(`[server] 暂存区清扫：${STAGING_DIR} 是符号链接，拒绝清扫（只碰真实暂存目录）`);
    return result;
  }

  let entries: StagingSweepEntry[];
  try {
    entries = collectStagingEntries(stagingDir);
  } catch (err) {
    // 读不到（权限/竞态删除）时 fail-loud 到日志但不抛：启动不能被清扫挡住
    const message = err instanceof Error ? err.message : String(err);
    result.failures.push({path: STAGING_DIR, message});
    log(`[server] 暂存区清扫失败（不中断启动）：读 ${STAGING_DIR} 出错：${message}`);
    return result;
  }

  result.scanned = entries.length;
  const plan = planStagingSweep(entries, nowMs, maxAgeMs);
  // 先深后浅：子项删掉之后，空掉的超龄目录才能一起删（不留空壳 litter）
  const ordered = [...plan.remove].sort((a, b) => depthOf(b) - depthOf(a) || a.localeCompare(b));
  for (const rel of ordered) {
    const absolute = join(stagingDir, rel);
    try {
      const entry = lstatSync(absolute, {throwIfNoEntry: false});
      if (!entry) continue;
      if (entry.isDirectory() && readdirSync(absolute).length > 0) {
        // 超龄目录里还有年轻条目：不整树删，宁可留下这个目录
        result.nonEmptyDirsKept++;
        continue;
      }
      rmSync(absolute, {recursive: true, force: true});
      result.removed++;
    } catch (err) {
      result.failures.push({path: rel, message: err instanceof Error ? err.message : String(err)});
    }
  }

  // kept = 实际保留项总数：年轻条目 + 因含年轻文件而整树留下的超龄目录
  // （codex 复审 minor：早先只计年轻条目，日志会输出「留 1 项（其中 2 个超龄目录…）」自相矛盾）
  result.kept = plan.keep.length + result.nonEmptyDirsKept;
  const ageDays = Math.round(maxAgeMs / 86_400_000);
  log(
    `[server] 暂存区清扫：${STAGING_DIR} 扫到 ${result.scanned} 项，删 ${result.removed} 项（修改时间早于 ${ageDays} 天），`
    + `留 ${result.kept} 项${result.nonEmptyDirsKept ? `（其中 ${result.nonEmptyDirsKept} 个超龄目录因含年轻文件未删）` : ''}，`
    + `失败 ${result.failures.length} 项`,
  );
  for (const failure of result.failures) {
    log(`[server] 暂存区清扫：删除失败 ${failure.path}：${failure.message}`);
  }
  return result;
}
