// issue #191：对象 ID 关联贯通（issue #98 验收清单第 3、4 项）。
//
// 守三条验收标准：
//   ① 工作包有 targets 且指向工程对象 ID（targets == MODEL-PKG 链接 scope 解析出的对象集）；
//   ② acceptance 记录按对象 ID 关联（objects.from_packages 与 acceptance_refs 一致，
//      对象集 = 引用它的工作包 targets 并集），不再靠 room+type selector；
//   ③ **单对象改动只让相关的工作包 stale**——在配置副本上改一件家具的声明，
//      断言只有 scope 含该对象的包指纹变化（project_scope 包按定义永远变化）。
//
// 第三条是本 issue 的核心：旧实现把整份 authority 文件塞进指纹，改 house.yaml 任何一处会让
// 所有引用 house.yaml 的包一起 stale。本文件用「改坏→红」的反证见 PR 正文。

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { load as parseYaml } from 'js-yaml';
import { loadModelPackageLinks } from '../../server/model-package-links.js';
import { authorityFilePaths } from '../../shared/model-package-links.js';
import { ALL_MODEL_TARGET, indexAuthorityObjects } from '../../shared/package-objects.js';
import { ENGINEERING_AUTHORITY_SOURCES } from '../../shared/schedule-state.js';
import { loadScheduleState, type ScheduleState } from '../../shared/schedule-state.js';

type AnyRecord = Record<string, any>;

const repoRoot = process.cwd();
const links = loadModelPackageLinks();
const control = parseYaml(readFileSync('schedule/phase-1/control.yaml', 'utf8')) as AnyRecord;
const acceptance = parseYaml(readFileSync('config/acceptance.yaml', 'utf8')) as AnyRecord;
const state = loadScheduleState(repoRoot, {modelPackageLinks: links});

const packages: AnyRecord[] = control.work_packages;

/**
 * 全部权威源 → 工程对象 id 全集。索引复用 shared/package-objects.ts 的唯一实现。
 *
 * 排除已知的**非工程对象前缀**：default 分支会 walk 所有带 id 的节点，把
 * BLK-*（blocker）、PKG-*（工作包）、DEC-*（决策编号）、OI-*（开放项）之类也收进来。
 * 那些不是工程对象，验收/SCH 正文提到它们不代表依赖其几何——混进来就是假阳性
 * （第 9 轮实测 4 条全是这类）。不能用「要求有 collection」替代：plumbing/electrical
 * 的点位在 default 分支里 add 时没传 collection，那样会把宇宙从 732 削到 194。
 */
const NON_OBJECT_ID_PREFIX = /^(BLK-|PKG-|DEC-|OI-|COST-|SCH-|GATE-|check_)/;
function objectUniverse(): Set<string> {
  const universe = new Set<string>();
  for (const [source, value] of Object.entries(links.authorities)) {
    for (const file of authorityFilePaths(value)) {
      const index = indexAuthorityObjects(source, parseYaml(readFileSync(join(repoRoot, file), 'utf8')));
      for (const object of index.objects.values()) {
        if (!NON_OBJECT_ID_PREFIX.test(object.id)) universe.add(object.id);
      }
    }
  }
  return universe;
}
const items: AnyRecord[] = acceptance.phases.flatMap((phase: AnyRecord) => phase.items as AnyRecord[]);

function linkOf(packageId: string): AnyRecord {
  const found = links.links.filter((link) => link.budget_ref.id === packageId);
  assert.equal(found.length, 1, `${packageId} 必须恰有一条 MODEL-PKG 链接`);
  return found[0] as AnyRecord;
}

describe('issue #191 工作包 targets（验收标准一）', () => {
  it('25 个工作包都有非空 targets，且与链接 scope 解析出的对象集逐包相等', () => {
    assert.equal(packages.length, 25, '一期工作包必须 25 个');
    for (const pkg of packages) {
      assert.ok(Array.isArray(pkg.targets) && pkg.targets.length > 0, `${pkg.id} 必须有非空 targets`);
      assert.equal(new Set(pkg.targets).size, pkg.targets.length, `${pkg.id} targets 不得重复`);
      const link = linkOf(pkg.id);
      const resolution = links.objectResolutions![link.id];
      const expected = link.mapping_status === 'project_scope'
        ? [ALL_MODEL_TARGET]
        : [...new Set(resolution.objectIds)].sort();
      assert.deepEqual(pkg.targets, expected, `${pkg.id} targets 必须等于 ${link.id} 的 scope 解析结果`);
    }
  });

  it('六个 project_scope 包用全模型标记，其余包的目标是真实对象 id（不是面层配方 id）', () => {
    const projectScope = packages.filter((pkg) => linkOf(pkg.id).mapping_status === 'project_scope').map((pkg) => pkg.id);
    assert.deepEqual(projectScope.sort(), ['PKG-000', 'PKG-005', 'PKG-010', 'PKG-142', 'PKG-170', 'PKG-900']);
    for (const pkg of packages) {
      if (projectScope.includes(pkg.id)) {
        assert.deepEqual(pkg.targets, [ALL_MODEL_TARGET], `${pkg.id} 必须用 ${ALL_MODEL_TARGET} 标记`);
        continue;
      }
      for (const target of pkg.targets) {
        assert.match(target, /^[A-Za-z0-9_.:\-]+$/, `${pkg.id} 的 target "${target}" 必须是对象 id 形态`);
        // 工作包 targets = scope 解析结果；PKG-135 的 scope 按 S6 已显式含 24 条派生踢脚带
        // （skirting_region 场景元素），它们是 3D 可高亮元素而不是「配方稀释成本归属」那一类。
        // 成本项 targets 的 S6 拦截（不得收配方 id）不套用到工作包：工作包 scope 只管「哪些对象
        // 属于本包」。其余配方前缀（墙砖带/漆带/窗台面）不得出现。
        assert.ok(!target.startsWith('walltile_') && !target.startsWith('paint_') && !target.startsWith('silltile_'),
          `${pkg.id} 的 target "${target}" 是面层配方 id——工作包 targets 只收对象/场景元素 id`);
        if (target.startsWith('skirt_')) assert.equal(pkg.id, 'PKG-135', `派生踢脚带只属于 PKG-135，实际出现在 ${pkg.id}`);
      }
    }
    const pkg135 = packages.find((pkg) => pkg.id === 'PKG-135');
    assert.ok(pkg135, 'PKG-135 必须存在');
    assert.equal(pkg135.targets.filter((target: string) => target.startsWith('skirt_')).length, 24, 'PKG-135 必须含 24 条派生踢脚带');
  });

  it('scope 选择器不再有 room_ids/types（唯一例外 MODEL-P2-110 有登记理由）', () => {
    const legacy: string[] = [];
    for (const link of links.links) {
      for (const ref of link.scope ?? []) {
        for (const field of ['room_ids', 'types'] as const) {
          if ((ref.select[field] ?? []).length) legacy.push(`${link.id}:${ref.source}.${field}`);
        }
      }
    }
    assert.deepEqual(legacy, ['MODEL-P2-110:furnishings.room_ids', 'MODEL-P2-110:furnishings.types']);
    const exception = (parseYaml(readFileSync('config/facts.yaml', 'utf8')) as AnyRecord).contracts
      .find((contract: AnyRecord) => contract.id === 'c.model_package_link_ids_only');
    const allow = (exception.allow_legacy_selectors ?? []).find((entry: AnyRecord) => entry.link_id === 'MODEL-P2-110');
    assert.ok(allow?.reason?.trim(), 'MODEL-P2-110 的例外必须在 facts.yaml 登记理由');
  });
});

describe('issue #191 验收项对象关联（验收标准二）', () => {
  const refsByCheck = new Map<string, string[]>();
  for (const pkg of packages) {
    for (const ref of pkg.acceptance_refs ?? []) refsByCheck.set(ref, [...(refsByCheck.get(ref) ?? []), pkg.id]);
  }

  it('69 条验收项都登记了 objects.from_packages，且与 acceptance_refs 反查集合一致', () => {
    assert.equal(items.length, 69, 'acceptance.yaml 必须 69 条'); // 2026-11-11 Codex 一审 blocking 拆分新增 check_tile_door_seam_closed：68 → 69
    for (const item of items) {
      const declared = item.objects?.from_packages;
      assert.ok(Array.isArray(declared) && declared.length > 0, `${item.id} 必须登记 objects.from_packages`);
      const expected = [...(refsByCheck.get(item.id) ?? [])].sort();
      assert.deepEqual(declared, expected, `${item.id} 的 from_packages 必须等于引用它的工作包集合`);
    }
  });

  it('每条验收项的对象集 = 引用它的工作包 targets 并集（全模型标记吸收为 *）', () => {
    for (const item of items) {
      const derived = state.acceptanceObjectIds.get(item.id);
      assert.ok(derived && derived.length > 0, `${item.id} 的对象集不得为空`);
      const union = new Set<string>();
      for (const packageId of refsByCheck.get(item.id) ?? []) {
        const pkg = packages.find((candidate) => candidate.id === packageId);
        assert.ok(pkg, `${item.id} 引用了不存在的工作包 ${packageId}`);
        for (const target of pkg.targets) union.add(target);
      }
      const expected = union.has(ALL_MODEL_TARGET) ? [ALL_MODEL_TARGET] : [...union].sort();
      assert.deepEqual(derived, expected, `${item.id} 的对象集必须等于工作包 targets 并集`);
      for (const id of derived) {
        assert.ok(id === ALL_MODEL_TARGET || typeof id === 'string' && id.length > 0);
      }
    }
    // 窗口类检查由 PKG-000（project_scope）派生为全模型——这是「跟着任何对象变」的显式口径。
    assert.deepEqual(state.acceptanceObjectIds.get('check_window_paper_per_window'), [ALL_MODEL_TARGET]);
  });

  it('验收正文点名的被验对象必须在派生对象集里（check_elec_micro_oven_reserved → sock_kitchen_oven；check_plumb_external_vanity_waterproof → gbath.vanity）', () => {
    // issue #191 Codex blocking：验收正文点名的被验对象，施工归属可能在别的包；若只按引用包
    // 原 scope 派生，被验对象变化不会让本包 stale。处理方式是把被验对象按 id 纳入引用包的
    // 链接 scope（不是改 acceptance 的派生规则）。
    const microOven = state.acceptanceObjectIds.get('check_elec_micro_oven_reserved');
    assert.ok(microOven?.includes('sock_kitchen_oven'), `对象集必须含 sock_kitchen_oven：${JSON.stringify(microOven)}`);
    const pkg110 = packages.find((pkg) => pkg.id === 'PKG-110');
    assert.ok(pkg110, 'PKG-110 必须存在');
    assert.ok(pkg110.targets.includes('sock_kitchen_oven'), 'PKG-110 targets 必须含被验插座');

    const vanityWaterproof = state.acceptanceObjectIds.get('check_plumb_external_vanity_waterproof');
    assert.ok(vanityWaterproof?.includes('gbath.vanity'), `对象集必须含被验柜体 gbath.vanity：${JSON.stringify(vanityWaterproof)}`);
    const pkg050 = packages.find((pkg) => pkg.id === 'PKG-050');
    assert.ok(pkg050, 'PKG-050 必须存在');
    assert.ok(pkg050.targets.includes('gbath.vanity'), 'PKG-050 targets 必须含被验柜体');
  });

  it('验收项不再只靠 rooms: 选择器表达适用范围（rooms 保留为现场上下文，不承担对象关联）', () => {
    const withRooms = items.filter((item) => (item.rooms ?? []).length > 0);
    assert.ok(withRooms.length > 0, 'rooms 字段仍作为现场上下文保留');
    for (const item of withRooms) {
      assert.ok(item.objects?.from_packages?.length, `${item.id} 必须同时有对象关联，rooms 不再是唯一关联`);
    }
  });
});

// issue #191 扫描式门禁：把「正文点名对象不在对象集里」这个缺陷类变成常驻防线。
//
// 来历：同一缺陷被 Codex 逐个发现三次——sock_kitchen_oven（R2）、gbath.vanity（R3）、
// mb.washbasin_cabinet（R4）。每次都是往链接 scope 里补一个对象，而守护测试只硬编码检查
// 已修过的那两个，所以第三个照样溜过。三角度全仓扫描（67 验收项 + 49 内置检查 × 732 个
// 对象 id）确认存量只有 R4 那一处，但没人保证以后新增条目不再犯。
//
// 判据不是「在 targets 里」，而是「在指纹覆盖里」——resolution.digests 的键是
// 对象集 ∪ 引用闭包（digestResolvedObjects 的产物）。所以墙 w_gbath_south 虽不在
// PKG-050 的 targets，但被 drain_gbath_vanity 的 wall 引用带进闭包，算已覆盖，不报。
// 这与全仓扫描的口径一致：清单没写但闭包已覆盖的，不算漏 stale。
describe('issue #191 扫描式门禁：验收正文点名的对象必须被指纹覆盖', () => {
  /** 某条验收项被指纹覆盖的对象 id 集合 = 其 from_packages 全部链接的 digest 键（含闭包）。 */
  function coveredIds(fromPackages: string[]): {covered: Set<string>; wholeModel: boolean} {
    const covered = new Set<string>();
    let wholeModel = false;
    for (const packageId of fromPackages) {
      const resolution = links.objectResolutions?.[linkOf(packageId).id];
      if (!resolution) continue;
      if (resolution.projectScope) {
        wholeModel = true;
        continue;
      }
      for (const key of Object.keys(resolution.digests)) {
        // 键形态 `<source>:<id>` 或 `<source>:<id>@<parentId>`（墙洞的宿主墙）。
        const bare = key.slice(key.indexOf(':') + 1).split('@')[0];
        if (bare) covered.add(bare);
      }
    }
    return {covered, wholeModel};
  }

  it('69 条验收项四段正文点名的每个工程对象，都被其对象集或引用闭包覆盖', () => {
    const universe = objectUniverse();
    assert.ok(universe.size > 500, `对象宇宙应有数百个 id，实得 ${universe.size}——枚举不全会导致漏报`);

    const missing: string[] = [];
    for (const item of items) {
      // 只扫四段承载验收口径的正文。rooms 是现场上下文、evidence 是取证清单，
      // 都不承担对象关联（与上一条既有测试同口径）。
      const text = [item.item, item.method, item.standard, item.knowledge]
        .filter((value: unknown) => typeof value === 'string')
        .join('\n');
      const {covered, wholeModel} = coveredIds(item.objects?.from_packages ?? []);
      if (wholeModel) continue;
      for (const id of universe) {
        // 词边界匹配：id 含字母数字与 . _ -，两侧不能再跟这些字符，
        // 否则 sock 会命中 sock_kitchen_oven、LED 会命中别的串。
        const pattern = new RegExp(`(?<![A-Za-z0-9_.\\-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_.\\-])`);
        if (pattern.test(text) && !covered.has(id)) {
          missing.push(`${item.id}（${item.objects?.from_packages?.join('+')}）点名 ${id}，但对象集与闭包都没有它`);
        }
      }
    }
    assert.deepEqual(missing, [], `以下验收项点名的对象未被覆盖，改这些对象不会让旧通过记录 stale：\n${missing.join('\n')}`);
  });

  it('门禁真的会红：把被验柜体从 PKG-050 scope 去掉，上一条必须失败', () => {
    // 反证：临时从链接 scope 删掉 mb.washbasin_cabinet，重新解析后门禁应报它漏。
    // 这与 R2/R3/R4 三次 Codex blocking 是同一处缺陷，删掉任意一个被验对象都该红。
    const probe = mkdtempSync(join(tmpdir(), 'object-links-gate-'));
    try {
      cpSync(join(repoRoot, 'config'), join(probe, 'config'), {recursive: true});
      // phase_1_budget 权威源指向 schedule/phase-1/control.yaml，沙箱必须连 schedule 一起复制。
      cpSync(join(repoRoot, 'schedule'), join(probe, 'schedule'), {recursive: true});
      const path = join(probe, 'config/model-package-links.yaml');
      const before = readFileSync(path, 'utf8');
      const tampered = before.replace('ids: [gbath.vanity, mb.washbasin_cabinet]', 'ids: [gbath.vanity]');
      assert.ok(tampered !== before, '必须能改坏：scope 里应含 mb.washbasin_cabinet');
      writeFileSync(path, tampered);

      const probeLinks = loadModelPackageLinks(join(probe, 'config/model-package-links.yaml'), {root: probe});
      const probeUniverse = new Set<string>();
      for (const [source, value] of Object.entries(probeLinks.authorities)) {
        for (const file of authorityFilePaths(value)) {
          const index = indexAuthorityObjects(source, parseYaml(readFileSync(join(probe, file), 'utf8')));
          for (const object of index.objects.values()) probeUniverse.add(object.id);
        }
      }

      const missing: string[] = [];
      for (const item of items) {
        const text = [item.item, item.method, item.standard, item.knowledge]
          .filter((value: unknown) => typeof value === 'string')
          .join('\n');
        let wholeModel = false;
        const covered = new Set<string>();
        for (const packageId of item.objects?.from_packages ?? []) {
          const link = probeLinks.links.find((l) => l.budget_ref.id === packageId);
          const resolution = link ? probeLinks.objectResolutions?.[link.id] : undefined;
          if (!resolution) continue;
          if (resolution.projectScope) {
            wholeModel = true;
            continue;
          }
          for (const key of Object.keys(resolution.digests)) {
            const bare = key.slice(key.indexOf(':') + 1).split('@')[0];
            if (bare) covered.add(bare);
          }
        }
        if (wholeModel) continue;
        for (const id of probeUniverse) {
          const pattern = new RegExp(`(?<![A-Za-z0-9_.\\-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_.\\-])`);
          if (pattern.test(text) && !covered.has(id)) {
            missing.push(`${item.id} 点名 ${id}`);
          }
        }
      }
      assert.ok(
        missing.some((line) => line.includes('mb.washbasin_cabinet')),
        `去掉被验柜体后门禁必须报 mb.washbasin_cabinet，实得：${missing.join('；') || '（无）'}`,
      );
    } finally {
      rmSync(probe, {recursive: true, force: true});
    }
  });
});

describe('issue #191 对象粒度 stale（验收标准三）', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'object-links-'));
  let beforeFingerprints = new Map<string, string>();
  let beforeState: ScheduleState;

  before(() => {
    cpSync(join(repoRoot, 'config'), join(sandbox, 'config'), {recursive: true});
    cpSync(join(repoRoot, 'schedule'), join(sandbox, 'schedule'), {recursive: true});
    cpSync(join(repoRoot, 'contracts'), join(sandbox, 'contracts'), {recursive: true});
    symlinkSync(join(repoRoot, 'node_modules'), join(sandbox, 'node_modules'));
    beforeState = loadScheduleState(sandbox, {
      modelPackageLinks: loadModelPackageLinks(join(sandbox, 'config/model-package-links.yaml'), {root: sandbox}),
    });
    assert.deepEqual(beforeState.errors, [], `配置副本必须无加载错误：${beforeState.errors.join(' | ')}`);
    beforeFingerprints = new Map(beforeState.control.work_packages.map((pkg: AnyRecord) => [pkg.id, beforeState.packageProjectFingerprint(pkg)]));
  });

  after(() => {
    rmSync(sandbox, {recursive: true, force: true});
  });

  /** 以当前沙箱文件状态重新加载，返回「该状态」的工作包指纹。测试会逐步改文件，每次重取基线。 */
  function fingerprintsNow(): {state: ScheduleState; fingerprints: Map<string, string>} {
    const current = loadScheduleState(sandbox, {
      modelPackageLinks: loadModelPackageLinks(join(sandbox, 'config/model-package-links.yaml'), {root: sandbox}),
    });
    return {
      state: current,
      fingerprints: new Map(current.control.work_packages.map((pkg: AnyRecord) => [pkg.id, current.packageProjectFingerprint(pkg)])),
    };
  }

  it('改一件家具的声明：只有 scope 含该对象的包 stale（project_scope 包按定义变化）', () => {
    const housePath = join(sandbox, 'config/house.yaml');
    const text = readFileSync(housePath, 'utf8');
    const anchor = `{ type: coffee_table, id: ld.coffee_table, x: 9.70, z: 7.70, rotation: 0 }`;
    assert.equal(text.split(anchor).length - 1, 1, '家具声明锚点必须恰出现一次');
    writeFileSync(housePath, text.replace(anchor, `{ type: coffee_table, id: ld.coffee_table, x: 9.71, z: 7.70, rotation: 0 }`));

    const afterState = loadScheduleState(sandbox, {
      modelPackageLinks: loadModelPackageLinks(join(sandbox, 'config/model-package-links.yaml'), {root: sandbox}),
    });
    const stale = afterState.control.work_packages
      .filter((pkg: AnyRecord) => afterState.packageProjectFingerprint(pkg) !== beforeFingerprints.get(pkg.id))
      .map((pkg: AnyRecord) => pkg.id)
      .sort();

    // 相关包 = PKG-150（一期家具 = furnishings all）+ **全部 6 个 project_scope 包**
    // （PKG-000/005/010/142/170/900）。project_scope 的 targets 是 `*`（全模型），
    // 指纹就必须按全部权威文件算——改 house.yaml 的任何对象都该让它们 stale。
    // 这条曾只断言 ['PKG-142','PKG-150']：另 5 个 project_scope 链接的 scope 只列了
    // model_geometry，于是声明了「跟任何对象变」却只跟几何变，PKG-170 的甲醛验收
    // 在家具变化后不 stale（issue #191 独立复核 high）。现在 6 个全在里面。
    assert.deepEqual(stale, [
      'PKG-000', 'PKG-005', 'PKG-010', 'PKG-142', 'PKG-150', 'PKG-170', 'PKG-900',
    ]);
  });

  // project_scope 的 `*` 必须落到指纹上，而不是只落到 targets 上：6 个整项目包的 scope
  // 各自只列了少数来源（5 个只有 model_geometry），若指纹按 scope 列出的文件算，
  // 非几何对象域的变化就静默漏过。这里对 6 个包逐一验证：指纹含全部权威对象域的文件。
  it('project_scope 的 * 落到指纹：含全部工程对象域，且不含存验收记录的执行文件', () => {
    const projectScopeIds = ['PKG-000', 'PKG-005', 'PKG-010', 'PKG-142', 'PKG-170', 'PKG-900'];
    // 只算工程对象域（ENGINEERING_AUTHORITY_SOURCES）。schedule/execution 文件
    // （phase_scope / phase_*_budget / phase_*_scope）**故意不在内**——见下。
    const engineeringFiles = [
      ...new Set(ENGINEERING_AUTHORITY_SOURCES.flatMap((source) => authorityFilePaths(beforeState.modelPackageLinks.authorities[source] ?? source))),
    ];
    // 存验收通过记录的文件。它若进指纹，记录一存进去就会改变自己保存的
    // project_data_sha256，重新加载即判 stale——付款门槛永远无法稳定通过（自指）。
    const executionFiles = ['schedule/phase-1/control.yaml', 'schedule/phase-2/control.yaml', 'schedule/phase-3/control.yaml'];
    for (const id of projectScopeIds) {
      const pkg = beforeState.control.work_packages.find((item: AnyRecord) => item.id === id);
      assert.ok(pkg, `${id} 必须存在`);
      assert.deepEqual(pkg.targets, ['*'], `${id} 的 targets 必须是 *`);
      const keys = Object.keys(beforeState.packageProjectSnapshot(pkg));
      const missing = engineeringFiles.filter((file) => !keys.includes(file));
      assert.deepEqual(missing, [], `${id} 的指纹必须含全部工程对象域，缺：${missing.join(', ')}`);
      const leaked = executionFiles.filter((file) => keys.includes(file));
      assert.deepEqual(leaked, [], `${id} 的指纹不得含存验收记录的执行文件（自指），实际含：${leaked.join(', ')}`);
    }
  });

  // issue #191 Codex blocking 第 7 轮（#205 引入的回归）：project_scope 包曾把**全部**
  // authorities 圈进指纹，其中 phase_1_budget 指向 schedule/phase-1/control.yaml，而该文件
  // 的 audit_log.records 就是验收通过记录本身。存一条记录 → 文件变 → 这条记录保存的
  // project_data_sha256 失效 → 重新加载立即判 stale → 付款门槛永远无法稳定通过。
  // 本条钉住：control.yaml 不进任何包的指纹。
  // issue #191 Codex blocking 第 7 轮：控制关系是**反向**的——controls[] 的
  // target_point_ids 指向受控灯具，灯具自己的声明不写「我被哪个开关控」。PKG-120 只选
  // 灯具，正向闭包到不了控制组；改 control_master_bed_door 的 kind/status/开关清单不会
  // 让 PKG-120 stale，而 SCH-120-01「开关和双处控制关系」的旧通过记录会继续有效。
  // 旧实现靠整份 electrical.yaml 能抓到，本次收窄后必须由反向闭包接住。
  it('反向闭包：改控制组声明，只选灯具的 PKG-120 必须 stale', () => {
    const topologyPath = join(sandbox, 'config/electrical-topology.yaml');
    const lines = readFileSync(topologyPath, 'utf8').split('\n');
    const idAt = lines.findIndex((line) => /^\s*- id: control_master_bed_door\s*$/.test(line));
    assert.ok(idAt >= 0, 'config/electrical-topology.yaml 必须有 control_master_bed_door');
    // 该控制组必须指向 PKG-120 scope 里的一盏灯（否则本用例的前提不成立）。
    const blockEnd = lines.findIndex((line, i) => i > idAt && /^\s*- id:/.test(line));
    const stop = blockEnd > 0 ? blockEnd : lines.length;
    const targetAt = lines.findIndex((line, i) => i > idAt && i < stop && /^\s*target_point_ids:/.test(line));
    assert.ok(targetAt > idAt, 'control_master_bed_door 必须有 target_point_ids');
    assert.ok(/light_master_dome/.test(lines[targetAt]),
      `该控制组必须受控 PKG-120 scope 里的 light_master_dome，实际：${lines[targetAt]}`);

    const kindAt = lines.findIndex((line, i) => i > idAt && i < stop && /^\s*kind:/.test(line));
    assert.ok(kindAt > idAt, 'control_master_bed_door 必须有 kind');
    const before = lines[kindAt];
    const moved = before.replace(/switch_multiway/, 'switch_2way');
    assert.ok(moved !== before, `必须能改动 kind：${before}`);

    const patched = [...lines];
    patched[kindAt] = moved;
    const baseline = fingerprintsNow();
    writeFileSync(topologyPath, patched.join('\n'));
    const afterState = fingerprintsNow().state;
    const stale = afterState.control.work_packages
      .filter((pkg: AnyRecord) => afterState.packageProjectFingerprint(pkg) !== baseline.fingerprints.get(pkg.id))
      .map((pkg: AnyRecord) => pkg.id)
      .sort();
    assert.ok(stale.includes('PKG-120'),
      `改控制组必须让只选灯具的 PKG-120 stale；实际 stale：${stale.join(', ') || '（无）'}`);
    // 反向自证：摘要里必须出现该控制组，证明走的是反向闭包。
    const keys = Object.keys(afterState.packageProjectSnapshot(
      afterState.control.work_packages.find((pkg: AnyRecord) => pkg.id === 'PKG-120')!,
    ));
    assert.ok(keys.some((key) => key.includes('control_master_bed_door')),
      `PKG-120 摘要必须含控制组 control_master_bed_door，实际键 ${keys.filter((k) => k.includes('control_')).join(', ') || '（无）'}`);
  });

  // issue #191 Codex blocking 第 8 轮：上一轮的反向闭包只存了控制组摘要、把关联点位 id
  // 塞进队列却没存点位声明——改开关的 height/type/neutral 不会让只选灯具的 PKG-120 stale。
  // 这是上一轮做了一半，本条补全并钉住。
  it('反向闭包补全：改关联开关的声明，只选灯具的 PKG-120 必须 stale', () => {
    const elecPath = join(sandbox, 'config/electrical.yaml');
    const lines = readFileSync(elecPath, 'utf8').split('\n');
    const idAt = lines.findIndex((line) => /^- id: switch_master_door\s*$/.test(line));
    assert.ok(idAt >= 0, 'config/electrical.yaml 必须有 switch_master_door');
    // 该开关必须被某控制组关联（否则前提不成立）。
    const topoLinks = loadModelPackageLinks(join(sandbox, 'config/model-package-links.yaml'), {root: sandbox});
    const referenced = Object.values(topoLinks.objectResolutions ?? {}).some((r) =>
      Object.keys(r.digests).some((k) => k.includes('switch_master_door')));
    assert.ok(referenced, 'switch_master_door 必须经控制组进入某包的指纹（反向闭包生效）');

    const blockEnd = lines.findIndex((line, i) => i > idAt && /^- id:/.test(line));
    const stop = blockEnd > 0 ? blockEnd : lines.length;
    const heightAt = lines.findIndex((line, i) => i > idAt && i < stop && /^\s*height:\s*[\d.]+\s*$/.test(line));
    assert.ok(heightAt > idAt, 'switch_master_door 必须有 height');
    const before = lines[heightAt];
    const moved = before.replace(/1\.3/, '1.4');
    assert.ok(moved !== before, `必须能改动 height：${before}`);

    const patched = [...lines];
    patched[heightAt] = moved;
    const baseline = fingerprintsNow();
    writeFileSync(elecPath, patched.join('\n'));
    const afterState = fingerprintsNow().state;
    const stale = afterState.control.work_packages
      .filter((pkg: AnyRecord) => afterState.packageProjectFingerprint(pkg) !== baseline.fingerprints.get(pkg.id))
      .map((pkg: AnyRecord) => pkg.id)
      .sort();
    assert.ok(stale.includes('PKG-120'),
      `改关联开关必须让只选灯具的 PKG-120 stale；实际 stale：${stale.join(', ') || '（无）'}`);
    const keys = Object.keys(afterState.packageProjectSnapshot(
      afterState.control.work_packages.find((pkg: AnyRecord) => pkg.id === 'PKG-120')!,
    ));
    assert.ok(keys.some((key) => key.includes('switch_master_door')),
      `PKG-120 摘要必须含开关 switch_master_door，实际键 ${keys.filter((k) => k.includes('switch_')).join(', ') || '（无）'}`);
  });

  // issue #191 Codex blocking 第 9 轮：SCH-110-01「核对柜体、台面、烟机、灶具、水槽及
  // 预留电器的尺寸和水电接口」与 SCH-110-02「设备安装空间」实际验收的三件家电
  // （gas_stove / range_hood / dishwasher）施工归属在 PKG-160，本包是这两条 SCH 的挂载包。
  // 不纳入则移动 gas_stove 不会让 PKG-110 摘要变化、旧的接口冻结与安装空间通过记录继续有效。
  it('SCH 被验设备纳入挂载包：改灶具声明，PKG-110 必须 stale', () => {
    const housePath = join(sandbox, 'config/house.yaml');
    const lines = readFileSync(housePath, 'utf8').split('\n');
    const idAt = lines.findIndex((line) => /^\s*- \{ type: gas_stove, id: kitchen\.gas_stove/.test(line));
    assert.ok(idAt >= 0, 'config/house.yaml 必须有 kitchen.gas_stove');
    const before = lines[idAt];
    const moved = before.replace('x: 10.50', 'x: 10.65');
    assert.ok(moved !== before, `必须能改动 gas_stove 的 x：${before.slice(0, 90)}`);

    const patched = [...lines];
    patched[idAt] = moved;
    const baseline = fingerprintsNow();
    writeFileSync(housePath, patched.join('\n'));
    const afterState = fingerprintsNow().state;
    const stale = afterState.control.work_packages
      .filter((pkg: AnyRecord) => afterState.packageProjectFingerprint(pkg) !== baseline.fingerprints.get(pkg.id))
      .map((pkg: AnyRecord) => pkg.id)
      .sort();
    assert.ok(stale.includes('PKG-110'),
      `改灶具必须让挂 SCH-110-01/02 的 PKG-110 stale；实际 stale：${stale.join(', ') || '（无）'}`);
    // PKG-160 是施工归属包，本来就该 stale——两个包都要在，缺一个即漏。
    assert.ok(stale.includes('PKG-160'),
      `改灶具也必须让施工归属包 PKG-160 stale；实际 stale：${stale.join(', ') || '（无）'}`);
  });

  // 门禁覆盖洞（第 9 轮暴露）：上面的扫描式门禁只扫 config/acceptance.yaml 的 69 条，
  // **没扫 control.yaml 里 49 条 SCH-xxx 工作包内置检查**——而 SCH 正文用的是中文通称
  // （「烟机、灶具」）不是对象 id，词边界匹配扫不到。本条用另一条判据堵这个洞：
  // 每个工作包的 targets 必须覆盖「它全部 SCH 检查点名对象的并集」。
  // 判据来源：SCH 检查没有 objects 字段，其对象集完全来自所属包 targets——
  // 所以 targets 漏了，SCH 的旧通过记录就会漏 stale。
  // issue #191 Codex blocking 第 10 轮：房间归属没进摘要。AuthorityObject.room 记了家具
  // 所在分组，但 objectDigestKey 与摘要值都只哈希 item.node——把稳定 id 的家具从
  // living_dining 组移到 study 组，键与摘要都不变。房间分组实际影响 ProjectCatalog 的
  // 逐房清单与数量，PKG-150 又已移除整份 house.yaml 指纹，故旧通过记录不会 stale。
  it('房间归属进摘要：稳定 id 家具跨房迁移，PKG-150 必须 stale', () => {
    const housePath = join(sandbox, 'config/house.yaml');
    const lines = readFileSync(housePath, 'utf8').split('\n');
    // ld.coffee_table 是 living_dining 组的 placed 家具（稳定 id）。
    const idAt = lines.findIndex((line) => /^\s*- \{ type: coffee_table, id: ld\.coffee_table/.test(line));
    assert.ok(idAt >= 0, 'config/house.yaml 必须有 ld.coffee_table');
    const decl = lines[idAt];
    // 找到 living_dining 组的起止，把该行整条移到 study 组末尾。
    const groupAt = lines.findIndex((line, i) => i < idAt && /^  living_dining:\s*$/.test(line));
    assert.ok(groupAt >= 0, '必须有 living_dining 分组');
    const groupEnd = lines.findIndex((line, i) => i > groupAt && /^  \S/.test(line));
    const studyAt = lines.findIndex((line) => /^  study:\s*$/.test(line));
    assert.ok(studyAt >= 0, '必须有 study 分组');
    const studyEnd = lines.findIndex((line, i) => i > studyAt && /^  \S/.test(line));
    assert.ok(groupEnd > 0 && studyEnd > studyAt, '两个分组的边界都必须能定位');

    const patched = [...lines];
    patched.splice(idAt, 1);
    // 删除后 study 组末行索引可能前移 1（若 study 在 living_dining 之后）。
    const insertAt = studyEnd > idAt ? studyEnd - 1 : studyEnd;
    patched.splice(insertAt, 0, decl);
    const moved = patched.join('\n');
    assert.ok(moved !== lines.join('\n'), '必须真的发生了迁移');
    // 自证：该行现在落在 study 组内、不在 living_dining 组内。
    const after = moved.split('\n');
    const newAt = after.findIndex((line) => line === decl);
    const newStudyStart = after.findIndex((line) => /^  study:\s*$/.test(line));
    const newStudyEnd = after.findIndex((line, i) => i > newStudyStart && /^  \S/.test(line));
    assert.ok(newAt > newStudyStart && newAt < newStudyEnd, '迁移后该条必须落在 study 组内');

    const baseline = fingerprintsNow();
    writeFileSync(housePath, moved);
    const afterState = fingerprintsNow().state;
    const stale = afterState.control.work_packages
      .filter((pkg: AnyRecord) => afterState.packageProjectFingerprint(pkg) !== baseline.fingerprints.get(pkg.id))
      .map((pkg: AnyRecord) => pkg.id)
      .sort();
    assert.ok(stale.includes('PKG-150'),
      `稳定 id 家具跨房迁移必须让 PKG-150 stale；实际 stale：${stale.join(', ') || '（无）'}`);
  });

  // issue #191 Codex blocking 第 12 轮（一）：CONDENSATE_CHAIN_INPUT_IDS 漏了两面墙。
  // resolveCondensateChain 的 wallOrDiagnostic 逐个取 w_mb_east / w_mbath_east /
  // w_mbath_south 三面（shared/condensate-chain.ts:213-215），而我第 8 轮写清单时只对照了
  // 注释里的穿墙点，漏了前两面。这正是 OI-80 预言的「清单靠人工维护，漏更新就是一个漏 stale」。
  it('链输入清单补全：改 w_mb_east 端点，PKG-150 必须 stale', () => {
    const geometryPath = join(sandbox, 'config/layout/model-geometry.yaml');
    const lines = readFileSync(geometryPath, 'utf8').split('\n');
    // 墙声明是多行：`- id: w_mb_east` 之后若干行才是 from/to。
    const wallAt = lines.findIndex((line) => /^\s*- id: w_mb_east\s*$/.test(line));
    assert.ok(wallAt >= 0, '必须有 w_mb_east 墙');
    const wallEnd = lines.findIndex((line, i) => i > wallAt && /^\s*- id:/.test(line));
    const stop = wallEnd > 0 ? wallEnd : lines.length;
    const fromAt = lines.findIndex((line, i) => i > wallAt && i < stop && /^\s*from:\s*\S+\s*$/.test(line));
    assert.ok(fromAt > wallAt, 'w_mb_east 必须声明 from');
    const vertexId = /from:\s*(\S+)/.exec(lines[fromAt])![1];
    // 顶点是单行流式：`- { id: v_mb_ne, x: 4.20, z: 5.55 }`。改它的 x 即改墙几何。
    const vAt = lines.findIndex((line) => new RegExp(`^- \\{ id: ${vertexId}\\b`).test(line.trim()));
    assert.ok(vAt >= 0, `必须有顶点 ${vertexId}`);
    const vBefore = lines[vAt];
    const vMoved = vBefore.replace(/x:\s*[\d.-]+/, 'x: 9.99');
    assert.ok(vMoved !== vBefore, `必须能改动 ${vertexId} 的 x：${vBefore.slice(0, 80)}`);

    const patched = [...lines];
    patched[vAt] = vMoved;
    const baseline = fingerprintsNow();
    writeFileSync(geometryPath, patched.join('\n'));
    const afterState = fingerprintsNow().state;
    const stale = afterState.control.work_packages
      .filter((pkg: AnyRecord) => afterState.packageProjectFingerprint(pkg) !== baseline.fingerprints.get(pkg.id))
      .map((pkg: AnyRecord) => pkg.id)
      .sort();
    assert.ok(stale.includes('PKG-150'),
      `改 w_mb_east 必须让挂链上家具的 PKG-150 stale；实际 stale：${stale.join(', ') || '（无）'}`);
  });

  // issue #191 Codex blocking 第 12 轮（二）：PKG-160 的 SCH-160-01 验安装与维护空间，
  // 而空间由厨房柜体与桥接台面决定； dishwasher 用绝对坐标、无宿主引用可供闭包跟随。
  // 第 11 轮只登记了 OI-82 没修——Codex 评得对：登记不修复本次收窄造成的漏报。
  it('安装空间依赖补反向：改桥接台面长度，PKG-160 必须 stale', () => {
    const housePath = join(sandbox, 'config/house.yaml');
    const lines = readFileSync(housePath, 'utf8').split('\n');
    const idAt = lines.findIndex((line) => /^\s*- \{ type: kitchen_countertop_bridge, id: kitchen\.countertop_bridge/.test(line));
    assert.ok(idAt >= 0, 'config/house.yaml 必须有 kitchen.countertop_bridge');
    const before = lines[idAt];
    const moved = /length:\s*[\d.]+/.test(before)
      ? before.replace(/length:\s*[\d.]+/, 'length: 2.10')
      : before.replace(/\}\s*$/, ', length: 2.10 }');
    assert.ok(moved !== before, `必须能改动 countertop_bridge 的 length：${before.slice(0, 100)}`);

    const patched = [...lines];
    patched[idAt] = moved;
    const baseline = fingerprintsNow();
    writeFileSync(housePath, patched.join('\n'));
    const afterState = fingerprintsNow().state;
    const stale = afterState.control.work_packages
      .filter((pkg: AnyRecord) => afterState.packageProjectFingerprint(pkg) !== baseline.fingerprints.get(pkg.id))
      .map((pkg: AnyRecord) => pkg.id)
      .sort();
    assert.ok(stale.includes('PKG-160'),
      `改桥接台面必须让挂 SCH-160-01 的 PKG-160 stale；实际 stale：${stale.join(', ') || '（无）'}`);
    assert.ok(stale.includes('PKG-110'),
      `改桥接台面也必须让施工归属包 PKG-110 stale；实际 stale：${stale.join(', ') || '（无）'}`);
  });

  it('门禁补洞：工作包 targets 必须覆盖其全部 SCH 检查点名对象的并集', () => {
    const universe = objectUniverse();
    // 每条 SCH 检查 → 所属包（按 control.yaml 的嵌套位置）。
    const schOwner = new Map<string, string>();
    let currentPkg = '';
    for (const line of readFileSync(join(repoRoot, 'schedule/phase-1/control.yaml'), 'utf8').split('\n')) {
      const pkgMatch = /^  - id: (PKG-\d+)\s*$/.exec(line);
      if (pkgMatch) currentPkg = pkgMatch[1];
      const schMatch = /^      - id: (SCH-[\w-]+)\s*$/.exec(line);
      if (schMatch && currentPkg) schOwner.set(schMatch[1], currentPkg);
    }
    assert.ok(schOwner.size > 0, `必须能解析出 SCH 检查及其所属包，实得 ${schOwner.size} 条`);

    const missing: string[] = [];
    for (const pkg of packages) {
      const checks = (pkg.checks ?? []) as AnyRecord[];
      const targets = new Set((pkg.targets ?? []) as string[]);
      for (const check of checks) {
        const text = [check.item, check.method, check.pass_condition, ...(check.evidence_required ?? [])]
          .filter((v: unknown) => typeof v === 'string')
          .join('\n');
        for (const id of universe) {
          const pattern = new RegExp(`(?<![A-Za-z0-9_.\\-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_.\\-])`);
          if (pattern.test(text) && !targets.has(id) && !targets.has('*')) {
            missing.push(`${check.id}（属 ${pkg.id}）点名 ${id}，但 ${pkg.id} 的 targets 没有它`);
          }
        }
      }
    }
    assert.deepEqual(missing, [], `以下 SCH 检查点名的对象未被所属包 targets 覆盖：\n${missing.join('\n')}`);
  });

  it('回归：存验收记录的 control.yaml 不进任何工作包的项目数据指纹（防自指）', () => {
    const controlFile = 'schedule/phase-1/control.yaml';
    for (const pkg of beforeState.control.work_packages) {
      const keys = Object.keys(beforeState.packageProjectSnapshot(pkg));
      assert.ok(!keys.includes(controlFile),
        `${pkg.id} 的指纹不得含 ${controlFile}（audit_log.records 在其中，会自指）`);
    }
  });

  it('对象粒度指纹只含 scope 对象与结构性文件：家具包不再整份依赖 house.yaml', () => {
    const pkg150 = beforeState.control.work_packages.find((pkg: AnyRecord) => pkg.id === 'PKG-150');
    const snapshot = beforeState.packageProjectSnapshot(pkg150);
    const keys = Object.keys(snapshot);
    assert.ok(keys.some((key) => key.startsWith('object:furnishings:')), '家具包指纹必须含 furnishings 对象声明');
    assert.ok(!keys.includes('config/house.yaml'), '家具包指纹不得再整份计入 house.yaml（对象粒度）');
    // 结构性文件仍整份计入：改链接表/验收表结构会影响所有包。
    for (const structural of ['config/model-package-links.yaml', 'schedule/phase-scope.yaml', 'config/acceptance.yaml']) {
      assert.ok(keys.includes(structural), `${structural} 必须整份计入工作包指纹`);
    }
    // project_scope 包（PKG-142）相反：整项目语义，按整份权威文件计。
    const pkg142 = beforeState.control.work_packages.find((pkg: AnyRecord) => pkg.id === 'PKG-142');
    assert.ok(Object.keys(beforeState.packageProjectSnapshot(pkg142)).includes('config/house.yaml'));
  });

  // issue #191 Codex blocking：model-geometry 的顶点（vertices）也是几何对象——墙的 from/to、
  // 房间/平台的 boundary、门洞 anchor 都以 id 引用顶点。只索引房间/墙/洞口时，移动一个顶点
  // 不会改变任何已收录对象的声明，引用闭包也无从捕获，移墙后相关包的旧通过记录仍显得有效。
  // 本用例改一个顶点坐标，断言「拥有该顶点的墙」所在包 stale，而无关的厨房橱柜包不动。
  it('移动一个顶点：引用它的墙/房间所在包 stale，无关包不动（顶点进对象索引）', () => {
    const geometryPath = join(sandbox, 'config/layout/model-geometry.yaml');
    const text = readFileSync(geometryPath, 'utf8');
    const anchor = 'id: v_gbath_se,x: 7.20,';
    assert.equal(text.split(anchor).length - 1, 1, '顶点锚点必须恰出现一次');
    // 上一用例已改 house.yaml；这里在「当前」状态上取基线，只比较顶点改动的影响。
    const baseline = loadScheduleState(sandbox, {
      modelPackageLinks: loadModelPackageLinks(join(sandbox, 'config/model-package-links.yaml'), {root: sandbox}),
    });
    const baselineFingerprints = new Map(
      baseline.control.work_packages.map((pkg: AnyRecord) => [pkg.id, baseline.packageProjectFingerprint(pkg)]),
    );
    writeFileSync(geometryPath, text.replace(anchor, 'id: v_gbath_se,x: 7.21,'));

    const afterState = loadScheduleState(sandbox, {
      modelPackageLinks: loadModelPackageLinks(join(sandbox, 'config/model-package-links.yaml'), {root: sandbox}),
    });
    const stale = afterState.control.work_packages
      .filter((pkg: AnyRecord) => afterState.packageProjectFingerprint(pkg) !== baselineFingerprints.get(pkg.id))
      .map((pkg: AnyRecord) => pkg.id);

    // v_gbath_se 是 w_gbath_south / w_gbath_east / w_gbath_east_open_vanity 的端点；
    // 防水、铺贴、美缝、踢脚等包按墙/房间选对象，必须跟着 stale。
    for (const pkgId of ['PKG-020', 'PKG-050', 'PKG-060', 'PKG-065', 'PKG-130', 'PKG-135']) {
      assert.ok(stale.includes(pkgId), `${pkgId} 的 scope 含引用 v_gbath_se 的墙，顶点移动后必须 stale；实际 ${stale.join(', ')}`);
    }
    // 厨房橱柜包只引用厨房墙（不引用 v_gbath_se），不得被无关几何改动打成 stale。
    assert.ok(!stale.includes('PKG-110'), `PKG-110 与 v_gbath_se 无关，不应 stale；实际 ${stale.join(', ')}`);
    // 顶点必须真的进了摘要（否则上面「墙 stale」只是整份 model-geometry 兜底的假阳性）。
    const pkg020 = afterState.control.work_packages.find((pkg: AnyRecord) => pkg.id === 'PKG-020');
    const snapshot = afterState.packageProjectSnapshot(pkg020);
    assert.ok(Object.keys(snapshot).some((key) => key.startsWith('object:model_geometry:v_')),
      '对象粒度指纹必须含顶点声明（object:model_geometry:v_*）');
  });

  // issue #191 Codex blocking：check_elec_micro_oven_reserved 正文点名 sock_kitchen_oven
  // （插拔可及性），但施工归属在水电包。MODEL-PKG-110 已按 id 直选该点位；本用例守
  // 「插座改动 → 挂该验收的 PKG-110 stale」，防止验收关联再次退化成只跟橱柜对象。
  it('改被验插座的高度：挂该验收的 PKG-110 必须 stale', () => {
    const electricalPath = join(sandbox, 'config/electrical.yaml');
    const text = readFileSync(electricalPath, 'utf8');
    const anchor = '  x: 10.80\n  z: 1.95\n  height: 1.2\n';
    assert.equal(text.split(anchor).length - 1, 1, 'sock_kitchen_oven 坐标块锚点必须恰出现一次');
    const baseline = fingerprintsNow();
    writeFileSync(electricalPath, text.replace(anchor, '  x: 10.80\n  z: 1.95\n  height: 1.3\n'));
    const afterState = fingerprintsNow().state;
    const stale = afterState.control.work_packages
      .filter((pkg: AnyRecord) => afterState.packageProjectFingerprint(pkg) !== baseline.fingerprints.get(pkg.id))
      .map((pkg: AnyRecord) => pkg.id);
    assert.ok(stale.includes('PKG-110'), `PKG-110 的验收点名 sock_kitchen_oven，插座改动后必须 stale；实际 ${stale.join(', ')}`);
  });

  // issue #191 Codex blocking：check_plumb_external_vanity_waterproof 正文按 gbath.vanity 的
  // vanity_layout 核托盘/排水走廊/前拉空间；柜体施工归属在 PKG-100，但验收记录挂在 PKG-050。
  // MODEL-PKG-050 已按 id 纳入该柜体；本用例守「柜内布局改动 → PKG-050 stale」。
  it('改被验柜体的 vanity_layout：挂该验收的 PKG-050 必须 stale', () => {
    const housePath = join(sandbox, 'config/house.yaml');
    const text = readFileSync(housePath, 'utf8');
    const anchor = 'vanity_layout: { width: 0.69, depth: 0.50,';
    assert.equal(text.split(anchor).length - 1, 1, 'gbath.vanity vanity_layout 锚点必须恰出现一次');
    const baseline = fingerprintsNow();
    writeFileSync(housePath, text.replace(anchor, 'vanity_layout: { width: 0.69, depth: 0.51,'));
    const afterState = fingerprintsNow().state;
    const stale = afterState.control.work_packages
      .filter((pkg: AnyRecord) => afterState.packageProjectFingerprint(pkg) !== baseline.fingerprints.get(pkg.id))
      .map((pkg: AnyRecord) => pkg.id);
    assert.ok(stale.includes('PKG-050'), `PKG-050 的验收点名 gbath.vanity，柜内布局改动后必须 stale；实际 ${stale.join(', ')}`);
  });

  // issue #191 Codex blocking（三轮）：门洞摘要键带父墙还不够——宿主墙的声明也要进引用闭包。
  // 只改父墙端点（洞声明不变）时，若闭包不沿 parent 展开，PKG-090 的摘要不会变化。
  it('宿主墙几何变化：只选 openings 的 PKG-090 必须 stale（父墙进闭包）', () => {
    const geometryPath = join(sandbox, 'config/layout/model-geometry.yaml');
    const text = readFileSync(geometryPath, 'utf8');
    const anchor = '  - id: w_strip_east\n    from: v_strip_ne\n';
    assert.equal(text.split(anchor).length - 1, 1, 'w_strip_east 端点锚点必须恰出现一次');
    const baseline = fingerprintsNow();
    // 改宿主墙起点端点（洞声明不动）：d_mb 的解算方向/位置依赖这面墙。
    writeFileSync(geometryPath, text.replace(anchor, '  - id: w_strip_east\n    from: v_st_ne\n'));
    const afterState = fingerprintsNow().state;
    const stale = afterState.control.work_packages
      .filter((pkg: AnyRecord) => afterState.packageProjectFingerprint(pkg) !== baseline.fingerprints.get(pkg.id))
      .map((pkg: AnyRecord) => pkg.id);
    assert.ok(stale.includes('PKG-090'), `PKG-090 只选 openings，宿主墙端点变化后必须 stale；实际 ${stale.join(', ')}`);
  });

  // issue #191 Codex blocking：门洞声明本身不带 wall 字段，父墙只由嵌套位置表达。摘要键
  // 必须带父墙（`source:opening@parentWall`），否则把门洞从一面墙搬到另一面墙，洞的声明
  // 一字未改、指纹不变，而 layout-resolver 已按新宿主墙重算位置/朝向。
  it('门洞换宿主墙：只选 openings 的 PKG-090 必须 stale（摘要键含父墙）', () => {
    const geometryPath = join(sandbox, 'config/layout/model-geometry.yaml');
    const text = readFileSync(geometryPath, 'utf8');
    const opening = '      - { id: d_mb, type: door, anchor: v_mb_ne, offset: 0.45, width: 0.9, height: 2.1, room: master_bath, swing: inward, hinge: start }\n';
    const study = '      - { id: d_study, type: door, anchor: v_mb_ne, offset: 2.4, width: 0.9, height: 2.1, room: study }\n';
    assert.equal(text.split(opening).length - 1, 1, 'd_mb 声明锚点必须恰出现一次');
    assert.equal(text.split(study).length - 1, 1, 'd_study 声明锚点必须恰出现一次');
    const baseline = fingerprintsNow();
    // d_mb 从 w_strip_east 的 openings 段搬到 w_st_north 的 openings 段（洞声明本身不变）。
    writeFileSync(geometryPath, text.replace(opening, '').replace(study, study + opening));
    const afterState = fingerprintsNow().state;
    const stale = afterState.control.work_packages
      .filter((pkg: AnyRecord) => afterState.packageProjectFingerprint(pkg) !== baseline.fingerprints.get(pkg.id))
      .map((pkg: AnyRecord) => pkg.id);
    assert.ok(stale.includes('PKG-090'), `PKG-090 只选 openings，门洞换宿主墙后必须 stale；实际 ${stale.join(', ')}`);
    const pkg090 = afterState.control.work_packages.find((pkg: AnyRecord) => pkg.id === 'PKG-090');
    const keys = Object.keys(afterState.packageProjectSnapshot(pkg090));
    assert.ok(keys.some((key) => key.includes('d_mb@w_st_north')),
      `摘要键必须带父墙（d_mb@w_st_north），实际 ${keys.filter((key) => key.includes('d_mb')).join(', ')}`);
  });

  // issue #191 Codex blocking 第 5 轮兜底一（OI-79）：count-only 商品条目不是 placed 工程对象，
  // 但 SCH-150-02 的 method 原文写着「逐件检查牢固、水平、开合、边角、床垫匹配和主要通道」。
  // 在商品对象化（OI-79）落地前，按房间把这些条目纳入指纹——改床垫必须让 PKG-150 stale。
  // 方向是过度 stale（吵），不是漏 stale（哑）。
  it('兜底一：改 count-only 商品条目（床垫），挂「床垫匹配」的 PKG-150 必须 stale', () => {
    const housePath = join(sandbox, 'config/house.yaml');
    const lines = readFileSync(housePath, 'utf8').split('\n');
    // furnishings 的房键是缩进 2 的 `  <room>:`；条目是缩进 4 的 `    - { ... }`。
    const roomAt = lines.findIndex((line) => /^  bedroom_se:\s*$/.test(line));
    assert.ok(roomAt >= 0, 'config/house.yaml 的 furnishings 必须有 bedroom_se 房键');
    const nextRoom = lines.findIndex((line, i) => i > roomAt && /^  \S/.test(line));
    const roomEnd = nextRoom > 0 ? nextRoom : lines.length;
    const itemAt = lines.findIndex((line, i) => i > roomAt && i < roomEnd && /^    - \{ type: mattress_150 \}\s*$/.test(line));
    assert.ok(itemAt >= 0, 'bedroom_se 段内必须有一条 count-only 的 mattress_150');

    const patched = [...lines];
    patched[itemAt] = '    - { type: mattress_180 }';
    const baseline = fingerprintsNow();
    writeFileSync(housePath, patched.join('\n'));
    const afterState = fingerprintsNow().state;
    const stale = afterState.control.work_packages
      .filter((pkg: AnyRecord) => afterState.packageProjectFingerprint(pkg) !== baseline.fingerprints.get(pkg.id))
      .map((pkg: AnyRecord) => pkg.id)
      .sort();
    assert.ok(stale.includes('PKG-150'),
      `改床垫必须让挂 SCH-150-02「床垫匹配」的 PKG-150 stale；实际 stale：${stale.join(', ') || '（无）'}`);
    // 反向自证：摘要里必须出现 quantity: 键，证明走的是 quantity 兜底而不是别的路径。
    const keys = Object.keys(afterState.packageProjectSnapshot(
      afterState.control.work_packages.find((pkg: AnyRecord) => pkg.id === 'PKG-150')!,
    ));
    assert.ok(keys.some((key) => key.includes(':quantity:')),
      `PKG-150 摘要必须含 quantity: 类的 count-only 条目，实际键 ${keys.filter((k) => k.includes('quantity')).join(', ') || '（无）'}`);
  });

  it('兜底二：改冷凝水候选接入点，挂链上家具的 PKG-150 必须 stale', () => {
    const hvacPath = join(sandbox, 'config/hvac.yaml');
    const lines = readFileSync(hvacPath, 'utf8').split('\n');
    const idAt = lines.findIndex((line) => /^\s*- id: condensate_master_candidate\s*$/.test(line));
    assert.ok(idAt >= 0, 'config/hvac.yaml 必须有 condensate_master_candidate terminal');
    // 该 block 内第一条 position 行（到下一个 `- id:` 之前）。
    const blockEnd = lines.findIndex((line, i) => i > idAt && /^\s*- id:/.test(line));
    const stop = blockEnd > 0 ? blockEnd : lines.length;
    const posAt = lines.findIndex((line, i) => i > idAt && i < stop && /^\s*position: \{/.test(line));
    assert.ok(posAt > idAt, 'condensate_master_candidate block 内必须有 position 行');
    const before = lines[posAt];
    const moved = before.replace(/x:\s*[\d.]+/, 'x: 9.87');
    assert.ok(moved !== before, `必须能改动候选点的 x：${before}`);

    const patched = [...lines];
    patched[posAt] = moved;
    const baseline = fingerprintsNow();
    writeFileSync(hvacPath, patched.join('\n'));
    const afterState = fingerprintsNow().state;
    const stale = afterState.control.work_packages
      .filter((pkg: AnyRecord) => afterState.packageProjectFingerprint(pkg) !== baseline.fingerprints.get(pkg.id))
      .map((pkg: AnyRecord) => pkg.id)
      .sort();
    assert.ok(stale.includes('PKG-150'),
      `改进候选接入点必须让挂链上家具的 PKG-150 stale；实际 stale：${stale.join(', ') || '（无）'}`);
    // 反向自证：摘要里必须出现链声明的输入对象，证明闭包确实跟随了 CONDENSATE_CHAIN_INPUT_IDS。
    const keys = Object.keys(afterState.packageProjectSnapshot(
      afterState.control.work_packages.find((pkg: AnyRecord) => pkg.id === 'PKG-150')!,
    ));
    assert.ok(keys.some((key) => key.includes('condensate_master_candidate')),
      `PKG-150 摘要必须含链输入 condensate_master_candidate，实际键 ${keys.filter((k) => k.includes('condensate')).join(', ') || '（无）'}`);
  });
});
