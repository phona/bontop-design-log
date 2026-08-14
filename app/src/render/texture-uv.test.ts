import { describe, it, expect } from 'vitest';
import { PlaneGeometry, Shape, ShapeGeometry } from 'three';
import { scalePlaneUvToMeters } from './uv-utils';

/**
 * PBR 地面 spec 的核心假设验证：ShapeGeometry 的 UV 等于 shape 顶点坐标（米制）。
 * 成立 → TextureManager 可用 repeat=1/worldSize 做世界对齐；不成立 → 退化为按房间尺寸算 repeat。
 */
describe('ShapeGeometry UV 米制假设（three r166）', () => {
  it('UV 范围等于顶点坐标范围', () => {
    const shape = new Shape();
    shape.moveTo(0, 0);
    shape.lineTo(2.4, 0);
    shape.lineTo(2.4, 1.3);
    shape.lineTo(0, 1.3);
    shape.closePath();

    const geo = new ShapeGeometry(shape);
    const uv = geo.getAttribute('uv');
    const pos = geo.getAttribute('position');

    let maxU = -Infinity, maxV = -Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < uv.count; i++) {
      maxU = Math.max(maxU, uv.getX(i));
      maxV = Math.max(maxV, uv.getY(i));
      maxX = Math.max(maxX, pos.getX(i));
      maxY = Math.max(maxY, pos.getY(i));
    }
    expect(maxU).toBeCloseTo(maxX, 5);
    expect(maxV).toBeCloseTo(maxY, 5);
    expect(maxU).toBeCloseTo(2.4, 5);
    expect(maxV).toBeCloseTo(1.3, 5);
  });

  it('矩形房间 PlaneGeometry 分支：UV 从 0..1 重标定为米制（layout-resolver isRect → points=undefined）', () => {
    const geo = new PlaneGeometry(2.4, 1.3);
    scalePlaneUvToMeters(geo, 2.4, 1.3);
    const uv = geo.getAttribute('uv');
    let maxU = -Infinity, maxV = -Infinity;
    for (let i = 0; i < uv.count; i++) {
      maxU = Math.max(maxU, uv.getX(i));
      maxV = Math.max(maxV, uv.getY(i));
    }
    expect(maxU).toBeCloseTo(2.4, 5);
    expect(maxV).toBeCloseTo(1.3, 5);
  });
});
