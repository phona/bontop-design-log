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

import type { SchedulePackageView, ScheduleSnapshot } from './schedule-state.js';

/** 文本手术的形状不符（fail-loud，不猜）。 */
export class DraftTextError extends Error {}

export type DraftCheckStatus = 'passed' | 'failed' | 'not_applicable';

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

/**
 * 草稿校验（纯）。规则与 audit_log.record_schema 和决策门禁语义逐条对齐：
 *  - 包必须在快照里；check 必须属于该包；
 *  - checked_by / checked_at 必填，日期须真实；
 *  - passed 必须有证据；not_applicable 须写理由（note）；
 *  - 被 open 决策门禁阻塞的检查不得判 passed（阻塞期间付款门槛保持 pending）；
 *  - 同一 check 在草稿里只允许一条结果。
 */
export function validateDraft(draft: AcceptanceDraft, snapshot: ScheduleSnapshot): DraftValidation {
  const issues: DraftIssue[] = [];
  const pkg = snapshot.packages.find((item) => item.id === draft.package_id);
  if (!pkg) {
    return {ok: false, issues: [{check_id: '*', message: `包 ${draft.package_id} 不在当前快照里`}]};
  }
  // 空草稿不放行：一条结果都没有的 PR 没有内容，不开（机械卡点的一部分）
  if (!draft.results.length) {
    return {ok: false, issues: [{check_id: '*', message: '草稿为空：至少选择一项检查结果再提交'}]};
  }
  const seen = new Set<string>();
  for (const result of draft.results) {
    if (seen.has(result.check_id)) {
      issues.push({check_id: result.check_id, message: '同一检查在草稿里有多条结果，只允许一条'});
      continue;
    }
    seen.add(result.check_id);
    const check = pkg.checks.find((item) => item.id === result.check_id);
    if (!check) {
      issues.push({check_id: result.check_id, message: `检查 ${result.check_id} 不属于 ${draft.package_id}`});
      continue;
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
      // 已有当前通过的记录时不允许重复 passed（复验请用 supersedes 指旧记录）
      if (check.audit_status === 'passed') {
        issues.push({check_id: result.check_id, message: '该检查已有当前通过的记录；复验请用 supersedes 指向旧记录'});
      }
    }
    if (result.status === 'not_applicable' && !(result.note ?? '').trim()) {
      issues.push({check_id: result.check_id, field: 'note', message: 'not_applicable 必须写理由（note）'});
    }
    for (const evidencePath of result.evidence ?? []) {
      if (evidencePath.includes('..') || evidencePath.startsWith('/')) {
        issues.push({check_id: result.check_id, field: 'evidence', message: `证据路径必须是仓内规范相对路径（got ${evidencePath})`});
      }
    }
  }
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
      evidence: result.evidence,
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
    `- ${pkg.gate_label} \`${pkg.payment_gate}\`：当前 \`${pkg.gate_status}\`。合并后按机械卡点判定是否放行。`,
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
