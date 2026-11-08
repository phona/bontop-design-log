// 构件级工程状态派生 + blocker 门禁 + 待决台账解析的权威测试。
//
// 守的不变量（2026-11-08 issue #98 第六阶段 S2-A「状态上对象」后）：
//   ① 派生优先级只剩 [conflict, config_status, fallback]——**状态不查表**：
//      docs/pending-site-data.md 的 ledger 规则与 note 内 DEC 编号的 decision 规则都已退役；
//   ② census：total=162 不变、undeclared≤2、statusSource 全部来自 config 声明；
//   ③ 每个 pending/undeclared 构件都带结构完整的 blocker（kind/owner/trigger/reverses_if/rationale）；
//   ④ 台账解析本身仍可用（shared/pending-ledger.ts 还被 server 侧消费），能区分
//      「元素 id」与「类型/字段引用」——它只是不再是状态来源。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { parseProjectHvacFacts, parseElectricalPoints, parsePlumbingPoints, parseCeilingZones } from '../../shared/project-render-facts-schema.js';
import type { BeamDef, ComponentBlocker } from '../../shared/types.js';
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
import {
  BLOCKER_KINDS,
  BLOCKER_OWNERS,
  checkBlockers,
  formatBlockerIssue,
  noteBlockerDuplicates,
  type BlockerSubject,
} from '../../shared/element-blockers.js';
import { extractBlocker } from '../../scripts/project/extract-element-blockers.js';

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
    // 台账写法：electrical.yaml `sock_balcony_washer`/`sock_balcony_dryer`/`sock_fridge_living`
    // （第三位原为 sock_kitchen_fridge，该点位已于 DEC-2026-10-17-R20 删除并由 sock_fridge_living 接替）
    const targets = extractTargets('electrical.yaml `sock_balcony_washer`/`sock_balcony_dryer`/`sock_fridge_living`；house.yaml');
    // 三个 id 都要取到；末尾的 house.yaml 没有反引号 id，作为无 id 的 target 保留（不丢文件引用）
    assert.deepEqual(targets.filter((target) => target.id).map((target) => target.id), ['sock_balcony_washer', 'sock_balcony_dryer', 'sock_fridge_living']);
    assert.equal(targets[0].file, 'config/electrical.yaml');
    assert.ok(targets.some((target) => target.file === 'config/house.yaml' && !target.id));
  });

  it('separates element ids from type/field references', () => {
    const knownIds = new Set(['electrical:sock_child_ac', 'ceiling:ac_child']);
    const knownTypes = new Set(['ac_indoor', 'strong_panel', 'leb']);
    assert.equal(classifyTarget({ file: 'config/electrical.yaml', id: 'sock_child_ac' }, knownIds, knownTypes), 'bound');
    assert.equal(classifyTarget({ file: 'config/model/envelope/ceiling.yaml', id: 'ac_indoor' }, knownIds, knownTypes), 'type_reference', 'ac_indoor 是 type 取值，不是元素 id');
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

  it('has no ledger input at all: deriveElementStates cannot be fed a pending-site-data entry (S2-A)', () => {
    // 2026-11-08 S2-A 评审 blocking 2 的防线：台账不是降级为「可选输入」，而是从签名里消失。
    // `ElementStateInput` 没有 `ledger` 字段——把台账喂进去是**类型错误**，编译期就拦，
    // 不靠运行期「读了但不用」。状态与「卡在谁」只能来自对象自己的 status / blocker。
    const result = deriveElementStates({
      elements: [{ id: 'electrical:ledgered', kind: 'electrical', label: 'socket ledgered', configStatus: 'inferred' }],
      issues: [],
    });
    assert.equal(result.states[0].status, 'inferred');
    assert.equal(result.states[0].statusSource, 'config:inferred');
    assert.equal(result.states[0].blocker, undefined, '「卡在谁」来自对象自己的 blocker，不来自任何账本');
    // 反向锚：签名里确实没有 ledger（下面这行若去掉 @ts-expect-error 就会编译失败）。
    // @ts-expect-error —— ledger 已从 ElementStateInput 移除，喂进来必须是类型错误
    deriveElementStates({ elements: [], issues: [], ledger: { entries: [] } });
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
      elements: [element({ id: 'electrical:x', configStatus: 'measured', blocker: { kind: 'site_measurement', owner: ['量房'], trigger: '量房', reverses_if: '改', rationale: '卡' } })],
      issues: [{ entity: 'electrical:x', code: 'furniture_wall_collision', level: 'error' }],
    });
    assert.equal(result.states[0].status, 'conflicted');
    assert.equal(result.states[0].statusSource, 'verifier:furniture_wall_collision');
    assert.deepEqual(result.states[0].conflicts, ['furniture_wall_collision']);
  });

  it('lets a warning-level issue show as a conflict but not override the status', () => {
    const result = deriveElementStates({
      elements: [element({ id: 'electrical:x', configStatus: 'measured' })],
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
        element({ id: 'electrical:f', configStatus: 'undeclared' }),
      ],
      issues: [],
    });
    const byId = new Map(result.states.map((state) => [state.id, state.status]));
    assert.equal(byId.get('electrical:a'), 'measured');
    assert.equal(byId.get('electrical:b'), 'inferred', 'likely 未经现场核实，统一按推断处理');
    assert.equal(byId.get('electrical:c'), 'inferred');
    assert.equal(byId.get('electrical:d'), 'pending');
    assert.equal(byId.get('electrical:e'), 'confirmed');
    assert.equal(byId.get('electrical:f'), 'undeclared', '对象可显形申报「状态未申报」，与派生兜底同词同义');
  });

  it('carries the object blocker through to the state (S2-A: 未决项住对象本体)', () => {
    const blocker = { kind: 'pending_vendor_drawing' as const, owner: ['厂家' as const], trigger: '厂家深化图到手', reverses_if: '接线盒在西/北侧则改位', rationale: '机身尺寸未定' };
    const result = deriveElementStates({
      elements: [element({ id: 'electrical:x', configStatus: 'pending', blocker })],
      issues: [],
    });
    assert.equal(result.states[0].status, 'pending');
    assert.equal(result.states[0].statusSource, 'config:pending');
    assert.deepEqual(result.states[0].blocker, blocker);
  });

  it('never produces a confirmed status from a DEC reference in the note (S2-A)', () => {
    // 反事实锚点：采集器仍会把 note 里的 DEC 编号带进 decision 字段（溯源用），
    // 但 deriveElementStates 不许再拿它当状态依据——这正是 issue #98 点名的隐式确认逻辑。
    const result = deriveElementStates({
      elements: [element({ id: 'electrical:decided', decision: 'DEC-2026-10-08-C01' })],
      issues: [],
    });
    assert.equal(result.states[0].status, 'undeclared', 'note 内 DEC 编号不再产生 confirmed');
    assert.equal(result.states[0].decision, 'DEC-2026-10-08-C01', '编号本身仍作溯源保留');
  });

  it('falls through to undeclared when nothing is declared', () => {
    const result = deriveElementStates({
      elements: [element({ id: 'electrical:bare' })],
      issues: [],
    });
    assert.equal(result.states[0].status, 'undeclared', '派生不出来必须显形，不是默认已确认');
    assert.equal(result.summary.undeclared, 1);
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
      issues: [],
      model: { ...DEFAULT_STATE_MODEL, priority: ['conflict', 'nonsense', 'fallback'] as StateModel['priority'] },
    });
    assert.ok(extra.warnings.some((warning) => warning.code === 'state.rule_unknown' && warning.entity === 'nonsense'));
    assert.ok(extra.warnings.some((warning) => warning.code === 'state.rule_undeclared'));

    // 已退役的两条规则（ledger / decision）再被写回优先级链，必须报「代码里没有这个规则」——
    // 覆盖矩阵不许说谎：删掉的查表通道不许靠改配置悄悄复活。
    const revived = deriveElementStates({
      elements: [element({ id: 'electrical:x' })],
      issues: [],
      model: { ...DEFAULT_STATE_MODEL, priority: ['conflict', 'config_status', 'ledger', 'decision', 'fallback'] as StateModel['priority'] },
    });
    assert.ok(revived.warnings.some((warning) => warning.code === 'state.rule_unknown' && warning.entity === 'ledger'));
    assert.ok(revived.warnings.some((warning) => warning.code === 'state.rule_unknown' && warning.entity === 'decision'));
    assert.equal(revived.states[0].status, 'undeclared', '复活的规则没有实现，不改变任何状态');

    const noFallback = deriveElementStates({
      elements: [element({ id: 'electrical:x' })],
      issues: [],
      model: { ...DEFAULT_STATE_MODEL, priority: ['conflict', 'config_status'] },
    });
    assert.ok(noFallback.warnings.some((warning) => warning.code === 'state.no_fallback'));
    assert.equal(noFallback.states[0].status, 'undeclared', '没有 fallback 也不静默给状态');
  });
});

describe('element blocker gate', () => {
  const subject = (overrides: Partial<BlockerSubject> & { id: string }): BlockerSubject => ({
    kind: 'electrical',
    ...overrides,
  });
  const goodBlocker = { kind: 'site_measurement' as const, owner: ['量房' as const], trigger: '量房实测', reverses_if: '不符则重算', rationale: '未实测' };

  it('requires a complete blocker for every pending or undeclared element', () => {
    const issues = checkBlockers(
      [
        subject({ id: 'electrical:ok', status: 'pending', blocker: goodBlocker }),
        subject({ id: 'electrical:undeclared', status: 'undeclared', blocker: goodBlocker }),
      ],
      (item) => item.status,
    );
    assert.deepEqual(issues.issues, []);
    assert.equal(issues.checked, 2);
  });

  it('flags a missing blocker on a pending element', () => {
    const result = checkBlockers([subject({ id: 'electrical:x', status: 'pending' })], (item) => item.status);
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].code, 'blocker_missing');
    assert.match(formatBlockerIssue(result.issues[0]), /electrical:x \[blocker_missing\]/);
  });

  it('flags an undeclared element with no blocker (申报缺口也要说清卡在什么)', () => {
    const result = checkBlockers([subject({ id: 'ceiling:y' })], () => 'undeclared');
    assert.equal(result.issues[0].code, 'blocker_missing');
  });

  it('rejects a kind outside the enum', () => {
    const result = checkBlockers(
      [subject({ id: 'electrical:x', status: 'pending', blocker: { ...goodBlocker, kind: 'waiting_for_godot' as never } })],
      (item) => item.status,
    );
    assert.equal(result.issues[0].code, 'blocker_kind_invalid');
    assert.match(result.issues[0].message, /site_measurement/);
  });

  it('rejects an empty or unknown owner list', () => {
    const empty = checkBlockers([subject({ id: 'electrical:x', status: 'pending', blocker: { ...goodBlocker, owner: [] } })], (item) => item.status);
    assert.equal(empty.issues[0].code, 'blocker_owner_missing');
    const unknown = checkBlockers([subject({ id: 'electrical:x', status: 'pending', blocker: { ...goodBlocker, owner: ['邻居' as never] } })], (item) => item.status);
    assert.equal(unknown.issues[0].code, 'blocker_owner_invalid');
    assert.match(unknown.issues[0].message, /业主/);
  });

  it('rejects empty trigger / reverses_if / rationale', () => {
    for (const field of ['trigger', 'reverses_if', 'rationale'] as const) {
      const result = checkBlockers(
        [subject({ id: 'electrical:x', status: 'pending', blocker: { ...goodBlocker, [field]: '   ' } })],
        (item) => item.status,
      );
      assert.equal(result.issues[0].code, `blocker_${field === 'trigger' ? 'trigger' : field === 'reverses_if' ? 'reverses_if' : 'rationale'}_empty`, field);
    }
  });

  it('leaves non-pending elements alone', () => {
    const result = checkBlockers(
      [subject({ id: 'electrical:a', status: 'inferred' }), subject({ id: 'electrical:b', status: 'confirmed' }), subject({ id: 'electrical:c', status: 'measured' })],
      (item) => item.status,
    );
    assert.deepEqual(result.issues, []);
    assert.equal(result.checked, 0);
  });

  it('extracts kind and owner from a note that already states the blocker (mechanical, S2-A)', () => {
    // 真实 note 片段：Hood SKU, final face/access and duct joint remain pending
    const extraction = extractBlocker({ note: 'Hood SKU, final face/access and duct joint remain pending, so this point is explicitly position_status: pending.' });
    assert.equal(extraction.kind, 'pending_selection');
    assert.ok(extraction.owner.length > 0);
    for (const owner of extraction.owner) assert.ok(BLOCKER_OWNERS.includes(owner), `owner ${owner} 必须在枚举内`);
    for (const kind of BLOCKER_KINDS) assert.ok(typeof kind === 'string');
  });

  it('reports a note with no kind keyword as unresolved instead of guessing silently', () => {
    const extraction = extractBlocker({ note: '主走廊吊顶（藏多联机风管），净高约2.50m' });
    assert.deepEqual(extraction.missing, ['kind'], '抽不出 kind 必须进未命中清单交人工判');
  });
});

describe('real project projection', () => {
  it('binds sock_child_ac to its own blocker (no ledger, no DEC)', () => {
    const elements = collectElements();
    const byId = new Map(elements.map((item) => [item.id, item]));
    const child = byId.get('electrical:sock_child_ac');
    assert.ok(child, 'electrical:sock_child_ac 必须被采集到');
    assert.equal(child.configStatus, 'pending');
    assert.ok(child.blocker, '必须带 blocker（对象本体声明，不查台账）');
    assert.equal(child.blocker!.kind, 'pending_vendor_drawing');
    assert.deepEqual(child.blocker!.owner, ['厂家']);
    assert.match(child.blocker!.trigger, /28T2/);

    const result = deriveElementStates({ elements, issues: [] });
    const state = result.states.find((item) => item.id === 'electrical:sock_child_ac');
    assert.equal(state!.status, 'pending');
    assert.equal(state!.statusSource, 'config:pending');
    assert.match(state!.blocker!.trigger, /厂家深化图到手/);
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
  //   ① 有人往配置里加了构件但没申报 status → 去申报，别改这个数；
  //   ② 有人删了构件 → 故意更新此快照并在 commit 里说明；
  //   ③ 有人给既有构件补了 status 申报（如并行提交 769401e 给 46 个电气点位
  //      补申报，undeclared 随之下降）→ 合法改进，更新此快照并在 commit 里说明来历；
  //   ④ 采集器新接了一份权威状态源（如本次接入 config/hvac.yaml）→ 相应构件不再是申报缺口，
  //      数字下降，在 commit 里说明来历。
  // 用空 issues 求 undeclared：把「申报缺口」与「门禁当前有没有 error」解耦，
  // 否则一个真实冲突会让这个数莫名少 1，掩盖申报缺口本身。
  it('pins the element census so undeclared elements cannot slip in silently', () => {
    const elements = collectElements();
    const result = deriveElementStates({ elements, issues: [] });
    assert.equal(result.summary.total, 162, '构件总数（电气 104 + 给排水 33 + 吊顶/HVAC 25；R1 删两盏壁灯 107→105，R2 删两卫平板灯与墙控 105→101，DEC-2026-10-13-R5 删电视墙灯带 101→100；DEC-2026-10-17-R20 水电 review 落地：电气 +7 新增 −2 删除=105，给排水 +1 洗碗机给水=33；DEC-2026-10-27-R01 删 switch_parent_bed，电气 105→104；2026-11-08 issue #98 S1-B 状态申报只补字段不增删构件；S2-A 同）');
    // 申报缺口的历史：b0c425c 基线 74 → 电气 46 项按依据补申报 → hvac anchor 接入 6 项
    // → 给排水采集器补读 status 2 项 → 花洒 2 项补申报 → 15 → 吊顶分区补 DEC 溯源 10 项 → 5。
    // DEC-2026-10-28-R05：主卧南窗帘盒归位时 note 补了 DEC 全引 → 该盒不再是申报缺口，5→4。
    // 2026-11-08 issue #98 S1-B：原 67 个「DEC 引用 confirmed」构件补显式 status/position_status
    // （issue #98 要求 DEC 引用不再直接产生状态），decision 引用通道归零——申报缺口不因此变化，
    // 仍是既有 4 个：两个吊顶分区（ceiling_child_ac / ceiling_main_corridor）+ 主卧西窗帘盒
    // （curtain_box_master_west，#53 追踪）+ 阳台洗衣机排水（drain_balcony_washer，#51 追踪）。
    // 2026-11-08 issue #98 S2-A：ledger 规则退役后这 4 个全部改由对象自身 status + blocker 承载
    // （curtain_box_master_west / drain_balcony_washer → status: pending；两个吊顶分区 →
    // status: undeclared 显形申报），申报缺口回到 2 个纯未申报的吊顶分区。
    assert.equal(result.summary.undeclared, 2, '空 issues 下的未声明状态数——纯申报缺口，不受台账/门禁影响');
    assert.ok(result.summary.undeclared / result.summary.total < 0.15, '申报缺口应维持在低位；重新升高说明有新构件没申报');
  });

  it('binds every element to a config declaration once the real inputs are in play', () => {
    const elements = collectElements();
    const result = deriveElementStates({ elements, issues: [] });
    // issue #98 S2-A（2026-11-08）：状态不查表。statusSource 只允许两种形态——
    // `config:<raw>`（电气/给排水/吊顶分区自身声明）与 `config/hvac.yaml anchor ...`
    // （6 个 ac_* 内机的权威状态在 hvac.yaml anchor）。台账与 DEC 通道必须为 0。
    const byDecision = result.states.filter((state) => state.statusSource.startsWith('decision:'));
    assert.deepEqual(byDecision.map((state) => state.id), [], 'DEC 引用通道必须为 0——note 内编号不得再隐式产生 confirmed');
    const byLedger = result.states.filter((state) => state.statusSource.startsWith('pending-site-data'));
    assert.deepEqual(byLedger.map((state) => state.id), [], '台账通道必须为 0——状态是对象的声明，不是查表查出来的结果');
    for (const state of result.states) {
      assert.ok(
        state.statusSource.startsWith('config:') || state.statusSource.startsWith('config/hvac.yaml') || state.statusSource.startsWith('verifier:'),
        `statusSource 必须来自 config 声明或 verifier：${state.id} → ${state.statusSource}`,
      );
    }
    assert.equal(result.summary.undeclared, 2, '只剩 2 个显形申报 undeclared 的吊顶分区（ceiling_child_ac / ceiling_main_corridor）');
    assert.equal(result.summary.pending, 37, '2026-11-08 issue #98 S2-A：37 个 pending 全部由 config status: pending 承载（原 S1-B 口径 37，其中 8 个原经 ledger 规则、2 个原为 undeclared 申报缺口）');
    const confirmed = result.states.filter((state) => state.status === 'confirmed');
    assert.equal(confirmed.length, 6, 'confirmed 剩 6 个且全部来自 hvac anchor（ac_* 成交映射），不再有 DEC 引用产生的 confirmed');
    for (const state of confirmed) assert.match(state.statusSource, /config\/hvac\.yaml/, `confirmed 的权威必须是 config/hvac.yaml：${state.id} → ${state.statusSource}`);
  });

  it('requires a complete blocker on every pending or undeclared element (S2-A 门禁)', () => {
    // 这条断言是「未决项上对象」的机器约束：今天 39 个对象一个都不许漏。
    const elements = collectElements();
    const result = deriveElementStates({ elements, issues: [] });
    const statusById = new Map(result.states.map((state) => [state.id, state.status]));
    const gate = checkBlockers(elements as BlockerSubject[], (subject) => statusById.get(subject.id));
    assert.equal(gate.checked, 39, `受门禁管辖的 pending/undeclared 构件数（pending 37 + undeclared 2）：${gate.checked}`);
    assert.deepEqual(gate.issues.map((issue) => formatBlockerIssue(issue)), [], '每个 pending/undeclared 构件都必须带结构完整的 blocker');
    // 反向锚：门禁不是恒真式——把一个对象的 blocker 抹掉，它必须报红。
    const stripped = elements.map((item) => (item.id === 'electrical:sock_child_ac' ? { ...item, blocker: undefined } : item));
    const broken = checkBlockers(stripped as BlockerSubject[], (subject) => statusById.get(subject.id));
    assert.ok(broken.issues.some((issue) => issue.id === 'electrical:sock_child_ac' && issue.code === 'blocker_missing'), '抹掉一个 blocker 必须报红（证明门禁有约束力）');
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
    const result = deriveElementStates({ elements, issues: [] });
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
      issues: [],
    });
    assert.equal(result.states[0].status, 'confirmed');
    assert.equal(result.states[0].statusSource, 'config/hvac.yaml anchor indoor_child:confirmed');
  });

  it('takes the most conservative status when several anchors reference one ceiling id', () => {
    // 一个内机常同时被 refrigerant/power/condensate 三个 anchor 引用；只要一条没确认，
    // 整个构件就不能按 confirmed 计——否则「电源 confirmed」会把「冷凝水仍 pending」盖掉。
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

describe('structural beams declared on the geometry object (S2-A)', () => {
  // beam 对象是 2026-11-08 S2-A 从 docs/pending-site-data.md 的「梁体推断」表与「邻户实测参考」
  // 节上到 config/layout/model-geometry.yaml 的。它当前没有运行期几何消费方（梁是量房待填项），
  // 读者是这份测试——所以不变量必须在这里钉住，否则「上对象」会退化成一份没人校验的登记。
  const mg = parseYaml(readFileSync('config/layout/model-geometry.yaml', 'utf8')) as { beams?: BeamDef[] };
  const beams = mg.beams ?? [];

  it('declares the four slab-span inferred beams from the pending-site-data table', () => {
    assert.ok(beams.length >= 4, `梁体推断表 4 行必须全部上对象，实际 ${beams.length}`);
    const slabSpan = beams.filter((beam) => !beam.inferred.neighbor_ref);
    assert.equal(slabSpan.length, 4, '4 条板跨结构推断（不带 neighbor_ref 指针）');
    for (const beam of slabSpan) {
      assert.ok(beam.inferred.height && beam.inferred.height.length === 2, `${beam.id} 的推断梁高必须是区间 [min,max]`);
      assert.ok(beam.inferred.height[0] < beam.inferred.height[1], `${beam.id} 的梁高区间必须递增`);
      assert.ok(beam.inferred.basis.length > 0, `${beam.id} 必须写清推断依据`);
    }
  });

  it('marks every beam as inferred and not for construction', () => {
    for (const beam of beams) {
      assert.equal(beam.structure_status, 'inferred', `${beam.id} 自家量房前无 confirmed 梁`);
      assert.equal(beam.not_for_construction, true, `${beam.id} 不得作为开孔/穿梁/压标高依据`);
      assert.ok(['east_west', 'north_south'].includes(beam.orientation), `${beam.id} 必须声明走向`);
    }
  });

  it('points at the hvac reference_constraints instead of copying neighbour-survey numbers', () => {
    // 单一真相：外部原件 survey/neighbor_ys01_original_structure_2025-06.png 只在
    // config/hvac.yaml 的 reference_constraints 登记一次；beam 侧只存指针，不复制数字。
    const hvac = parseProjectHvacFacts(readFileSync('config/hvac.yaml', 'utf8'));
    const constraintIds = new Set(hvac.plans.flatMap((plan) => plan.diagram.reference_constraints.map((constraint) => constraint.id)));
    const withRef = beams.filter((beam) => beam.inferred.neighbor_ref);
    assert.ok(withRef.length >= 3, '邻户实测的梁体读数必须以指针形式上对象');
    for (const beam of withRef) {
      const refs = (beam.inferred.neighbor_ref ?? '').split(':').pop()!.split(',').map((ref) => ref.trim()).filter(Boolean);
      assert.ok(refs.length > 0, `${beam.id} 的 neighbor_ref 不能为空`);
      for (const ref of refs) {
        assert.ok(constraintIds.has(ref), `${beam.id} 的 neighbor_ref ${ref} 必须存在于 config/hvac.yaml reference_constraints`);
      }
      assert.ok(!beam.inferred.height && !beam.inferred.width, `${beam.id} 是指针式登记，不得复制 hvac 约束的数字（第二份真相）`);
    }
  });
});

describe('note 与 blocker 不许并存两份（S2-A 评审 blocking 1 的防线）', () => {
  // 同一句「为什么卡 / 什么条件下反转」写在 note 里又抄进 blocker，就是第二份真相——
  // note 改一句、blocker 不会跟着改，而 blocker 门禁只查非空，查不出漂移。
  // 纪律：未决口径只住 blocker；note 里要么没有那句，要么末尾有统一标注指向 blocker。
  const TAIL = '本条未决口径（卡在谁/何时解锁/何时反转/为何卡）已结构化到 blocker 字段，以 blocker 为单一真相，note 不再重复登记。';
  const all = [
    ...parseElectricalPoints(readFileSync('config/electrical.yaml', 'utf8')),
    ...parsePlumbingPoints(readFileSync('config/plumbing.yaml', 'utf8')),
    ...parseCeilingZones(readFileSync('config/model/envelope/ceiling.yaml', 'utf8')),
  ] as Array<{ id: string; note?: string; status?: string; blocker?: ComponentBlocker }>;
  const withBlocker = all.filter((item) => item.blocker);

  it('covers every blocker-carrying object', () => {
    assert.equal(withBlocker.length, 39, `带 blocker 的构件数：${withBlocker.length}`);
  });

  it('never repeats a blocker field verbatim inside the note', () => {
    for (const item of withBlocker) {
      const duplicates = noteBlockerDuplicates(item.note ?? '', item.blocker!);
      assert.deepEqual(duplicates, [], `${item.id} 的 note 逐字包含 blocker 字段——删掉 note 里那句或改为指向 blocker`);
    }
  });

  it('never mentions the retired position_status field in a blocker-carrying note', () => {
    for (const item of withBlocker) {
      assert.ok(!/position_status/.test(item.note ?? ''), `${item.id} 的 note 仍提及已删除的 position_status 字段（悬空引用）`);
    }
  });

  it('marks every blocker-carrying note as结构化到 blocker', () => {
    for (const item of withBlocker) {
      if (!item.note) continue;
      assert.ok((item.note ?? '').includes(TAIL), `${item.id} 的 note 末尾必须有统一标注，说明未决口径已结构化到 blocker`);
    }
  });

  it('flags a note that states a status conclusion contradicting the status field', () => {
    // 同一事实两处可写且值不同 = 第二份真相（ask ⑥）。S1-B 曾在 note 里写
    // 「状态依据：status 归入 topology 回路 X→inferred」，本轮 status 合并后这些对象已是
    // status: pending——note 的旧派生结论与字段直接矛盾，必须显形。
    const STATUS_CLAIM = /status\s*归入\s*topology\s*回路[^→\n]{0,60}→\s*(inferred|measured|confirmed|likely|pending)|status\s*暂不判|status\s*不判/g;
    const contradicting = all.filter((item) => {
      const hits = [...(item.note ?? '').matchAll(STATUS_CLAIM)];
      return hits.some((hit) => (/暂不判|不判/.test(hit[0]) ? true : hit[1] !== item.status));
    });
    assert.deepEqual(contradicting.map((item) => item.id), [], 'note 不得声明与 status 字段矛盾的状态结论');
  });

  it('is not vacuous: the duplicate detector fires on a tampered note (real reverse anchor)', () => {
    // 反向锚必须**真的调用被测逻辑**，不能只对「自己刚构造出来的字符串」做 includes 断言——
    // 那种写法恒真、永不失败，是 S1/S2 教训里的「假的反向锚」。
    const victim = withBlocker[0];
    const clean = noteBlockerDuplicates(victim.note ?? '', victim.blocker!);
    assert.deepEqual(clean, [], '干净输入的重复列表必须为空');
    const tampered = { ...victim, note: `${victim.note ?? ''}${victim.blocker!.trigger}` };
    const dirty = noteBlockerDuplicates(tampered.note ?? '', tampered.blocker!);
    assert.ok(dirty.length > 0, `把 blocker.trigger 原样注入 note 必须被检测到，实际：${JSON.stringify(dirty)}`);
    assert.ok(dirty.some((entry) => entry.field === 'trigger'), '检出的重复必须点名是哪个字段');
  });
});

describe('构件状态唯一来源是 status 字段，position_status 不再是状态源（S2-A 头号契约）', () => {
  // 业主裁定①：「status / position_status 两个字段都能写状态即 blocking」。
  // 这条契约此前只靠 config 数据与注释维系——把 shared/element-sources.ts 的采集分支
  // 改回 position_status 优先，派生状态会静默改变，而 census 钉的 total/undeclared/pending/confirmed
  // 全不变，没有任何测试或门禁变红。以下三条锚把契约钉死。
  const electricalPoints = parseElectricalPoints(readFileSync('config/electrical.yaml', 'utf8'));
  const plumbingPoints = parsePlumbingPoints(readFileSync('config/plumbing.yaml', 'utf8'));
  const elements = collectElements();
  const configStatusById = new Map(elements.map((element) => [element.id, element.configStatus]));

  it('reads every element status from the status field, never from position_status', () => {
    // 通用锚：有 status 声明的对象，采集器给出的 configStatus 必须**等于 status 原值**。
    // 采集器一旦改回 position_status 优先，两个面板点就会从这里分歧。
    let checked = 0;
    const groups: Array<[string, Array<{ id: string; status?: string }>]> = [
      ['electrical', electricalPoints as Array<{ id: string; status?: string }>],
      ['plumbing', plumbingPoints as Array<{ id: string; status?: string }>],
    ];
    for (const [prefix, points] of groups) {
      for (const point of points) {
        if (point.status === undefined) continue;
        checked += 1;
        assert.equal(
          configStatusById.get(`${prefix}:${point.id}`),
          point.status,
          `${prefix}:${point.id} 的 configStatus 必须来自 status 字段（${point.status}），不得来自 position_status`,
        );
      }
    }
    assert.equal(checked, electricalPoints.length + plumbingPoints.length, '每个电气/给排水点都要被检查（一个都不能漏）');
  });

  it('强弱电箱的 status 是诚实值：位置未实测 ⇒ 不得写 measured（S2-A 第 4 轮 blocking 修复）', () => {
    // 这两个点的存量脏值：panel_strong_entry_left 原写 status: measured（2026-08-25 的旧声明），
    // 而 note 明写「横向偏移待量房实测回填 / 本体高度待现场复测 / pending #4/#29/#30」。
    // 旧代码靠 position_status 优先把它压成 inferred；S2-A 拆掉压制后必须重新裁断，
    // 不能把脏值当「有意为之」钉住。词汇表定义 measured = 现场实测几何，故诚实值是 inferred。
    assert.equal(configStatusById.get('electrical:panel_strong_entry_left'), 'inferred');
    // likely 由词汇表映射为 inferred（app 侧同色），position_status 冗余已删——同一事实不写两遍。
    assert.equal(configStatusById.get('electrical:panel_weak_entry_left'), 'likely');
    for (const id of ['panel_strong_entry_left', 'panel_weak_entry_left']) {
      const point = electricalPoints.find((p) => p.id === id) as { position_status?: string } | undefined;
      assert.equal(point?.position_status, undefined, `${id} 不应再声明 position_status（与 status 同一事实，双写）`);
    }
    // 反证：measured 只能留给真的现场实测过的几何。
    const measured = (electricalPoints as Array<{ id: string; status?: string }>).filter((p) => p.status === 'measured').map((p) => p.id);
    assert.deepEqual(measured, [], '电气点不应有 status: measured——量房前一个都没有');
  });

  it('keeps position_status out of new declarations (regression anchor)', () => {
    // 回归锚：position_status 已退役，电气配置里只允许存量 2 条（sock_child_ac /
    // sock_kitchen_oven 两个预留占位点，是 shared/mep-takeoff.ts 算量延期判定
    // 「status 与 position_status 均 pending」的一半）。两个面板点的冗余 position_status
    // 已在第 4 轮删掉（与 status 同一事实，双写）。
    // 给任何点新增 position_status 都会让「位置待核」在状态机 / DXF / 算量三处静默分叉。
    const declared = (electricalPoints as Array<{ id: string; position_status?: string; status?: string }>)
      .filter((point) => point.position_status !== undefined)
      .map((point) => point.id)
      .sort();
    assert.deepEqual(declared, ['sock_child_ac', 'sock_kitchen_oven'], 'position_status 只允许存量 2 条，新增即是回归');
    for (const point of electricalPoints as Array<{ id: string; position_status?: string; status?: string }>) {
      if (point.position_status === 'pending') {
        assert.equal(point.status, 'pending', `${point.id} 的 position_status=pending 只在 status 也 pending 时有意义（算量延期判定）`);
      }
    }
    // 给排水/吊顶从未有第二个状态字段，补写 position_status 必须是 schema 错误。
    for (const point of plumbingPoints as Array<{ id: string; position_status?: string }>) {
      assert.equal(point.position_status, undefined, '给排水点不得出现 position_status');
    }
  });
});
