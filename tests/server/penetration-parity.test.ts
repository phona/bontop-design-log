// 并联期 parity 锁：verify:spatial 与 verify:penetration 对同一份场景的穿透族结论必须一致。
//
// 两个 CLI 共用 shared/penetration/scene.ts 的采集与 shared/penetration/rules.ts 的判定，
// 因此 parity 由构造成立；本测试是防线——任何一侧单独改采集/容差/规则都会在这里红。
//
// P4（拆除 verify:spatial 的穿透功能）后，本文件翻转为**一票否定**：
// verify:spatial 的报告不得再含任何穿透族 code。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

/** 穿透族 code 登记表：同时是「什么属于 penetration」的唯一清单。 */
const PENETRATION_CODES = new Set([
  'furniture_wall_collision',
  'furniture_clearance_insufficient',
  'furniture_endpoint_clearance_insufficient',
  'furniture_host_unknown',
  'furniture_host_runtime_missing',
  'furniture_glass_collision',
  'furniture_glass_clearance_insufficient',
  'furniture_ceiling_collision',
  'furniture_furniture_collision',
  'furniture_furniture_contact_tolerance',
  'glass_runtime_collision',
]);

const runCli = (script: string) => {
  const result = spawnSync('npx', ['tsx', script, '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as {
    report: { issues: Array<{ code: string; entity: string; level: string; message: string }> };
  };
};

const key = (issue: { code: string; entity: string; level: string; message: string }) => JSON.stringify([issue.code, issue.entity, issue.level, issue.message]);

describe('spatial / penetration parity', () => {
  it('produces identical penetration findings from both CLIs', () => {
    const spatial = runCli('scripts/verify/spatial/verify-spatial.ts');
    const penetration = runCli('scripts/verify/penetration/verify-penetration.ts');

    const fromSpatial = spatial.report.issues.filter((issue) => PENETRATION_CODES.has(issue.code)).map(key).sort();
    const fromPenetration = penetration.report.issues.map(key).sort();

    assert.deepEqual(fromSpatial, fromPenetration, 'penetration-family findings must match across both CLIs');
    assert.ok(fromPenetration.length > 0, 'parity is only meaningful while the house still yields findings');
  });
});
