import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeHumidity, isInHuinanWindow, toTier } from '../../../shared/humidity-model.js';
import type { WindowAperture } from '../../../shared/glazing.js';

const WINDOW = { start: '02-15', end: '04-15' };
const HUINAN_DATE = { month: 3, day: 15 };
const DRY_DATE = { month: 12, day: 22 };

function aperture(roomId: string, azimuthDeg: number): WindowAperture {
  return { id: `${roomId}-win`, roomId, azimuthDeg, midpoint: { x: 0, z: 0 } };
}

function scoreOf(rooms: ReturnType<typeof analyzeHumidity>['rooms'], roomId: string): number {
  const r = rooms.find((x) => x.roomId === roomId);
  assert.ok(r, `room ${roomId} present`);
  return r!.score;
}

describe('isInHuinanWindow', () => {
  it('窗口内/外/边界', () => {
    assert.equal(isInHuinanWindow(HUINAN_DATE, WINDOW), true);
    assert.equal(isInHuinanWindow(DRY_DATE, WINDOW), false);
    assert.equal(isInHuinanWindow({ month: 2, day: 15 }, WINDOW), true);
    assert.equal(isInHuinanWindow({ month: 4, day: 15 }, WINDOW), true);
    assert.equal(isInHuinanWindow({ month: 4, day: 16 }, WINDOW), false);
  });
});

describe('toTier', () => {
  it('边界：<25 low / 25-50 medium / >50 high', () => {
    assert.equal(toTier(24), 'low');
    assert.equal(toTier(25), 'medium');
    assert.equal(toTier(50), 'medium');
    assert.equal(toTier(51), 'high');
  });
});

describe('analyzeHumidity 房间评分', () => {
  it('湿源单调性：high > medium > low', () => {
    const decls = {
      a: { moisture: 'high', ventilation: 'mechanical' },
      b: { moisture: 'medium', ventilation: 'mechanical' },
      c: { moisture: 'low', ventilation: 'mechanical' },
    } as const;
    const { rooms } = analyzeHumidity({ roomIds: ['a', 'b', 'c'], apertures: [], roomDecls: decls, date: DRY_DATE, huinanWindow: WINDOW });
    assert.ok(scoreOf(rooms, 'a') > scoreOf(rooms, 'b'));
    assert.ok(scoreOf(rooms, 'b') > scoreOf(rooms, 'c'));
  });

  it('通风单调性：cross < mechanical < single_side', () => {
    const decls = {
      a: { moisture: 'medium', ventilation: 'cross' },
      b: { moisture: 'medium', ventilation: 'mechanical' },
      c: { moisture: 'medium', ventilation: 'single_side' },
    } as const;
    const { rooms } = analyzeHumidity({ roomIds: ['a', 'b', 'c'], apertures: [], roomDecls: decls, date: DRY_DATE, huinanWindow: WINDOW });
    assert.ok(scoreOf(rooms, 'a') < scoreOf(rooms, 'b'));
    assert.ok(scoreOf(rooms, 'b') < scoreOf(rooms, 'c'));
  });

  it('仅北向采光 +10；南向不得分；无采光面不得分', () => {
    const decls = { a: { moisture: 'low', ventilation: 'mechanical' } } as const;
    const north = analyzeHumidity({ roomIds: ['a'], apertures: [aperture('a', 0), aperture('a', 350)], roomDecls: decls, date: DRY_DATE, huinanWindow: WINDOW });
    const south = analyzeHumidity({ roomIds: ['a'], apertures: [aperture('a', 180)], roomDecls: decls, date: DRY_DATE, huinanWindow: WINDOW });
    const mixed = analyzeHumidity({ roomIds: ['a'], apertures: [aperture('a', 0), aperture('a', 180)], roomDecls: decls, date: DRY_DATE, huinanWindow: WINDOW });
    const none = analyzeHumidity({ roomIds: ['a'], apertures: [], roomDecls: decls, date: DRY_DATE, huinanWindow: WINDOW });
    assert.equal(scoreOf(north.rooms, 'a'), 10);
    assert.equal(scoreOf(south.rooms, 'a'), 0);
    assert.equal(scoreOf(mixed.rooms, 'a'), 0);
    assert.equal(scoreOf(none.rooms, 'a'), 0);
  });

  it('回南天冷表面：窗口内 +20，窗口外 0', () => {
    const decls = { a: { moisture: 'low', ventilation: 'open', cold_surface: 'slab' } } as const;
    const inWin = analyzeHumidity({ roomIds: ['a'], apertures: [], roomDecls: decls, date: HUINAN_DATE, huinanWindow: WINDOW });
    const outWin = analyzeHumidity({ roomIds: ['a'], apertures: [], roomDecls: decls, date: DRY_DATE, huinanWindow: WINDOW });
    assert.equal(scoreOf(inWin.rooms, 'a'), 15);
    assert.equal(scoreOf(outWin.rooms, 'a'), 0);
  });

  it('未声明房间走默认（low + single_side = 10）且 declared=false', () => {
    const { rooms } = analyzeHumidity({ roomIds: ['x'], apertures: [], date: DRY_DATE, huinanWindow: WINDOW });
    assert.equal(scoreOf(rooms, 'x'), 10);
    assert.equal(rooms[0].declared, false);
  });

  it('声明房间 declared=true 且 factors 含非零因子', () => {
    const decls = { a: { moisture: 'high', ventilation: 'single_side' } } as const;
    const { rooms } = analyzeHumidity({ roomIds: ['a'], apertures: [], roomDecls: decls, date: DRY_DATE, huinanWindow: WINDOW });
    const r = rooms[0];
    assert.equal(r.declared, true);
    assert.equal(r.score, 40);
    assert.deepEqual(r.factors.map((f) => f.delta).sort((m, n) => m - n), [10, 30]);
  });

  it('分数 clamp 到 0-100', () => {
    const decls = { a: { moisture: 'low', ventilation: 'cross' } } as const;
    const { rooms } = analyzeHumidity({ roomIds: ['a'], apertures: [], roomDecls: decls, date: DRY_DATE, huinanWindow: WINDOW });
    assert.equal(scoreOf(rooms, 'a'), 0);
  });
});

describe('analyzeHumidity 重点表面', () => {
  const surfaceDecls = [
    { id: 'slab1', room: 'a', kind: 'slab' as const },
    { id: 'wall1', room: 'a', kind: 'ext_wall' as const, faces: 'north' },
    { id: 'corner1', room: 'a', kind: 'corner' as const },
  ];

  it('slab 仅窗口内 +15', () => {
    const decls = { a: { moisture: 'medium', ventilation: 'mechanical' } } as const;
    const inWin = analyzeHumidity({ roomIds: ['a'], apertures: [], roomDecls: decls, surfaceDecls, date: HUINAN_DATE, huinanWindow: WINDOW });
    const outWin = analyzeHumidity({ roomIds: ['a'], apertures: [], roomDecls: decls, surfaceDecls, date: DRY_DATE, huinanWindow: WINDOW });
    assert.equal(inWin.surfaces.find((s) => s.id === 'slab1')!.score, 30);
    assert.equal(outWin.surfaces.find((s) => s.id === 'slab1')!.score, 15);
  });

  it('ext_wall +10 / corner +10，携带 faces', () => {
    const decls = { a: { moisture: 'medium', ventilation: 'mechanical' } } as const;
    const { surfaces } = analyzeHumidity({ roomIds: ['a'], apertures: [], roomDecls: decls, surfaceDecls, date: DRY_DATE, huinanWindow: WINDOW });
    assert.equal(surfaces.find((s) => s.id === 'wall1')!.score, 25);
    assert.equal(surfaces.find((s) => s.id === 'wall1')!.faces, 'north');
    assert.equal(surfaces.find((s) => s.id === 'corner1')!.score, 25);
  });

  it('表面所属房间未声明时按默认房间分计算', () => {
    const { surfaces } = analyzeHumidity({ roomIds: ['a'], apertures: [], surfaceDecls, date: DRY_DATE, huinanWindow: WINDOW });
    assert.equal(surfaces.find((s) => s.id === 'wall1')!.score, 20);
  });
});
