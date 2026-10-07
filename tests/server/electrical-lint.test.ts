import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { parseElectricalTopology, ElectricalPointSchema } from '../../shared/project-render-facts-schema.js';
import { lintElectricalTopology } from '../../shared/electrical-lint.js';
import type { ElectricalPoint, ElectricalTopology } from '../../shared/types.js';

const points = parseYaml(readFileSync('config/electrical.yaml', 'utf8')) as ElectricalPoint[];
const raw = readFileSync('config/electrical-topology.yaml', 'utf8');

const byCode = (result: ReturnType<typeof lintElectricalTopology>, code: string) => result.warnings.filter((issue) => issue.code === code);
const idsOf = (result: ReturnType<typeof lintElectricalTopology>, code: string) => byCode(result, code).map((issue) => issue.id).sort();
const pointMap = new Map(points.map((point) => [point.id, point]));
const isSocket = (point: ElectricalPoint | undefined) => point !== undefined && ['socket', 'usb', 'floor_socket'].includes(point.type);

test('real electrical topology parses and lints', () => {
  const topology = parseElectricalTopology(raw, points);
  const result = lintElectricalTopology(topology, points);
  assert.equal(topology.circuits.length, 21); // DEC-2026-10-03-R1：25 路合并至 19 路；DEC-2026-10-04-R2：+外机专用回路；DEC-2026-10-05-R3：浴霸拆每卫一路（20→21）
  assert.equal(topology.controls.length, 11);
  assert.equal(topology.circuits.filter((circuit) => circuit.purpose === 'lighting').flatMap((circuit) => circuit.member_point_ids).length, 20); // R15 起夜灯并入照明回路；R12 删除客卫 3 灯、R15 删除 NP-4b（24→20）
  assert.equal(topology.circuits.filter((circuit) => circuit.purpose === 'ordinary_power').flatMap((circuit) => circuit.member_point_ids).length, 41); // 2026-10-05 R15 客房床头插座 ×2 并入 ordinary_power_parent_child（39→41） // DEC-2026-10-03-R1：+sock_living_tv_high +sock_kitchen_counter_east
  assert.equal(result.counts.coveredPoints, 75); // R15 增起夜点与床头插座；R12 删除客卫 3 灯、R15 删除 NP-4b 后 79→75。床头双控 switch_guest_bed 非负载点，仍计未覆盖
  assert.equal(result.errors.length, 0);
  assert.ok(result.warnings.length > 0);
  // 2026-10 三条规范规则（全部 warning）落地后的新计数：原 52 warnings = 9 dedicated + 29 uncovered + 14 pending
  // +2 卫浴防溅 +17 开关零线口径 +0 插座回路 RCD（现有 16 路均已声明"漏保"）= 71
  // DEC-2026-10-06-R2 电气兜底轮：17 个开关补 neutral: true、2 个浴霸插座补防溅盒 note → 两类归零（-19）；
  // 新增微蒸烤预留点位 sock_kitchen_oven（未激活、不进 topology 回路）→ point_uncovered +1（29→30）→ 71-19+1=53
  assert.equal(result.warnings.length, 53);
  assert.equal(result.counts.byCode.rcd_missing_on_socket_circuit ?? 0, 0); // 命中 0：16 路含 socket 成员的回路 breaker 均已声明"漏保"
  assert.equal(result.counts.byCode.bath_socket_splash_box_undeclared ?? 0, 0); // DEC-2026-10-06-R2：两卫浴霸插座 note 已补防溅盒声明（2→0）
  assert.equal(result.counts.byCode.switch_neutral_policy_undeclared ?? 0, 0); // DEC-2026-10-06-R2：17 个 switch/switch_2way 已补 neutral: true（17→0）
});

test('unknown point and duplicate member are rejected by parser', () => {
  const topology = parseElectricalTopology(raw, points) as ElectricalTopology;
  assert.throws(() => parseElectricalTopology(JSON.stringify({ ...topology, circuits: [...topology.circuits, { ...topology.circuits[0], id: 'duplicate', member_point_ids: ['unknown'] }] }), points), /unknown point/);
  assert.throws(() => parseElectricalTopology(JSON.stringify({ ...topology, circuits: [...topology.circuits, { ...topology.circuits[0], id: 'duplicate', member_point_ids: [topology.circuits[0].member_point_ids[0]] }] }), points), /multiple circuits/);
});

test('two-way control without target is warning and dedicated pending is warning', () => {
  const topology = parseElectricalTopology(raw, points);
  const result = lintElectricalTopology(topology, points);
  // DEC-2026-09-07-056：全部控件已绑定受控灯具，真实拓扑不再出现 control_target_missing
  assert.equal(result.errors.filter((i) => i.code === 'control_target_missing').length, 0);
  assert.equal(result.warnings.filter((i) => i.code === 'control_target_missing').length, 0);
  assert.ok(result.warnings.some((i) => i.code === 'dedicated_parameters_pending'));
  assert.equal(topology.controls.filter((control) => control.target_point_ids.length === 0).length, 0);
  // 行为回归：合成一个无目标双控仍应产生 warning
  const mutated = lintElectricalTopology({ ...topology, controls: [...topology.controls, { ...topology.controls[0], id: 'control_no_target', target_point_ids: [] }] }, points);
  assert.equal(mutated.warnings.filter((i) => i.code === 'control_target_missing').length, 1);
});

test('lint rejects non-load members and duplicate members', () => {
  const topology = parseElectricalTopology(raw, points) as ElectricalTopology;
  const result = lintElectricalTopology({
    ...topology,
    circuits: [{ ...topology.circuits[0], member_point_ids: ['switch_living_entrance', 'switch_living_entrance'] }],
  }, points);
  assert.equal(result.errors.filter((i) => i.code === 'member_not_powerable').length, 2);
  assert.ok(result.errors.filter((i) => i.code === 'duplicate_member').length >= 1);
});

test('ordinary power accepts sockets and rejects lighting/network/switch points', () => {
  const topology = parseElectricalTopology(raw, points) as ElectricalTopology;
  const ordinary = topology.circuits.find((circuit) => circuit.purpose === 'ordinary_power')!;
  const valid = lintElectricalTopology({ ...topology, circuits: [{ ...ordinary, member_point_ids: ['sock_living_tv', 'sock_living_sofa_l'] }] }, points);
  assert.equal(valid.errors.filter((i) => i.code === 'ordinary_member_not_socket').length, 0);
  const invalid = lintElectricalTopology({ ...topology, circuits: [{ ...ordinary, member_point_ids: ['light_master_wall_l', 'net_living', 'switch_living_entrance'] }] }, points);
  assert.equal(invalid.errors.filter((i) => i.code === 'ordinary_member_not_socket').length, 3);
});

test('unknown circuit purpose is rejected by schema', () => {
  const topology = parseElectricalTopology(raw, points) as ElectricalTopology;
  assert.throws(() => parseElectricalTopology(JSON.stringify({ ...topology, circuits: [{ ...topology.circuits[0], purpose: 'unknown_power' }] }), points), /Invalid option/);
});

test('lint keeps historical uncovered points as warnings and maps circuit facts', () => {
  const topology = parseElectricalTopology(raw, points);
  const result = lintElectricalTopology(topology, points);
  assert.equal(result.errors.filter((i) => i.code === 'circuit_fact_mismatch').length, 0);
  assert.equal(result.warnings.filter((i) => i.code === 'declared_circuit_uncovered').length, 0);
  assert.ok(result.warnings.some((i) => i.code === 'point_uncovered'));
  assert.equal(result.warnings.filter((i) => i.code === 'electrical_parameters_pending').length, 0);
  assert.equal(result.warnings.filter((i) => i.code === 'point_uncovered').length, 30); // 2026-10-05 R15：+switch_guest_bed（床头双控开关非负载点，28→29）// DEC-2026-10-06-R2：+sock_kitchen_oven（微蒸烤预留接口，未激活前不进 topology 回路，29→30） // 外机点位已入回路，不增未覆盖 // DEC-2026-10-04-R2：+ac_panel_dining（餐区第 6 台线控器）27→28
  assert.ok(result.warnings.some((i) => i.code === 'point_uncovered' && i.id === 'switch_master_bed_l'));
});

// ── 2026-10 新增三条规范规则（全部 warning 起步）──────────────────────────────

test('every socket-bearing circuit must declare ≤30mA RCD protection (GB 55038-2025 7.4.3-1)', () => {
  const topology = parseElectricalTopology(raw, points) as ElectricalTopology;
  // 合规方向：21 路中 16 路含 socket 类成员，breaker 全是 "CxxA+漏保" 写法 → 不应命中
  const socketCircuits = topology.circuits.filter((circuit) => circuit.member_point_ids.some((id) => isSocket(pointMap.get(id))));
  assert.equal(socketCircuits.length, 16);
  const compliant = lintElectricalTopology(topology, points);
  assert.equal(compliant.warnings.filter((issue) => issue.code === 'rcd_missing_on_socket_circuit').length, 0);

  // 违反方向 1：breaker 退化成不带漏保的裸电流值
  const stripped = lintElectricalTopology({
    ...topology,
    circuits: topology.circuits.map((circuit) => (circuit.id === 'ordinary_power_living' ? { ...circuit, breaker: 'C20A' } : circuit)),
  }, points);
  const hits = stripped.warnings.filter((issue) => issue.code === 'rcd_missing_on_socket_circuit');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'ordinary_power_living');
  assert.match(hits[0].message, /≤30mA/);
  assert.match(hits[0].message, /sock_living_tv/);

  // 违反方向 2：breaker 整段缺失（同时仍会触发 electrical_parameters_pending，本规则独立计数）
  const undeclared = lintElectricalTopology({
    ...topology,
    circuits: topology.circuits.map((circuit) => (circuit.id === 'ordinary_power_kitchen' ? { ...circuit, breaker: undefined } : circuit)),
  }, points);
  assert.equal(undeclared.warnings.filter((issue) => issue.code === 'rcd_missing_on_socket_circuit').length, 1);
  assert.equal(undeclared.errors.length, 0); // 新规则一律 warning，不破坏 0 error 门禁
});

test('bathroom socket points must declare a splash box (GB 55038-2025 7.4.5)', () => {
  const topology = parseElectricalTopology(raw, points) as ElectricalTopology;
  const result = lintElectricalTopology(topology, points);
  // DEC-2026-10-06-R2：两个卫浴高位浴霸点位 note 已补防溅盒声明 → 原违反方向清空（2→0）
  assert.deepEqual(idsOf(result, 'bath_socket_splash_box_undeclared'), []);
  const bathSockets = points.filter((point) => (point.room === 'master_bath' || point.room === 'guest_bath') && isSocket(point));
  assert.equal(bathSockets.length, 8);
  // DEC-2026-10-06-R2：两卫 8 个插座 note 全部声明"防溅"（原 6 个 + 本轮补齐的 2 个浴霸位）
  assert.equal(bathSockets.filter((point) => /防溅/.test(point.note ?? '')).length, 8);
  // 违反方向（剥掉本轮补的防溅声明后告警复现，证明判据就是 note 文本而非点位 id）
  const strippedNote = (note: string) => note.replace(/；DEC-2026-10-06-R2 插座带防溅盒（GB 55038-2025 7.4.5）/, '');
  const stripped = points.map((point) => (point.id === 'sock_mbath_batheheater' ? { ...point, note: strippedNote(point.note ?? '') } : point));
  assert.deepEqual(idsOf(lintElectricalTopology(topology, stripped), 'bath_socket_splash_box_undeclared'), ['sock_mbath_batheheater']);
});

test('switch points must declare an explicit neutral policy (config/house.yaml 智能开关零线)', () => {
  const topology = parseElectricalTopology(raw, points) as ElectricalTopology;
  const switchPoints = points.filter((point) => point.type === 'switch' || point.type === 'switch_2way');
  assert.equal(switchPoints.length, 17);
  // DEC-2026-10-06-R2：17 个点位已全部补 neutral: true → 原"17 个全命中"违规方向清空（17→0）
  assert.equal(lintElectricalTopology(topology, points).warnings.filter((issue) => issue.code === 'switch_neutral_policy_undeclared').length, 0);
  assert.deepEqual(switchPoints.filter((point) => point.neutral !== true).map((point) => point.id), []);
  // note 统一口径同时落地（备用可读口径，与 neutral 字段无冲突）
  assert.equal(switchPoints.filter((point) => /零线/.test(point.note ?? '')).length, 17);

  // schema 同步：neutral 为 optional boolean；strict 仍然拒绝未知键
  assert.equal(ElectricalPointSchema.parse({ id: 'switch_probe', room: 'kitchen', type: 'switch', x: 1, z: 2, neutral: false }).neutral, false);
  assert.throws(() => ElectricalPointSchema.parse({ id: 'switch_probe', room: 'kitchen', type: 'switch', x: 1, z: 2, neutral_required: true }));

  // 违反方向 1：剥掉 neutral 字段且 note 不写零线 → 该点告警复现（判据在字段/note，不在点位 id）
  const strippedSwitchNote = (note: string) => note.replace(/；DEC-2026-10-06-R2 底盒预埋零线（单火智能开关防 LED 鬼火）/, '');
  const withoutNeutral = points.map((point) => (point.id === 'switch_kitchen' ? { ...point, neutral: undefined, note: strippedSwitchNote(point.note ?? '') } : point));
  assert.deepEqual(idsOf(lintElectricalTopology(topology, withoutNeutral), 'switch_neutral_policy_undeclared'), ['switch_kitchen']);

  // 违反方向 2：note 写明"零线"等价于显式声明（单火线方案也可写"单火线不回零线"关机口径）
  const withNote = points.map((point) => (point.id === 'switch_kitchen' ? { ...point, neutral: undefined, note: `${strippedSwitchNote(point.note ?? '')}；智能开关零线已预留` } : point));
  assert.equal(lintElectricalTopology(topology, withNote).warnings.filter((issue) => issue.code === 'switch_neutral_policy_undeclared').length, 0);
});

test('lint validates panel topology/source semantics and status at runtime', () => {
  const topology = parseElectricalTopology(raw, points) as ElectricalTopology;
  const result = lintElectricalTopology({
    ...topology,
    panels: [{ ...topology.panels[0], kind: 'weak' as any, status: 'invalid' as any }],
  }, points);
  assert.equal(result.errors.filter((i) => i.code === 'invalid_panel_kind').length, 1);
  assert.equal(result.errors.filter((i) => i.code === 'invalid_panel_status').length, 1);
});

test('electrical JSON CLI emits pure JSON', () => {
  const output = execFileSync('npx', ['tsx', 'scripts/verify/electrical/verify-electrical-lint.ts', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const result = JSON.parse(output) as { errors: unknown[]; warnings: unknown[]; counts: { circuits: number; byCode?: Record<string, number> } };
  assert.equal(result.counts.circuits, 21); // DEC-2026-10-04-R2：+hvac_power_outdoor_a2；DEC-2026-10-05-R3：浴霸拆每卫一路（20→21）
  assert.ok(Array.isArray(result.errors));
  assert.ok(Array.isArray(result.warnings));
  // 既有字段语义不变 + 新增的按规则汇总字段（纯附加，兼容旧消费方；零命中的规则不出现在 byCode 里）
  // DEC-2026-10-06-R2：switch_neutral_policy_undeclared / bath_socket_splash_box_undeclared 两类已归零
  assert.equal(result.counts.byCode?.switch_neutral_policy_undeclared ?? 0, 0);
  assert.equal(result.counts.byCode?.bath_socket_splash_box_undeclared ?? 0, 0);
  assert.equal(result.counts.byCode?.rcd_missing_on_socket_circuit ?? 0, 0);
});
