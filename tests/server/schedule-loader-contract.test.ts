// PR #216 Codex blocking 的 loader 层回归（docs/schedule-coordination-design.md §14）。
//
// 守什么（每条对应 §14 的一条契约）：
//   B1 验收指纹与协调事实隔离：checkSpecHash 只哈希显式白名单字段；改 coordination 的
//      status/actor/confirmed_at、包名/描述/顺序/依赖/责任角色或阻塞项文案不换指纹、不让已
//      passed 记录变 stale；改 pass_condition 换指纹；遍历 control.yaml 全部 check 的键与
//      packageChecks 派生视图（含 acceptance_refs 摊平）的全部键、以及全部包级键，白名单外
//      且未显式排除的键必须失败。
//   B2 实际窗口 = 完工事实：gateStatus(pkg) !== 'passed'（含 1/N 部分通过）不生成窗口；
//      全部 passed 才生成 = 各 checked_at 的 [min, max]；status: waived 不生成。
//   B3 actual_windows 以真实日期给模块：非法 checked_at 按记录报错；gate passed 的包只要有一
//      条 passed 记录日期非法就不生成窗口（actual_window_invalid_checked_at，不许拿剩余日期
//      拼偏短窗口）；一条都映射不到时报 actual_window_unresolved（不许静默丢完工事实）。
//   B4 投影前移到 load 期：ProjectionError 的 code 进 state.errors（route 在 build 之前 503），
//      buildScheduleSnapshot 只消费已存投影、不得再追加错误。
//   B5 loader 侧显形 constraint_resolved_without_anchor（锚点未定时 resolved 约束不静默丢）。
//
// 手法沿用 tests/server/schedule-state.test.ts 的 symlink 农场：除 schedule/ 与 contracts/
// 为真实副本（可篡改面）外，其余顶层条目 symlink 回真仓；control.yaml 走文本手术。

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { load as parseYaml } from 'js-yaml';
import {
  CHECK_NON_SPEC_KEYS,
  CHECK_SPEC_FIELD_ALIASES,
  CHECK_SPEC_HASH_FIELDS,
  PACKAGE_NON_SPEC_KEYS,
  PACKAGE_SPEC_HASH_FIELDS,
  buildScheduleSnapshot,
  loadScheduleState,
  type ScheduleState,
} from '../../shared/schedule-state.js';
import { loadModelPackageLinks } from '../../server/model-package-links.js';

type AnyRecord = Record<string, any>;

const repoRoot = process.cwd();

function loadRealState(): ScheduleState {
  return loadScheduleState(repoRoot, {modelPackageLinks: loadModelPackageLinks()});
}

function replaceOnce(text: string, from: string, to: string): string {
  const first = text.indexOf(from);
  assert.notEqual(first, -1, `篡改锚点不存在：${from}`);
  assert.equal(text.indexOf(from, first + 1), -1, `篡改锚点不唯一：${from}`);
  return text.slice(0, first) + to + text.slice(first + from.length);
}

/** 只在指定包块内替换一次（包级 status 等同名字段在全部包里重复，不能全文件锚）。 */
function replaceInPackageBlock(text: string, pkgId: string, nextPkgId: string, from: string, to: string): string {
  const marker = `  - id: ${pkgId}\n`;
  const start = text.indexOf(marker);
  assert.notEqual(start, -1, `包块不存在：${pkgId}`);
  const end = text.indexOf(`\n  - id: ${nextPkgId}\n`, start);
  assert.ok(end > start, `下一个包块不存在：${nextPkgId}`);
  return text.slice(0, start) + replaceOnce(text.slice(start, end), from, to) + text.slice(end);
}

// ─── B1：验收指纹与协调事实隔离 ─────────────────────────────────────────────

describe('checkSpecHash 白名单（§14/B1）', () => {
  it('改 coordination 的 status/actor/confirmed_at → 指纹不变，已 passed 记录不 stale', () => {
    const state = loadRealState();
    const pkg = state.control.work_packages.find((item: AnyRecord) => item.id === 'PKG-000');
    const checkId = 'SCH-000-01';
    const baseline = state.checkSpecHash(pkg, checkId);
    assert.equal(baseline.length, 64, 'PKG-000/SCH-000-01 有 coordination 块，指纹必须存在');

    const mutated = structuredClone(pkg);
    const check = mutated.checks.find((item: AnyRecord) => item.id === checkId);
    check.coordination.status = 'confirmed';
    check.coordination.actor = {name: '张工', org: '施工方'};
    check.coordination.confirmed_at = '2026-11-11';

    assert.equal(state.checkSpecHash(mutated, checkId), baseline, '协调事实不是验收标准，不得换指纹');
    // 事实链回归：指纹一变 → staleAuditReason 判 stale → gate_status 从 passed 退回 pending。
    // 协调状态变化必须整条链不动。
    assert.deepEqual(
      state.staleAuditReason(mutated, checkId, {
        status: 'passed',
        check_spec_sha256: baseline,
        project_data_sha256: state.packageProjectFingerprint(pkg),
      }),
      [],
      '只改协调状态不得让已 passed 的验收记录变 stale',
    );
  });

  it('改 pass_condition → 指纹变', () => {
    const state = loadRealState();
    const pkg = state.control.work_packages.find((item: AnyRecord) => item.id === 'PKG-000');
    const checkId = 'SCH-000-01';
    const baseline = state.checkSpecHash(pkg, checkId);
    const mutated = structuredClone(pkg);
    mutated.checks.find((item: AnyRecord) => item.id === checkId).pass_condition += '（标准变更）';
    assert.notEqual(state.checkSpecHash(mutated, checkId), baseline, '验收标准变化必须换指纹');
  });

  it('未知的 check / package 新键默认不进指纹（新字段必须显式决定）', () => {
    const state = loadRealState();
    const pkg = state.control.work_packages.find((item: AnyRecord) => item.id === 'PKG-000');
    const checkId = 'SCH-000-01';
    const baseline = state.checkSpecHash(pkg, checkId);
    const mutated = structuredClone(pkg);
    mutated.checks.find((item: AnyRecord) => item.id === checkId).future_non_spec_field = 'x';
    mutated.future_package_field = 'y';
    assert.equal(state.checkSpecHash(mutated, checkId), baseline, '白名单外的未来字段不得静默进入指纹');
  });

  it('引用型验收项：standard / rooms / when / standard_ref 进指纹，knowledge 与阶段元数据不进', () => {
    const state = loadRealState();
    const pkg = state.control.work_packages.find((item: AnyRecord) => (item.acceptance_refs ?? []).includes('check_wp_dry_gate'));
    assert.ok(pkg, 'check_wp_dry_gate 必须仍挂在某个包的 acceptance_refs 上');
    const checkId = 'check_wp_dry_gate';
    const baseline = state.checkSpecHash(pkg, checkId);
    assert.equal(baseline.length, 64, '引用型验收项必须有指纹');

    const original = state.acceptanceById.get(checkId);
    assert.ok(original, 'acceptance.yaml 里必须有 check_wp_dry_gate');
    /** 只替换这一条验收项的摊平视图（packageChecks 每次现读 acceptanceById）。 */
    const mutate = (patch: AnyRecord) => {
      state.acceptanceById.set(checkId, {...structuredClone(original), ...patch});
      return state.checkSpecHash(pkg, checkId);
    };

    assert.notEqual(mutate({standard: `${original.standard}（标准变更）`}), baseline, '改判定标准必须换指纹（standard → pass_condition 槽位）');
    assert.notEqual(mutate({rooms: [...(original.rooms ?? []), 'kitchen']}), baseline, '改检查范围（rooms）必须换指纹');
    assert.notEqual(mutate({when: 'at_delivery'}), baseline, '改检查时机（when）必须换指纹');
    assert.notEqual(mutate({standard_ref: [...(original.standard_ref ?? []), 'GB 00000']}), baseline, '改判定依据引用（standard_ref）必须换指纹');
    assert.equal(mutate({knowledge: `${original.knowledge ?? ''}补充背景说明`}), baseline, 'knowledge 是背景说明，不改变判定标准，不进指纹');
    assert.equal(mutate({phase_name: '改名的阶段'}), baseline, '阶段元数据不进指纹');
    assert.equal(mutate({objects: {from_packages: ['PKG-030', 'PKG-050', 'PKG-060']}}), baseline, 'objects.from_packages 是挂接登记，不进指纹（一致性由 c.acceptance_objects 对账）');
  });

  it('改包级非验收字段（name/description/sequence/dependencies/owner_roles/blockers）→ 指纹不变，已 passed 记录不 stale', () => {
    const state = loadRealState();
    const pkg = state.control.work_packages.find((item: AnyRecord) => item.id === 'PKG-005');
    const checkId = 'SCH-005-01';
    const baseline = state.checkSpecHash(pkg, checkId);

    const mutated = structuredClone(pkg);
    mutated.name = `${pkg.name}（改名）`;
    mutated.description = `${pkg.description}（改描述）`;
    mutated.sequence = 999;
    mutated.dependencies = ['PKG-000', 'PKG-010'];
    mutated.owner_roles = ['业主'];
    mutated.blockers = [];
    assert.equal(state.checkSpecHash(mutated, checkId), baseline, '包级非验收字段不得进入验收指纹');

    // 阻塞项文案在 global_blockers 上：改它同样不得换指纹（blockerSpecs 已退出哈希）。
    const blocker = state.blockerById.get('BLK-HANDOVER');
    assert.ok(blocker, 'BLK-HANDOVER 必须存在（PKG-005 的阻塞项）');
    state.blockerById.set('BLK-HANDOVER', {...blocker, item: `${blocker.item}（改文案）`, trigger: `${blocker.trigger}（改触发条件）`});
    const withChangedBlockerText = state.checkSpecHash(pkg, checkId);
    assert.equal(withChangedBlockerText, baseline, '阻塞项文案不是验收标准，不得换指纹');

    // 事实链：指纹不变 → 已 passed 记录不 stale → gate 不因这些字段退回 pending。
    assert.deepEqual(
      state.staleAuditReason(mutated, checkId, {
        status: 'passed',
        check_spec_sha256: baseline,
        project_data_sha256: state.packageProjectFingerprint(pkg),
      }),
      [],
      '只改包级非验收字段不得让已 passed 的验收记录变 stale',
    );
  });

  it('control.yaml 与派生验收视图的全部 check 键都在「进指纹 / 显式排除」清单里', () => {
    // 这份断言是反向保险丝：新增 check 字段时，测试当场失败，逼提交人显式决定它进不进
    // checkSpecHash——「新 spec 字段静默不进哈希」和「非 spec 字段悄悄进哈希」都不允许。
    assert.deepEqual(
      [...CHECK_SPEC_HASH_FIELDS].sort(),
      [
        'can_run_while_blocked',
        'checkpoint',
        'does_not_release_construction',
        'evidence_required',
        'id',
        'item',
        'method',
        'owner_roles',
        'pass_condition',
        'rooms',
        'severity',
        'standard_ref',
        'when',
      ],
      '白名单本身变化必须在测试里显式确认（设计 §14/B1）',
    );
    assert.deepEqual([...CHECK_NON_SPEC_KEYS].sort(), ['coordination', 'knowledge', 'objects', 'phase', 'phase_name']);
    assert.deepEqual(Object.keys(CHECK_SPEC_FIELD_ALIASES).sort(), ['evidence_required', 'pass_condition']);
    assert.deepEqual([...PACKAGE_SPEC_HASH_FIELDS], ['id'], '包级白名单本身变化必须在测试里显式确认（设计 §14/B1）');
    assert.deepEqual(
      [...PACKAGE_NON_SPEC_KEYS].sort(),
      [
        'acceptance_refs',
        'blockers',
        'budget',
        'budget_pool',
        'checks',
        'constraints',
        'dependencies',
        'description',
        'duration_workdays',
        'gate_label',
        'include_site_data_ledger',
        'name',
        'owner_roles',
        'payment_gate',
        'readiness',
        'sequence',
        'status',
        'targets',
        'waiver',
      ],
      '包级排除清单变化必须在测试里显式确认（设计 §14/B1）',
    );

    const allowed = new Set<string>([
      ...CHECK_SPEC_HASH_FIELDS,
      ...CHECK_NON_SPEC_KEYS,
      ...Object.values(CHECK_SPEC_FIELD_ALIASES).flat(),
    ]);
    const control = parseYaml(readFileSync(join(repoRoot, 'schedule/phase-1/control.yaml'), 'utf8')) as AnyRecord;
    const allowedPackageKeys = new Set<string>([...PACKAGE_SPEC_HASH_FIELDS, ...PACKAGE_NON_SPEC_KEYS]);
    let packageCount = 0;
    let checkCount = 0;
    let coordinationCount = 0;
    for (const pkg of control.work_packages ?? []) {
      packageCount += 1;
      // 包级键的反向保险丝：新增包级字段必须显式决定进不进 packageSpec。没有这一层，
      // 未来的包级非验收字段可以悄悄进入哈希（改一句描述就让已 passed 记录 stale）。
      for (const key of Object.keys(pkg)) {
        assert.ok(
          allowedPackageKeys.has(key),
          `${pkg.id}: 包级键 "${key}" 不在 PACKAGE_SPEC_HASH_FIELDS / PACKAGE_NON_SPEC_KEYS 里——` +
          '新增字段必须显式决定是否进入 checkSpecHash（设计 §14/B1）',
        );
      }
      for (const check of pkg.checks ?? []) {
        checkCount += 1;
        if (check.coordination !== undefined) coordinationCount += 1;
        for (const key of Object.keys(check)) {
          assert.ok(
            allowed.has(key),
            `${check.id}: check 键 "${key}" 不在 CHECK_SPEC_HASH_FIELDS / CHECK_NON_SPEC_KEYS 里——` +
            '新增字段必须显式决定是否进入 checkSpecHash（设计 §14/B1）',
          );
        }
      }
    }
    assert.ok(packageCount >= 25, `control.yaml 的包数不应缩水（实际 ${packageCount}）`);
    assert.ok(checkCount >= 49, `control.yaml 的 check 数不应缩水（实际 ${checkCount}）`);
    assert.ok(coordinationCount >= 1, 'coordination 必须仍是已登记的「显式不进指纹」键');

    // 引用型验收项的字段并集（acceptance.yaml 经 packageChecks 摊平）同样逐键检查：
    // 新增 acceptance 字段而没人决定归属时，这里当场点名。
    const state = loadRealState();
    const derivedKeys = new Set<string>();
    let derivedChecks = 0;
    for (const pkg of state.control.work_packages) {
      for (const check of state.packageChecks(pkg)) {
        derivedChecks += 1;
        for (const key of Object.keys(check)) {
          derivedKeys.add(key);
          assert.ok(
            allowed.has(key),
            `${check.id}: 派生验收项键 "${key}" 不在 CHECK_SPEC_HASH_FIELDS / CHECK_NON_SPEC_KEYS 里——` +
            '新增字段必须显式决定是否进入 checkSpecHash（设计 §14/B1）',
          );
        }
      }
    }
    assert.ok(derivedChecks > checkCount, '派生视图必须覆盖 acceptance_refs 摊平出的验收项');
    assert.ok(derivedKeys.has('standard') && derivedKeys.has('rooms') && derivedKeys.has('when'), '引用型验收项字段必须仍被派生视图看见');
  });
});

// ─── B2/B3/B4/B5：沙箱（control.yaml 文本手术） ─────────────────────────────

describe('排程投影在 load 期完成（§14/B2/B3/B4/B5，symlink 农场）', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'schedule-loader-'));
  const sandboxControlPath = join(sandbox, 'schedule/phase-1/control.yaml');
  let pristineControlText = '';

  before(() => {
    for (const entry of readdirSync(repoRoot)) {
      if (entry === '.git' || entry === 'node_modules' || entry === 'schedule' || entry === 'contracts') continue;
      symlinkSync(join(repoRoot, entry), join(sandbox, entry));
    }
    symlinkSync(join(repoRoot, 'node_modules'), join(sandbox, 'node_modules'));
    cpSync(join(repoRoot, 'schedule'), join(sandbox, 'schedule'), {recursive: true});
    cpSync(join(repoRoot, 'contracts'), join(sandbox, 'contracts'), {recursive: true});
    pristineControlText = readFileSync(sandboxControlPath, 'utf8');
  });

  after(() => {
    rmSync(sandbox, {recursive: true, force: true});
  });

  function loadSandbox(): ScheduleState {
    return loadScheduleState(sandbox, {
      modelPackageLinks: loadModelPackageLinks(join(sandbox, 'config/model-package-links.yaml')),
    });
  }

  function writeControl(text: string): void {
    writeFileSync(sandboxControlPath, text);
  }

  function restoreControl(): void {
    writeControl(pristineControlText);
  }

  /** 锚点就位（真实日期坐标系的必要条件；anchor_status 必须是 resolved）。 */
  function withAnchor(text: string): string {
    return replaceOnce(
      replaceOnce(text, 'anchor_date: null', 'anchor_date: "2026-01-05"'),
      'anchor_status: site_pending',
      'anchor_status: resolved',
    );
  }

  /** 用「当前 loader」算出的双指纹构造 PKG-005 的 passed 记录（sandbox 与真仓同配置）。 */
  function pkg005AuditRecords(state: ScheduleState, checkedAtByCheck: Record<string, string>): AnyRecord[] {
    const pkg = state.control.work_packages.find((item: AnyRecord) => item.id === 'PKG-005');
    const projectDataSha = state.packageProjectFingerprint(pkg);
    return Object.entries(checkedAtByCheck).map(([checkId, checkedAt], index) => ({
      id: `AUD-005-${String(index + 1).padStart(2, '0')}`,
      package_id: 'PKG-005',
      check_id: checkId,
      status: 'passed',
      checked_at: checkedAt,
      checked_by: '业主',
      evidence: [`evidence-${index + 1}.jpg`],
      check_spec_sha256: state.checkSpecHash(pkg, checkId),
      project_data_sha256: projectDataSha,
    }));
  }

  /** 注入 records（control.yaml 的 audit_log.records 是唯一的空数组锚点）。 */
  function withAuditRecords(text: string, records: AnyRecord[]): string {
    return replaceOnce(text, '  records: []', `  records: ${JSON.stringify(records)}`);
  }

  it('B2/B3：1/N 条 passed → 无实际窗口；全部 passed → 窗口 = checked_at 的 [min,max] 真实日期', (t) => {
    t.after(restoreControl);
    writeControl(pristineControlText);
    const baseline = loadSandbox();
    assert.deepEqual(baseline.errors, [], '未篡改的农场副本必须无错误');
    assert.equal(baseline.gateStatus(baseline.control.work_packages.find((item: AnyRecord) => item.id === 'PKG-005')), 'pending');

    // ① 部分通过：PKG-005 有 2 条检查，只有 1 条 passed —— 不是完工事实，不得生成实际窗口。
    const partialText = withAuditRecords(
      withAnchor(pristineControlText),
      pkg005AuditRecords(baseline, {'SCH-005-01': '2026-01-07'}),
    );
    writeControl(partialText);
    const partial = loadSandbox();
    const partialPkg = partial.control.work_packages.find((item: AnyRecord) => item.id === 'PKG-005');
    assert.deepEqual(partial.errors, []);
    assert.equal(partial.gateStatus(partialPkg), 'pending', '1/2 passed 不得判 gate passed');
    assert.equal(partial.scheduleProjection?.packages['PKG-005']?.actual, null, '部分通过不得冒充完工事实');
    assert.ok(partial.scheduleProjection, '投影本身必须成功（只是该包无实际窗口）');

    // ② 全部通过：窗口 = 两条 checked_at 的 [min,max]；模块把 2026-01-05(一) 映射为 ord 1，
    //    01-07→ord 3、01-09→ord 5（workdays 含周六，故 01-10 也是工作日）。
    writeControl(withAuditRecords(
      withAnchor(pristineControlText),
      pkg005AuditRecords(baseline, {'SCH-005-01': '2026-01-07', 'SCH-005-02': '2026-01-09'}),
    ));
    const full = loadSandbox();
    const fullPkg = full.control.work_packages.find((item: AnyRecord) => item.id === 'PKG-005');
    assert.deepEqual(full.errors, []);
    assert.equal(full.gateStatus(fullPkg), 'passed');
    assert.deepEqual(full.scheduleProjection?.packages['PKG-005']?.actual, {start_ord: 3, end_ord: 5});
    assert.deepEqual(full.scheduleProjection?.packages['PKG-005']?.forecast, {
      start_ord: 3,
      end_ord_min: 5,
      end_ord_max: 5,
    });
    assert.deepEqual(full.scheduleProjection?.ordinals.find((entry) => entry.ord === 3), {
      ord: 3,
      date: '2026-01-07',
    });
  });

  it('B2：status: waived 的包不生成实际窗口（豁免没有 checked_at 完工事实）', (t) => {
    t.after(restoreControl);
    const baseline = loadRealState();
    let text = withAnchor(pristineControlText);
    text = replaceInPackageBlock(
      text,
      'PKG-005',
      'PKG-010',
      'status: not_started',
      'status: waived\n    waiver: {approved_by: 业主, reason: 测试豁免, evidence: [test-evidence]}',
    );
    // 即使两条检查都留有 passed 记录，waived 是豁免事实而不是完工事实。
    writeControl(withAuditRecords(text, pkg005AuditRecords(baseline, {'SCH-005-01': '2026-01-07', 'SCH-005-02': '2026-01-09'})));
    const state = loadSandbox();
    const pkg = state.control.work_packages.find((item: AnyRecord) => item.id === 'PKG-005');
    assert.deepEqual(state.errors, []);
    assert.equal(state.gateStatus(pkg), 'passed', '审计记录确实全部通过（排除「因为 gate 未过」的假阴性）');
    assert.equal(state.effectivePackageStatus(pkg), 'waived');
    assert.equal(state.scheduleProjection?.packages['PKG-005']?.actual, null, 'waived 包不得生成实际窗口');
  });

  it('B3：gate passed 但 checked_at 全部非法 → actual_window_unresolved 诊断 error（不许静默）', (t) => {
    t.after(restoreControl);
    const baseline = loadRealState();
    writeControl(withAuditRecords(
      withAnchor(pristineControlText),
      pkg005AuditRecords(baseline, {'SCH-005-01': 'not-a-date', 'SCH-005-02': '2026-13-40'}),
    ));
    const state = loadSandbox();
    assert.ok(
      state.errors.some((error) => error.includes('PKG-005: actual_window_unresolved')),
      `gate passed 却一条日期都映射不到必须显形，实际 errors：${state.errors.join(' | ')}`,
    );
    assert.equal(state.scheduleProjection?.packages['PKG-005']?.actual, null);
    assert.ok(state.scheduleProjection, '单包日期不可用不应让整份投影失败');
  });

  it('B3：gate passed 但部分 checked_at 非法 → 不生成偏短窗口，actual_window_invalid_checked_at 显形', (t) => {
    t.after(restoreControl);
    const baseline = loadRealState();
    // 混合情形（复审缺口）：SCH-005-01 合法、SCH-005-02 非法。旧实现只跳过非法记录，
    // 用剩余日期生成 {3,3} 窗口——实际完工日可能正是被跳过的那条，预测会被低估。
    writeControl(withAuditRecords(
      withAnchor(pristineControlText),
      pkg005AuditRecords(baseline, {'SCH-005-01': '2026-01-07', 'SCH-005-02': '2026-13-40'}),
    ));
    const state = loadSandbox();
    assert.ok(
      state.errors.some((error) => error.includes('actual_window_invalid_checked_at')),
      `部分非法 checked_at 必须显形为 actual_window_invalid_checked_at，实际 errors：${state.errors.join(' | ')}`,
    );
    assert.ok(
      state.errors.some((error) => error.includes('invalid checked_at')),
      `audit 记录级校验必须报出非法日期（loader 不能只查非空），实际 errors：${state.errors.join(' | ')}`,
    );
    assert.equal(state.scheduleProjection?.packages['PKG-005']?.actual, null, '部分日期不可用不得拿剩余日期拼偏短窗口');
    assert.ok(state.scheduleProjection, '单包日期不可用不应让整份投影失败');
  });

  it('B4/B3：锚点未定 + 完工包实际窗口 → invalid_actual_window 原样透传（不吞成未映射的 projection_failed）', (t) => {
    t.after(restoreControl);
    const baseline = loadRealState();
    // 不填锚点：真实日期没有日期坐标系。模块按 §14.4 抛 invalid_actual_window，
    // loader 必须把该 code 原样带进 errors，不得降级成一个无 code 的泛化 projection_failed。
    writeControl(withAuditRecords(
      pristineControlText,
      pkg005AuditRecords(baseline, {'SCH-005-01': '2026-01-07', 'SCH-005-02': '2026-01-09'}),
    ));
    const state = loadSandbox();
    assert.ok(
      state.errors.some((error) => error.includes('schedule projection: projection_failed — [invalid_actual_window]')),
      `锚点未定时实际窗口的 code 必须透传，实际 errors：${state.errors.join(' | ')}`,
    );
    assert.equal(state.scheduleProjection, null, '投影失败时不得存空投影冒充结果');
  });

  it('B4：workdays 为空 → 投影错误在 load 期进入 errors，build 不再追加错误、不再投影', (t) => {
    t.after(restoreControl);
    writeControl(replaceOnce(pristineControlText, '  workdays: [1, 2, 3, 4, 5, 6]', '  workdays: []'));
    const state = loadSandbox();
    assert.ok(
      state.errors.some((error) => error.includes('schedule projection: projection_failed — [work_calendar_empty]')),
      `投影错误必须带 code 前缀进 load 期 errors，实际 errors：${state.errors.join(' | ')}`,
    );
    assert.equal(state.scheduleProjection, null, '投影失败时不得存空投影冒充结果');

    // B4 的核心时序：503 判定（route 读 state.errors）必须发生在 build 之前；
    // buildScheduleSnapshot 只消费已存投影，不得再产生任何新错误。
    const errorsAtLoad = [...state.errors];
    const snapshot = buildScheduleSnapshot(state);
    assert.deepEqual(state.errors, errorsAtLoad, 'buildScheduleSnapshot 不得追加错误（否则 503 判定会漏掉它们）');
    assert.deepEqual(snapshot.schedule?.ordinals, []);
    assert.deepEqual(snapshot.schedule?.packages, {});
  });

  it('B4：rest_dates 与 extra_workdates 同日 → calendar_date_conflict 进 load 期 errors', (t) => {
    t.after(restoreControl);
    let text = replaceOnce(pristineControlText, '  rest_dates: []', '  rest_dates: ["2026-01-01"]');
    text = replaceOnce(text, '  extra_workdates: []', '  extra_workdates: ["2026-01-01"]');
    writeControl(text);
    const state = loadSandbox();
    assert.ok(
      state.errors.some((error) => error.includes('schedule projection: projection_failed — [calendar_date_conflict]')),
      `日历冲突必须带 code 前缀进 load 期 errors，实际 errors：${state.errors.join(' | ')}`,
    );
    assert.equal(state.scheduleProjection, null);
  });

  it('B5：锚点未定时 resolved 的 not_before 日期不静默丢（constraint_resolved_without_anchor）', (t) => {
    t.after(restoreControl);
    writeControl(replaceOnce(
      pristineControlText,
      '{id: CON-005-DEPOSIT-PAID, type: not_before, detail: 装修押金缴纳后才能进场, source: 物业收费通知, status: site_pending, date: null}',
      '{id: CON-005-DEPOSIT-PAID, type: not_before, detail: 装修押金缴纳后才能进场, source: 物业收费通知, status: resolved, date: "2026-01-07"}',
    ));
    const state = loadSandbox();
    assert.ok(
      state.errors.some((error) => error.includes('CON-005-DEPOSIT-PAID: constraint_resolved_without_anchor')),
      `锚点缺失时 resolved 约束不得静默不抬，实际 errors：${state.errors.join(' | ')}`,
    );
    assert.ok(state.scheduleProjection, '跳过该约束抬升不应让整份投影失败（模块 §14/B5 契约）');
  });
});
