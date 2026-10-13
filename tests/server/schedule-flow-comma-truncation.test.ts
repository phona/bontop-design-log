// tests/server/schedule-flow-comma-truncation.test.ts
//
// 背景（2026-10-12 实况）：`scripts/schedule/control.ts` 自 DEC-2026-10-05-R12 起有一道
// 「flow 标量被逗号截断」门禁，但它只查**半角逗号 ','**。而真实的截断发生在
// 「18,500」「4,000」「3,684」这类**千分位分隔符**里——截断后残段变成的垃圾键往往
// **只剩全角逗号「，」**，于是门禁 0 命中，尾部条款从解析层静默丢失。
//
// 实测中招三条（均长期绿）：
//   COST-060-02  description 截在「…2026-10-03 轮次约4」
//   COST-060-04  description 截在「…业主瓦工预算池18」、quantity_basis 截在「业主预算池18」
//   COST-120-01  description 截在「…全屋筒射灯轨道灯约3」
// 丢失的正是「18,500 元计入（含复杂铺贴与增项），不得再另加复杂砖人工」这类**计价边界条款**。
//
// 本测试的职责：让这类丢失**不可能再静默**。
//   1. 全量断言——任何 component 的键只要含半角或全角逗号，即为截断残段，fail。
//   2. 回归锚点——三条已修复的 description / quantity_basis 必须仍含完整千分位数与尾句，
//      防止有人用「再截短一点」或「删掉尾句」来让测试变绿。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';

const control = parseYaml(readFileSync('schedule/phase-1/control.yaml', 'utf8')) as {
  work_packages?: Array<{ id: string; budget?: { components?: Array<Record<string, unknown>> } }>;
};

type Component = Record<string, unknown> & { id: string };

const allComponents: Component[] = (control.work_packages ?? []).flatMap(
  (pkg) => (pkg.budget?.components ?? []) as Component[],
);

/** 截断残段的签名：键里出现半角或全角逗号。正常 component 键是 id/name/description/… */
function commaKeys(component: Component): string[] {
  return Object.keys(component).filter((key) => key.includes(',') || key.includes('，'));
}

test('flow 标量截断门禁：所有成本组件的键都不得含逗号（半角 , 或全角 ，）', () => {
  const offenders = allComponents
    .map((component) => ({ id: component.id, keys: commaKeys(component) }))
    .filter((item) => item.keys.length > 0)
    .map((item) => `${item.id} → ${item.keys.join(' / ')}`);
  assert.deepEqual(offenders, [], `以下组件的 flow 标量疑被千分位逗号截断，请给 description/quantity_basis 加双引号：\n${offenders.join('\n')}`);
});

test('回归锚点：COST-060-04 的千分位与计价边界条款必须完整', () => {
  const component = allComponents.find((item) => item.id === 'COST-060-04');
  assert.ok(component, 'COST-060-04 应存在');
  const description = String(component.description ?? '');
  const quantityBasis = String(component.quantity_basis ?? '');
  assert.ok(description.includes('18,500'), `description 应含「18,500」，实为：${description.slice(-60)}`);
  assert.ok(description.includes('不得再另加复杂砖人工'), 'description 应保留「不得再另加复杂砖人工」尾句');
  assert.ok(quantityBasis.includes('18,500'), `quantity_basis 应含「18,500」，实为：${quantityBasis}`);
  assert.equal(component.planned_cny, 18500, 'planned_cny 应仍为 18500（对账不替换计划额）');
});

test('回归锚点：COST-060-02 与 COST-120-01 的千分位必须完整', () => {
  const a = allComponents.find((item) => item.id === 'COST-060-02');
  const b = allComponents.find((item) => item.id === 'COST-120-01');
  assert.ok(a && b, 'COST-060-02 与 COST-120-01 应存在');
  assert.ok(String(a.description).includes('4,000'), `COST-060-02 description 应含「4,000」，实为：${String(a.description).slice(-40)}`);
  assert.ok(String(a.quantity_basis).includes('4,000'), `COST-060-02 quantity_basis 应含「4,000」，实为：${String(a.quantity_basis)}`);
  assert.ok(String(b.description).includes('3,684'), `COST-120-01 description 应含「3,684」，实为：${String(b.description).slice(-40)}`);
  assert.ok(String(b.description).includes('安装人工600元'), 'COST-120-01 description 应保留「安装人工600元」尾句');
});
