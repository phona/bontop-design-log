import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { BudgetCalculator, loadMasonryTakeoff } from '../../server/budget-calculator.js';
import { ProjectCatalog, loadHvacPlans } from '../../server/project-catalog.js';
import { RuleEngine } from '../../server/rule-engine.js';
import {
  MASONRY_SPEC,
  MASONRY_LABOR_AREAS,
  activeMasonryCard,
  compareMasonryQuotes,
  loadMasonryQuotes,
  masonryCardDomain,
  masonryQuoteFallback,
  masonryQuoteQuantities,
  masonrySpecSelection,
  parseMasonryQuotes,
  resolveActiveMasonryRates,
  setActiveMasonryQuote,
} from '../../server/masonry-quotes.js';
import { loadMasonryRateCard } from '../../server/tile-cost-comparison.js';
import type { CurrentScheme } from '../../shared/types.js';

/**
 * 瓦工报价卡片（2026-10-13「预算计算架构根治」阶段 3）。
 *
 * 守的东西：config/masonry-labor.yaml 现在是**合法 quote-cards**（parseQuoteCards 可直接解析），
 * 单价按 data/current-scheme.json 的选型规格从卡内规格表取行；卡上没有的那一档
 * （湿区 400×400 / 200×200）显形为待报价，不许用 base.json 的 45 元/㎡ 冒充。
 */

const catalog = ProjectCatalog.load('.');
const takeoff = loadMasonryTakeoff(catalog);
const scheme = JSON.parse(readFileSync('data/current-scheme.json', 'utf8')) as CurrentScheme;
const tileComparison = parseYaml(readFileSync('config/tile-comparison.yaml', 'utf8')) as {
  dry_room_ids: string[];
  wet_room_ids: string[];
};
/** 干/湿区划分（算量输入）：键名与 server/budget-calculator.ts 的 loadFloorRoomSplit 一致。 */
const floorRoomSplit = { dryRoomIds: tileComparison.dry_room_ids, wetRoomIds: tileComparison.wet_room_ids };

const baseJson = JSON.parse(readFileSync('config/budget/base.json', 'utf8')) as {
  categories: Record<string, { labor?: unknown }>;
};

test('量只有一份：masonryQuoteQuantities 全部来自 shared/masonry-takeoff.ts', () => {
  const quantities = masonryQuoteQuantities(takeoff);
  assert.ok(Math.abs(quantities.floor - takeoff.dryFloorSqm) < 1e-12, '干区地面 = dryFloorSqm');
  assert.ok(Math.abs(quantities.wet_floor - takeoff.wetFloorSqm) < 1e-12, '湿区地面 = wetFloorSqm');
  assert.ok(Math.abs(quantities.wall_tile - takeoff.totalTileSqm) < 1e-12, '墙砖+防水台 = totalTileSqm');
  // 权威值（阶段 2.1）：干区 115.614 / 湿区 7.726 / 贴砖 30.8105
  assert.ok(Math.abs(quantities.floor - 115.614) < 1e-6, `干区地面实测 ${quantities.floor}`);
  assert.ok(Math.abs(quantities.wet_floor - 7.726) < 1e-6, `湿区地面实测 ${quantities.wet_floor}`);
  assert.ok(Math.abs(quantities.wall_tile - 30.81054967354321) < 1e-6, `贴砖实测 ${quantities.wall_tile}`);
});

test('文件是合法 quote-cards：parseQuoteCards 不再抛「rates 必须是对象」', () => {
  // 阶段 3 之前卡内是 floor_rates_yuan_per_sqm 平写在卡根上，通用 parser 直接抛错，
  // server/tile-cost-comparison.ts 只能另写专用 loader 绕过。现在同一条路。
  const file = parseMasonryQuotes(readFileSync('config/masonry-labor.yaml', 'utf8'));
  assert.equal(file.version, 1);
  assert.equal(file.active, 'rate_card_photo');
  const card = activeMasonryCard(file);
  assert.equal(card.status, 'baseline');
  // 三个计价行都声明了，且一律 per_unit:null（单价靠规格表解析，不预先拍）
  assert.deepEqual(Object.keys(card.rates).sort(), ['floor', 'wall_tile', 'wet_floor']);
  for (const key of MASONRY_SPEC.keys) {
    assert.equal(card.rates[key]?.per_unit, null, `${key} 必须显式为待报价，由规格表按选型解析`);
    assert.ok(card.rates[key]?.scope_note, `${key} 必须声明含项范围`);
  }
  // 身份字段走 evidence{...}
  assert.equal(card.evidence?.kind, 'photo');
  assert.equal(card.evidence?.status, 'preliminary_labor_rate_card');
  assert.match(card.evidence?.source ?? '', /mason-labor-rate-card\.jpg$/);
});

test('照片级费率卡：compare 期自动 comparable:false（即使每行都写了 scope_note）', () => {
  const file = parseMasonryQuotes(readFileSync('config/masonry-labor.yaml', 'utf8'));
  const fallback = masonryQuoteFallback(baseJson.categories);
  const comparison = compareMasonryQuotes(file, takeoff, fallback);
  const card = comparison.find((entry) => entry.id === 'rate_card_photo')!;
  assert.equal(card.comparable, false, '照片级费率表不是施工方书面报价，不可直接比价');
  assert.ok(card.comparability_notes.some((note) => note.includes('照片级费率表')));
  assert.ok(card.comparability_notes.some((note) => note.includes('preliminary_labor_rate_card')));
  // 三行全部待报价 → 总额不编（但不因为「没报价」就被跳过：数量照样显形）
  assert.deepEqual(card.pendingRows, ['floor', 'wet_floor', 'wall_tile']);
  assert.equal(card.total, null);
  assert.ok(card.rows.every((row) => row.quantity > 0), '待报价的行数量必须显形');
});

test('规格解析：干区木纹砖 75、墙砖 300×600 取 50、湿区 400×400 无行 → 待报价', () => {
  const file = parseMasonryQuotes(readFileSync('config/masonry-labor.yaml', 'utf8'));
  const fallback = masonryQuoteFallback(baseJson.categories);
  const resolved = resolveActiveMasonryRates(file, fallback, masonrySpecSelection(catalog, scheme, floorRoomSplit));

  // 干区当前选型 floor_tile_kt_200x1200_01 = 200×1200 → 卡上「木纹砖200x1200或150x900」行
  assert.equal(resolved.floor.per_unit, 75);
  assert.equal(resolved.floor.matchedSpecification, '木纹砖200x1200或150x900');
  assert.equal(resolved.floor.source, 'quote');
  // 墙砖当前选型 wall_tile_01 = 300×600 → 卡上「300x600」行
  assert.equal(resolved.wall_tile.per_unit, 50);
  assert.equal(resolved.wall_tile.matchedSpecification, '300x600');
  // 湿区当前选型 400×400（主卫/阳台）与 200×200（客卫）→ 卡上无行 → 回落 base.json，
  // 而 base.json 的 wet_floor_tile 也是 null → 待报价。**不许用 45 冒充**。
  assert.deepEqual(resolved.wet_floor.specs.sort(), ['200x200mm', '400x400mm'], '湿区两种规格必须全部显形');
  assert.equal(resolved.wet_floor.matchedSpecification, null);
  assert.equal(resolved.wet_floor.per_unit, null);
  assert.equal(resolved.wet_floor.source, 'base.json');
});

test('base.json 兜底：floor 45 / wet_floor_tile null / wall_tile null', () => {
  const fallback = masonryQuoteFallback(baseJson.categories);
  assert.equal(fallback.floor.per_unit, 45, '干区兜底仍是 base.json 的 45（= 卡上 600x600 行）');
  assert.equal(fallback.wet_floor.per_unit, null, '湿区兜底必须是 null：卡上无行，不得冒充');
  assert.equal(fallback.wall_tile.per_unit, null, '墙砖兜底 null：base.json 原先没有这一行');
  // 面积名映射：wet_floor → wet_floor_tile（避开 base.json 里 waterproof 已占用的 wet_floor）
  assert.deepEqual(MASONRY_LABOR_AREAS, { floor: 'floor', wet_floor: 'wet_floor_tile', wall_tile: 'wall_tile' });
});

test('报价文件缺失/非法（null）：全行走 base.json 回落，不伪造卡片', () => {
  // 与吊顶同一条出口（阶段 0 的教训）：读不到/读不懂 masonry-labor.yaml 时按「无报价」处理，
  // 预算不能被一个坏配置文件冻结；也不合成 `{active:'base.json',quotes:[]}` 那种假卡。
  const fallback = masonryQuoteFallback(baseJson.categories);
  const resolved = resolveActiveMasonryRates(null, fallback, {});
  assert.equal(resolved.floor.per_unit, 45);
  assert.equal(resolved.floor.source, 'base.json');
  assert.equal(resolved.wet_floor.per_unit, null, '湿区回落也是 null → 待报价显形');
  assert.equal(resolved.wall_tile.per_unit, null);
  assert.equal(resolved.floor.matchedSpecification, null);
});

test('computeLabor 按三行计价：干区 75、墙砖 50、湿区待报价', () => {
  const realRules = RuleEngine.load('config/design-rules.yaml').getConfig();
  const snapshot = new BudgetCalculator(catalog, realRules).calculate(scheme);
  const masonry = snapshot.categories.find((c) => c.key === 'masonry');
  assert.ok(masonry);
  // round(75 × 115.614) + round(50 × 30.81054967354321) = 8671 + 1541
  // 阶段 5 口径变更：actual = 已取证材料款 + 人工（不含 candidateActual）。
  // 本 fixture 材料款全未取证 → actual 就是纯人工。
  assert.equal(masonry.actual, 8671 + 1541, '瓦工人工按费率卡解析价逐行计价');
  assert.deepEqual(masonry.pendingLabor, [
    { area: 'wet_floor_tile', quantity: takeoff.wetFloorSqm, unit: '元/㎡', reason: 'rate 待报价' },
  ], '湿区必须显形为待报价，而不是按 45 元/㎡ 悄悄计入');
});

test('防水工的 wet_floor 不被瓦工费率覆盖', () => {
  const realRules = RuleEngine.load('config/design-rules.yaml').getConfig();
  const snapshot = new BudgetCalculator(catalog, realRules).calculate(scheme);
  const waterproof = snapshot.categories.find((c) => c.key === 'waterproof');
  assert.ok(waterproof);
  // 防水仍按 base.json 的 20 元/㎡ × needs_waterproof 房间（含厨房）计价，与瓦工三行无关
  const wetRooms = catalog.getRooms().filter((room) => room.needs_waterproof === true);
  const expected = Math.round(20 * wetRooms.reduce((sum, room) => sum + room.width * room.depth, 0));
  assert.equal(waterproof.actual, expected, `防水人工必须仍是 20 元/㎡ × 防水房（实测 ${waterproof.actual}）`);
});

test('卡内域层数据：形状不对就抛错，不静默退回「没报价」', () => {
  const card = activeMasonryCard(parseMasonryQuotes(readFileSync('config/masonry-labor.yaml', 'utf8')));
  const domain = masonryCardDomain(card);
  assert.equal(domain.floor_rates_yuan_per_sqm.length, 6);
  assert.equal(domain.wall_rates_yuan_per_sqm.length, 6);
  assert.equal(domain.extras.length, 13);
  assert.equal(domain.conditional_addons.length, 4);
  assert.equal(domain.bathroom_floor_charge_interpretations.selection_status, 'unresolved');
  // 缺 domain / domain 形状坏 → 抛错
  assert.throws(() => masonryCardDomain({ ...card, domain: undefined }), /没有 domain/);
  assert.throws(() => masonryCardDomain({ ...card, domain: { floor_rates_yuan_per_sqm: 'x' } }), /必须是数组/);
  assert.throws(
    () => masonryCardDomain({ ...card, domain: { ...domain, floor_rates_yuan_per_sqm: [{ specification: '600x600' }] } }),
    /price 必须是非负数字/,
  );
});

test('tile-cost-comparison 的 loadMasonryRateCard 改走正规 loader，输出逐字段不变', () => {
  const card = loadMasonryRateCard();
  assert.equal(card.source, 'docs/design-iterations/tile-plank-comparison-20261006/evidence/mason-labor-rate-card.jpg');
  assert.equal(card.quote_status, 'preliminary_labor_rate_card; extras_and_work_scopes_require_confirmation');
  assert.equal(card.currency, 'CNY');
  assert.equal(card.floor_rates_yuan_per_sqm.find((rate) => rate.specification.includes('木纹砖'))?.price, 75);
  assert.equal(card.wall_rates_yuan_per_sqm.find((rate) => rate.specification === '600x1200')?.price, 65);
  assert.equal(card.floor_rates_yuan_per_sqm.length, 6);
  assert.equal(card.wall_rates_yuan_per_sqm.length, 6);
  assert.equal(card.extras.length, 13);
  assert.equal(card.conditional_addons.length, 4);
});

test('active 指向不存在的卡片 → 抛错（fail closed，不悄悄回落）', () => {
  const raw = readFileSync('config/masonry-labor.yaml', 'utf8').replace('active: rate_card_photo', 'active: ghost');
  assert.throws(() => parseMasonryQuotes(raw), /不在 quotes 里/);
});

test('切换只改写 active 一行：留 .bak、写后仍可解析', () => {
  const dir = mkdtempSync(join(tmpdir(), 'masonry-quotes-'));
  const path = join(dir, 'masonry-labor.yaml');
  writeFileSync(path, readFileSync('config/masonry-labor.yaml', 'utf8'), 'utf8');
  const switched = setActiveMasonryQuote('rate_card_photo', path);
  assert.equal(switched.active, 'rate_card_photo');
  assert.ok(readFileSync(path, 'utf8').includes('active: rate_card_photo'));
  assert.ok(existsSync(`${path}.bak`), '必须留 .bak');
});

test('hvac 选项来自 config/hvac.yaml：一个成交方案、36,000、status 透传', () => {
  const plans = loadHvacPlans('.');
  assert.deepEqual(
    plans.map((plan) => [plan.id, plan.price_per_unit, (plan.data as { status: string }).status]),
    [['A2', 36000, 'contracted']],
  );
  // 阶段 3 之前：shared/houseData.ts 的七套 invented 报价表（A1 30,500 / A2 29,000 / …）。
  assert.equal(catalog.getOption('hvac', 'A1'), undefined, 'invented 方案 A1 不得再作为可选项');
  const a2 = catalog.getOption('hvac', 'A2');
  assert.ok(a2);
  assert.equal(a2.price_per_unit, 36000);
  assert.equal((a2.data as { status: string }).status, 'contracted');
  assert.equal((a2.data as { commercial: { vendor: string } }).commercial.vendor.includes('美的'), true);
});
