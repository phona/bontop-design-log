import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { hvacPlanOptions } from '../../shared/hvac-plans.js';
import { ProjectCatalog } from '../../server/project-catalog.js';

/**
 * config/hvac.yaml → HVAC 选项的纯映射（2026-10-13 阶段 3）。
 *
 * 取代 shared/houseData.ts 的七套 invented 报价表。守两条：
 *   ① 没有价格的方案不许进预算（会静默变成 0 元）；
 *   ② data.status 由 commercial.status 透传，候选价门控据此分流，
 *      所以 SYNTHETIC_UNVERIFIED_TOPICS 白名单可以清空。
 */

test('真实配置：一个成交方案，36,000，status=contracted', () => {
  const options = hvacPlanOptions(parseYaml(readFileSync('config/hvac.yaml', 'utf8')));
  assert.equal(options.length, 1);
  const [plan] = options;
  assert.equal(plan.id, 'A2');
  assert.equal(plan.price_per_unit, 36000);
  assert.equal((plan.data as { status: string }).status, 'contracted');
  assert.equal((plan.data as { commercial: { decision_ref: string } }).commercial.decision_ref, 'DEC-2026-10-04-R1');
  // 外机：config/hvac.yaml 的 outdoor（platform: west_platform）→ OutdoorUnit
  assert.deepEqual(plan.outdoorUnits, [{ location: 'platform', w: 0.99, d: 0.4, h: 0.81 }]);
  // 内机：load_design.rooms 六间（客餐厅两条热区 + 四卧）
  assert.equal(plan.indoorUnits.length, 6);
  assert.deepEqual(plan.indoorUnits.map((unit) => unit.roomId).sort(), [
    'bedroom_nw', 'bedroom_se', 'living_dining', 'living_dining', 'master_bedroom', 'study',
  ]);
  assert.ok(plan.indoorUnits.every((unit) => unit.type === 'ceiling'), 'vrf_ducted → 全部藏吊顶');
});

test('catalog 的 hvac topic 与预算同源，且 candidate 门控把它归「已取证」', () => {
  const catalog = ProjectCatalog.load('.');
  const options = catalog.getOptions('hvac');
  assert.deepEqual(options.map((o) => o.id), ['A2']);
  assert.equal(options[0].price_per_unit, 36000);
  assert.equal((options[0].data as { status: string }).status, 'contracted');
  // 阶段 1 的白名单只剩显式登记处：合成选项现在也带 status
  assert.equal(catalog.getOption('hvac', 'A1'), undefined, 'invented 方案不得再作为可选项');
  assert.equal(catalog.getOption('hvac', 'hvac_01'), undefined, 'materials.yaml 的采购台账镜像不是选型清单');
});

test('没有 commercial.price_cny → 抛错（不许静默按 0 元进预算）', () => {
  assert.throws(() => hvacPlanOptions({ plans: [{ id: 'X', kind: 'vrf_ducted' }] }), /commercial/);
  assert.throws(() => hvacPlanOptions({ plans: [{ id: 'X', kind: 'vrf_ducted', commercial: { status: 'candidate' } }] }), /price_cny/);
  assert.throws(() => hvacPlanOptions({ plans: [{ id: 'X', kind: 'vrf_ducted', commercial: { status: 'candidate', price_cny: -1 } }] }), /price_cny/);
  assert.throws(() => hvacPlanOptions({ plans: [{ id: 'X', kind: 'vrf_ducted', commercial: { price_cny: 100 } }] }), /commercial.status/);
});

test('plans 为空 / id 重复 / 形状坏 → 抛错（fail closed）', () => {
  assert.throws(() => hvacPlanOptions({}), /plans 必须是非空数组/);
  assert.throws(() => hvacPlanOptions({ plans: [] }), /plans 必须是非空数组/);
  assert.throws(() => hvacPlanOptions({ plans: [{ id: 'A', kind: 'vrf_ducted', commercial: { status: 'candidate', price_cny: 1 } }, { id: 'A', kind: 'vrf_ducted', commercial: { status: 'candidate', price_cny: 1 } }] }), /id 重复/);
  assert.throws(() => hvacPlanOptions({ plans: ['x'] }), /plans 条目必须是对象/);
  assert.throws(() => hvacPlanOptions({ plans: [{ kind: 'vrf_ducted', commercial: { status: 'candidate', price_cny: 1 } }] }), /缺少 id/);
});

test('outdoor 位置不可猜：既没有 location 也没有 platform → 抛错', () => {
  const base = { id: 'X', kind: 'vrf_ducted', commercial: { status: 'candidate', price_cny: 1 } };
  assert.throws(() => hvacPlanOptions({ plans: [{ ...base, outdoor: { width: 1, depth: 1, height: 1 } }] }), /无法定位/);
  assert.throws(() => hvacPlanOptions({ plans: [{ ...base, outdoor: { location: 'roof', width: 1, depth: 1, height: 1 } }] }), /location/);
  assert.throws(() => hvacPlanOptions({ plans: [{ ...base, outdoor: { platform: 'p', width: 1, depth: 1 } }] }), /height/);
  // 多个外机用 outdoors:（平台摆放紧张由 app 端 HvacTopic.validate 告警）
  const multi = hvacPlanOptions({ plans: [{ ...base, outdoors: [{ platform: 'p', width: 0.85, depth: 0.35, height: 0.6 }, { platform: 'p', width: 0.85, depth: 0.35, height: 0.6 }] }] });
  assert.equal(multi[0].outdoorUnits.length, 2);
  assert.ok(multi[0].outdoorUnits.every((unit) => unit.location === 'platform'));
});

test('未登记的内机安装形式 → 抛错（不猜挂机/柜机）', () => {
  const base = { id: 'X', kind: 'wall_split', commercial: { status: 'candidate', price_cny: 1 }, load_design: { rooms: [{ room: 'living_dining', indoor: 'x' }] } };
  assert.throws(() => hvacPlanOptions({ plans: [base] }), /未登记内机安装形式/);
});
