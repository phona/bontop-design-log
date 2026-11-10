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
import { ALL_MODEL_TARGET } from '../../shared/package-objects.js';
import { loadScheduleState, type ScheduleState } from '../../shared/schedule-state.js';

type AnyRecord = Record<string, any>;

const repoRoot = process.cwd();
const links = loadModelPackageLinks();
const control = parseYaml(readFileSync('schedule/phase-1/control.yaml', 'utf8')) as AnyRecord;
const acceptance = parseYaml(readFileSync('config/acceptance.yaml', 'utf8')) as AnyRecord;
const state = loadScheduleState(repoRoot, {modelPackageLinks: links});

const packages: AnyRecord[] = control.work_packages;

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
  const items: AnyRecord[] = acceptance.phases.flatMap((phase: AnyRecord) => phase.items as AnyRecord[]);

  it('67 条验收项都登记了 objects.from_packages，且与 acceptance_refs 反查集合一致', () => {
    assert.equal(items.length, 67, 'acceptance.yaml 必须 67 条');
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

    // PKG-150（一期家具 = furnishings all）与 PKG-142（临时入住整屋放行，project_scope）
    // 是仅有的两个相关包；其余 23 个包（含同样引用 house.yaml 的 PKG-100/110/160）必须不动。
    assert.deepEqual(stale, ['PKG-142', 'PKG-150']);
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
});
