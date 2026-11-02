// shared/acceptance-draft.ts 的回归测试（自装审批第二步，2026-11-02）。
// 守：草稿校验规则与 audit_log.record_schema/决策门禁语义逐条对齐（含运行时
// 形状校验 422 不抛 500、passed 证据锚定本包本检查前缀、supersedes 复验放行）；
// audit_log 文本手术只认两种形状、其余 fail-loud；PR 正文四要素与付款节点显式
// 结论；记录 id 递进与指纹注入正确。

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

/** 真实快照 + 给 check_tile_gap 注入一条当前 passed 记录（复验/supersedes 用例）。 */
const snapshotWithCurrentRecord = (): ScheduleSnapshot => {
  const snapshot = realSnapshot();
  const check = snapshot.packages.find((item) => item.id === 'PKG-060')!.checks.find((item) => item.id === 'check_tile_gap')!;
  check.audit_status = 'passed';
  check.audit = {
    id: 'AUD-PKG-060-check_tile_gap-001',
    checked_by: '业主',
    checked_at: '2026-10-30',
    evidence: ['schedule/phase-1/evidence/PKG-060/check_tile_gap/old.jpg'],
  };
  return snapshot;
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

  it('P1-7 运行时形状校验：status/checked_by/evidence/supersedes 非法一律 issue，不抛 500', () => {
    const snapshot = realSnapshot();
    const base = {check_id: 'check_tile_gap', checked_by: '业主', checked_at: '2026-11-02', evidence: []};
    const badStatus = validateDraft({package_id: 'PKG-060', results: [{...base, status: 'bogus'}]} as never, snapshot);
    assert.equal(badStatus.ok, false);
    assert.ok(badStatus.issues.some((issue) => issue.field === 'status' && /passed \/ failed \/ not_applicable/.test(issue.message)));

    const badBy = validateDraft({package_id: 'PKG-060', results: [{...base, status: 'passed', checked_by: 123}]} as never, snapshot);
    assert.ok(badBy.issues.some((issue) => issue.field === 'checked_by' && /必须是字符串/.test(issue.message)));

    const badEvidence = validateDraft({package_id: 'PKG-060', results: [{...base, status: 'passed', evidence: 'x'}]} as never, snapshot);
    assert.ok(badEvidence.issues.some((issue) => issue.field === 'evidence' && /必须是字符串数组/.test(issue.message)));

    const badSupersedes = validateDraft({package_id: 'PKG-060', results: [{...base, status: 'passed', supersedes: 42}]} as never, snapshot);
    assert.ok(badSupersedes.issues.some((issue) => issue.field === 'supersedes' && /必须是字符串/.test(issue.message)));

    const badNote = validateDraft({package_id: 'PKG-060', results: [{...base, status: 'not_applicable', note: 7}]} as never, snapshot);
    assert.ok(badNote.issues.some((issue) => issue.field === 'note' && /必须是字符串/.test(issue.message)));

    const notArray = validateDraft({package_id: 'PKG-060', results: 'nope'} as never, snapshot);
    assert.ok(notArray.issues.some((issue) => issue.field === 'results' && /必须是数组/.test(issue.message)));

    const notObject = validateDraft({package_id: 'PKG-060', results: ['x', null]} as never, snapshot);
    assert.ok(notObject.issues.some((issue) => /必须是对象/.test(issue.message)));

    // 形状非法的条目不进入后续规则（123.trim() 之类不会炸出 500）
    const mixed = validateDraft({package_id: 'PKG-060', results: [
      {check_id: 'check_tile_gap', status: 'bogus', checked_by: 123, checked_at: 2026, evidence: 'x'},
      {...base, status: 'passed', evidence: ['schedule/phase-1/evidence/PKG-060/check_tile_gap/a.jpg']},
    ]} as never, snapshot);
    assert.equal(mixed.ok, false);
    assert.ok(mixed.issues.some((issue) => issue.field === 'status'));
  });

  it('P1-5 passed 证据必须锚定在本包本检查的规范前缀下', () => {
    const snapshot = realSnapshot();
    const prefix = 'schedule/phase-1/evidence/PKG-060/check_tile_gap/';
    // 仓内其他路径（非证据区）当证据 → 拦截
    const checklist = validateDraft(draft({results: [{...draft().results[0], evidence: ['schedule/phase-1/checklist.md']}]}), snapshot);
    assert.equal(checklist.ok, false);
    assert.ok(checklist.issues.some((issue) => issue.field === 'evidence' && /必须位于/.test(issue.message)));
    // 别包 / 别检查的前缀也不行
    const otherPkg = validateDraft(draft({results: [{...draft().results[0], evidence: ['schedule/phase-1/evidence/PKG-070/check_x/a.jpg']}]}), snapshot);
    assert.ok(otherPkg.issues.some((issue) => /必须位于/.test(issue.message)));
    const otherCheck = validateDraft(draft({results: [{...draft().results[0], evidence: ['schedule/phase-1/evidence/PKG-060/check_tile_flatness/a.jpg']}]}), snapshot);
    assert.ok(otherCheck.issues.some((issue) => /必须位于/.test(issue.message)));
    // 正确前缀（含 ./ 前缀与重复斜杠的等价形态）→ 通过
    const ok = validateDraft(draft({results: [{...draft().results[0], evidence: [`./${prefix}a.jpg`, `${prefix.replace('/check_tile_gap/', '//check_tile_gap/')}b.jpg`]}]}), snapshot);
    assert.equal(ok.ok, true, JSON.stringify(ok.issues));
    // failed 的证据不受该前缀约束（只拦 passed）
    const failed = validateDraft(draft({results: [{...draft().results[0], status: 'failed', evidence: ['schedule/phase-1/checklist.md']}]}), snapshot);
    assert.equal(failed.ok, true, JSON.stringify(failed.issues));
  });

  it('P1-1/P1-2 复验：合法 supersedes 指向当前记录 → passed 放行', () => {
    const result = validateDraft(
      draft({results: [{...draft().results[0], supersedes: 'AUD-PKG-060-check_tile_gap-001'}]}),
      snapshotWithCurrentRecord(),
    );
    assert.equal(result.ok, true, JSON.stringify(result.issues));
  });

  it('P1-1/P1-2 已有当前通过记录：不填/指错 supersedes 再判 passed → 拦截', () => {
    const snapshot = snapshotWithCurrentRecord();
    const missing = validateDraft(draft(), snapshot);
    assert.equal(missing.ok, false);
    assert.ok(missing.issues.some((issue) => issue.field === 'supersedes' && /已有当前通过的记录/.test(issue.message)));

    const wrongPkg = validateDraft(draft({results: [{...draft().results[0], supersedes: 'AUD-PKG-070-check_x-001'}]}), snapshot);
    assert.ok(wrongPkg.issues.some((issue) => /supersedes/.test(issue.message) && /当前记录 AUD-PKG-060-check_tile_gap-001/.test(issue.message)));

    // 空 supersedes 等同没填（不是「指了一个空 id」）
    const empty = validateDraft(draft({results: [{...draft().results[0], supersedes: ''}]}), snapshot);
    assert.equal(empty.ok, false);

    // pending 检查（无当前记录）填 supersedes → 必须指向当前记录
    const pending = validateDraft(draft({results: [{...draft().results[0], check_id: 'check_tile_flatness', supersedes: 'AUD-PKG-060-check_tile_gap-001'}]}), realSnapshot());
    assert.ok(pending.issues.some((issue) => issue.field === 'supersedes' && /supersedes 必须指向本包本检查的当前记录/.test(issue.message)));
  });

  it('P1-1/P1-2 stale 记录复验：supersedes 可指该记录，不强制填（仅 passed 强制）', () => {
    const snapshot = realSnapshot();
    const check = snapshot.packages.find((item) => item.id === 'PKG-060')!.checks.find((item) => item.id === 'check_tile_gap')!;
    check.audit_status = 'stale';
    check.stale_reasons = ['项目数据已变化'];
    check.audit = {id: 'AUD-PKG-060-check_tile_gap-001', checked_by: '业主', checked_at: '2026-10-30', evidence: []};
    const withSuper = validateDraft(draft({results: [{...draft().results[0], supersedes: 'AUD-PKG-060-check_tile_gap-001'}]}), snapshot);
    assert.equal(withSuper.ok, true, JSON.stringify(withSuper.issues));
    const without = validateDraft(draft(), snapshot);
    assert.equal(without.ok, true, JSON.stringify(without.issues));
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

  it('P1-8 付款节点显式结论：未全部通过写「不放行 N/M」，全部通过写放行 GATE', () => {
    const pkg = pkg060();
    // 部分通过：草稿只过 1/7 → 明确写「本次放行：无」
    const partial = renderPrBody(draft(), pkg, 'accept/PKG-060-20261102-101530');
    assert.match(partial, /\*\*本次放行：无（包未全部通过：1\/7）；付款只在合并后生效\*\*/);
    assert.doesNotMatch(partial, /本次放行：GATE-060-COMPLETE/);
    // 全部通过：草稿覆盖 PKG-060 每一条检查且全 passed → 写放行的付款节点
    const all = renderPrBody({
      package_id: 'PKG-060',
      results: pkg.checks.map((check) => ({
        check_id: check.id,
        status: 'passed',
        checked_by: '业主',
        checked_at: '2026-11-02',
        evidence: [`schedule/phase-1/evidence/PKG-060/${check.id}/a.jpg`],
      })),
    }, pkg, 'accept/PKG-060-20261102-101530');
    assert.match(all, /\*\*本次放行：GATE-060-COMPLETE（包已全部通过；合并后生效）\*\*/);
    // 当前门槛状态仍如实呈现（结论与现值两行并存）
    assert.match(all, new RegExp(`- 付款门槛 \`GATE-060-COMPLETE\`：当前 \`${pkg.gate_status}\``));
  });
});
