import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import {
  CeilingZonesSchema,
  ElectricalPointsSchema,
  ProjectHvacFactsSchema,
  validateProjectHvacFacts,
} from '../../shared/project-render-facts-schema.js';

const electrical = ElectricalPointsSchema.parse(parseYaml(readFileSync('config/electrical.yaml', 'utf8')));
const ceiling = CeilingZonesSchema.parse(parseYaml(readFileSync('config/ceiling.yaml', 'utf8')));
const hvac = ProjectHvacFactsSchema.parse(parseYaml(readFileSync('config/hvac.yaml', 'utf8')));

test('hvac.yaml declares the complete A2 diagram against existing MEP facts', () => {
  assert.deepEqual(hvac.plans.map((plan) => plan.id), ['A2']);
  validateProjectHvacFacts(hvac, { electrical, ceiling });
  const plan = hvac.plans[0];
  assert.equal(plan.outdoor.id, 'vrf_outdoor_a2');
  assert.equal(plan.diagram.anchors.filter((anchor) => anchor.ref?.source === 'ceiling').length, 6);
  assert.equal(plan.diagram.anchors.filter((anchor) => anchor.ref?.source === 'electrical').length, 6);
  assert.equal(plan.diagram.anchors.find((anchor) => anchor.id === 'indoor_dining')?.ref?.id, 'ac_dining');
  assert.equal(plan.diagram.anchors.find((anchor) => anchor.id === 'power_dining')?.ref?.id, 'sock_dining_ac');
  const roomKeys = ['living', 'dining', 'master', 'study', 'parent', 'child'];
  // 2026-08-26 回检一体：回风格栅兼作检修口，不另设 access 面板；DEC-2026-10-27-R03 缩窄适用范围：
  // 餐厅/客房/儿童房/书房四台的回风离机身 0.50–1.65m、经风管连接够不到机身，另设检修面板；
  // 主卧（回风同轴）与客厅（待服务侧）仍沿用回检一体。面板不是风管路由，故六间仍无 access 路由。
  const mergedAccessRooms = new Set(['living', 'dining', 'master', 'study', 'parent', 'child']);
  // DEC-2026-10-27-R03 检修面板 id：书房为南立面侧口 access_parent_side，其余为底口 access_<room>。
  const accessPanelIds: Record<string, string> = { dining: 'access_dining', study: 'access_study', child: 'access_child', parent: 'access_parent_side' };
  for (const room of roomKeys) {
    const indoor = `indoor_${room}`;
    const mergedAccess = mergedAccessRooms.has(room);
    assert.ok(plan.diagram.anchors.some((anchor) => anchor.id === `power_${room}` && anchor.ref?.source === 'electrical'));
    const systems = ['power', 'refrigerant', 'condensate', 'supply_air', 'return_air', ...(mergedAccess ? [] : ['access'])];
    for (const system of systems) {
      assert.equal(plan.diagram.routes.filter((route) => route.system === system && (route.from === indoor || route.to === indoor)).length, 1,
        `${room} should have exactly one ${system} route`);
    }
    if (mergedAccess) {
      assert.equal(plan.diagram.routes.filter((route) => route.system === 'access' && (route.from === indoor || route.to === indoor)).length, 0,
        `${room} should not have an access route (回检一体)`);
    }
    for (const terminal of ['supply', 'return']) {
      assert.ok(plan.diagram.terminals.some((item) => item.id === `${terminal}_${room}`), `${room} missing ${terminal} terminal`);
    }
    const panelId = accessPanelIds[room];
    if (panelId) {
      assert.ok(plan.diagram.terminals.some((item) => item.id === panelId), `${room} missing access panel ${panelId} (DEC-2026-10-27-R03)`);
    } else if (mergedAccess) {
      assert.ok(!plan.diagram.terminals.some((item) => item.id === `access_${room}`), `${room} should not have an access terminal (回检一体)`);
    }
  }
  for (const route of plan.diagram.routes.filter((route) => route.status !== 'confirmed')) {
    assert.ok(route.reason?.trim(), `${route.id} requires a review reason`);
  }
  for (const route of plan.diagram.routes.filter((route) => route.system === 'condensate')) {
    // DEC-2026-10-19-R25 汇流拓扑：branch/equipment_outlet 路由止于锚点（汇合点/出水口候选），
    // 只有 shared_trunk 与无 role 的候选路由直达 pending 候选终端——旧断言假设全数直达终端已失效
    if (route.topology_role === 'branch' || route.topology_role === 'equipment_outlet') {
      assert.ok(plan.diagram.anchors.some((anchor) => anchor.id === route.to), `${route.id} should end at a diagram anchor (${route.to})`);
      continue;
    }
    const candidate = plan.diagram.terminals.find((terminal) => terminal.id === route.to);
    assert.equal(candidate?.status, 'pending');
    assert.equal(candidate?.kind, 'condensate_drain_candidate');
    assert.equal(candidate?.confirmed, false);
    assert.equal(candidate?.render_interior, false);
    assert.equal(candidate?.render_coordination, true);
    assert.match(candidate?.id ?? '', /^condensate_.*_candidate$/u);
  }
});

test('purchased indoor mapping stays aligned with ceiling entities and the six-unit total', () => {
  const load = hvac.plans[0].load_design;
  assert.ok(load);
  const expected = [
    { ceilingId: 'ac_living', room: 'living_dining', model: '71T2/P-SS', kw: 7.1 },
    { ceilingId: 'ac_dining', room: 'living_dining', model: '42T2/P-SS', kw: 4.2 },
    { ceilingId: 'ac_master', room: 'master_bedroom', model: '56T2/P-SS', kw: 5.6 },
    { ceilingId: 'ac_parent', room: 'study', model: '28T2/P-SS', kw: 2.8 },
    { ceilingId: 'ac_child', room: 'bedroom_nw', model: '28T2/P-SS', kw: 2.8 },
    { ceilingId: 'ac_study', room: 'bedroom_se', model: '28T2/P-SS', kw: 2.8 },
  ];
  assert.equal(load.rooms.length, expected.length);
  for (const [index, item] of expected.entries()) {
    const room: { room: string; indoor: string } = load.rooms[index]!;
    const entity = ceiling.find((zone) => zone.id === item.ceilingId);
    assert.equal(room.room, item.room);
    assert.match(room.indoor, new RegExp(item.model.replace('/', '\\/')));
    assert.match(room.indoor, new RegExp(`${item.kw.toFixed(1)}kW`));
    assert.ok(entity && entity.type === 'ac_indoor');
    assert.match(entity.model ?? '', new RegExp(item.model.replace('/', '\\/')));
  }
  assert.equal(expected.reduce((sum, item) => sum + item.kw, 0), load.indoor_nominal_kw_total);
  assert.ok(Math.abs(load.indoor_nominal_kw_total / load.outdoor_nominal_kw - 1.265) < 1e-9);
  assert.equal(ceiling.find((zone) => zone.id === 'ac_master')?.x, 3.70);
});

test('HVAC schema rejects invalid status, missing reasons, non-finite positions, and dangling routes', () => {
  const diagram = hvac.plans[0].diagram;
  const invalidStatus = structuredClone(hvac);
  invalidStatus.plans[0].diagram.anchors[0].status = 'draft' as never;
  assert.throws(() => ProjectHvacFactsSchema.parse(invalidStatus));

  const missingReason = structuredClone(hvac);
  delete missingReason.plans[0].diagram.anchors.find((anchor) => anchor.status === 'inferred')!.reason;
  assert.throws(() => ProjectHvacFactsSchema.parse(missingReason), /require reason/);

  const nonFinite = structuredClone(hvac);
  nonFinite.plans[0].diagram.terminals[0].position.x = Infinity;
  assert.throws(() => ProjectHvacFactsSchema.parse(nonFinite));

  const dangling = structuredClone(hvac);
  dangling.plans[0].diagram.routes[0].to = 'missing';
  assert.throws(() => validateProjectHvacFacts(dangling, { electrical, ceiling }), /unknown diagram id/);
});

test('HVAC schema accepts legacy terminals and rejects invalid condensate candidates', () => {
  const legacy = structuredClone(hvac);
  const terminal = legacy.plans[0].diagram.terminals.find((item) => item.id === 'supply_living')!;
  delete terminal.kind;
  delete terminal.confirmed;
  delete terminal.render_interior;
  delete terminal.render_coordination;
  assert.equal(ProjectHvacFactsSchema.parse(legacy).plans[0].diagram.terminals.find((item) => item.id === 'supply_living')?.kind, undefined);

  for (const field of ['confirmed', 'render_interior', 'render_coordination'] as const) {
    const invalid = structuredClone(hvac);
    const candidate = invalid.plans[0].diagram.terminals.find((item) => item.kind === 'condensate_drain_candidate')!;
    candidate[field] = field === 'render_coordination' ? false : true;
    assert.throws(() => ProjectHvacFactsSchema.parse(invalid), new RegExp(field));
  }

  const wrongSystem = structuredClone(hvac);
  const wrongCandidate = wrongSystem.plans[0].diagram.terminals.find((item) => item.kind === 'condensate_drain_candidate')!;
  wrongCandidate.system = 'access';
  assert.throws(() => ProjectHvacFactsSchema.parse(wrongSystem), /must use condensate system/);
});

test('HVAC semantic validation rejects duplicate ids and condensate candidates other than pending terminals', () => {
  const duplicate = structuredClone(hvac);
  duplicate.plans[0].diagram.terminals[0].id = duplicate.plans[0].diagram.anchors[0].id;
  assert.throws(() => validateProjectHvacFacts(duplicate, { electrical, ceiling }), /Duplicate HVAC diagram id/);

  const invalidSink = structuredClone(hvac);
  // 须挑无 topology_role 的候选路由做夹具：第一条 condensate 路由是 branch，校验会按 role 分流报 junction anchor 文案（行为正确、更精确）
  invalidSink.plans[0].diagram.routes.find((route) => route.id === 'condensate_master_candidate_route')!.to = 'indoor_living';
  assert.throws(() => validateProjectHvacFacts(invalidSink, { electrical, ceiling }), /must end at a pending condensate drain candidate/);
});
