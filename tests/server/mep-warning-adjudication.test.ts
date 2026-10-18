// 交付表态登记册守门（DEC-2026-10-17-R19）。
// 全绿 = must_fix 清零 + 存活 warning 类全部登记 accepted；未表态的类本身是 error。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  appendUnadjudicatedWarningFindings,
  parseMepWarningAdjudication,
} from '../../shared/mep-warning-adjudication.js';

const registry = parseMepWarningAdjudication(readFileSync('config/mep-warning-adjudication.yaml', 'utf8'));

test('真实登记册可解析且覆盖 R18 两个声明通道', () => {
  const codes = registry.adjudications.map((entry) => entry.code);
  for (const code of ['route_overlap_declared_trunk', 'bay_sill_crossing_declared']) {
    assert.ok(codes.includes(code), `${code} 必须已表态`);
  }
  for (const entry of registry.adjudications) {
    assert.match(entry.dec_ref, /^DEC-\d{4}-\d{2}-\d{2}-/, `${entry.code} 的 dec_ref 必须是 DEC 全引`);
    assert.ok(entry.owner && entry.trigger, `${entry.code} 必须带 owner 与复核触发`);
  }
});

test('未表态的 warning 类被追加为 must_fix error 并同步计数与桶明细', () => {
  const result = {
    errors: [],
    warnings: [
      { level: 'warning', code: 'route_overlap_declared_trunk', message: 'declared' },
      { level: 'warning', code: 'some_unregistered_class', message: 'a' },
      { level: 'warning', code: 'some_unregistered_class', message: 'b' },
    ],
    counts: { errors: 0, warnings: 3, routes: 2, resolvedRoutes: 2 },
    categories: {
      must_fix_before_briefing: { count: 0, codes: [] },
      survey_dependent: { count: 3, codes: [] },
      envelope_approximation: { count: 0, codes: [] },
    },
  } as unknown as Parameters<typeof appendUnadjudicatedWarningFindings>[0];

  appendUnadjudicatedWarningFindings(result, registry);
  const added = result.errors.filter((item) => item.code === 'warning_class_unadjudicated');
  assert.equal(added.length, 1, '只有未表态的类成为 error（已表态的 declared 不重复计）');
  assert.match(added[0].message, /some_unregistered_class ×2/);
  assert.equal(result.counts.errors, 1, 'counts.errors 同步 +1');
  const bucket = result.categories!.must_fix_before_briefing;
  assert.equal(bucket.count, 1);
  // 桶明细计数 = 该 code 的 finding 数（1 条 meta-error）;warning 规模 ×2 在 message 里
  assert.deepEqual(bucket.codes, [{ code: 'some_unregistered_class', count: 1 }]);
});
