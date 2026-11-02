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
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { buildScheduleSnapshot, loadScheduleState } from '../shared/schedule-state.js';
import {
  appendAuditRecords, projectAuditRecords, renderPrBody, validateDraft,
  type AcceptanceDraft, type AuditRecordProjection, type DraftValidation,
} from '../shared/acceptance-draft.js';
import { loadModelPackageLinks, MODEL_PACKAGE_LINKS_PATH } from './model-package-links.js';

const CONTROL_REL_PATH = 'schedule/phase-1/control.yaml';
const EVIDENCE_REL_DIR = 'schedule/phase-1/evidence';
const STAGING_DIR = 'tmp/capture/acceptance-staging';
const DRAFT_DIR = 'tmp/capture/acceptance-draft';

export class AcceptanceError extends Error {
  constructor(message: string, readonly detail?: unknown) {
    super(message);
  }
}

function repoRoot(): string {
  return process.cwd();
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
    if (parsed.package_id !== packageId) return {package_id: packageId, results: []};
    return {package_id: packageId, results: Array.isArray(parsed.results) ? parsed.results : []};
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

// ─── 证据暂存与落定 ─────────────────────────────────────────────────────────

export interface StagedEvidence {
  staging_path: string;
  sha256: string;
  size: number;
}

/** 上传落暂存区（tmp/，过程物不进 git）。dataBase64 由界面传来。 */
export function stageEvidence(packageId: string, checkId: string, filename: string, dataBase64: string): StagedEvidence {
  if (!/^[\w.\-]+$/.test(filename)) throw new AcceptanceError(`文件名只能含字母数字与 . _ -（got ${filename}）`);
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
  const normalized = resolve(repoRoot(), stagingPath);
  const stagingRoot = resolve(repoRoot(), STAGING_DIR);
  if (!normalized.startsWith(stagingRoot)) throw new AcceptanceError('staging_path 必须在暂存区内');
  if (!existsSync(normalized)) throw new AcceptanceError(`暂存文件不存在：${stagingPath}`);
  const finalDir = join(repoRoot(), EVIDENCE_REL_DIR, packageId, checkId);
  mkdirSync(finalDir, {recursive: true});
  const target = join(finalDir, normalized.split('/').pop()!);
  renameSync(normalized, target);
  return {final_path: join(EVIDENCE_REL_DIR, packageId, checkId, target.split('/').pop()!), sha256: sha256OfFile(target)};
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

/** 提交前机械卡点：草稿校验 + 证据在位 + 控制源校验 + 当前树 verify:schedule。 */
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

  const missing = draft.results.flatMap((result) => result.evidence)
    .filter((path) => !existsSync(join(repoRoot(), path)));
  gates.push({name: '证据文件在位', ok: missing.length === 0, detail: missing.length ? missing.join('\n') : '全部证据文件存在'});

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

function abortBranch(branch: string, reason: string): never {
  git(['checkout', '--', '.']);
  git(['clean', '-fd', '--', EVIDENCE_REL_DIR, 'schedule/']);
  git(['checkout', 'master']);
  git(['branch', '-D', branch]);
  throw new AcceptanceError(`提交已中止并回滚：${reason}`);
}

/**
 * 完整提交流（设计稿 §5）：卡点 → 建分支 → 写 audit_log → 落证据 → 重渲视图 →
 * 复跑卡点 → commit → push → 开 PR。任何一步失败都回滚到 master 原状。
 * 合并永远由业主在 GitHub 上亲手点——本模块只到开 PR 为止。
 */
export function submitAcceptance(packageId: string): SubmitResult {
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
  const status = git(['status', '--porcelain']);
  if (status.status !== 0) throw new AcceptanceError('git status 失败', status.output);
  const dirtyTracked = status.output.split('\n').filter((line) => line.trim() && !line.startsWith('??'));
  if (dirtyTracked.length) throw new AcceptanceError('工作树有未提交的跟踪文件修改，先处理再提交', dirtyTracked);

  const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const branch = `accept/${packageId}-${stamp}`;
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
    if (render.status !== 0) abortBranch(branch, `schedule:render 失败：${render.output.split('\n').slice(-4).join('\n')}`);

    // ③ 带上新记录复跑 verify:schedule（双指纹/stale 判定在这里生效）
    const recheck = runCommand(['scripts/schedule/control.ts', '--check']);
    if (recheck.status !== 0) abortBranch(branch, `verify:schedule（含新记录）失败：${recheck.output.split('\n').slice(-6).join('\n')}`);

    // ④ commit（显式路径，不 git add -A——避免把 .zcode/ 等无关文件带进分支）
    const evidenceFiles = readdirSync(join(repoRoot(), EVIDENCE_REL_DIR, packageId), {recursive: true}) as string[];
    const add = git(['add', CONTROL_REL_PATH, EVIDENCE_REL_DIR, 'schedule/phase-1/budget.md', 'schedule/phase-1/cost.md', 'schedule/phase-1/schedule.md', 'schedule/phase-1/checklist.md', 'schedule/checklist.md', 'schedule/phase-2/checklist.md', 'schedule/phase-3/checklist.md']);
    if (add.status !== 0) abortBranch(branch, `git add 失败：${add.output}`);
    if (!evidenceFiles.length) abortBranch(branch, '没有证据文件可提交（passed 记录必须有证据）');
    const message = `accept(${packageId}): 验收提交 ${records.length} 条（界面生成草稿，卡点通过）\n\n${renderPrBody(draft, pkg, branch).split('\n').slice(0, 20).join('\n')}`;
    const commit = git(['commit', '-m', message]);
    if (commit.status !== 0) abortBranch(branch, `git commit 失败：${commit.output}`);
    const push = git(['push', '-u', 'origin', branch]);
    if (push.status !== 0) abortBranch(branch, `git push 失败：${push.output}`);
    const prBody = renderPrBody(draft, pkg, branch);
    const pr = spawnSync('gh', ['pr', 'create', '--base', 'master', '--head', branch, '--title', `accept(${packageId}): 验收提交`, '--body', prBody], {cwd: repoRoot(), encoding: 'utf8', timeout: 120_000});
    if (pr.status !== 0) {
      // PR 没开成但分支已推：保留分支，把开 PR 的命令交回界面（不静默丢失工作）
      git(['checkout', 'master']);
      throw new AcceptanceError('分支已推送但 gh pr create 失败；请手动开 PR 或重试', pr.stderr || pr.stdout);
    }
    const sha = git(['rev-parse', '--short', 'HEAD']);
    git(['checkout', 'master']);
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
