// shared/acceptance-draft.ts 的回归测试（自装审批第二步，2026-11-02）。
// 守四件事：草稿校验规则与 audit_log.record_schema/决策门禁语义逐条对齐；
// audit_log 文本手术只认两种形状、其余 fail-loud；PR 正文四要素齐全；
// 记录 id 递进与指纹注入正确。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  appendAuditRecords, auditRecordId, projectAuditRecords, renderPrBody, validateDraft,
  type AcceptanceDraft, type AuditRecordProjection,
} from '../../shared/acceptance-draft.js';
import { buildScheduleSnapshot, loadScheduleState, type SchedulePackageView, type ScheduleSnapshot } from '../../shared/schedule-state.js';
import { loadModelPackageLinks } from '../../server/model-package-links.js';

const realSnapshot = (): ScheduleSnapshot =>
  buildScheduleSnapshot(loadScheduleState(process.cwd(), {modelPackageLinks: loadModelPackageLinks()}));

const pkg060 = (): SchedulePackageView => {
  const pkg = realSnapshot().packages.find((item) => item.id === 'PKG-060');
  assert.ok(pkg, 'PKG-060 必须在快照里');
  return pkg!;
};

const draft = (overrides: Partial<AcceptanceDraft> = {}): AcceptanceDraft => ({
  package_id: 'PKG-060',
  results: [{
    // check_tile_gap 无门禁阻塞；check_tile_hollow 被 D11 阻塞（见下方真实用例）
    check_id: 'check_tile_gap',
    status: 'passed',
    checked_by: '业主',
    checked_at: '2026-11-02',
    evidence: ['schedule/phase-1/evidence/PKG-060/check_tile_gap/a.jpg'],
  }],
  ...overrides,
});

describe('validateDraft', () => {
  it('合法草稿通过', () => {
    const result = validateDraft(draft(), realSnapshot());
    assert.equal(result.ok, true, JSON.stringify(result.issues));
  });

  it('passed 无证据 → 拦截', () => {
    const result = validateDraft(draft({results: [{...draft().results[0], evidence: []}]}), realSnapshot());
    assert.equal(result.ok, false);
    assert.match(result.issues[0].message, /passed 必须附最终证据/);
  });

  it('被 open 决策门禁阻塞的检查不得判 passed', () => {
    const snapshot = realSnapshot();
    const gated = snapshot.packages.flatMap((pkg) => pkg.checks).find((check) => (check.open_gates ?? []).length > 0);
    assert.ok(gated, '快照里必须存在被门禁阻塞的检查（7 条 open 门禁阻塞 13 项）');
    const result = validateDraft({
      package_id: snapshot.packages.find((pkg) => pkg.checks.some((check) => check.id === gated.id))!.id,
      results: [{check_id: gated.id, status: 'passed', checked_by: '业主', checked_at: '2026-11-02', evidence: ['e.jpg']}],
    }, snapshot);
    assert.equal(result.ok, false);
    assert.match(result.issues.find((issue) => issue.field === 'open_gates')?.message ?? '', /拍板前不得判 passed/);
  });

  it('真实数据：check_tile_hollow 被 D11 阻塞 → 不得判 passed', () => {
    const result = validateDraft(draft({results: [{...draft().results[0], check_id: 'check_tile_hollow'}]}), realSnapshot());
    assert.equal(result.ok, false);
    assert.match(result.issues.find((issue) => issue.field === 'open_gates')?.message ?? '', /D11/);
  });

  it('坏日期 / 缺检查人 / 检查不属于该包 / 重复结果 → 逐条拦截', () => {
    const snapshot = realSnapshot();
    const bad = draft({results: [
      {...draft().results[0], checked_at: '2026-02-30'},
      {...draft().results[0], check_id: 'check_tile_flatness', checked_by: ''},
    ]});
    const result = validateDraft(bad, snapshot);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => /真实日历日期/.test(issue.message)));
    assert.ok(result.issues.some((issue) => /checked_by/.test(issue.message)));

    const wrongPkg = validateDraft(draft({results: [{...draft().results[0], check_id: 'check_wp_flood'}]}), snapshot);
    assert.ok(wrongPkg.issues.some((issue) => /不属于/.test(issue.message)), 'check_wp_flood 属于 PKG-050 不属于 PKG-060');

    const dup = validateDraft(draft({results: [draft().results[0], {...draft().results[0], checked_by: '业主2'}]}), snapshot);
    assert.ok(dup.issues.some((issue) => /多条结果/.test(issue.message)));
  });

  it('空草稿不放行（一条结果都没有的 PR 没有内容）', () => {
    const result = validateDraft({package_id: 'PKG-060', results: []}, realSnapshot());
    assert.equal(result.ok, false);
    assert.match(result.issues[0].message, /草稿为空/);
  });

  it('not_applicable 必须写理由；路径越界拦截', () => {
    const snapshot = realSnapshot();
    const na = validateDraft(draft({results: [{...draft().results[0], status: 'not_applicable', evidence: []}]}), snapshot);
    assert.ok(na.issues.some((issue) => /必须写理由/.test(issue.message)));
    const escape = validateDraft(draft({results: [{...draft().results[0], evidence: ['../../etc/passwd']}]}), snapshot);
    assert.ok(escape.issues.some((issue) => /规范相对路径/.test(issue.message)));
  });
});

describe('appendAuditRecords（control.yaml 文本手术）', () => {
  const record: AuditRecordProjection = {
    id: 'AUD-PKG-060-check_tile_gap-001',
    package_id: 'PKG-060',
    check_id: 'check_tile_gap',
    status: 'passed',
    checked_at: '2026-11-02',
    checked_by: '业主',
    evidence: ['schedule/phase-1/evidence/PKG-060/check_tile_gap/a.jpg'],
    check_spec_sha256: 'a'.repeat(64),
    project_data_sha256: 'b'.repeat(64),
  };

  it('空 records: [] → 替换为列表（日期加引号）', () => {
    const text = 'audit_log:\n  status: empty\n  records: []\n';
    const out = appendAuditRecords(text, [record]);
    assert.ok(!out.includes('records: []'));
    assert.ok(out.includes('checked_at: \'2026-11-02\''), '日期必须加引号（否则 YAML 解析成 Date）');
    assert.ok(out.includes('    - id: AUD-PKG-060-check_tile_gap-001'));
    assert.ok(out.includes(`      evidence: ['schedule/phase-1/evidence/PKG-060/check_tile_gap/a.jpg']`));
  });

  it('已有条目且 audit_log 在文尾 → 追加', () => {
    const text = 'schema: x\nversion: 1\naudit_log:\n  records:\n    - id: AUD-OLD-001\n      package_id: PKG-000\n';
    const out = appendAuditRecords(text, [record]);
    assert.ok(out.includes('AUD-OLD-001'));
    assert.ok(out.trimEnd().endsWith(`      project_data_sha256: ${'b'.repeat(64)}`));
  });

  it('audit_log 不是最后段 → fail-loud 不猜', () => {
    const text = 'schema: x\naudit_log:\n  records:\n    - id: X\nother_section:\n  a: 1\n';
    assert.throws(() => appendAuditRecords(text, [record]), /拒绝文本手术/);
  });

  it('真实 control.yaml 当前形状可被手术（空 records）', () => {
    const controlText = readFileSync('schedule/phase-1/control.yaml', 'utf8');
    const out = appendAuditRecords(controlText, [record]);
    assert.ok(out.includes('AUD-PKG-060-check_tile_gap-001'));
    assert.ok(out.length > controlText.length);
  });
});

describe('projectAuditRecords / renderPrBody', () => {
  it('记录 id 递进、指纹注入、supersedes 保留', () => {
    const snapshot = realSnapshot();
    const counts = new Map([['PKG-060:check_tile_gap', 2]]);
    const records = projectAuditRecords(
      draft({results: [{...draft().results[0], supersedes: 'AUD-PKG-060-check_tile_gap-002'}]}),
      snapshot,
      {checkSpecSha256: () => 'c'.repeat(64), projectDataSha256: 'd'.repeat(64)},
      counts,
    );
    assert.equal(records[0].id, 'AUD-PKG-060-check_tile_gap-003');
    assert.equal(records[0].check_spec_sha256, 'c'.repeat(64));
    assert.equal(records[0].project_data_sha256, 'd'.repeat(64));
    assert.equal(records[0].supersedes, 'AUD-PKG-060-check_tile_gap-002');
    assert.equal(auditRecordId('PKG-060', 'check_tile_gap', 0), 'AUD-PKG-060-check_tile_gap-001');
  });

  it('PR 正文四要素：改了什么/没改什么/证据/放行哪个付款节点', () => {
    const pkg = pkg060();
    const body = renderPrBody(draft(), pkg, 'accept/PKG-060-20261102');
    assert.match(body, /本次改动的检查/);
    assert.match(body, /`check_tile_gap` → \*\*passed\*\*/);
    assert.match(body, /未改动的检查/);
    assert.ok(body.split('\n').length > 10);
    assert.match(body, new RegExp(pkg.payment_gate));
    assert.match(body, /schedule\/phase-1\/evidence\/PKG-060\/check_tile_gap\/a\.jpg/);
  });
});
