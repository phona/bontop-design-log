// 支撑检查（2026-11-16 DDD 模型约束）：shared/furniture-support.ts 的 checkSupport
// 按 kind 断言通过/失败边界。包络是合成值（不钉任何配方数字）；规则是「建模竖向
// 包络必须符合支撑声明」，容差 SUPPORT_EPS（5mm）只消浮点噪声。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkSupport, SUPPORT_EPS, type FurnishingBuiltBounds } from '../../shared/furniture-support.js';
import type { FurnishingSupport } from '../../shared/types.js';

const HOSTS = new Map<string, unknown>([
  ['ld.waterbar_cabinet', {}],
  ['kitchen.cabinet_run_north_west', {}],
  ['kitchen.cabinet_run_north_east', {}],
  ['balcony.washer', {}],
]);

function errorsFor(support: FurnishingSupport | undefined, bounds: FurnishingBuiltBounds | null, hosts = HOSTS): string[] {
  const errors: string[] = [];
  checkSupport('test-item', support, bounds, hosts, errors);
  return errors;
}

describe('furniture 支撑检查（2026-11-16 DDD 模型约束）', () => {
  it('floor：建模底 = 0 通过；悬空/下沉超容差报错', () => {
    assert.deepEqual(errorsFor({ kind: 'floor' }, { bottom: 0, top: 0.75 }), []);
    assert.deepEqual(errorsFor({ kind: 'floor' }, { bottom: 0.004, top: 0.75 }), [], '4mm 在 5mm 容差内');
    assert.equal(errorsFor({ kind: 'floor' }, { bottom: 0.052, top: 0.9 }).length, 1, '52mm 悬空必须报错（洗衣机旧配方即此数）');
    assert.equal(errorsFor({ kind: 'floor' }, { bottom: -0.01, top: 0.75 }).length, 1, '下沉 10mm 也报错');
  });

  it('wall：建模底 = 声明挂高通过；偏差超容差报错', () => {
    assert.deepEqual(errorsFor({ kind: 'wall', bottom: 1.1 }, { bottom: 1.1, top: 1.9 }), []);
    assert.equal(errorsFor({ kind: 'wall', bottom: 1.1 }, { bottom: 1.05, top: 1.9 }).length, 1);
  });

  it('furniture：建模底 = 承托面通过；偏差超容差报错；宿主断引用单独报错', () => {
    assert.deepEqual(
      errorsFor({ kind: 'furniture', host: 'ld.waterbar_cabinet', surface: 0.85 }, { bottom: 0.85, top: 1.1 }),
      [],
    );
    assert.equal(
      errorsFor({ kind: 'furniture', host: 'ld.waterbar_cabinet', surface: 0.85 }, { bottom: 0.8, top: 1.1 }).length,
      1,
    );
    const broken = errorsFor({ kind: 'furniture', host: 'no_such_host', surface: 0.85 }, { bottom: 0.85, top: 1.1 });
    assert.equal(broken.length, 1, '宿主断引用须单独报错（底面吻合时只报这一条）');
    assert.match(broken[0], /不在 furnishings 中/);
  });

  it('furniture 多宿主：任一宿主断引用即报错', () => {
    const errors = errorsFor(
      { kind: 'furniture', host: ['kitchen.cabinet_run_north_west', 'no_such_host'], surface: 0.86 },
      { bottom: 0.86, top: 0.89 },
    );
    assert.equal(errors.length, 1);
    assert.match(errors[0], /no_such_host/);
  });

  it('inset：包络跨过台面通过；底在面上方或顶在面下方即报错', () => {
    const inset: FurnishingSupport = { kind: 'inset', host: 'kitchen.cabinet_run_north_east', surface: 0.89 };
    assert.deepEqual(errorsFor(inset, { bottom: 0.876, top: 0.89 }), [], '灶具：底在面下、顶在面上，跨过');
    assert.deepEqual(errorsFor(inset, { bottom: 0.76, top: 0.92 }), [], '水槽：盆在面下、沿在面上，跨过');
    assert.equal(errorsFor(inset, { bottom: 0.9, top: 0.95 }).length, 1, '整体在台面上方不算嵌装');
    assert.equal(errorsFor(inset, { bottom: 0.8, top: 0.88 }).length, 1, '整体在台面下方不算嵌装');
  });

  it('ceiling：建模顶 = 完成面 − drop 通过；drop 缺省 0', () => {
    assert.deepEqual(
      errorsFor({ kind: 'ceiling', face: 2.5, drop: 0.075 }, { bottom: 2.275, top: 2.425 }),
      [],
      '排气扇：顶 2.425 = 完成面 2.50 − 0.075 间隙',
    );
    assert.deepEqual(errorsFor({ kind: 'ceiling', face: 2.5 }, { bottom: 2.3, top: 2.5 }), []);
    assert.equal(errorsFor({ kind: 'ceiling', face: 2.5, drop: 0.075 }, { bottom: 2.3, top: 2.4 }).length, 1);
  });

  it('缺 support：报错（解算器已拦，verify 侧兜底）', () => {
    const errors = errorsFor(undefined, { bottom: 0, top: 0.75 });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /缺少 support/);
  });

  it('无建模包络（如示意件）：跳过不报错', () => {
    assert.deepEqual(errorsFor({ kind: 'floor' }, null), []);
  });

  it('SUPPORT_EPS = 5mm（与起夜灯挂载漂移容差同量级）', () => {
    assert.equal(SUPPORT_EPS, 0.005);
  });
});
