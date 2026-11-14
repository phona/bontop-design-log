/**
 * Issue #98 二阶段 Stage 2：clearance 通道校验消费共享解算结果。
 *
 * 缺陷（Codex major，PR #229）：`scripts/verify/rules/verify-rules.ts` 的 clearance
 * 循环直读家具声明 x/z、无声明即 `continue`；Stage 2 把 `ld.sofa_3seat` 改为
 * anchor 形式后，沙发静默退出 0.50m 通道检查。修复后 clearance 取
 * `buildPlacementIndexes` 的 mountHosts（与 3D/DXF/点位解算同源），解不出位置的
 * 清单内家具有 id 即报 error（fail-closed），不再静默跳过。
 *
 * 本文件端到端驱动真实的 verify-rules 脚本：在 config 沙箱里改沙发声明后跑
 * `tsx scripts/verify/rules/verify-rules.ts`，断言输出。沙箱只拷 config/（脚本
 * 与 ProjectCatalog 只读 config/ 下的文件），不碰工作树。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const repoRoot = process.cwd();
const tsxCli = join(repoRoot, 'node_modules/tsx/dist/cli.mjs');
const verifyRulesScript = join(repoRoot, 'scripts/verify/rules/verify-rules.ts');

// 沙发 anchor 声明（config/house.yaml），三处场景各改一处。
const SOFA_ANCHOR = 'anchor: { source: furniture, id: ld.tv_65, offset: { x: 3.58, z: -0.30 } }';

function makeSandbox(): string {
  const sandbox = mkdtempSync(join(tmpdir(), 'stage2-clearance-'));
  cpSync(join(repoRoot, 'config'), join(sandbox, 'config'), { recursive: true });
  return sandbox;
}

function replaceOnce(text: string, needle: string, replacement: string): string {
  const parts = text.split(needle);
  assert.equal(parts.length, 2, `沙箱 house.yaml 里应恰有一处待改：${needle}`);
  return parts.join(replacement);
}

/** 跑真实 verify-rules 脚本（cwd=沙箱），返回合并输出与退出码。 */
function runVerifyRules(sandbox: string): { status: number; output: string } {
  const r = spawnSync(process.execPath, [tsxCli, verifyRulesScript], {
    cwd: sandbox,
    encoding: 'utf8',
    timeout: 120000,
  });
  return { status: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('Stage 2：anchor 沙发仍受 clearance 通道校验', () => {
  it('正例：沙发南移致南侧通道 0.30m（<0.50m）时 clearance 告警', () => {
    const sandbox = makeSandbox();
    try {
      const housePath = join(sandbox, 'config/house.yaml');
      const text = readFileSync(housePath, 'utf8');
      // offset z −0.30 → +0.10：沙发中心 z 8.00→8.10，南侧通道 0.70→0.30m，仍在房内。
      writeFileSync(housePath, replaceOnce(text, SOFA_ANCHOR,
        'anchor: { source: furniture, id: ld.tv_65, offset: { x: 3.58, z: 0.10 } }'));
      const { output } = runVerifyRules(sandbox);
      assert.match(output, /\[clearance\] living_dining\/sofa_3seat: south侧通道 0\.30m \(<0\.5m\)/,
        'anchor 沙发南移后 clearance 必须按解算位置告警');
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('对照：真实配置的沙发通过 clearance（各侧通道均 ≥0.50m），其余清单项结果不变', () => {
    const sandbox = makeSandbox();
    try {
      const { output } = runVerifyRules(sandbox);
      assert.doesNotMatch(output, /\[clearance\] living_dining\/sofa_3seat/,
        '真实配置的沙发（南侧通道 0.70m）不得误报');
      // 基线两条 clearance 告警仍在：绝对家具结果与修复前一致。
      assert.match(output, /\[clearance\] bedroom_nw\/bed_150: north侧通道 0\.45m \(<0\.5m\)/);
      assert.match(output, /\[clearance\] bedroom_se\/wardrobe_180: east侧通道 0\.25m \(<0\.5m\)/);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('反例：沙发 anchor 宿主不存在时 clearance 报定位失败，不静默跳过', () => {
    const sandbox = makeSandbox();
    try {
      const housePath = join(sandbox, 'config/house.yaml');
      const text = readFileSync(housePath, 'utf8');
      writeFileSync(housePath, replaceOnce(text, SOFA_ANCHOR,
        'anchor: { source: furniture, id: ld.tv_65_missing, offset: { x: 3.58, z: -0.30 } }'));
      const { status, output } = runVerifyRules(sandbox);
      assert.notEqual(status, 0, '定位失败时 verify-rules 必须非零退出');
      assert.match(output, /\[clearance\] living_dining\/sofa_3seat \(ld\.sofa_3seat\): 定位解算失败/,
        '清单内家具解不出位置时 clearance 必须显形诊断，不得静默跳过');
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
