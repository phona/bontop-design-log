import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractApertures } from '../../../shared/glazing.js';
import type { SceneElement } from '../../../shared/types.js';

describe('extractApertures', () => {
  it('南向幕墙 → 方位角 ≈ 180，归属最近房间', () => {
    const el: SceneElement = {
      type: 'curtain_run',
      id: 'south_curtain',
      points: [{ x: 0, z: 10 }, { x: 5, z: 10 }],
      height: 2.8,
    };
    const rooms = [{ id: 'living', x: 2.5, z: 5 }];
    const aps = extractApertures([el], rooms);
    assert.equal(aps.length, 1);
    assert.ok(Math.abs(aps[0].azimuthDeg - 180) < 0.1, `az ${aps[0].azimuthDeg}`);
    assert.equal(aps[0].roomId, 'living');
  });

  it('西向幕墙 → 方位角 ≈ 270', () => {
    const el: SceneElement = {
      type: 'curtain_run',
      id: 'west_curtain',
      points: [{ x: 0, z: 0 }, { x: 0, z: 5 }],
      height: 2.8,
    };
    const rooms = [{ id: 'bedroom', x: 3, z: 2.5 }];
    const aps = extractApertures([el], rooms);
    assert.ok(Math.abs(aps[0].azimuthDeg - 270) < 0.1, `az ${aps[0].azimuthDeg}`);
  });

  it('bay_sill 同样提取', () => {
    const el: SceneElement = {
      type: 'bay_sill',
      id: 'north_bay',
      points: [{ x: 1, z: 0 }, { x: 3, z: 0 }],
      depth: 1.1,
      sill: 2.55,
      height: 0.45,
    };
    const rooms = [{ id: 'bed', x: 2, z: 4 }];
    const aps = extractApertures([el], rooms);
    assert.ok(Math.abs(aps[0].azimuthDeg - 0) < 0.1, `az ${aps[0].azimuthDeg}`);
  });

  it('glass_infill 经 walls 解析', () => {
    const el: SceneElement = {
      type: 'glass_infill',
      id: 'win1',
      wall: 'w_east',
      width: 1.5,
      height: 1.5,
      sill: 0.9,
    };
    const walls = [{ id: 'w_east', x1: 10, z1: 0, x2: 10, z2: 5 }];
    const rooms = [{ id: 'study', x: 6, z: 2.5 }];
    const aps = extractApertures([el], rooms, walls);
    assert.equal(aps.length, 1);
    assert.ok(Math.abs(aps[0].azimuthDeg - 90) < 0.1, `az ${aps[0].azimuthDeg}`);
    assert.equal(aps[0].roomId, 'study');
  });

  it('glass_infill 找不到墙引用时跳过', () => {
    const el: SceneElement = { type: 'glass_infill', id: 'w2', wall: 'missing', width: 1, height: 1, sill: 0.9 };
    assert.equal(extractApertures([el], []).length, 0);
  });

  it('多段折线产生多条采光面', () => {
    const el: SceneElement = {
      type: 'curtain_run',
      id: 'arc',
      points: [{ x: 0, z: 0 }, { x: 0, z: 1 }, { x: 1, z: 2 }],
      height: 2.8,
    };
    assert.equal(extractApertures([el], []).length, 2);
  });

  it('非窗类型（wall/floor_region/railing_run/curtain）被忽略', () => {
    const els: SceneElement[] = [
      { type: 'wall', id: 'w1', x1: 0, z1: 0, x2: 1, z2: 0 },
      { type: 'floor_region', id: 'f1', points: [{ x: 0, z: 0 }] },
      { type: 'railing_run', id: 'r1', points: [{ x: 0, z: 0 }, { x: 1, z: 0 }], height: 1 },
      { type: 'curtain', id: 'c1', points: [{ x: 0, z: 0 }, { x: 1, z: 0 }], height: 2.8 },
    ];
    assert.equal(extractApertures(els, []).length, 0);
  });

  it('无房间时 roomId 为 null', () => {
    const el: SceneElement = {
      type: 'curtain_run',
      id: 'c',
      points: [{ x: 0, z: 10 }, { x: 5, z: 10 }],
      height: 2.8,
    };
    assert.equal(extractApertures([el], [])[0].roomId, null);
  });
});
