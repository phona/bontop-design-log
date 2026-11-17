/**
 * 斜边真长（S2）——量价算法审计跟进。
 *
 * pricedCircuitLength 曾把斜边按“平面 + |Δy|”曼哈顿拆分计入
 * （3-4-5 斜边计 7m）。现为平面并集 + 斜边超出平面的真长部分
 * （hypot(平面, Δy) − 平面），3-4-5 斜边计 5m。
 * 依赖 S1 的精确并集：平面部分须为真长（网格并集会多 0.05m）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { pricedCircuitLength } from '../../shared/mep-takeoff.js';

const TOL = 1e-9;
const close = (actual: number, expected: number, what: string): void => {
  assert.ok(Math.abs(actual - expected) <= TOL, `${what}：期望 ${expected}，实际 ${actual}`);
};

test('S2 计价基数：3-4-5 斜边计 5m（平面 3m + 超出 2m，不按 3+4=7m）', () => {
  close(pricedCircuitLength([[{ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 }]]), 5, '3-4-5 斜边');
});

test('S2 计价基数：纯竖直共享立管按 y 区间合并只计一次', () => {
  close(
    pricedCircuitLength([
      [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
      [
        { x: 0, y: 0.5, z: 0 },
        { x: 0, y: 1.5, z: 0 },
      ],
    ]),
    1.5,
    '竖直区间合并',
  );
});

test('S2 计价基数：斜边 + 独立竖直段相加（3-4-5 斜边 5m + 1m 立管 = 6m）', () => {
  close(
    pricedCircuitLength([
      [
        { x: 0, y: 0, z: 0 },
        { x: 3, y: 4, z: 0 },
      ],
      [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
    ]),
    6,
    '斜边加竖直',
  );
});
