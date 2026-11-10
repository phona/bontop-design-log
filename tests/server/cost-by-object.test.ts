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

  it('COST-150-01 targets = 条带柜组 7 件（DEC-2026-10-07-R02 裁定④的对象关联）；金额边界仍 D19 未拍板', () => {
    // 2026-11-07（issue #98 PR-11）口径修正：PR-8 曾断言「COST-150-01 不登记 targets」
    // （把业主「按开放项显形，不裁定」的裁定落实为「拍板前不挂对象」）。PR-11 改为按
    // 裁定④已定的对象→成本项关联机器化：targets 登记的是「哪些对象归本项跟踪」，
    // 不是金额裁定——D19 问的是含不含 P2-100 的 3000-5000、要不要 P2-101，仍开放。
    const {pkg, component} = componentOf('COST-150-01');
    assert.deepEqual(component.targets, [
      'mb.vanity_base_cabinet',
      'mb.vanity_lower_board',
      'mb.vanity_main_board',
      'mb.vanity_pvc_box',
      'mb.vanity_pvc_wardrobe_entry',
      'mb.vanity_pvc_service_chase',
      'mb.condensate_pipe',
    ]);
    // 不裁定：金额侧零结论——planned 维持 0、不新增 P2 行、推断区间不进 targets
    assert.equal(component.planned_cny, 0);
    assert.equal(component.status, 'deferred_to_phase_2');
    // 衣柜名件不进 targets（本项现名的对象引用在 description；其归属不在 D19 问价范围）
    assert.ok(!(component.targets as string[]).includes('mb.wardrobe_950'));
    assert.ok(!(component.targets as string[]).includes('mb.wardrobe_pelmet'));
    // 与 COST-100-02 不双计：mb.washbasin_cabinet 归 COST-100-02，不进本项
    assert.ok(!(component.targets as string[]).includes('mb.washbasin_cabinet'));
    assert.equal(pkg.id, 'PKG-150');
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
    assert.deepEqual(ledgerOf('mb.washbasin_cabinet').packageLinks.map((link) => link.pkgId), ['PKG-100', 'P2-100']);
  });

  it('gbath.vanity 验收项：包级（PKG-100）+ acceptance.yaml 直接点名', () => {
    const checks = ledgerOf('gbath.vanity').acceptanceChecks;
    assert.ok(checks.some((check) => check.checkId === 'SCH-100-01' && check.via === 'PKG-100 checks'), JSON.stringify(checks));
    const direct = checks.find((check) => check.checkId === 'check_plumb_external_vanity_waterproof');
    assert.ok(direct, 'check_plumb_external_vanity_waterproof 必须经 acceptance.yaml 点名可达');
    assert.equal(direct.via, 'acceptance.yaml 点名');
  });

  it('mb.washbasin_cabinet 经 MODEL-PKG-100 的 id 直选有包链接，验收点名与自带 blocker 可达', () => {
    const ledger = ledgerOf('mb.washbasin_cabinet');
    assert.deepEqual(ledger.packageLinks.map((link) => link.pkgId), ['PKG-100', 'P2-100'],
      'issue #191：PKG-100 的 ids 含 mb_washbasin_cabinet；P2-100 的 room_ids [master_bedroom] 改 ids 后也覆盖它');
    assert.ok(ledger.aliases.includes('mb_washbasin_cabinet'), 'mb_washbasin_cabinet 全屋唯一，裸类型名是全等别名');
    assert.ok(ledger.acceptanceChecks.some((check) => check.checkId === 'check_plumb_external_vanity_waterproof'));
    // 注意：mb.washbasin_cabinet 是**家具对象**，本身没有 status/blocker 字段（那四个实体
    // 类型才有）。它的未决性经同区的电气/给排水构件显形——sock_mbath_vanity 与
    // faucet_mbath_vanity 都带 blocker（#61 主卫镜柜/台盆柜型式）。原手账 #61 行的语义
    // 由这两个构件承接，故此处不断言本对象自带 pending。
    assert.ok(ledger.acceptanceChecks.length > 0, '验收点名通道仍可达');
  });

  // 2026-11-08 S2-B：原「台账别名通道」随量房手账退场——未决项的单一源已是对象自己的
  // blocker 字段，不再有跨对象的散文别名匹配。等价断言改为：对象自己的 blocker 就是它的
  // pending 条目，且带齐四字段。
  // 2026-11-08 S2-B：原「台账别名通道」与「词边界评审回归」两条测试随量房手账整份退役。
  // 它们测的是「扫描手账表格行 → 词边界匹配 → 挂到对象别名」这条通道，文件没了机制就没了。
  // 新单一源下，未决性住在电气/给排水/吊顶/HVAC 构件自己的 blocker 字段上
  // （由 tests/server/element-state.test.ts 的 blocker 门禁与 decision-knowledge 的 landing 词表守），
  // 而 cost-by-object 的视图以**家具对象**为行——家具对象本身没有 status/blocker 字段，
  // 故本视图不再有「pending 可达」这一列。
  // ⚠ 移交缺口（owner=AI 会话，触发=S3 之后）：家具对象不再显形其同区构件的 blocker，
  // 读成本视图的人看不到「这个台盆柜还卡着」。若要补，应在 cost-by-object 里加一条
  // 「同区构件 blocker 汇总」通道，按 room + 服务关系关联，而不是恢复散文别名匹配。
  it('S2-B 后家具对象的 pending 通道已退役（缺口已登记移交）', () => {
    assert.equal(ledgerOf('gbath.vanity').pendingEntries.length, 0,
      '家具对象无 blocker 字段，pendingEntries 恒空——这是设计结果不是缺陷');
  });

  it('词边界评审回归（2026-11-07 blocking）：gbath.vanity 不再吃子串——pending 只剩真点名行、D19 不误挂', () => {
    const ledger = ledgerOf('gbath.vanity');
    // 修复前：裸 includes 把 `vanity` 吃进 `mb.vanity_base_cabinet` / `faucet_gbath_vanity` 等，
    // 误挂 #42/#44/#55/#59/#75 与决策 D19（评审实测 8 行中 6 行假阳性）。
    // 单一源后没有「子串吃错行」这一失效模式——对象只可能关联自己的 blocker。
    // 原子串误挂（vanity 吃进 mb.vanity_base_cabinet / faucet_gbath_vanity 等 6 行假阳性）
    // 在单一源下不可能再发生：没有跨对象散文可被吃。家具对象恒空即证。
    assert.deepEqual(ledger.pendingEntries, [], JSON.stringify(ledger.pendingEntries));
    assert.deepEqual(ledger.openDecisions, [], `D19 的 question 只点名条带 7 件，不得经子串挂到 gbath.vanity：${JSON.stringify(ledger.openDecisions)}`);
    assert.deepEqual(ledgerOf('mb.washbasin_cabinet').openDecisions, []);
    // 全局：挂 D19 的对象必须恰好是条带 7 件（决策通道与对象两两核对，防同类子串误挂；
    // 衣柜对象不得挂 D19——其归属不在本决策问价范围，D19 options 只以非 id 写法提衣柜名件）
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

  it('D19 挂在条带 7 件全部对象上；PR-11 起 7 件同时有 P2-100 包链接与 COST-150-01 成本项', () => {
    // 2026-11-07（issue #98 PR-11）：条带柜组业务关联落地——MODEL-P2-100 改按对象 id
    // 选（原 types 选择器对 furnishings 是 silent no-op）+ COST-150-01 targets 登记。
    // 7 件自此有业务链接，「成本归属未定」汇总表不再收它们（该表现在为空）；D19 的
    // 显形口改为各对象单对象视图的「关联决策门禁」节 + 决策登记表 + description 散文。
    const stripIds = [
      'mb.vanity_base_cabinet',
      'mb.vanity_lower_board',
      'mb.vanity_main_board',
      'mb.vanity_pvc_box',
      'mb.vanity_pvc_wardrobe_entry',
      'mb.vanity_pvc_service_chase',
      'mb.condensate_pipe',
    ];
    assert.equal(report.undecided.length, 0, `「被开放决策点名且无业务链接」应无对象：${JSON.stringify(report.undecided.map((ledger) => ledger.ref))}`);
    for (const ref of stripIds) {
      const ledger = ledgerOf(ref);
      assert.ok(ledger, `${ref} 必须出现在视图里`);
      assert.ok(ledger.openDecisions.some((decision) => decision.id === 'D19'), `${ref} 必须挂 D19`);
      assert.equal(hasBusinessLink(ledger), true, `${ref} 应有业务链接（P2-100 包 + COST-150-01 成本项）`);
      assert.deepEqual(ledger.costItems.map((item) => item.costId), ['COST-150-01'], `${ref} 的成本项应恰为 COST-150-01`);
      assert.deepEqual(ledger.packageLinks.map((link) => link.pkgId), ['P2-100'], `${ref} 的包链接应恰为 P2-100`);
    }
    // 反向：有归属对象不进「成本归属未定」
    assert.ok(!report.undecided.some((ledger) => ledger.ref === 'gbath.vanity'));
  });

  it('无参数汇总：有归属 51 件（issue #191 起 room_ids/types 改 ids 后包链接通道覆盖真实家具）、共担成本项去重合计 ¥6,599', () => {
    // 2026-11-10（issue #191）：12 → 51。原因是 model-package-links 的 19 处 room_ids/types
    // 选择器改成对象 id 直选后，MODEL-PKG-110/160/P2-010/P2-020/P2-030/P2-060/P2-100/
    // P2-120/P2-140/P3-030 的包链接第一次真正指名家具对象（此前 types 对 furnishings 是
    // silent no-op，room_ids 只记房间）。这 51 件是「有包链接或成本项」的真实集合，
    // 逐件列出而不是只报数量——包/对象关联漂移时本断言当场点名。
    const owned = report.objects.filter(hasBusinessLink);
    assert.deepEqual(owned.map((ledger) => ledger.ref).sort(), [
      'balcony.dryer',
      'balcony.washer',
      'bnw.bed_150',
      'bnw.chair',
      'bnw.desk',
      'bnw.shelf',
      'bnw.wardrobe_180',
      'gbath.exhaust_fan',
      'gbath.mirror_cabinet',
      'gbath.robot_dock',
      'gbath.toilet',
      'gbath.vanity',
      'kitchen.cabinet_run_east',
      'kitchen.cabinet_run_north_east',
      'kitchen.cabinet_run_north_west',
      'kitchen.countertop_bridge',
      'kitchen.dishwasher',
      'kitchen.gas_stove',
      'kitchen.range_hood',
      'kitchen.sink',
      'kitchen.water_heater',
      'ld.coffee_table',
      'ld.floor_lamp',
      'ld.fridge',
      'ld.plant_fiddle',
      'ld.tv_65',
      'ld.tv_wall_low',
      'ld.wall_cabinet_tall',
      'mb.bed_180',
      'mb.bedside_cabinet_north',
      'mb.bedside_cabinet_south',
      'mb.condensate_pipe',
      'mb.dressing_stool',
      'mb.dressing_table',
      'mb.low_dresser',
      'mb.vanity_base_cabinet',
      'mb.vanity_lower_board',
      'mb.vanity_main_board',
      'mb.vanity_pvc_box',
      'mb.vanity_pvc_service_chase',
      'mb.vanity_pvc_wardrobe_entry',
      'mb.wardrobe_950',
      'mb.wardrobe_pelmet',
      'mb.washbasin_cabinet',
      'mbath.exhaust_fan',
      'mbath.toilet',
      'study.chair',
      'study.desk',
      'study.seasonal_wardrobe_step_north',
      'study.seasonal_wardrobe_step_south',
      'study.seasonal_wardrobe_wall',
    ]);
    const summary = renderOwnershipSummary(report);
    assert.match(summary, /¥6,599/);
    assert.match(summary, /2 对象共担/);
    // COST-150-01 planned=0（二期 deferred）进合计但不加钱；7 件条带共担该项、
    // 与衣柜 9 件共担 P2-100 包链接，金额仍只有 COST-100-02/160-06 两项有数
    assert.match(summary, /COST-150-01/);
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
    // 2026-11-07（issue #98 PR-11）：条带 7 件 + 衣柜 2 件经 MODEL-P2-100 的 select.ids
    // 进反查（pvc_box/wardrobe_entry/service_chase/condensate_pipe 4 件此前零机器引用），
    // 22 → 26 件。
    // 2026-11-10（issue #191）：model-package-links 的 19 处 room_ids/types 选择器改 ids 后，
    // model_package_link 通道能反查到真实家具对象（此前 furnishings 的 types 选择器按
    // sceneElements 匹配，家具对象从不命中；room_ids 只记房间）。26 → 53 件是通道变真，
    // 不是新造引用——总 placed 67 件中未挂任何机器引用的只剩 14 件。
    assert.match(inventory, /被机器绑定引用的对象：\*\*53\*\* 件/);
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
      pendingCount: 39,
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
