import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dump as toYaml } from 'js-yaml';
import {
  parseQuoteCards,
  compareQuoteCards,
  resolveActiveQuoteRates,
  type QuoteCardSpec,
} from '../../shared/quote-cards.js';
import { parseCeilingQuotes } from '../../server/ceiling-quotes.js';

/**
 * 报价卡片机制的三个缺口（2026-10-13「预算计算架构根治」阶段 3 补的）。
 *
 * 这三个洞在吊顶/水电两张卡上**休眠**，因为现有卡都不带 evidence、也没有空卡；
 * 但它们让新卡（瓦工费率卡）可以静默地把「照片级假设」伪装成「已报价且可比」。
 */

type Key = 'floor' | 'wall';

const SPEC: QuoteCardSpec<Key> = {
  keys: ['floor', 'wall'],
  labels: { floor: '地面（㎡）', wall: '墙面（㎡）' },
  fallbackLabel: 'base.json',
};

const QUANTITIES: Record<Key, number> = { floor: 100, wall: 50 };
const FALLBACK: Record<Key, { per_unit: number | null; unit: string }> = {
  floor: { per_unit: 45, unit: '元/㎡' },
  wall: { per_unit: null, unit: '元/㎡' },
};

function file(quotes: unknown[], active: string): string {
  return toYaml({ version: 1, active, quotes });
}

// ─── 缺口 A：照片级 / 业主转述不可比 ─────────────────────────────────────────

test('照片级费率卡：即使每行都写了 scope_note，也必须 comparable:false', () => {
  // 反证缺口存在：同一张卡去掉 evidence，就是 comparable:true（旧逻辑唯一认的三个信号全绿）。
  const rates = {
    floor: { per_unit: 40, unit: '元/㎡', scope_note: '含辅材' },
    wall: { per_unit: 50, unit: '元/㎡', scope_note: '含安装' },
  };
  const noEvidence = parseQuoteCards(file([{ id: 'p', contractor: '费率卡照片', quoted_at: '2026-10-06', status: 'baseline', rates }], 'p'), SPEC);
  const bare = compareQuoteCards(noEvidence, QUANTITIES, FALLBACK, SPEC)[0];
  assert.equal(bare.comparable, true, '没有 evidence 的卡沿用旧判据（三个信号全绿 → 可比）');

  const withEvidence = parseQuoteCards(
    file([{
      id: 'p',
      contractor: '费率卡照片（非施工方报价）',
      quoted_at: '2026-10-06',
      status: 'baseline',
      evidence: {
        kind: 'photo',
        status: 'preliminary_labor_rate_card',
        source: 'docs/x/mason-labor-rate-card.jpg',
        observed_at: 'received in this conversation 2026-10-06; date printed on card unknown',
        quote_status: 'preliminary_labor_rate_card; extras_and_work_scopes_require_confirmation',
        currency: 'CNY',
      },
      rates,
    }], 'p'),
    SPEC,
  );
  const photo = compareQuoteCards(withEvidence, QUANTITIES, FALLBACK, SPEC)[0];
  assert.equal(photo.comparable, false, '照片级一律不可比——无施工方名称/日期/签章/总价');
  assert.ok(photo.comparability_notes.some((note) => note.includes('照片级费率表')));
  assert.ok(photo.comparability_notes.some((note) => note.includes('preliminary_labor_rate_card')));
  // 身份字段必须原样透传（旧实现把它们静默丢掉）
  assert.deepEqual(photo.evidence, {
    kind: 'photo',
    status: 'preliminary_labor_rate_card',
    source: 'docs/x/mason-labor-rate-card.jpg',
    observed_at: 'received in this conversation 2026-10-06; date printed on card unknown',
    quote_status: 'preliminary_labor_rate_card; extras_and_work_scopes_require_confirmation',
    currency: 'CNY',
  });
});

test('业主转述不可比；书面报价单仍可比', () => {
  const rates = { floor: { per_unit: 40, unit: '元/㎡', scope_note: '含辅材' }, wall: { per_unit: 50, unit: '元/㎡', scope_note: '含安装' } };
  const ownerReported = compareQuoteCards(
    parseQuoteCards(file([{ id: 'o', contractor: '施工方（业主转述）', quoted_at: '2026-10-08', status: 'candidate', evidence: { kind: 'owner_reported', status: 'verbal_relay_no_itemized_sheet' }, rates }], 'o'), SPEC),
    QUANTITIES, FALLBACK, SPEC,
  )[0];
  assert.equal(ownerReported.comparable, false);
  assert.ok(ownerReported.comparability_notes.some((note) => note.includes('业主转述')));

  const written = compareQuoteCards(
    parseQuoteCards(file([{ id: 'w', contractor: '施工方（书面报价单）', quoted_at: '2026-10-09', status: 'quoted', evidence: { kind: 'written_quote', status: 'signed_itemized_quote' }, rates }], 'w'), SPEC),
    QUANTITIES, FALLBACK, SPEC,
  )[0];
  assert.equal(written.comparable, true, '书面报价单不受证据级别影响，仍按三个信号判');
});

test('evidence 形状错误 / kind 越界 → 抛错（fail closed）', () => {
  const base = { id: 'p', contractor: 'x', quoted_at: null, status: 'candidate', rates: { floor: { per_unit: 40, unit: '元/㎡', scope_note: 's' } } };
  assert.throws(() => parseQuoteCards(file([{ ...base, evidence: { kind: 'screenshot', status: 'x' } }], 'p'), SPEC), /evidence.kind/);
  assert.throws(() => parseQuoteCards(file([{ ...base, evidence: { kind: 'photo' } }], 'p'), SPEC), /evidence.status/);
  assert.throws(() => parseQuoteCards(file([{ ...base, evidence: 'photo' }], 'p'), SPEC), /evidence 必须是对象/);
  assert.throws(() => parseQuoteCards(file([{ ...base, evidence: { kind: 'photo', status: 'x', source: 5 } }], 'p'), SPEC), /evidence.source/);
});

// ─── 缺口 B：空卡漏洞 ────────────────────────────────────────────────────────

test('空卡：rates 为 {} + fallback 全非 null → 必须 comparable:false', () => {
  // 旧逻辑下这张卡无 pending / 无 out_of_scope / 无 missingScope → comparable:true，
  // 「完全没报价」被当成「已报价且可比」。（fallback 必须全非 null，否则待报价行本来就会
  // 触发不可比，测不到空卡这条独立判据。）
  const fullFallback: Record<Key, { per_unit: number | null; unit: string }> = {
    floor: { per_unit: 45, unit: '元/㎡' },
    wall: { per_unit: 50, unit: '元/㎡' },
  };
  const comparison = compareQuoteCards(
    parseQuoteCards(file([{ id: 'empty', contractor: '空卡', quoted_at: null, status: 'candidate', rates: {} }], 'empty'), SPEC),
    QUANTITIES, fullFallback, SPEC,
  )[0];
  assert.equal(comparison.comparable, false);
  assert.ok(comparison.comparability_notes.some((note) => note.includes('未声明任何计价行')));
  assert.equal(comparison.rows[0].rate_source, 'base.json', '回落必须看得见');
  assert.equal(comparison.total, 45 * 100 + 50 * 50, '金额照算（fallback 全非 null），但可比性必须显形');
});

// ─── 缺口 C：身份字段不许再平写在卡根上 ─────────────────────────────────────

test('身份字段平写在卡根上 → 抛错（旧实现静默丢弃）', () => {
  const base = { id: 'p', contractor: 'x', quoted_at: null, status: 'candidate', rates: { floor: { per_unit: 40, unit: '元/㎡', scope_note: 's' } } };
  for (const field of ['source', 'observed_at', 'quote_status', 'currency']) {
    assert.throws(
      () => parseQuoteCards(file([{ ...base, [field]: 'x' }], 'p'), SPEC),
      new RegExp(`${field} 必须写进 evidence`),
      `${field} 不得再被静默吞掉`,
    );
  }
});

// ─── ResolvedQuoteRate 上提 + 回落源名参数化 ────────────────────────────────

test('resolveActiveQuoteRates：回落源名走 spec.fallbackLabel，域不自己硬编码', () => {
  const parsed = parseQuoteCards(file([{ id: 'p', contractor: 'x', quoted_at: null, status: 'candidate', rates: { floor: { per_unit: 40, unit: '元/㎡', scope_note: 's' } } }], 'p'), SPEC);
  const resolved = resolveActiveQuoteRates(parsed, FALLBACK, SPEC);
  assert.equal(resolved.floor.source, 'quote');
  assert.equal(resolved.floor.per_unit, 40);
  assert.equal(resolved.wall.source, 'base.json', '未声明的行回落，来源名 = fallbackLabel');
  assert.equal(resolved.wall.per_unit, null);

  // 换一个域（fallbackLabel 不同）→ 回落源名跟着变，不需要域自己写字
  const otherSpec: QuoteCardSpec<Key> = { ...SPEC, fallbackLabel: 'mep-labor.yaml' };
  const other = resolveActiveQuoteRates(parsed, FALLBACK, otherSpec);
  assert.equal(other.wall.source, 'mep-labor.yaml');

  // 「无报价文件」是一等状态：传 null 全行走回落，不伪造卡片
  const none = resolveActiveQuoteRates(null, FALLBACK, SPEC);
  assert.equal(none.floor.source, 'base.json');
  assert.equal(none.floor.per_unit, 45);
});

// ─── 回归：既有吊顶卡不受新逻辑影响 ─────────────────────────────────────────

test('既有吊顶卡没有 evidence → comparable 判据不变（不误伤）', () => {
  // config/ceiling-quotes.yaml 三张卡都不带 evidence。阶段 3 新增的「证据级别不可比」
  // 与「空卡」两条判据对它们必须零影响——否则就是误伤，要靠改测试掩盖的那一类。
  const raw = readFileSync('config/ceiling-quotes.yaml', 'utf8');
  assert.ok(!raw.includes('evidence:'), '吊顶卡当前不带 evidence，新判据不应触发');
  const parsed = parseCeilingQuotes(raw);
  assert.equal(parsed.quotes.length, 3, '吊顶三张卡仍可解析');
  for (const card of parsed.quotes) {
    assert.equal(card.evidence, undefined);
    assert.ok(Object.keys(card.rates).length > 0, '吊顶没有空卡，新判据不应触发');
  }
  // 反向：水电卡同样不带 evidence（它的 fallbackLabel 是 mep-labor.yaml）
  const mepRaw = readFileSync('config/mep-quotes.yaml', 'utf8');
  assert.ok(!mepRaw.includes('evidence:'), '水电卡当前不带 evidence');
});
