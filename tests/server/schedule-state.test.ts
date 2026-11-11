// shared/schedule-state.ts 的回归测试（自装交互审批第一步，2026-11-02）。
//
// 守什么：loader 是 server/前端/CLI 三方共用的唯一判定源，它一旦失真，
// 交互审批的「机械卡点」整体失据。这里钉四件事：
//   ① 真实仓集成：包数/检查数/未报价数/门禁阻塞数与 verify:schedule 汇总行同源；
//   ② next-action：三线索分类齐全、排序按「解除下游」、两次计算深相等（确定性）；
//   ③ stale 双线索：缺指纹/指纹变/指纹对 三种输入的判定文案逐字不变；
//   ④ 沙箱负例：control.yaml 登记值改坏，loader 必须原样吐出校验错误文案
//      （与 control-contract-validation.test.ts 同一农场手法，那里 spawn CLI，
//      这里直接调 loader——两条路守的是同一份判定）。

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildScheduleSnapshot, computeNextActions, loadScheduleState } from '../../shared/schedule-state.js';
import { loadModelPackageLinks } from '../../server/model-package-links.js';
import { collectFinishRecipeIds } from '../../shared/finish/input.js';

type AnyRecord = Record<string, any>;

const repoRoot = process.cwd();

function loadRealState() {
  return loadScheduleState(repoRoot, {modelPackageLinks: loadModelPackageLinks()});
}

describe('shared/schedule-state: 真实仓集成', () => {
  it('加载无错误，包/检查/未报价计数与 verify:schedule 汇总行同源', () => {
    const state = loadRealState();
    assert.deepEqual(state.errors, []);
    // 2026-11-02 实测锚点（npm run verify:schedule）：
    // 25 phase-1 packages, 106 cost components (89 unpriced), 116 auditable checks
    // 2026-11-11 先定门再贴砖门禁新增 check_tile_door_gate（PKG-060 acceptance_refs）→ 117。
    // orderedPackages 按原语义过滤 sequence<900（PKG-900 预备金不进施工顺序），故 24。
    assert.equal(state.control.work_packages.length, 25);
    assert.equal(state.orderedPackages.length, 24);
    assert.equal(state.componentIds.size, 106);
    assert.equal(state.unpricedComponents.length, 89);
    assert.equal(state.usedCheckIds.size, 117);
    // 当前真实状态：25 包全部 blocked、0 个 ready（design v2 §4 的口径）
    assert.equal(state.orderedPackages.filter((pkg: AnyRecord) => state.effectiveReadiness(pkg) === 'ready').length, 0);
    assert.ok(state.openDecisionGates.length >= 1, '至少一条 open 决策门禁');
    assert.ok(state.openGatedCheckCount >= 1, 'open 门禁必须阻塞检查');
  });

  it('snapshot 是纯数据：结构完整且可 JSON 往返', () => {
    const snapshot = buildScheduleSnapshot(loadRealState());
    // 全量 25 个包（含 PKG-900 预备金侧车道）
    assert.equal(snapshot.packages.length, 25);
    assert.equal(snapshot.counts.packages, 25);
    assert.equal(snapshot.phase.ceiling_cny, 210099);
    assert.equal(snapshot.counts.ready_packages, 0);
    assert.ok(snapshot.data_fingerprint.length === 64);
    const pkg900 = snapshot.packages.find((pkg) => pkg.id === 'PKG-900');
    assert.ok(pkg900, 'PKG-900 硬装预备金必须作为侧车道出现在 snapshot 里');
    assert.equal(pkg900!.payment_gate, 'GATE-900-OWNER-APPROVAL');
    const pkg060 = snapshot.packages.find((pkg) => pkg.id === 'PKG-060');
    assert.ok(pkg060, 'PKG-060 必须在 snapshot 里');
    assert.equal(pkg060!.effective_readiness, 'blocked');
    assert.ok(pkg060!.checks.length >= 7, 'PKG-060 acceptance_refs 7 项');
    assert.equal(pkg060!.gate_status, 'pending');
    assert.ok(pkg060!.project_fingerprint.length === 64);
    const hollow = pkg060!.checks.find((check) => check.id === 'check_tile_hollow');
    assert.equal(hollow?.source, 'acceptance');
    assert.equal(hollow?.pass_condition, '单片空鼓率 < 15%，整面墙 < 5%');
    assert.equal(hollow?.audit_status, undefined, '无审计记录时 audit_status 为 undefined');
    assert.ok(hollow!.evidence_required.length > 0, '必需证据类型必须在投影里');
    assert.equal(JSON.parse(JSON.stringify(snapshot)).counts.packages, 25);
  });
});

describe('shared/schedule-state: next-action', () => {
  it('三线索分类齐全，按解除下游数量降序', () => {
    const state = loadRealState();
    const actions = computeNextActions(state);
    const kinds = new Set(actions.map((item) => item.kind));
    assert.ok(kinds.has('decision_gate'), '待拍板门禁必须出现');
    assert.ok(kinds.has('quote_pending'), '待询价组件必须出现');
    assert.ok(kinds.has('external_blocker'), '系统外阻塞项必须单列');
    for (let index = 1; index < actions.length; index += 1) {
      assert.ok(actions[index - 1].unblocks >= actions[index].unblocks, 'unblocks 必须降序');
    }
    const gate = actions.find((item) => item.kind === 'decision_gate')!;
    assert.match(gate.title, /^拍板 D\d+：/);
    const blocker = actions.find((item) => item.kind === 'external_blocker')!;
    assert.match(blocker.detail, /^解除条件：/);
  });

  it('确定性：同一 state 两次计算深相等', () => {
    const state = loadRealState();
    assert.deepEqual(computeNextActions(state), computeNextActions(state));
  });
});

describe('shared/schedule-state: stale 双线索', () => {
  it('缺指纹 / 指纹变 / 指纹对 三种输入判定正确', () => {
    const state = loadRealState();
    const pkg = state.control.work_packages.find((item: AnyRecord) => item.id === 'PKG-060');
    const checkId = 'check_tile_hollow';
    const currentSpec = state.checkSpecHash(pkg, checkId);
    const currentData = state.packageProjectFingerprint(pkg);
    assert.ok(currentSpec.length === 64 && currentData.length === 64);

    // ① 两条指纹都缺
    assert.deepEqual(
      state.staleAuditReason(pkg, checkId, {status: 'passed'}),
      ['验收记录缺少检查标准指纹', '验收记录缺少项目数据指纹'],
    );
    // ② 指纹在但已变（配置改过的旧通过记录）
    assert.deepEqual(
      state.staleAuditReason(pkg, checkId, {status: 'passed', check_spec_sha256: '0'.repeat(64), project_data_sha256: '0'.repeat(64)}),
      ['检查标准已变化', '项目数据已变化'],
    );
    // ③ 指纹对得上——当前通过
    assert.deepEqual(
      state.staleAuditReason(pkg, checkId, {status: 'passed', check_spec_sha256: currentSpec, project_data_sha256: currentData}),
      [],
    );
  });
});

describe('shared/schedule-state: 沙箱负例（symlink 农场，锚点文本手术）', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'schedule-state-'));
  let pristineControlText = '';

  before(() => {
    for (const entry of readdirSync(repoRoot)) {
      if (entry === '.git' || entry === 'node_modules' || entry === 'schedule' || entry === 'contracts') continue;
      symlinkSync(join(repoRoot, entry), join(sandbox, entry));
    }
    symlinkSync(join(repoRoot, 'node_modules'), join(sandbox, 'node_modules'));
    cpSync(join(repoRoot, 'schedule'), join(sandbox, 'schedule'), {recursive: true});
    cpSync(join(repoRoot, 'contracts'), join(sandbox, 'contracts'), {recursive: true});
    pristineControlText = readFileSync(join(sandbox, 'schedule/phase-1/control.yaml'), 'utf8');
  });

  after(() => {
    rmSync(sandbox, {recursive: true, force: true});
  });

  it('未篡改的农场副本加载无错误（loader 在复制树上同样成立）', () => {
    const state = loadScheduleState(sandbox, {modelPackageLinks: loadModelPackageLinks(join(sandbox, 'config/model-package-links.yaml'))});
    assert.deepEqual(state.errors, []);
    assert.equal(state.control.work_packages.length, 25);
  });

  it('allocated_cny 登记值改坏：loader 原样吐出校验错误文案', () => {
    const anchor = 'allocated_cny: 210099';
    const occurrences = pristineControlText.split(anchor).length - 1;
    assert.equal(occurrences, 1, `锚点 ${anchor} 必须恰出现一次（实际 ${occurrences}）——锚点漂移时本测试当场点名`);
    writeFileSync(
      join(sandbox, 'schedule/phase-1/control.yaml'),
      pristineControlText.replace(anchor, 'allocated_cny: 210001'),
    );
    try {
      const state = loadScheduleState(sandbox, {modelPackageLinks: loadModelPackageLinks(join(sandbox, 'config/model-package-links.yaml'))});
      assert.ok(
        state.errors.includes('allocated mismatch: computed=210099, declared=210001'),
        `必须原样报告 allocated mismatch，实际 errors：${state.errors.join(' | ')}`,
      );
      // 同一处漂移必须同时打到 roadmap 镜像校验（两处对账不是一处）
      assert.ok(
        state.errors.some((error) => error.includes('roadmap allocated mismatch')),
        `roadmap 镜像校验必须同时报，实际 errors：${state.errors.join(' | ')}`,
      );
    } finally {
      writeFileSync(join(sandbox, 'schedule/phase-1/control.yaml'), pristineControlText);
    }
  });

  // 2026-11-07（issue #98 第三阶段 S6）：成本项 targets 只收**对象** id，不收面层配方 id。
  // S4 起墙贴砖带/涂装带、防水台与飘窗的贴砖/涂装面、S5 起派生的踢脚带都是宿主对象身上的
  // 派生量；它们与对象 id 同为稳定字符串，任何 schema 都区分不了——只能按配方住处
  // （shared/finish/input.ts 的 collectFinishRecipeIds）枚举后拦截（迁移设计 §5.7：
  // 否则按对象算账视图被 109 个配方稀释）。
  it('成本项 targets 写面层配方 id：loader 显式拦截并点名配方住处', () => {
    const anchor = 'targets: [mb.washbasin_cabinet, gbath.vanity]';
    const occurrences = pristineControlText.split(anchor).length - 1;
    assert.equal(occurrences, 1, `锚点 ${anchor} 必须恰出现一次（实际 ${occurrences}）——锚点漂移时本测试当场点名`);
    writeFileSync(
      join(sandbox, 'schedule/phase-1/control.yaml'),
      pristineControlText.replace(anchor, 'targets: [walltile_kitchen_ent_west, skirt_master_bedroom_w_mb_east]'),
    );
    try {
      const state = loadScheduleState(sandbox, {modelPackageLinks: loadModelPackageLinks(join(sandbox, 'config/model-package-links.yaml'))});
      for (const target of ['walltile_kitchen_ent_west', 'skirt_master_bedroom_w_mb_east']) {
        assert.ok(
          state.errors.some((error) => error.includes(`cost target "${target}" 是面层配方 id`)),
          `配方 id ${target} 必须被显式拦截，实际 errors：${state.errors.join(' | ')}`,
        );
      }
      // 拦截文案要说清「只收对象 id」，否则写错的人不知道该改成什么
      assert.ok(
        state.errors.some((error) => error.includes('targets 只收对象 id')),
        `拦截文案必须写明口径，实际 errors：${state.errors.join(' | ')}`,
      );
    } finally {
      writeFileSync(join(sandbox, 'schedule/phase-1/control.yaml'), pristineControlText);
    }
  });

  it('配方 id 全集覆盖四类配方且不含任何对象 id', () => {
    const recipes = collectFinishRecipeIds();
    // 四类配方都在册：墙贴砖带 / 墙涂装带 / 防水台与飘窗的贴砖涂装面 / 派生踢脚带
    assert.ok(recipes.has('walltile_kitchen_ent_west'), '墙贴砖带 id 应在册');
    assert.ok(recipes.has('paint_living_dining_w_cent_south'), '墙涂装带 id 应在册');
    assert.ok(recipes.has('silltile_kitchen_north_bay_front'), '防水台贴砖面 id 应在册');
    assert.ok(recipes.has('skirt_master_bedroom_w_mb_east'), '派生踢脚带 id 应在册');
    assert.ok(recipes.size >= 100, `配方 id 应 ≥100（18 砖带 + 31 漆带 + 28 窗台面 + 24 派生踢脚），实际 ${recipes.size}`);
    // 宿主对象 id 不在册——否则拦截会误伤合法 targets
    for (const objectId of ['kitchen_north_bay', 'mb.washbasin_cabinet', 'gbath.vanity', 'w_kit_west', 'ceiling_living']) {
      assert.ok(!recipes.has(objectId), `对象 id ${objectId} 不得进配方集合`);
    }
  });
});
