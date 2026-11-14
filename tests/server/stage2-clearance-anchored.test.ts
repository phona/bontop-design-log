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
 *
 * 注入方式（PR #229 复审后改）：沙箱声明一律按稳定对象 id 结构化查找、改字段，
 * 不做 YAML 文本精确匹配、不读当前 offset 数值——R6 合法改偏移后测试不受影响。
 * 注入值（offset.z=+0.10）为测试选定值，断言的是规则对注入状态的输出；
 * 对照只守“修复未给迁移项带来误报”，不钉绝对家具的历史通道数值。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { load as loadYaml, dump as dumpYaml } from 'js-yaml';

const repoRoot = process.cwd();
const tsxCli = join(repoRoot, 'node_modules/tsx/dist/cli.mjs');
const verifyRulesScript = join(repoRoot, 'scripts/verify/rules/verify-rules.ts');

type YamlDoc = Record<string, any>;

function makeSandbox(): string {
  const sandbox = mkdtempSync(join(tmpdir(), 'stage2-clearance-'));
  cpSync(join(repoRoot, 'config'), join(sandbox, 'config'), { recursive: true });
  return sandbox;
}

/** 沙箱 house.yaml：按稳定对象 id 找家具声明（结构化查找，不依赖 YAML 文本）。 */
function furnishingById(doc: YamlDoc, id: string): YamlDoc {
  const furnishings = (doc.furnishings ?? {}) as Record<string, unknown>;
  for (const items of Object.values(furnishings)) {
    if (!Array.isArray(items)) continue;
    const item = items.find((i) => (i as YamlDoc)?.id === id) as YamlDoc | undefined;
    if (item) return item;
  }
  throw new Error(`house.yaml 中找不到家具 ${id}`);
}

function loadHouseYaml(sandbox: string): { path: string; doc: YamlDoc } {
  const path = join(sandbox, 'config/house.yaml');
  return { path, doc: loadYaml(readFileSync(path, 'utf8')) as YamlDoc };
}

function saveHouseYaml(path: string, doc: unknown): void {
  writeFileSync(path, dumpYaml(doc));
}

/** 把沙发 anchor offset.z 设为测试选定值（与当前配置的 R6 偏移无关）。 */
function setSofaOffsetZ(sandbox: string, z: number): void {
  const { path, doc } = loadHouseYaml(sandbox);
  const sofa = furnishingById(doc, 'ld.sofa_3seat');
  assert.equal(sofa.anchor?.source, 'furniture', '沙发须为 anchor 形式');
  assert.equal(sofa.anchor?.id, 'ld.tv_65', '沙发须锚定电视基准');
  assert.ok(sofa.anchor?.offset, '沙发 anchor 须有 offset');
  sofa.anchor.offset.z = z;
  saveHouseYaml(path, doc);
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
      // 注入 offset.z=+0.10：沙发解算位 z = 电视 z + 0.10，南侧通道 0.30m，仍在房内。
      setSofaOffsetZ(sandbox, 0.10);
      const { output } = runVerifyRules(sandbox);
      assert.match(output, /\[clearance\] living_dining\/sofa_3seat: south侧通道 0\.30m \(<0\.5m\)/,
        'anchor 沙发南移后 clearance 必须按解算位置告警');
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('对照：真实配置的沙发通过 clearance（各侧通道均 ≥0.50m）', () => {
    const sandbox = makeSandbox();
    try {
      const { output } = runVerifyRules(sandbox);
      assert.doesNotMatch(output, /\[clearance\] living_dining\/sofa_3seat/,
        '真实配置的沙发不得误报 clearance');
      // 注意：此处不钉 bed_150 / wardrobe_180 等绝对家具的具体通道数值——
      // 那些是真实工程的历史坐标，规则对已知状态的输出由正例覆盖；
      // 本对照只守“修复未给迁移项带来误报”，缺失类断言只会在真实违规时才出现。
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('反例：沙发 anchor 宿主不存在时 clearance 报定位失败，不静默跳过', () => {
    const sandbox = makeSandbox();
    try {
      const { path, doc } = loadHouseYaml(sandbox);
      const sofa = furnishingById(doc, 'ld.sofa_3seat');
      sofa.anchor.id = 'ld.tv_65_missing';
      saveHouseYaml(path, doc);
      const { status, output } = runVerifyRules(sandbox);
      assert.notEqual(status, 0, '定位失败时 verify-rules 必须非零退出');
      assert.match(output, /\[clearance\] living_dining\/sofa_3seat \(ld\.sofa_3seat\): 定位解算失败/,
        '清单内家具解不出位置时 clearance 必须显形诊断，不得静默跳过');
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
