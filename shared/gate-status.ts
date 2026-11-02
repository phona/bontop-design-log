// 付款门槛状态（gateStatus）的纯计算内核。
//
// 语义与 control.control.rules 第 5 条一致：「声明的付款门槛通过后才可释放对应付款」。
// 该门槛覆盖工作包的**全部**验收检查（critical + non-critical），任一未 passed
// 都不得判为 passed，任一 critical 未过即判 failed：
//   - failed  ：任一 critical 检查的审计结果为 failed。
//   - passed  ：该包**所有**检查的审计结果均为 passed。
//   - pending ：其余情况（含无 critical 检查、或有检查尚未 passed/failed）。
//
// 说明：无论工作包是否含 critical 检查，判据都是「全部检查 passed」。历史上
// 只判 critical 会导致两类失真——(1) 无 critical 的包永远 pending；(2) 含
// critical 的包即使 major/warning 未过也误判 passed。两者都会破坏付款门槛的
// 真实性，因此统一收窄为「全部通过」，宁可多 pending，不可错放款。
export type GateStatus = 'passed' | 'failed' | 'pending';

/** 参与门槛判定的检查项：只需 id 与 severity。 */
export interface GateCheck {
  id: string;
  severity?: string;
}

/**
 * @param checks     该工作包的全部检查（验收引用 + 内置检查，含 severity）。
 * @param auditStatus 由 (packageId, checkId) 取该检查最新审计状态；无记录返回 undefined。
 * @param packageId  工作包 id，用于拼装审计键。
 */
export function computeGateStatus(
  checks: GateCheck[],
  auditStatus: (packageId: string, checkId: string) => string | undefined,
  packageId: string,
): GateStatus {
  const critical = checks.filter((check) => check.severity === 'critical');
  if (critical.some((check) => auditStatus(packageId, check.id) === 'failed')) return 'failed';
  // 零检查不得判 passed：没有任何检查项就意味着没有任何东西被验证过，
  // 而此时 `[].every(...)` 会返回 true。付款门必须是「有证据的通过」，
  // 「无从判断」只能落在 pending——宁可多 pending，不可错放款。
  if (checks.length === 0) return 'pending';
  return checks.every((check) => auditStatus(packageId, check.id) === 'passed') ? 'passed' : 'pending';
}
