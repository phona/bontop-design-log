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
import { collectElements, mapHvacStatus, mergeCeilingHvacAnchors } from '../../shared/element-sources.js';

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
  // 快照门禁：构件总数与「未声明状态」数是**申报缺口的度量**。它变化只意味着几件事——
  //   ① 有人往配置里加了构件但没申报 status/position_status → 去申报，别改这个数；
  //   ② 有人删了构件 → 故意更新此快照并在 commit 里说明；
  //   ③ 有人给既有构件补了 status/position_status 申报（如并行提交 769401e 给 46 个电气点位
  //      补申报，undeclared 随之下降）→ 合法改进，更新此快照并在 commit 里说明来历；
  //   ④ 采集器新接了一份权威状态源（如本次接入 config/hvac.yaml）→ 相应构件不再是申报缺口，
  //      数字下降，在 commit 里说明来历。
  // 用空 issues 求 undeclared：把「申报缺口」与「门禁当前有没有 error」解耦，
  // 否则一个真实冲突会让这个数莫名少 1，掩盖申报缺口本身。
  it('pins the element census so undeclared elements cannot slip in silently', () => {
    const elements = collectElements();
    const result = deriveElementStates({ elements, ledger: { entries: [] }, issues: [] });
    assert.equal(result.summary.total, 164, '构件总数（电气 107 + 给排水 32 + 吊顶/HVAC 25）');
    // 空台账 undeclared 来历：b0c425c 基线 74 →（769401e 电气 46 项补申报）28 →（本次接入
    // config/hvac.yaml，6 个 ac_* 内机从 hvac anchor 拿到 confirmed）22。这 6 条 hvac anchor
    // 的 confirmed 是本次修复的直接贡献（-6）；电气补申报的 -46 来自并行提交，非本次改动。
    assert.equal(result.summary.undeclared, 22, '空台账下的未声明状态数——纯申报缺口，不受台账/门禁影响');
    assert.ok(result.summary.undeclared / result.summary.total < 0.5, '未声明占比不应过半——过半说明申报大面积缺失，应优先补申报而不是继续加规则');
  });

  it('binds most elements once the real ledger and decisions are in play', () => {
    const elements = collectElements();
    const ledger = parsePendingLedger(LEDGER);
    const result = deriveElementStates({ elements, ledger, issues: [] });
    // 接上真实台账后，undeclared 从空台账的 22 再降到 16——否则说明派生没接上台账这份权威源。
    // 来历同样叠加了电气补申报：b0c425c 68 →（769401e 电气补申报）22 →（本次 hvac 接入 -6）16。
    assert.equal(result.summary.undeclared, 16, '台账把 6 个「无 config 状态、无 DEC、无 hvac anchor」的构件绑成了 pending（undeclared -6）');
    assert.equal(result.summary.pending, 34, 'pending = config 声明 pending 23 + 台账新绑 11');
    assert.ok((result.summary.byStatus.confirmed ?? 0) > 0, 'DEC 引用必须把构件绑成 confirmed');
  });
});

describe('hvac ceiling anchors → authoritative status', () => {
  // 修的是「权威状态本就存在、采集器没去读」：config/hvac.yaml 的 anchor 通过
  // `ref.source: ceiling` + `ref.id` 指回 ceiling 构件，并带 status。采集器接入后，
  // 6 个 ac_* 内机不再是 undeclared。
  const CEILING_TO_ANCHOR: Record<string, string> = {
    ac_living: 'indoor_living',
    ac_dining: 'indoor_dining',
    ac_master: 'indoor_master',
    ac_study: 'indoor_study',
    ac_parent: 'indoor_parent',
    ac_child: 'indoor_child',
  };

  it('binds all six ac_* indoor units to their hvac.yaml anchor (no longer undeclared)', () => {
    const elements = collectElements();
    const result = deriveElementStates({ elements, ledger: { entries: [] }, issues: [] });
    const byId = new Map(result.states.map((state) => [state.id, state]));
    for (const [ceilingId, anchorId] of Object.entries(CEILING_TO_ANCHOR)) {
      const state = byId.get(`ceiling:${ceilingId}`);
      assert.ok(state, `ceiling:${ceilingId} 必须被采集到`);
      assert.equal(state.kind, 'hvac');
      assert.notEqual(state.status, 'undeclared', `${ceilingId} 不再应是 undeclared——权威状态在 config/hvac.yaml`);
      assert.equal(state.status, 'confirmed', `${ceilingId} 的 anchor ${anchorId} 是 confirmed（DEC-2026-10-04-R1 成交映射）`);
      assert.match(state.statusSource, /config\/hvac\.yaml/, `statusSource 必须指向 config/hvac.yaml`);
      assert.ok(state.statusSource.includes(anchorId), `statusSource 必须列出 anchor id ${anchorId}，实际：${state.statusSource}`);
    }
    // 六个 hvac 构件全部 confirmed，undeclared 不再含任何一个 ac_*
    const acStates = result.states.filter((state) => /^ceiling:ac_/.test(state.id));
    assert.equal(acStates.length, 6);
    assert.equal(acStates.filter((state) => state.status === 'confirmed').length, 6);
  });

  it('lets the collector-provided configStatusSource override the default config:<raw> source', () => {
    // 采集器把 hvac anchor 的出处带进 configStatusSource，派生据此覆盖默认的 `config:<raw>`。
    const result = deriveElementStates({
      elements: [{ id: 'ceiling:ac_child', kind: 'hvac', label: 'x', configStatus: 'confirmed', configStatusSource: 'config/hvac.yaml anchor indoor_child:confirmed' }],
      ledger: { entries: [] },
      issues: [],
    });
    assert.equal(result.states[0].status, 'confirmed');
    assert.equal(result.states[0].statusSource, 'config/hvac.yaml anchor indoor_child:confirmed');
  });

  it('takes the most conservative status when several anchors reference one ceiling id', () => {
    // 一个内机常同时被 refrigerant/power/condensate 三个 anchor 引用；只要一条没确认，
    // 整个构件就不能按 confirmed 计——否则「电源 confirmed」会盖掉「冷凝水仍 pending」。
    const mixed = mergeCeilingHvacAnchors([
      { id: 'indoor_child', status: 'confirmed' },
      { id: 'power_child', status: 'confirmed' },
      { id: 'condensate_child', status: 'pending', reason: '冷凝水候选接入点待量房确认立管' },
    ]);
    assert.equal(mixed.status, 'pending', '有一条 pending 就取 pending（最保守）');
    assert.deepEqual(mixed.anchorIds, ['condensate_child', 'indoor_child', 'power_child'], '列出全部 anchor id，不许只报一个');
    for (const id of ['condensate_child', 'indoor_child', 'power_child']) {
      assert.ok(mixed.statusSource.includes(id), `statusSource 必须包含 ${id}`);
    }

    const inferred = mergeCeilingHvacAnchors([
      { id: 'a', status: 'confirmed' },
      { id: 'b', status: 'inferred', reason: '示意' },
    ]);
    assert.equal(inferred.status, 'inferred', 'confirmed + inferred 取 inferred');

    const allConfirmed = mergeCeilingHvacAnchors([
      { id: 'a', status: 'confirmed' },
      { id: 'b', status: 'confirmed' },
    ]);
    assert.equal(allConfirmed.status, 'confirmed', '全部 confirmed 才 confirmed');
  });

  it('carries the anchor reason into statusSource for traceability', () => {
    const merged = mergeCeilingHvacAnchors([
      { id: 'branch_child', status: 'inferred', reason: '儿童房冷媒支路按南墙边吊转入示意，分歧、梁位和套管待厂家深化。' },
    ]);
    assert.match(merged.statusSource, /config\/hvac\.yaml/);
    assert.ok(merged.statusSource.includes('儿童房冷媒支路'), `reason 必须出现在 statusSource 里，实际：${merged.statusSource}`);
    assert.equal(merged.status, 'inferred');
  });

  it('maps the HVAC status vocabulary to ElementState words', () => {
    // HVAC confirmed/inferred/pending 在 status_vocabulary 里同名同义；confirmed 对应
    // ElementState 的 confirmed（有成交/裁定依据的确认），不降级成电气 measured/likely。
    assert.equal(mapHvacStatus('confirmed'), 'confirmed');
    assert.equal(mapHvacStatus('inferred'), 'inferred');
    assert.equal(mapHvacStatus('pending'), 'pending');
    assert.throws(() => mapHvacStatus('measured'), /Unknown HVAC status/, '电气词 measured 不是 HVAC 词——抛错，不静默猜测');
    assert.throws(() => mapHvacStatus('likely'), /Unknown HVAC status/, 'likely 同理');
  });
});
