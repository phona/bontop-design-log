/**
 * 验收 PR 草稿（自装审批第二步，2026-11-02）。
 *
 * 设计稿 §5 闭环的「提交前」半边：界面收集验收结果 → 本模块做纯校验与投影 →
 * 服务端跑机械卡点、建分支、开 PR。**浏览器永不直接写仓库**：草稿是暂存数据
 * （tmp/），唯一进仓库的路径是「分支 + commit + PR，业主亲手合并」。
 *
 * 纯函数：不碰 fs、不碰 git。audit 记录的 check_spec_sha256 / project_data_sha256
 * 由调用方从 shared/schedule-state.ts 的 loader 状态注入（判定单一实现），
 * 本模块只负责组装与校验。
 */

import type { ScheduleCheckView, SchedulePackageView, ScheduleSnapshot } from './schedule-state.js';

/** 文本手术的形状不符（fail-loud，不猜）。 */
export class DraftTextError extends Error {}

export type DraftCheckStatus = 'passed' | 'failed' | 'not_applicable';

const DRAFT_STATUS_VALUES: readonly DraftCheckStatus[] = ['passed', 'failed', 'not_applicable'];

/**
 * 最终证据的仓内规范根目录（server store 的 EVIDENCE_REL_DIR 同源，单一出处）。
 * passed 的证据必须落在 `<根>/<package_id>/<check_id>/` 下——audit 记录引用它、
 * 随 PR 进 master，路径必须可机械核验，不许把别包/别检查甚至非证据文件
 * （checklist.md）写进审计记录。
 */
export const ACCEPTANCE_EVIDENCE_REL_DIR = 'schedule/phase-1/evidence';

export interface DraftCheckResult {
  check_id: string;
  status: DraftCheckStatus;
  /** 检查人（audit_log.record_schema 必填）。 */
  checked_by: string;
  /** YYYY-MM-DD 真实日历日期（record_schema 必填；与成本守卫同款严格校验）。 */
  checked_at: string;
  /** 最终证据的仓库相对路径（passed 时至少一条）。 */
  evidence: string[];
  /** 复验时指向被替换的旧记录 id。 */
  supersedes?: string;
  note?: string;
}

export interface AcceptanceDraft {
  package_id: string;
  results: DraftCheckResult[];
}

export interface DraftIssue {
  check_id: string;
  field?: string;
  message: string;
}

export interface DraftValidation {
  ok: boolean;
  issues: DraftIssue[];
}

function isValidCalendarDateText(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * posix 风格规范化（折叠重复斜杠、去前缀 ./）：仓库路径统一 posix；shared 被
 * 浏览器侧 import 类型，不引 node:path。`..`/绝对路径已在调用处先行拦掉。
 */
function normalizeRepoRelativePath(text: string): string {
  return text.replaceAll('\\', '/').replace(/\/{2,}/g, '/').replace(/^\.\//, '');
}

/**
 * 运行时形状校验（P1-7）：TS 类型在运行时不存在——草稿经 HTTP JSON 进来，
 * results 可能不是数组、status 可能是任意字符串、checked_by 可能是数字。
 * 非法形状一律记 issue（路由转 422），**不许抛 500**——那会把「用户填错」
 * 伪装成「服务端故障」。返回的 broken 是形状非法的结果下标：这些条目不进入
 * 后续假设形状合法的规则（否则 123.trim() 之类直接炸）。
 */
function draftShapeIssues(draft: AcceptanceDraft): {issues: DraftIssue[]; broken: Set<number>} {
  const issues: DraftIssue[] = [];
  const broken = new Set<number>();
  if (!isPlainObject(draft)) {
    issues.push({check_id: '*', message: '草稿必须是对象 {package_id, results}'});
    return {issues, broken};
  }
  if (typeof draft.package_id !== 'string' || !draft.package_id.trim()) {
    issues.push({check_id: '*', field: 'package_id', message: 'package_id 必须是非空字符串'});
  }
  if (!Array.isArray(draft.results)) {
    issues.push({check_id: '*', field: 'results', message: 'results 必须是数组'});
    return {issues, broken};
  }
  draft.results.forEach((result: unknown, index: number) => {
    const at = `results[${index}]`;
    if (!isPlainObject(result)) {
      issues.push({check_id: '*', message: `${at} 必须是对象`});
      broken.add(index);
      return;
    }
    const checkId = typeof result.check_id === 'string' && result.check_id ? result.check_id : '*';
    let itemBroken = false;
    const mark = () => {itemBroken = true;};
    if (typeof result.check_id !== 'string' || !result.check_id) {
      issues.push({check_id: '*', field: 'check_id', message: `${at}.check_id 必须是非空字符串`});
      mark();
    }
    if (!DRAFT_STATUS_VALUES.includes(result.status as DraftCheckStatus)) {
      issues.push({check_id: checkId, field: 'status', message: `status 必须是 passed / failed / not_applicable（got ${JSON.stringify(result.status)}）`});
      mark();
    }
    if (typeof result.checked_by !== 'string') {
      issues.push({check_id: checkId, field: 'checked_by', message: 'checked_by 必须是字符串'});
      mark();
    }
    if (typeof result.checked_at !== 'string') {
      issues.push({check_id: checkId, field: 'checked_at', message: 'checked_at 必须是字符串'});
      mark();
    }
    if (result.evidence !== undefined && (!Array.isArray(result.evidence) || result.evidence.some((item: unknown) => typeof item !== 'string'))) {
      issues.push({check_id: checkId, field: 'evidence', message: 'evidence 必须是字符串数组'});
      mark();
    }
    if (result.supersedes !== undefined && typeof result.supersedes !== 'string') {
      issues.push({check_id: checkId, field: 'supersedes', message: 'supersedes 必须是字符串'});
      mark();
    }
    if (result.note !== undefined && typeof result.note !== 'string') {
      issues.push({check_id: checkId, field: 'note', message: 'note 必须是字符串'});
      mark();
    }
    if (itemBroken) broken.add(index);
  });
  return {issues, broken};
}

/**
 * 草稿校验（纯）。规则与 audit_log.record_schema 和决策门禁语义逐条对齐：
 *  - 形状（results 数组/status 枚举/字符串字段/evidence 字符串数组）——运行时校验，422 不抛 500；
 *  - 包必须在快照里；check 必须属于该包；
 *  - checked_by / checked_at 必填，日期须真实；
 *  - passed 必须有证据，且证据锚定在本包本检查的规范前缀下；
 *  - not_applicable 须写理由（note）；
 *  - 被 open 决策门禁阻塞的检查不得判 passed（阻塞期间付款门槛保持 pending）；
 *  - 已有当前通过记录的检查再判 passed 必须填合法 supersedes（复验放行）；
 *  - supersedes 若填必须等于本包本检查的当前记录 id；
 *  - 同一 check 在草稿里只允许一条结果。
 */
export function validateDraft(draft: AcceptanceDraft, snapshot: ScheduleSnapshot): DraftValidation {
  const shape = draftShapeIssues(draft);
  const issues: DraftIssue[] = [...shape.issues];
  // 形状坏到无法继续（草稿不是对象 / results 不是数组）：后续规则全部假设形状合法
  if (!isPlainObject(draft) || !Array.isArray(draft.results)) {
    return {ok: false, issues};
  }
  const pkg = snapshot.packages.find((item) => item.id === draft.package_id);
  if (!pkg) {
    return {ok: false, issues: [...issues, {check_id: '*', message: `包 ${draft.package_id} 不在当前快照里`}]};
  }
  // 空草稿不放行：一条结果都没有的 PR 没有内容，不开（机械卡点的一部分）
  if (!draft.results.length) {
    return {ok: false, issues: [...issues, {check_id: '*', message: '草稿为空：至少选择一项检查结果再提交'}]};
  }
  const seen = new Set<string>();
  draft.results.forEach((result: DraftCheckResult, index: number) => {
    if (shape.broken.has(index)) return;
    if (seen.has(result.check_id)) {
      issues.push({check_id: result.check_id, message: '同一检查在草稿里有多条结果，只允许一条'});
      return;
    }
    seen.add(result.check_id);
    const check = pkg.checks.find((item) => item.id === result.check_id);
    if (!check) {
      issues.push({check_id: result.check_id, message: `检查 ${result.check_id} 不属于 ${draft.package_id}`});
      return;
    }
    if (!result.checked_by || !result.checked_by.trim()) {
      issues.push({check_id: result.check_id, field: 'checked_by', message: '缺少检查人（checked_by 必填）'});
    }
    if (!isValidCalendarDateText(result.checked_at ?? '')) {
      issues.push({check_id: result.check_id, field: 'checked_at', message: `checked_at 必须是真实日历日期 YYYY-MM-DD（got ${result.checked_at}）`});
    }
    if (result.status === 'passed') {
      if (!result.evidence?.length) {
        issues.push({check_id: result.check_id, field: 'evidence', message: 'passed 必须附最终证据（evidence 至少一条）'});
      }
      // 决策门禁语义：open 门禁阻塞期间不得判 passed（与 computeGateStatus 同向）
      if ((check.open_gates ?? []).length) {
        issues.push({
          check_id: result.check_id,
          field: 'open_gates',
          message: `被未拍板决策门禁阻塞（${(check.open_gates ?? []).join('、')}）：拍板前不得判 passed，付款门槛保持 pending`,
        });
      }
      // 复验放行（P1-1/P1-2）：已有当前通过记录的检查再判 passed，必须用
      // supersedes 指向该记录（record_schema：复验追加记录并用 supersedes 指
      // 旧记录，禁止覆盖历史）。不填或指错一律拦——曾无条件拦 passed，界面
      // 的 supersedes 输入框是死路。
      if (check.audit_status === 'passed' && result.supersedes !== check.audit?.id) {
        issues.push({
          check_id: result.check_id,
          field: 'supersedes',
          message: `该检查已有当前通过的记录；复验请用 supersedes 指向旧记录（当前记录 ${check.audit?.id ?? '不存在'}）`,
        });
      }
    }
    if (result.status === 'not_applicable' && !(result.note ?? '').trim()) {
      issues.push({check_id: result.check_id, field: 'note', message: 'not_applicable 必须写理由（note）'});
    }
    // supersedes 指向性（任何状态）：必须等于本包本检查的当前记录 id，不许指到
    // 别包/别检查/不存在的记录（loader 也会查 referential integrity，这里先拦）
    if (result.supersedes && result.supersedes !== check.audit?.id && check.audit_status !== 'passed') {
      issues.push({
        check_id: result.check_id,
        field: 'supersedes',
        message: `supersedes 必须指向本包本检查的当前记录（当前记录 ${check.audit?.id ?? '不存在'}，got ${result.supersedes}）`,
      });
    }
    // 证据锚定（P1-5）：passed 的证据只能来自本包本检查的规范前缀——`..`/绝对
    // 路径先拦，再验前缀；failed/not_applicable 的证据不强制同前缀。
    const evidencePrefix = `${ACCEPTANCE_EVIDENCE_REL_DIR}/${draft.package_id}/${result.check_id}/`;
    for (const evidencePath of result.evidence ?? []) {
      if (evidencePath.includes('..') || evidencePath.startsWith('/')) {
        issues.push({check_id: result.check_id, field: 'evidence', message: `证据路径必须是仓内规范相对路径（got ${evidencePath})`});
        continue;
      }
      if (result.status === 'passed' && !normalizeRepoRelativePath(evidencePath).startsWith(evidencePrefix)) {
        issues.push({check_id: result.check_id, field: 'evidence', message: `passed 证据必须位于 ${evidencePrefix} 下（got ${evidencePath}）`});
      }
    }
  });
  return {ok: issues.length === 0, issues};
}

export interface AuditRecordProjection {
  id: string;
  package_id: string;
  check_id: string;
  status: DraftCheckStatus;
  checked_at: string;
  checked_by: string;
  evidence: string[];
  check_spec_sha256: string;
  project_data_sha256: string;
  supersedes?: string;
}

/** 生成审计记录 id：AUD-<pkg>-<check>-<nnn>，nnn 按该 (pkg, check) 现有记录数递进。 */
export function auditRecordId(packageId: string, checkId: string, existingCount: number): string {
  return `AUD-${packageId}-${checkId}-${String(existingCount + 1).padStart(3, '0')}`;
}

/**
 * 把草稿投影成 audit_log 记录。指纹由调用方注入（loader 单一实现），本模块
 * 只组装——两条指纹与 control.ts 的 staleAuditReason 同源。
 */
export function projectAuditRecords(
  draft: AcceptanceDraft,
  snapshot: ScheduleSnapshot,
  fingerprints: {checkSpecSha256: (checkId: string) => string; projectDataSha256: string},
  existingCounts: Map<string, number>,
): AuditRecordProjection[] {
  return draft.results.map((result) => {
    const key = `${draft.package_id}:${result.check_id}`;
    const record: AuditRecordProjection = {
      id: auditRecordId(draft.package_id, result.check_id, existingCounts.get(key) ?? 0),
      package_id: draft.package_id,
      check_id: result.check_id,
      status: result.status,
      checked_at: result.checked_at,
      checked_by: result.checked_by,
      // evidence 缺省空数组：record_schema 要求该字段必填，YAML 手术不接受 undefined
      evidence: result.evidence ?? [],
      check_spec_sha256: fingerprints.checkSpecSha256(result.check_id),
      project_data_sha256: fingerprints.projectDataSha256,
    };
    if (result.supersedes) record.supersedes = result.supersedes;
    return record;
  });
}

// ─── audit_log 文本手术 ─────────────────────────────────────────────────────

function yamlScalar(value: string): string {
  // checked_at 等日期必须加引号（YAML 会解析成 Date）；含 # 的值一律加引号（AGENTS.md 铁律）
  if (/^[\w.\-]+$/.test(value) && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return `'${value.replaceAll("'", "''")}'`;
}

function renderRecordYaml(record: AuditRecordProjection): string {
  const lines = [
    `    - id: ${yamlScalar(record.id)}`,
    `      package_id: ${yamlScalar(record.package_id)}`,
    `      check_id: ${yamlScalar(record.check_id)}`,
    `      status: ${record.status}`,
    `      checked_at: ${yamlScalar(record.checked_at)}`,
    `      checked_by: ${yamlScalar(record.checked_by)}`,
    `      evidence: [${record.evidence.map((path) => yamlScalar(path)).join(', ')}]`,
    `      check_spec_sha256: ${record.check_spec_sha256}`,
    `      project_data_sha256: ${record.project_data_sha256}`,
  ];
  if (record.supersedes) lines.push(`      supersedes: ${yamlScalar(record.supersedes)}`);
  return lines.join('\n');
}

/**
 * 把新记录追加进 control.yaml 的 audit_log.records。只支持两种形状：
 *  ① `  records: []`（空，锚点唯一）→ 替换为列表；
 *  ② records 已有条目且 audit_log 是文件最后一个顶层段 → 在文件尾部追加
 *     （4 空格缩进的列表项）。其他形状 fail-loud，不猜。
 */
export function appendAuditRecords(controlText: string, records: AuditRecordProjection[]): string {
  if (!records.length) return controlText;
  const emptyAnchor = '\n  records: []\n';
  if (controlText.includes(emptyAnchor)) {
    return controlText.replace(emptyAnchor, `\n  records:\n${records.map(renderRecordYaml).join('\n')}\n`);
  }
  const auditLogIndex = controlText.lastIndexOf('\naudit_log:');
  if (auditLogIndex === -1) throw new DraftTextError('control.yaml 找不到 audit_log 段');
  const afterAuditLog = controlText.slice(auditLogIndex);
  if (/^[a-z_]+:/m.test(afterAuditLog.replace('\naudit_log:', ''))) {
    throw new DraftTextError('audit_log 不是最后一个顶层段，拒绝文本手术（形状不符，fail-loud）');
  }
  if (!/\n  records:\n/.test(afterAuditLog)) throw new DraftTextError('audit_log 里找不到 records: 列表');
  const trimmed = controlText.replace(/\s*$/, '');
  return `${trimmed}\n${records.map(renderRecordYaml).join('\n')}\n`;
}

/** PR 正文（设计稿 §5.4）：改了哪些检查、没改哪些、证据是什么、放行哪个付款节点。 */
export function renderPrBody(draft: AcceptanceDraft, pkg: SchedulePackageView, branch: string): string {
  const touched = draft.results.map((result) => `- \`${result.check_id}\` → **${result.status}**（${result.checked_by} / ${result.checked_at}）证据：${result.evidence.join('、') || '—'}${result.supersedes ? `，supersedes ${result.supersedes}` : ''}`);
  const untouched = pkg.checks
    .filter((check) => !draft.results.some((result) => result.check_id === check.id))
    .map((check) => `- \`${check.id}\`（${check.audit_status ?? 'pending'}）`);
  // 付款节点结论（P1-8）：显式回答「本次合并放行哪个付款节点」——按草稿结果推算
  // 提交后本包是否全部通过，不拿「当前 gate_status + 合并后按卡点判定」糊弄。
  // 付款永远只在合并后生效，这里只给结论，不放行任何支付。
  // 以草稿结果为准（P1-B）：草稿里有该检查的结果就看草稿 status——此前已
  // passed、本次改判 failed / not_applicable 时不得再计入 passedCount（旧实现
  // 是 `audit_status === 'passed' || 草稿 passed` 的纯加法，会把退化的包写成
  // 「本次放行：GATE-xxx，包已全部通过」）。草稿没碰这项才回退看 audit_status。
  const passedAfterSubmit = (check: ScheduleCheckView) => {
    const result = draft.results.find((item) => item.check_id === check.id);
    return result ? result.status === 'passed' : check.audit_status === 'passed';
  };
  const passedCount = pkg.checks.filter(passedAfterSubmit).length;
  const releaseLine = passedCount === pkg.checks.length
    ? `- **本次放行：${pkg.payment_gate}（包已全部通过；合并后生效）**`
    : `- **本次放行：无（包未全部通过：${passedCount}/${pkg.checks.length}）；付款只在合并后生效**`;
  return [
    `## 验收提交：${pkg.id}｜${pkg.name}`,
    '',
    `分支 \`${branch}\`。本 PR 由审批界面生成草稿后经机械卡点提交；合并仍由业主亲手点。`,
    '',
    '### 本次改动的检查',
    ...(touched.length ? touched : ['- （无）']),
    '',
    '### 未改动的检查',
    ...(untouched.length ? untouched : ['- （无）']),
    '',
    '### 付款节点',
    `- ${pkg.gate_label} \`${pkg.payment_gate}\`：当前 \`${pkg.gate_status}\`。`,
    releaseLine,
    '',
    '### 机械卡点',
    '- [ ] `npm run verify:schedule` 通过（含新记录的双指纹校验）',
    '- [ ] CI 四任务无基线外新失败',
    '- [ ] 决策门禁未被本次提交绕过（open 门禁阻塞的检查无 passed 记录）',
    '',
    '### 证据',
    ...draft.results.flatMap((result) => result.evidence.map((path) => `- \`${path}\``)),
  ].join('\n');
}
