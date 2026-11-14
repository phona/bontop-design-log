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
 *
 * 注入方式（PR #229 复审后改）：沙箱声明一律按稳定对象 id 结构化查找、改字段，
 * 不做 YAML 文本精确匹配、不读当前 offset 数值——R6 合法改偏移后测试不受影响。
 * 注入值（offset.z、along 等）为测试选定值，断言的是规则对注入状态的输出；
 * 期望坐标从注入后的声明推导，不钉真实工程的历史数值。
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
  const sandbox = mkdtempSync(join(tmpdir(), 'stage2-rules-sweep-'));
  cpSync(join(repoRoot, 'config'), join(sandbox, 'config'), { recursive: true });
  return sandbox;
}

function loadYamlFile(path: string): any {
  return loadYaml(readFileSync(path, 'utf8'));
}

function saveYamlFile(path: string, doc: unknown): void {
  writeFileSync(path, dumpYaml(doc));
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
  return { path, doc: loadYamlFile(path) as YamlDoc };
}

/** 把沙发 anchor offset.z 设为测试选定值（与当前配置的 R6 偏移无关）。 */
function setSofaOffsetZ(sandbox: string, z: number): void {
  const { path, doc } = loadHouseYaml(sandbox);
  const sofa = furnishingById(doc, 'ld.sofa_3seat');
  assert.equal(sofa.anchor?.source, 'furniture', '沙发须为 anchor 形式');
  assert.equal(sofa.anchor?.id, 'ld.tv_65', '沙发须锚定电视基准');
  assert.ok(sofa.anchor?.offset, '沙发 anchor 须有 offset');
  sofa.anchor.offset.z = z;
  saveYamlFile(path, doc);
}

/** 沙箱列表型配置文件（electrical.yaml / ceiling.yaml）：按稳定对象 id 找条目。 */
function listItemById(sandbox: string, relPath: string, id: string): { path: string; items: YamlDoc[]; item: YamlDoc } {
  const path = join(sandbox, relPath);
  const items = loadYamlFile(path) as YamlDoc[];
  assert.ok(Array.isArray(items), `${relPath} 应为顶层列表`);
  const item = items.find((i) => i?.id === id) as YamlDoc | undefined;
  assert.ok(item, `${relPath} 中找不到 ${id}`);
  return { path, items, item };
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
  it('bounds 正例：anchor 沙发移出房间时 bounds 告警', () => {
    const sandbox = makeSandbox();
    try {
      // 注入 offset.z=+2.00（测试选定值）：沙发解算位 z = 电视 z + 2.00，超出客餐厅南界。
      // 期望坐标从注入后的声明推导（电视基准位 + 当前 x 偏移 + 注入 z），不钉 R6 待裁定值。
      const { path, doc } = loadHouseYaml(sandbox);
      const sofa = furnishingById(doc, 'ld.sofa_3seat');
      const tv = furnishingById(doc, 'ld.tv_65');
      assert.ok(typeof tv.x === 'number' && typeof tv.z === 'number', '电视基准须有绝对坐标');
      assert.ok(typeof sofa.anchor?.offset?.x === 'number', '沙发 anchor 须有 x 偏移');
      const expectedX = tv.x + sofa.anchor.offset.x;
      const expectedZ = tv.z + 2.00;
      sofa.anchor.offset.z = 2.00;
      saveYamlFile(path, doc);
      const { status, output } = runVerifyRules(sandbox);
      assert.notEqual(status, 0, '沙发越界时 verify-rules 必须非零退出');
      const m = output.match(/\[bounds\] furniture\/living_dining\/sofa_3seat: \(([\d.]+),([\d.]+)\) 超出 living_dining 范围/);
      assert.ok(m, 'anchor 沙发移出房间后 bounds 必须按解算位置告警');
      assert.ok(Math.abs(parseFloat(m[1]) - expectedX) <= 0.005, `bounds 告警 x 应为解算位 ${expectedX}，实为 ${m[1]}`);
      assert.ok(Math.abs(parseFloat(m[2]) - expectedZ) <= 0.005, `bounds 告警 z 应为解算位 ${expectedZ}，实为 ${m[2]}`);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('existence 正例：anchor 家具落入不存在的房间时 existence 告警', () => {
    const sandbox = makeSandbox();
    try {
      // 结构化追加一个不存在的房间，放一件 anchor 沙发副本（合成条目，偏移为测试选定值）。
      const { path, doc } = loadHouseYaml(sandbox);
      (doc.furnishings as YamlDoc).no_such_room = [
        { type: 'sofa_3seat', id: 'ld.sofa_test', anchor: { source: 'furniture', id: 'ld.tv_65', offset: { x: 3.58, z: -0.30 } }, rotation: 270 },
      ];
      saveYamlFile(path, doc);
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
      // 电视柜改 anchor（相对电视 +0.06,+1.60，测试选定值）：解算位距电视插座 >1.5m，仍在房内。
      // 距离期望值不钉死具体数值——插座侧位置来自真实配置，断言只验规则按解算位置告警且距离超阈。
      const { path, doc } = loadHouseYaml(sandbox);
      const tvLow = furnishingById(doc, 'ld.tv_wall_low');
      delete tvLow.x;
      delete tvLow.z;
      tvLow.anchor = { source: 'furniture', id: 'ld.tv_65', offset: { x: 0.06, z: 1.60 } };
      saveYamlFile(path, doc);
      const { output } = runVerifyRules(sandbox);
      const m = output.match(/\[proximity\] tv_socket_to_stand: sock_living_tv ↔ living_dining\/tv_wall_low 距离 ([\d.]+)m \(>1\.5m\)/);
      assert.ok(m, 'anchor 电视柜远离插座后 proximity b 侧必须按解算位置告警');
      assert.ok(parseFloat(m[1]) > 1.5, `邻近距离应 >1.5m，实为 ${m[1]}m`);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('反例：anchor 家具宿主不存在时 [furniture] 定位失败显形，不静默跳过', () => {
    const sandbox = makeSandbox();
    try {
      const { path, doc } = loadHouseYaml(sandbox);
      const sofa = furnishingById(doc, 'ld.sofa_3seat');
      sofa.anchor.id = 'ld.tv_65_missing';
      saveYamlFile(path, doc);
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
      // 电视插座沿墙值改为 99（测试选定值，超出墙段）：点位解算失败。
      const { path, items, item } = listItemById(sandbox, 'config/electrical.yaml', 'sock_living_tv');
      item.along = 99;
      saveYamlFile(path, items);
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
      // 删主卧内机 x/z：结构化删字段，不依赖声明文本。
      const { path, items, item } = listItemById(sandbox, 'config/model/envelope/ceiling.yaml', 'ac_master');
      delete item.x;
      delete item.z;
      saveYamlFile(path, items);
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
