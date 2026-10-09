// 一票否定：verify:spatial 的报告不得再含任何穿透族 code。
//
// P4（拆除 verify:spatial 的穿透功能）后，本文件从「并联期 parity 锁」翻转为边界守门测试：
// 穿透/净距族结论只能由 verify:penetration 产出。若将来有人把互撞规则加回 verify:spatial，
// 这里立刻红——两个 linter 对同一件事各判一遍，是报告重复与口径漂移的开端。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { PENETRATION_LAYER_CODES } from '../../shared/penetration/registry.js';

/** 穿透族 code 全集：引用注册表的单一清单，不在此另抄一份。 */
const PENETRATION_CODES = new Set(PENETRATION_LAYER_CODES);

const runCli = (script: string) => {
  const result = spawnSync('npx', ['tsx', script, '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as {
    report: { counts: { errors: number; warnings: number }; issues: Array<{ code: string; entity: string }> };
  };
};

describe('spatial / penetration boundary', () => {
  it('emits no penetration-family code from verify:spatial', () => {
    const spatial = runCli('scripts/verify/spatial/verify-spatial.ts');
    const leaked = spatial.report.issues.filter((issue) => PENETRATION_CODES.has(issue.code));
    assert.deepEqual(leaked.map((issue) => `${issue.code} ${issue.entity}`), [], 'penetration rules must live only in verify:penetration');
  });

  it('keeps the penetration linter as the sole producer of penetration findings', () => {
    const penetration = runCli('scripts/verify/penetration/verify-penetration.ts');
    const produced = penetration.report.issues.filter((issue) => PENETRATION_CODES.has(issue.code));
    assert.ok(produced.length > 0, 'the house still yields penetration findings, so the linter is not silently vacuous');
    // 当前口径：0 error / 8 warning（玻璃净距不足），见 docs/penetration-lint.md。
    assert.equal(penetration.report.counts.errors, 0);
  });
});
