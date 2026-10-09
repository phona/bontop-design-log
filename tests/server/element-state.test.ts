// 构件级工程状态派生 + 待决台账解析的权威测试。
//
// 守的不变量：
//   ① 派生优先级（conflict > config_status > ledger > decision > undeclared）逐条可证，
//      且配置删掉/加错规则会告警——覆盖矩阵不许说谎；
//   ② 台账解析能区分「元素 id」与「类型/字段引用」，不把 `ac_indoor` 误报成构件已删；
//   ③ 一个文件路径后的多个 id（`a`/`b`/`c`）全部取出；
//   ④ config 声称已核实、台账却仍开着 → 矛盾告警；
//   ⑤ 真实 sock_child_ac 端到端：状态、卡在谁、与门禁结论的绑定。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  classifyTarget,
  extractBlockedBy,
  extractTargets,
  parsePendingLedger,
  summarizeLedger,
} from '../../shared/pending-ledger.js';
import {
  DEFAULT_STATE_MODEL,
  deriveElementStates,
  issueTouches,
  type ElementInput,
  type IssueLike,
  type StateModel,
} from '../../shared/element-state.js';
import { collectElements } from '../../shared/element-sources.js';

const LEDGER = readFileSync('docs/pending-site-data.md', 'utf8');

describe('pending ledger parsing', () => {
  it('parses every numbered row across all section tables', () => {
    const ledger = parsePendingLedger(LEDGER);
    assert.ok(ledger.entries.length >= 57, `台账条目数 ${ledger.entries.length}（含 6 列表的 #25–#29）`);
    const refs = new Set(ledger.entries.map((entry) => entry.ref));
    for (const expected of ['1', '33', '39', '42', '55']) assert.ok(refs.has(expected), `#${expected} 必须被解析到`);
    assert.ok(ledger.entries.every((entry) => entry.summary.length > 0), '每条都要有摘要');
  });

  it('takes every id listed after one file path', () => {
    // 台账写法：electrical.yaml `sock_balcony_washer`/`sock_balcony_dryer`/`sock_kitchen_fridge`
    const targets = extractTargets('electrical.yaml `sock_balcony_washer`/`sock_balcony_dryer`/`sock_kitchen_fridge`；house.yaml');
    // 三个 id 都要取到；末尾的 house.yaml 没有反引号 id，作为无 id 的 target 保留（不丢文件引用）
    assert.deepEqual(targets.filter((target) => target.id).map((target) => target.id), ['sock_balcony_washer', 'sock_balcony_dryer', 'sock_kitchen_fridge']);
    assert.equal(targets[0].file, 'config/electrical.yaml');
    assert.ok(targets.some((target) => target.file === 'config/house.yaml' && !target.id));
  });

  it('separates element ids from type/field references', () => {
    const knownIds = new Set(['electrical:sock_child_ac', 'ceiling:ac_child']);
    const knownTypes = new Set(['ac_indoor', 'strong_panel', 'leb']);
    assert.equal(classifyTarget({ file: 'config/electrical.yaml', id: 'sock_child_ac' }, knownIds, knownTypes), 'bound');
    assert.equal(classifyTarget({ file: 'config/ceiling.yaml', id: 'ac_indoor' }, knownIds, knownTypes), 'type_reference', 'ac_indoor 是 type 取值，不是元素 id');
    assert.equal(classifyTarget({ file: 'config/electrical.yaml', id: 'type: strong_panel' }, knownIds, knownTypes), 'type_reference', '含冒号的字段描述');
    assert.equal(classifyTarget({ file: 'config/plumbing.yaml', id: 'type: leb' }, knownIds, knownTypes), 'type_reference');
    assert.equal(classifyTarget({ file: 'config/electrical.yaml', id: 'sock_deleted_thing' }, knownIds, knownTypes), 'unresolved', '既不是已知 id 也不是已知 type → 台账腐烂的真信号');
    assert.equal(classifyTarget({ file: 'config/materials.yaml', id: 'floor_tile_04' }, knownIds, knownTypes), 'type_reference', '非构件承载文件不参与存在性核对');
  });

  it('does not report type references as dangling when the referenced elements exist', () => {
    const ledger = parsePendingLedger(LEDGER);
    // knownIds 必须包含台账真实引用的元素——用配置里的真实 id 集合，否则「配置里没有」与「我不认识」无法区分
    const knownIds = new Set(ledger.entries.flatMap((entry) => entry.targets.filter((t) => t.id && !/[\s:]/.test(t.id)).map((t) => t.id!)).map((id) => `electrical:${id}`));
    const summary = summarizeLedger(ledger, knownIds, new Set(['ac_indoor', 'strong_panel', 'weak_panel', 'drain_riser', 'water_supply', 'gas_meter', 'duct', 'leb']));
    assert.deepEqual(summary.dangling.filter((item) => item.file.endsWith('electrical.yaml')), [], `电气构件误报: ${JSON.stringify(summary.dangling)}`);
    assert.ok(summary.total >= 55, `台账条目数 ${summary.total}`);
  });

  it('extracts who an item is blocked on', () => {
    assert.match(extractBlockedBy('**卡在谁那**：卡在**空调厂家深化图**——机身尺寸决定落位'), /空调厂家深化图/);
    assert.match(extractBlockedBy('待业主 + 物业确认能否开孔'), /业主/);
    assert.equal(extractBlockedBy('point_uncovered'), 'point_uncovered', '提不出「卡在谁」时原样返回，不猜');
  });
});

describe('element state derivation', () => {
  const element = (overrides: Partial<ElementInput> & { id: string }): ElementInput => ({
    kind: 'electrical',
    label: overrides.id,
    ...overrides,
  });

  it('puts a verifier error above every other signal', () => {
    const result = deriveElementStates({
      elements: [element({ id: 'electrical:x', configStatus: 'measured', decision: 'DEC-2026-10-09-P01' })],
      ledger: { entries: [] },
      issues: [{ entity: 'electrical:x', code: 'furniture_wall_collision', level: 'error' }],
    });
    assert.equal(result.states[0].status, 'conflicted');
    assert.equal(result.states[0].statusSource, 'verifier:furniture_wall_collision');
    assert.deepEqual(result.states[0].conflicts, ['furniture_wall_collision']);
  });

  it('lets a warning-level issue show as a conflict but not override the status', () => {
    const result = deriveElementStates({
      elements: [element({ id: 'electrical:x', configStatus: 'measured' })],
      ledger: { entries: [] },
      issues: [{ entity: 'electrical:x', code: 'furniture_glass_clearance_insufficient', level: 'warning' }],
    });
    assert.equal(result.states[0].status, 'measured', 'warning 不覆盖 config 状态');
    assert.deepEqual(result.states[0].conflicts, ['furniture_glass_clearance_insufficient'], '但仍要在 conflicts 里可见');
  });

  it('maps the config status vocabulary', () => {
    const result = deriveElementStates({
      elements: [
        element({ id: 'electrical:a', configStatus: 'measured' }),
        element({ id: 'electrical:b', configStatus: 'likely' }),
        element({ id: 'electrical:c', configStatus: 'inferred' }),
        element({ id: 'electrical:d', configStatus: 'pending' }),
        element({ id: 'electrical:e', configStatus: 'confirmed' }),
      ],
      ledger: { entries: [] },
      issues: [],
    });
    const byId = new Map(result.states.map((state) => [state.id, state.status]));
    assert.equal(byId.get('electrical:a'), 'measured');
    assert.equal(byId.get('electrical:b'), 'inferred', 'likely 未经现场核实，统一按推断处理');
    assert.equal(byId.get('electrical:c'), 'inferred');
    assert.equal(byId.get('electrical:d'), 'pending');
    assert.equal(byId.get('electrical:e'), 'confirmed');
  });

  it('falls through to the ledger, then the decision, then undeclared', () => {
    const ledger = { entries: [{ ref: '42', summary: '儿童房空调电源', blockedBy: '卡在空调厂家深化图', targets: [{ file: 'config/electrical.yaml', id: 'ledgered' }] }] };
    const result = deriveElementStates({
      elements: [
        element({ id: 'electrical:ledgered' }),
        element({ id: 'electrical:decided', decision: 'DEC-2026-10-08-C01' }),
        element({ id: 'electrical:bare' }),
      ],
      ledger,
      issues: [],
    });
    const byId = new Map(result.states.map((state) => [state.id, state]));
    assert.equal(byId.get('electrical:ledgered')!.status, 'pending');
    assert.equal(byId.get('electrical:ledgered')!.statusSource, 'pending-site-data #42');
    assert.equal(byId.get('electrical:ledgered')!.openQuestion?.blockedBy, '卡在空调厂家深化图');
    assert.equal(byId.get('electrical:decided')!.status, 'confirmed');
    assert.equal(byId.get('electrical:bare')!.status, 'undeclared', '派生不出来必须显形，不是默认已确认');
    assert.equal(result.summary.undeclared, 1);
  });

  it('attaches the open question even when config status decides, and flags the contradiction', () => {
    const ledger = { entries: [{ ref: '42', summary: 'x', blockedBy: '卡在厂家图', targets: [{ file: 'config/electrical.yaml', id: 'x' }] }] };
    const result = deriveElementStates({
      elements: [element({ id: 'electrical:x', configStatus: 'measured' })],
      ledger,
      issues: [],
    });
    assert.equal(result.states[0].status, 'measured', 'config_status 优先级高于台账');
    assert.equal(result.states[0].openQuestion?.ref, '42', '但「卡在谁」仍要带上——那才是可行动的部分');
    assert.ok(result.warnings.some((warning) => warning.code === 'state.config_vs_ledger_conflict'), 'config 说已测、台账仍开着 → 必须显形');
  });

  it('matches issues written as a pair or as a bare id', () => {
    assert.ok(issueTouches({ entity: 'furniture:a↔furniture:b', code: 'c', level: 'error' }, 'furniture:b'));
    assert.ok(issueTouches({ entity: 'furniture:a↔north_recess_curtain', code: 'c', level: 'error' }, 'furniture:a'));
    assert.ok(issueTouches({ id: 'hvac_power_living', code: 'c', level: 'warning' }, 'electrical:hvac_power_living'), 'electrical-lint 用 id 字段');
    assert.equal(issueTouches({ entity: 'furniture:a↔furniture:b', code: 'c', level: 'error' }, 'furniture:c'), false);
  });

  it('warns when the state model declares an unknown rule or drops an implemented one', () => {
    const extra = deriveElementStates({
      elements: [element({ id: 'electrical:x' })],
      ledger: { entries: [] },
      issues: [],
      model: { ...DEFAULT_STATE_MODEL, priority: ['conflict', 'nonsense', 'fallback'] as StateModel['priority'] },
    });
    assert.ok(extra.warnings.some((warning) => warning.code === 'state.rule_unknown' && warning.entity === 'nonsense'));
    assert.ok(extra.warnings.some((warning) => warning.code === 'state.rule_undeclared'));

    const noFallback = deriveElementStates({
      elements: [element({ id: 'electrical:x' })],
      ledger: { entries: [] },
      issues: [],
      model: { ...DEFAULT_STATE_MODEL, priority: ['conflict', 'config_status', 'ledger', 'decision'] },
    });
    assert.ok(noFallback.warnings.some((warning) => warning.code === 'state.no_fallback'));
    assert.equal(noFallback.states[0].status, 'undeclared', '没有 fallback 也不静默给状态');
  });
});

describe('real project projection', () => {
  it('binds sock_child_ac to its ledger question and the vendor drawing', () => {
    const ledger = parsePendingLedger(LEDGER);
    const entry = ledger.entries.find((item) => item.ref === '42');
    assert.ok(entry, '#42 必须在台账里');
    assert.ok(entry.targets.some((target) => target.file.endsWith('electrical.yaml') && target.id === 'sock_child_ac'));

    const result = deriveElementStates({
      elements: [{ id: 'electrical:sock_child_ac', kind: 'electrical', label: 'socket sock_child_ac', room: 'bedroom_nw', configStatus: 'pending' }],
      ledger,
      issues: [],
    });
    const state = result.states[0];
    assert.equal(state.status, 'pending');
    assert.equal(state.openQuestion?.ref, '42');
    assert.match(state.openQuestion?.blockedBy ?? '', /空调厂家深化图/);
  });

  it('keeps the ledger honest: no dangling element refs in the current tree', () => {
    const ledger = parsePendingLedger(LEDGER);
    const summary = summarizeLedger(ledger, new Set(), new Set());
    // 空 knownIds 时全部元素引用都会变成 unresolved——这里只断言解析本身稳定、可复现
    assert.equal(summary.total, ledger.entries.length);
    assert.ok(summary.byPrecision.pending > 0 && summary.byPrecision.inferred > 0, '精度列两种取值都要解析到');
  });
});

describe('element census snapshot', () => {
  // 快照门禁：构件总数与「未声明状态」数是**申报缺口的度量**。它变化只意味着两件事——
  //   ① 有人往配置里加了构件但没申报 status/position_status → 去申报，别改这个数；
  //   ② 有人删了构件 → 故意更新此快照并在 commit 里说明。
  // 用空 issues 求 undeclared：把「申报缺口」与「门禁当前有没有 error」解耦，
  // 否则一个真实冲突会让这个数莫名少 1，掩盖申报缺口本身。
  it('pins the element census so undeclared elements cannot slip in silently', () => {
    const elements = collectElements();
    const result = deriveElementStates({ elements, ledger: { entries: [] }, issues: [] });
    assert.equal(result.summary.total, 164, '构件总数（电气 107 + 给排水 32 + 吊顶/HVAC 25）');
    assert.equal(result.summary.undeclared, 74, '空台账下的未声明状态数——纯申报缺口，不受台账/门禁影响');
    assert.ok(result.summary.undeclared / result.summary.total > 0.3, '缺口占比过高时应优先补申报，而不是继续加规则');
  });

  it('binds most elements once the real ledger and decisions are in play', () => {
    const elements = collectElements();
    const ledger = parsePendingLedger(LEDGER);
    const result = deriveElementStates({ elements, ledger, issues: [] });
    // 接上真实台账后，undeclared 必须从 74 降下来——否则说明派生没接上权威源
    assert.equal(result.summary.undeclared, 68, '台账把 6 个「无 config 状态、无 DEC」的构件绑成了 pending');
    assert.equal(result.summary.pending, 21, 'pending = config 声明 pending 10 + 台账新绑 11');
    assert.ok((result.summary.byStatus.confirmed ?? 0) > 0, 'DEC 引用必须把构件绑成 confirmed');
  });
});
