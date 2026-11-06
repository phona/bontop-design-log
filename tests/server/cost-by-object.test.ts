import assert from 'node:assert/strict';
import process from 'node:process';
import { describe, it } from 'node:test';
import {
  buildObjectLedgerReport,
  hasBusinessLink,
  loadCostByObjectContext,
  renderInventoryReport,
  renderObjectLedger,
  renderOwnershipSummary,
  type CostByObjectContext,
  type ObjectLedger,
} from '../../scripts/schedule/cost-by-object.js';
import { collectDeclaredFurnitureIds } from '../../shared/furniture-object-id.js';
import type { ScheduleState } from '../../shared/schedule-state.js';
import type { FurnishingsYaml } from '../../shared/types.js';

describe('cost:by-object（issue #98 PR-8，真实控制源）', () => {
  const ctx = loadCostByObjectContext(process.cwd());
  const report = buildObjectLedgerReport(ctx);
  const ledgerOf = (ref: string): ObjectLedger => {
    const ledger = [...report.objects, ...report.undecided].find((candidate) => candidate.ref === ref);
    assert.ok(ledger, `对象 ${ref} 应出现在视图里`);
    return ledger;
  };
  const componentOf = (costId: string): Record<string, any> => {
    for (const pkg of ctx.state.control.work_packages ?? []) {
      for (const component of pkg.budget?.components ?? []) {
        if (component.id === costId) return {pkg, component};
      }
    }
    throw new Error(`cost component ${costId} not found`);
  };

  it('控制源本身合法（targets 校验含在 loadScheduleState）', () => {
    assert.deepEqual(ctx.state.errors, []);
  });

  it('COST-100-02 targets 精确等于两件在役浴室柜对象（house.yaml 实际声明 id）', () => {
    const {component} = componentOf('COST-100-02');
    assert.deepEqual(component.targets, ['mb.washbasin_cabinet', 'gbath.vanity']);
    const mb = ledgerOf('mb.washbasin_cabinet');
    assert.equal(mb.roomId, 'master_bedroom');
    assert.equal(mb.type, 'mb_washbasin_cabinet');
    assert.equal(mb.placement, 'absolute');
    const gbath = ledgerOf('gbath.vanity');
    assert.equal(gbath.roomId, 'guest_bath');
    assert.equal(gbath.type, 'vanity');
    assert.equal(gbath.placement, 'wall');
    // 镜柜 gbath.mirror_cabinet 为候选未冻结（house.yaml:591），不在本项 targets——归属只链无歧义对象
    const mirror = component.targets as string[];
    assert.ok(!mirror.includes('gbath.mirror_cabinet'));
  });

  it('COST-160-06 targets = [gbath.robot_dock]，mount 挂 gbath.vanity 的 robot_bay', () => {
    const {component} = componentOf('COST-160-06');
    assert.deepEqual(component.targets, ['gbath.robot_dock']);
    const dock = ledgerOf('gbath.robot_dock');
    assert.equal(dock.placement, 'mount');
    assert.equal(dock.mountHost, 'gbath.vanity');
    assert.ok(ledgerOf('gbath.vanity').mountedChildren.includes('gbath.robot_dock'));
  });

  it('COST-150-01 不登记 targets——D19（owner=业主，触发=二期启动前）拍板前不得擅自认定归属', () => {
    const {component} = componentOf('COST-150-01');
    assert.equal(component.targets, undefined);
    // 登记侧：D19 是 open 的 tracked 决策，带 owner/触发条件（决策铁律 2）
    const d19 = ctx.state.decisionGates.decisions.find((decision) => decision.id === 'D19');
    assert.ok(d19, 'D19 必须已登记在 config/decision-gates.yaml');
    assert.equal(d19.status, 'open');
    assert.equal(d19.scope, 'tracked');
    assert.match(String(d19.tracking_note), /owner=业主/);
    assert.match(String(d19.tracking_note), /二期启动/);
  });

  it('对象 → 工作包走 OBJECT_ID_SOURCES 通道（与 3D 高亮/反查同源）：gbath.vanity→PKG-100、gbath.robot_dock→PKG-160', () => {
    assert.deepEqual(ledgerOf('gbath.vanity').packageLinks.map((link) => link.pkgId), ['PKG-100']);
    assert.deepEqual(ledgerOf('gbath.robot_dock').packageLinks.map((link) => link.pkgId), ['PKG-160']);
    assert.equal(ledgerOf('mb.washbasin_cabinet').packageLinks.length, 0);
  });

  it('gbath.vanity 验收项：包级（PKG-100）+ acceptance.yaml 直接点名', () => {
    const checks = ledgerOf('gbath.vanity').acceptanceChecks;
    assert.ok(checks.some((check) => check.checkId === 'SCH-100-01' && check.via === 'PKG-100 checks'), JSON.stringify(checks));
    const direct = checks.find((check) => check.checkId === 'check_plumb_external_vanity_waterproof');
    assert.ok(direct, 'check_plumb_external_vanity_waterproof 必须经 acceptance.yaml 点名可达');
    assert.equal(direct.via, 'acceptance.yaml 点名');
  });

  it('mb.washbasin_cabinet 无包链接，但验收点名与 pending 经全屋唯一裸类型名可达', () => {
    const ledger = ledgerOf('mb.washbasin_cabinet');
    assert.ok(ledger.aliases.includes('mb_washbasin_cabinet'), 'mb_washbasin_cabinet 全屋唯一，裸类型名是全等别名');
    assert.ok(ledger.acceptanceChecks.some((check) => check.checkId === 'check_plumb_external_vanity_waterproof'));
    assert.ok(ledger.pendingEntries.some((entry) => entry.id === '#61'), JSON.stringify(ledger.pendingEntries));
  });

  it('台账别名通道：gbath.vanity 关联 pending #76（guest_bath.vanity 写法）', () => {
    const pending = ledgerOf('gbath.vanity').pendingEntries;
    assert.ok(pending.some((entry) => entry.id === '#76'), JSON.stringify(pending));
  });

  it('词边界评审回归（2026-11-07 blocking）：gbath.vanity 不再吃子串——pending 只剩真点名行、D19 不误挂', () => {
    const ledger = ledgerOf('gbath.vanity');
    // 修复前：裸 includes 把 `vanity` 吃进 `mb.vanity_base_cabinet` / `faucet_gbath_vanity` 等，
    // 误挂 #42/#44/#55/#59/#75 与决策 D19（评审实测 8 行中 6 行假阳性）。
    assert.deepEqual(ledger.pendingEntries.map((entry) => entry.id).sort(), ['#41', '#76'], JSON.stringify(ledger.pendingEntries));
    // #41 是词边界真命中：行内「…吊架净空，并确认vanity现有服务/检修空间…」独立点名
    // 全屋唯一类型 vanity（docs/pending-site-data.md:129），语义即客卫台盆柜。
    assert.deepEqual(ledger.openDecisions, [], `D19 的 question 只点名条带 7 件，不得经子串挂到 gbath.vanity：${JSON.stringify(ledger.openDecisions)}`);
    assert.deepEqual(ledgerOf('mb.washbasin_cabinet').openDecisions, []);
    // 全局：挂 D19 的对象必须恰好是条带 7 件（决策通道与对象两两核对，防同类子串误挂；
    // 按 ref 去重——3 件条带对象同时有 anti-penetration 引用，同一 ledger 实例会出现在
    // objects 与 undecided 两个清单里）
    const d19Refs = [...new Map([...report.objects, ...report.undecided].map((candidate) => [candidate.ref, candidate])).values()]
      .filter((candidate) => candidate.openDecisions.some((decision) => decision.id === 'D19'))
      .map((candidate) => candidate.ref).sort();
    assert.deepEqual(d19Refs, [
      'mb.condensate_pipe',
      'mb.vanity_base_cabinet',
      'mb.vanity_lower_board',
      'mb.vanity_main_board',
      'mb.vanity_pvc_box',
      'mb.vanity_pvc_service_chase',
      'mb.vanity_pvc_wardrobe_entry',
    ]);
  });

  it('D19 挂在条带 7 件全部对象上（含 4 件无机器引用的对象），全部无成本归属', () => {
    const stripIds = [
      'mb.vanity_base_cabinet',
      'mb.vanity_lower_board',
      'mb.vanity_main_board',
      'mb.vanity_pvc_box',
      'mb.vanity_pvc_wardrobe_entry',
      'mb.vanity_pvc_service_chase',
      'mb.condensate_pipe',
    ];
    assert.equal(report.undecided.length, stripIds.length, JSON.stringify(report.undecided.map((ledger) => ledger.ref)));
    for (const ref of stripIds) {
      const ledger = report.undecided.find((candidate) => candidate.ref === ref);
      assert.ok(ledger, `${ref} 必须出现在「成本归属未定」里`);
      assert.ok(ledger.openDecisions.some((decision) => decision.id === 'D19'), `${ref} 必须挂 D19`);
      assert.equal(hasBusinessLink(ledger), false, `${ref} 不得有业务链接（归属未定）`);
      assert.deepEqual(ledger.costItems, []);
    }
    // 反向：有归属对象不进「成本归属未定」
    assert.ok(!report.undecided.some((ledger) => ledger.ref === 'gbath.vanity'));
  });

  it('无参数汇总：有归属 3 件、共担成本项去重合计 ¥6,599', () => {
    const owned = report.objects.filter(hasBusinessLink);
    assert.deepEqual(owned.map((ledger) => ledger.ref).sort(), ['gbath.robot_dock', 'gbath.vanity', 'mb.washbasin_cabinet']);
    const summary = renderOwnershipSummary(report);
    assert.match(summary, /¥6,599/);
    assert.match(summary, /2 对象共担/);
    // 未定归属不进金额：D19 行不得带 planned 金额
    assert.match(summary, /成本归属未定（开放决策点名，非归属认定）/);
  });

  it('单对象视图：gbath.vanity 全链（包/成本项/planned/实际侧）可渲染', () => {
    const text = renderObjectLedger(ledgerOf('gbath.vanity'));
    assert.match(text, /MODEL-PKG-100 → PKG-100/);
    assert.match(text, /COST-100-02「浴室柜台盆和镜柜」/);
    assert.match(text, /planned ¥3,500/);
    assert.match(text, /合同 — · 已付 ¥0/, '实际侧取 PKG-100 budget 的 contracted/paid 登记');
    assert.match(text, /挂载子件：gbath\.robot_dock/);
  });

  it('inventory（真实控制源）：0 legacy、0 悬挂，五通道 + 宿主/包链接通道齐活', () => {
    assert.equal(report.declaredCountOnlyCount, 0, 'PR-7 后 count-only 条目不声明 id');
    assert.equal(report.legacyRefs.length, 0, 'PR-7 全屋稳定 id 后不应再有 legacy 引用');
    assert.equal(report.danglingRefs.length, 0);
    const dock = ledgerOf('gbath.robot_dock');
    for (const channel of ['anti_penetration_pair', 'cost_target', 'model_package_link']) {
      assert.ok(dock.references.some((ref) => ref.channel === channel), `${dock.ref} 缺通道 ${channel}`);
    }
    const vanity = ledgerOf('gbath.vanity');
    for (const channel of ['anti_penetration_pair', 'cost_target', 'acceptance_text', 'house_mount_host', 'model_package_link']) {
      assert.ok(vanity.references.some((ref) => ref.channel === channel), `${vanity.ref} 缺通道 ${channel}`);
    }
    const tall = ledgerOf('ld.wall_cabinet_tall');
    for (const channel of ['electrical_mount_anchor', 'render_override']) {
      assert.ok(tall.references.some((ref) => ref.channel === channel), `${tall.ref} 缺通道 ${channel}`);
    }
    const washer = ledgerOf('balcony.washer');
    assert.ok(washer.references.some((ref) => ref.channel === 'anti_penetration_pair'));
    const inventory = renderInventoryReport(report);
    assert.match(inventory, /legacy `furniture:\*` 引用：\*\*0\*\* 条/);
    assert.match(inventory, /悬挂引用（对象匹配不到）：\*\*0\*\* 条/);
    assert.match(inventory, /被机器绑定引用的对象：\*\*22\*\* 件/);
  });
});

describe('cost:by-object 沙箱负例（legacy 引用 / 悬挂引用 / count-only）', () => {
  /** 最小 ScheduleState：buildObjectLedgerReport 只消费这五个字段。 */
  function sandboxCtx(furnishings: FurnishingsYaml, antiPenetration: Record<string, any>, workPackages: any[]): CostByObjectContext {
    const state = {
      control: {work_packages: workPackages},
      acceptance: {phases: []},
      acceptanceById: new Map(),
      modelPackageLinks: {links: [], authorities: {}},
      decisionGates: {version: 1, decisions: []},
    } as unknown as ScheduleState;
    return {
      state,
      furnishings,
      declared: collectDeclaredFurnitureIds(furnishings),
      antiPenetration,
      electricalPoints: [],
      overridesText: '',
      pendingText: '',
    };
  }

  it('legacy furniture:* 引用进迁移待办并带出唯一同型条目的摆位', () => {
    const furnishings = {study: [{type: 'desk', id: 'study.desk', x: 1, z: 2}]} as unknown as FurnishingsYaml;
    const ctx = sandboxCtx(furnishings, {waivers: [{id: 'w1', pair: ['furniture:study:desk:0']}]}, []);
    const report = buildObjectLedgerReport(ctx);
    assert.equal(report.legacyRefs.length, 1);
    const legacy = report.legacyRefs[0];
    assert.equal(legacy.ref, 'furniture:study:desk:0');
    assert.equal(legacy.stable, false);
    assert.equal(legacy.roomId, 'study');
    assert.equal(legacy.type, 'desk');
    assert.equal(legacy.placement, 'absolute');
    assert.equal(report.danglingRefs.length, 0);
  });

  it('既非稳定 id 也非 legacy 形式的引用 → 悬挂引用显形', () => {
    const furnishings = {study: [{type: 'desk', id: 'study.desk', x: 1, z: 2}]} as unknown as FurnishingsYaml;
    const ctx = sandboxCtx(furnishings, {waivers: [{id: 'w1', pair: ['study.desk_typo']}]}, []);
    const report = buildObjectLedgerReport(ctx);
    assert.equal(report.danglingRefs.length, 1);
    assert.equal(report.danglingRefs[0].ref, 'study.desk_typo');
    assert.equal(report.danglingRefs[0].channel, 'anti_penetration_pair');
  });

  it('成本项 targets 指向 count-only id：不进归属、显形为引用异常（schedule-state 另有 error 拦截）', () => {
    const furnishings = {
      study: [
        {type: 'desk', id: 'study.desk', x: 1, z: 2},
        {type: 'curtain_set', id: 'study.curtain_bad'},
      ],
    } as unknown as FurnishingsYaml;
    const workPackages = [{id: 'PKG-X', budget: {components: [{id: 'COST-X-01', name: 'x', targets: ['study.curtain_bad'], planned_cny: 1}]}}];
    const ctx = sandboxCtx(furnishings, {waivers: []}, workPackages);
    const report = buildObjectLedgerReport(ctx);
    assert.equal(report.declaredCountOnlyCount, 1);
    assert.ok(!report.objects.some((ledger) => ledger.ref === 'study.curtain_bad'), 'count-only 不得进入归属视图');
    assert.ok(report.danglingRefs.some((ref) => ref.ref === 'study.curtain_bad' && ref.channel === 'cost_target'));
  });

  it('多房同型的裸类型名不匹配（curtain_set 出现两房，散文提及不挂到任何一件）', () => {
    const furnishings = {
      study: [{type: 'curtain_set', id: 'study.curtain'}],
      bedroom_nw: [{type: 'curtain_set', id: 'bnw.curtain'}],
    } as unknown as FurnishingsYaml;
    const ctx = sandboxCtx(furnishings, {waivers: []}, []);
    ctx.overridesText = '某 reason 提到 curtain_set 但没说哪间房';
    const report = buildObjectLedgerReport(ctx);
    assert.equal(report.objects.length, 0, '裸类型名在多房同型时不得产生引用通道');
  });

  it('词边界：唯一类型 vanity 不得吃进 mb_vanity_base_cabinet / vanity_layout，真裸词要能命中', () => {
    const furnishings = {guest_bath: [{type: 'vanity', id: 'gbath.vanity', wall: 'w'}]} as unknown as FurnishingsYaml;
    const base = () => sandboxCtx(furnishings, {waivers: []}, []);
    // 陷阱文本：只有子串形态（mb_vanity_base_cabinet / vanity_layout / 带点 id 片段），无独立裸词。
    // 点号必须在边界排除类里，否则裸 vanity 会吃进 mb.vanity_base_cabinet（评审 2026-11-07 blocking）。
    const trap = base();
    trap.overridesText = '提到 mb_vanity_base_cabinet、mb.vanity_base_cabinet 与 vanity_layout 的行';
    assert.equal(buildObjectLedgerReport(trap).objects.length, 0, '词边界必须挡住下划线与点号两种子串误匹配');
    // 对照：真正的裸词提及要能建立 render_override 引用（否则唯一裸类型名通道失效）
    const hit = base();
    hit.overridesText = '某行提到裸词 vanity 本身';
    const report = buildObjectLedgerReport(hit);
    const vanity = report.objects.find((ledger) => ledger.ref === 'gbath.vanity');
    assert.ok(vanity, '裸词提及必须建立引用');
    assert.ok(vanity.references.some((ref) => ref.channel === 'render_override'));
  });
});
