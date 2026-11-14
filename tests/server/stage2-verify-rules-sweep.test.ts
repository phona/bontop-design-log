/**
 * Issue #98 二阶段 Stage 2：verify-rules 全文件扫——直读声明 x/z 的静默跳过一并收口。
 *
 * 打地鼠根因（PR #229 前三轮）：同一模式——读家具声明 x/z、无值即 `continue`——
 * 散落在 `scripts/verify/rules/verify-rules.ts` 的多个消费方里，clearance 修一处、
 * Codex 下一轮又在 furnitureItems（bounds/existence）找到下一处。本轮一次扫清：
 * 家具位置一律取 `buildPlacementIndexes` 的 mountHosts（与 3D/DXF/点位解算同源），
 * 有 id 解不出即报 error（fail-closed）；无 id 的 count-only/type-only 沿用跳过。
 * “解算失败已在上面报 error”两处注释（bounds/proximity 的 a 侧）各有守卫测试证明
 * 其为真；吊顶 b 侧匹配上却无位置的改为 fail-closed。
 *
 * 本文件端到端驱动真实的 verify-rules 脚本：在 config 沙箱里改声明后跑
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

// 沙发 anchor 声明（config/house.yaml）。
const SOFA_ANCHOR = 'anchor: { source: furniture, id: ld.tv_65, offset: { x: 3.58, z: -0.30 } }';
// 电视低柜绝对声明（config/house.yaml）。
const TV_LOW = '{ type: tv_wall_low, id: ld.tv_wall_low, x: 7.48, z: 8.00, rotation: 270 }';
// 电视插座声明块（config/electrical.yaml），沿墙 2.15。
const SOCK_TV_BLOCK = `- id: sock_living_tv
  # S1-B 状态申报（issue #98）：依据 DEC-2026-08-02-013（电视柜正后方 z=7.0 设计位）
  status: inferred
  room: living_dining
  wall: w_st_east
  wall_side: east
  along: 2.15`;
// 主卧内机声明块（config/model/envelope/ceiling.yaml）。
const AC_MASTER_BLOCK = `- id: ac_master
  room: master_bedroom
  type: ac_indoor
  x: 3.70
  z: 5.10`;

function makeSandbox(): string {
  const sandbox = mkdtempSync(join(tmpdir(), 'stage2-rules-sweep-'));
  cpSync(join(repoRoot, 'config'), join(sandbox, 'config'), { recursive: true });
  return sandbox;
}

function replaceOnce(text: string, needle: string, replacement: string): string {
  const parts = text.split(needle);
  assert.equal(parts.length, 2, `沙箱文件里应恰有一处待改：${needle.slice(0, 60)}…`);
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

describe('Stage 2：verify-rules 直读 x/z 的静默跳过一次收口', () => {
  it('bounds 正例：anchor 沙发移出房间时 bounds 告警（中心 z 10.0 > 房界 9.85）', () => {
    const sandbox = makeSandbox();
    try {
      const housePath = join(sandbox, 'config/house.yaml');
      const text = readFileSync(housePath, 'utf8');
      // offset z −0.30 → +2.00：沙发中心 z 8.00→10.00，客餐厅北界…南界 9.80+0.05 容差。
      writeFileSync(housePath, replaceOnce(text, SOFA_ANCHOR,
        'anchor: { source: furniture, id: ld.tv_65, offset: { x: 3.58, z: 2.00 } }'));
      const { status, output } = runVerifyRules(sandbox);
      assert.notEqual(status, 0, '沙发越界时 verify-rules 必须非零退出');
      assert.match(output, /\[bounds\] furniture\/living_dining\/sofa_3seat: \(11,10\) 超出 living_dining 范围/,
        'anchor 沙发移出房间后 bounds 必须按解算位置告警');
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('existence 正例：anchor 家具落入不存在的房间时 existence 告警', () => {
    const sandbox = makeSandbox();
    try {
      const housePath = join(sandbox, 'config/house.yaml');
      const text = readFileSync(housePath, 'utf8');
      // 在 furnishings 末尾追加一个不存在的房间，放一件 anchor 沙发副本。
      writeFileSync(housePath, replaceOnce(text, '  south_balcony: []',
        `  south_balcony: []
  no_such_room:
    - { type: sofa_3seat, id: ld.sofa_test, anchor: { source: furniture, id: ld.tv_65, offset: { x: 3.58, z: -0.30 } }, rotation: 270 }`));
      const { status, output } = runVerifyRules(sandbox);
      assert.notEqual(status, 0, '家具有不存在的房间时 verify-rules 必须非零退出');
      assert.match(output, /\[existence\] furniture\/no_such_room\/sofa_3seat: room "no_such_room" 不在 model-geometry 中/,
        'anchor 家具落入不存在的房间后 existence 必须告警');
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('proximity b 侧正例：anchor 电视柜远离插座时邻近告警', () => {
    const sandbox = makeSandbox();
    try {
      const housePath = join(sandbox, 'config/house.yaml');
      const text = readFileSync(housePath, 'utf8');
      // 电视柜改 anchor（相对电视 +0.06,+1.60）：解算位 (7.48,9.60)，距电视插座约 1.91m（>1.5m），仍在房内。
      writeFileSync(housePath, replaceOnce(text, TV_LOW,
        '{ type: tv_wall_low, id: ld.tv_wall_low, anchor: { source: furniture, id: ld.tv_65, offset: { x: 0.06, z: 1.60 } }, rotation: 270 }'));
      const { output } = runVerifyRules(sandbox);
      assert.match(output, /\[proximity\] tv_socket_to_stand: sock_living_tv ↔ living_dining\/tv_wall_low 距离 1\.92m \(>1\.5m\)/,
        'anchor 电视柜远离插座后 proximity b 侧必须按解算位置告警');
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('反例：anchor 家具宿主不存在时 [furniture] 定位失败显形，不静默跳过', () => {
    const sandbox = makeSandbox();
    try {
      const housePath = join(sandbox, 'config/house.yaml');
      const text = readFileSync(housePath, 'utf8');
      writeFileSync(housePath, replaceOnce(text, SOFA_ANCHOR,
        'anchor: { source: furniture, id: ld.tv_65_missing, offset: { x: 3.58, z: -0.30 } }'));
      const { status, output } = runVerifyRules(sandbox);
      assert.notEqual(status, 0, '定位失败时 verify-rules 必须非零退出');
      assert.match(output, /\[furniture\] living_dining\/sofa_3seat \(ld\.sofa_3seat\): 定位解算失败/,
        '有 id 家具解不出位置时 furnitureItems 必须显形诊断，不得静默跳过');
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('守卫：点位解算失败时 [placement] 先报 error——bounds/proximity 的跳过有上游诊断', () => {
    const sandbox = makeSandbox();
    try {
      const elecPath = join(sandbox, 'config/electrical.yaml');
      const text = readFileSync(elecPath, 'utf8');
      // 电视插座沿墙 2.15 → 99：超出墙段，点位解算失败。
      writeFileSync(elecPath, replaceOnce(text, SOCK_TV_BLOCK,
        SOCK_TV_BLOCK.replace('along: 2.15', 'along: 99')));
      const { status, output } = runVerifyRules(sandbox);
      assert.notEqual(status, 0, '点位解算失败时 verify-rules 必须非零退出');
      assert.match(output, /\[placement\] electrical\/sock_living_tv: 定位解算失败/,
        '点位解不出位置时 prologue 必须先报 [placement] error，bounds/proximity 的跳过才有据可依');
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('吊顶 b 侧反例：匹配上的内机无平面位置时 proximity 报 error，不静默过滤', () => {
    const sandbox = makeSandbox();
    try {
      const ceilPath = join(sandbox, 'config/model/envelope/ceiling.yaml');
      const text = readFileSync(ceilPath, 'utf8');
      writeFileSync(ceilPath, replaceOnce(text, AC_MASTER_BLOCK,
        `- id: ac_master
  room: master_bedroom
  type: ac_indoor`));
      const { status, output } = runVerifyRules(sandbox);
      assert.notEqual(status, 0, '内机缺平面位置时 verify-rules 必须非零退出');
      assert.match(output, /\[proximity\] ac_socket_to_unit: ceiling\/ac_master 缺少平面位置，无法参与邻近校验/,
        '匹配上的吊顶条目无位置时 proximity 必须显形 error，不得静默过滤');
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('对照：真实配置无 [furniture] 定位失败、无沙发 bounds 告警、无邻近误报', () => {
    const sandbox = makeSandbox();
    try {
      const { status, output } = runVerifyRules(sandbox);
      assert.equal(status, 0, '真实配置 verify-rules 应通过');
      assert.doesNotMatch(output, /\[furniture\].*定位解算失败/,
        '真实配置不得有家具定位失败');
      assert.doesNotMatch(output, /\[bounds\] furniture\/living_dining\/sofa_3seat/,
        '真实配置的沙发不得误报 bounds');
      assert.doesNotMatch(output, /\[proximity\] tv_socket_to_stand/,
        '真实配置的电视柜不得误报邻近');
      assert.doesNotMatch(output, /\[proximity\] ac_socket_to_unit.*缺少平面位置/,
        '真实配置的内机不得误报缺位置');
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
