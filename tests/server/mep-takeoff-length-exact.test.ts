/**
 * 精确并集（S1）——量价算法审计跟进。
 *
 * unionPlanLength 曾用 5cm 网格栅格化求并集，系统性多算（每条不连通
 * 路径多一个栅格 0.05m，生产 +0.5431m）。现为精确分段并集：线段在交点处
 * 切分、共线重叠去重、按欧氏长求和。期望值全部手算。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { unionPlanLength } from '../../shared/mep-takeoff.js';

const TOL = 1e-9;
const close = (actual: number, expected: number, what: string): void => {
  assert.ok(Math.abs(actual - expected) <= TOL, `${what}：期望 ${expected}，实际 ${actual}`);
};

test('S1 并集：共线重叠只计一次（0–2 与 1–3 → 3m）', () => {
  close(
    unionPlanLength([
      [
        { x: 0, z: 0 },
        { x: 2, z: 0 },
      ],
      [
        { x: 1, z: 0 },
        { x: 3, z: 0 },
      ],
    ]),
    3,
    '共线重叠并集',
  );
});

test('S1 并集：交叉（2m 横 + 2m 竖交于中点 → 4m）', () => {
  close(
    unionPlanLength([
      [
        { x: 0, z: 0 },
        { x: 2, z: 0 },
      ],
      [
        { x: 1, z: -1 },
        { x: 1, z: 1 },
      ],
    ]),
    4,
    '交叉并集',
  );
});

test('S1 并集：T 形交接（2m 横 + 1m 竖接于中点 → 3m）', () => {
  close(
    unionPlanLength([
      [
        { x: 0, z: 0 },
        { x: 2, z: 0 },
      ],
      [
        { x: 1, z: 0 },
        { x: 1, z: 1 },
      ],
    ]),
    3,
    'T 形并集',
  );
});

test('S1 并集：全包含（0–3 含 1–2 → 3m）与端点相接（0–1 + 1–2 → 2m）', () => {
  close(
    unionPlanLength([
      [
        { x: 0, z: 0 },
        { x: 3, z: 0 },
      ],
      [
        { x: 1, z: 0 },
        { x: 2, z: 0 },
      ],
    ]),
    3,
    '全包含并集',
  );
  close(
    unionPlanLength([
      [
        { x: 0, z: 0 },
        { x: 1, z: 0 },
      ],
      [
        { x: 1, z: 0 },
        { x: 2, z: 0 },
      ],
    ]),
    2,
    '端点相接并集',
  );
});

test('S1 并集：退化路径与单段（单点 0m；2m 直段 2m；分离平行段各计）', () => {
  close(unionPlanLength([[{ x: 1, z: 1 }]]), 0, '单点路径');
  close(
    unionPlanLength([
      [
        { x: 0, z: 0 },
        { x: 2, z: 0 },
      ],
    ]),
    2,
    '单段直行',
  );
  close(
    unionPlanLength([
      [
        { x: 0, z: 0 },
        { x: 1, z: 0 },
      ],
      [
        { x: 0, z: 1 },
        { x: 1, z: 1 },
      ],
    ]),
    2,
    '分离平行段',
  );
});

test('S1 并集：斜向段按真长（(0,0)–(3,4) → 5m，不按曼哈顿 7m）', () => {
  close(
    unionPlanLength([
      [
        { x: 0, z: 0 },
        { x: 3, z: 4 },
      ],
    ]),
    5,
    '斜向段并集',
  );
});
