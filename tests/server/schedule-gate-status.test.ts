// 付款门槛状态 computeGateStatus 单测。
// 覆盖 control.control.rules 第 5 条「声明的付款门槛通过后才可释放对应付款」的核心判据：
// failed（任一 critical failed）、passed（**全部**检查 passed）、pending（其余，含无 critical 包）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeGateStatus, type GateCheck } from '../../scripts/schedule/gate-status.js';

type Status = string | undefined;

/** 由「checkId -> 状态」表构造 auditStatus 查询函数，便于逐用例声明。 */
function auditFrom(records: Record<string, Status>) {
  return (_packageId: string, checkId: string) => records[checkId];
}

const critical: GateCheck = { id: 'C', severity: 'critical' };
const major: GateCheck = { id: 'M', severity: 'major' };
const warning: GateCheck = { id: 'W', severity: 'warning' };

test('无 critical 检查的包：全部 passed → passed（历史 bug：本应永远 pending，现可正常放行付款门槛）', () => {
  const checks = [major, warning, { id: 'I', severity: 'info' }];
  const status = computeGateStatus(checks, auditFrom({ M: 'passed', W: 'passed', I: 'passed' }), 'PKG-130');
  assert.equal(status, 'passed');
});

test('无 critical 检查的包：存在未过检查 → pending', () => {
  const checks = [major, warning];
  const status = computeGateStatus(checks, auditFrom({ M: 'passed', W: 'pending' }), 'PKG-080');
  assert.equal(status, 'pending');
});

test('无 critical 检查的包：任一检查 failed（非 critical）→ pending 而非 passed', () => {
  const checks = [major, warning];
  // 非 critical failed 不触发 'failed'（该级别保留给 critical），但绝不能 'passed'。
  const status = computeGateStatus(checks, auditFrom({ M: 'failed', W: 'passed' }), 'PKG-135');
  assert.equal(status, 'pending');
});

test('有 critical 的包：critical 全过但 major 未过 → 仍 pending（防止误放款）', () => {
  const checks = [critical, major];
  const status = computeGateStatus(checks, auditFrom({ C: 'passed', M: 'pending' }), 'PKG-050');
  assert.equal(status, 'pending');
});

test('有 critical 的包：全部检查 passed → passed', () => {
  const checks = [critical, major, warning];
  const status = computeGateStatus(checks, auditFrom({ C: 'passed', M: 'passed', W: 'passed' }), 'PKG-060');
  assert.equal(status, 'passed');
});

test('有 critical 的包：任一 critical failed → failed（即使其它检查已 passed）', () => {
  const checks = [critical, major];
  const status = computeGateStatus(checks, auditFrom({ C: 'failed', M: 'passed' }), 'PKG-090');
  assert.equal(status, 'failed');
});

test('无任何审计记录：一律 pending（audit_log.records 为空时的真实表现）', () => {
  const checks = [critical, major];
  const status = computeGateStatus(checks, auditFrom({}), 'PKG-080');
  assert.equal(status, 'pending');
});

test('审计状态判定以 passed 为准：waived 不等于 passed', () => {
  // status_values 含 'waived'，但门槛要求显式 passed，waived 不得放行。
  const checks = [major];
  assert.equal(computeGateStatus(checks, auditFrom({ M: 'waived' }), 'PKG-135'), 'pending');
});

test('零检查的包不得判 passed（[].every() 会返回 true，是无证据放行的漏洞）', () => {
  // 付款门必须是「有证据的通过」。没有任何检查项 → 无从判断 → 只能 pending。
  assert.equal(computeGateStatus([], () => 'passed', 'PKG-X'), 'pending');
  assert.equal(computeGateStatus([], () => undefined, 'PKG-X'), 'pending');
});
