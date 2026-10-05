import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as yaml from 'js-yaml';
import * as THREE from 'three';
import { buildCeilingZone } from '../../shared/render/CeilingZoneBuilder.js';
import { ceilingSurfaceY, isSolidCeilingZone, lintMepCoordination } from '../../shared/mep-hvac-lint.js';
import { endpointSourcesFromFacts, parseMepCoordination } from '../../shared/mep-hvac-coordination-schema.js';import type { CeilingZone } from '../../shared/types.js';

const load = <T,>(path: string): T => yaml.load(readFileSync(path, 'utf8')) as T;
const ceiling = load<CeilingZone[]>('config/ceiling.yaml');
const geometry = load<{ rooms: Array<{ id: string; height: number }>; platform: { id: string; height: number } }>('config/layout/model-geometry.yaml');
const roomHeights = new Map<string, number>([
  ...geometry.rooms.map((room) => [room.id, room.height] as const),
  [geometry.platform.id, geometry.platform.height] as const,
]);

// 2026-10-04 A1：吊顶净空探测器此前是死代码——它要求 zone.area 与 zone.height 同时存在，
// 而 config/ceiling.yaml 23 条里 17 条有 area 无 height（drop/aluminum）、6 条有 height
// 无 area（ac_indoor），交集为 0，规则永远不触发。现在按 thickness 反算完成面。
describe('ceiling surface derivation (A1)', () => {
  it('no solid ceiling zone relies on an undeclared height field', () => {
    const solid = ceiling.filter((zone) => isSolidCeilingZone(zone));
    assert.ok(solid.length >= 17, `expected the 17 solid zones, got ${solid.length}`);
    // 反算口径的前提是 thickness 必填；这条断言同时是「不许给实心区塞 height 出来绕反算」的哨兵
    for (const zone of solid) assert.ok(typeof zone.thickness === 'number' && zone.thickness > 0, `${zone.id} thickness`);
  });

  it('derived surface equals roomHeight - thickness for every solid zone', () => {
    for (const zone of ceiling) {
      if (!isSolidCeilingZone(zone)) continue;
      const expected = (roomHeights.get(zone.room) ?? 2.8) - (zone.thickness as number);
      assert.equal(ceilingSurfaceY(zone, roomHeights.get(zone.room) ?? 2.8), expected, `${zone.id}`);
    }
  });

  // 与渲染器逐区对账：CeilingZoneBuilder 把板下表面放在
  // `topY = ceilingHeight - zone.thickness + SLAB_EPS`，因此 slab.position.y 减去 SLAB_EPS
  // 必须正好等于反算出来的完成面。这条断言就是「反算口径 == 渲染口径」的机器证据。
  it('derived surface matches the renderer slab position for every solid zone', () => {
    for (const zone of ceiling) {
      if (!isSolidCeilingZone(zone) || !zone.area) continue;
      const roomHeight = roomHeights.get(zone.room) ?? 2.8;
      const group = buildCeilingZone(zone, roomHeight);
      assert.ok(group, `${zone.id} should build`);
      const slab = group!.children.find((child) => (child as THREE.Mesh).userData.part === 'slab') as THREE.Mesh;
      assert.ok(slab, `${zone.id} slab`);
      assert.ok(
        Math.abs(slab.position.y - 0.002 - ceilingSurfaceY(zone, roomHeight)!) < 1e-9,
        `${zone.id}: renderer slab ${slab.position.y} vs derived surface ${ceilingSurfaceY(zone, roomHeight)}`,
      );
    }
  });
});

const coordination = parseMepCoordination(readFileSync('config/mep-hvac-coordination.yaml', 'utf8'));
const electrical = load<any[]>('config/electrical.yaml');
const plumbing = load<any[]>('config/plumbing.yaml');
const hvac = load<any>('config/hvac.yaml');
const sources = endpointSourcesFromFacts({ electrical, plumbing, ceiling, hvac });
describe('mep ceiling clearance lint (A1)', () => {
  it('flags a route point that dips below a drop surface inside its footprint', () => {
    const result = lintMepCoordination(
      {
        ...coordination,
        routes: [{
          id: 'probe-drop', layer: 'strong_power' as const, status: 'inferred', source_status: 'proposed',
          construction_status: 'pending', method: 'conduit', diameter: 0.02, from_height: 2.55, to_height: 2.55,
          from: { x: 7.5, z: 4.6 }, via: [{ x: 8.0, z: 4.6, y: 2.45 }], to: { x: 8.5, z: 4.6 },
        }],
      },
      sources,
      { ceiling },
    );
    assert.ok(
      result.warnings.some((w) => w.code === 'ceiling_clearance_unverified' && w.routeId === 'probe-drop'),
      'expected a ceiling_clearance_unverified warning',
    );
    assert.equal(result.errors.length, 0);
  });

  it('does not flag a route that stays at or above the drop surface', () => {
    const result = lintMepCoordination(
      {
        ...coordination,
        routes: [{
          id: 'probe-ok', layer: 'strong_power' as const, status: 'inferred', source_status: 'proposed',
          construction_status: 'pending', method: 'conduit', diameter: 0.02, from_height: 2.55, to_height: 2.55,
          from: { x: 7.5, z: 4.6 }, via: [{ x: 8.0, z: 4.6, y: 2.55 }], to: { x: 8.5, z: 4.6 },
        }],
      },
      sources,
      { ceiling },
    );
    assert.equal(result.warnings.filter((w) => w.routeId === 'probe-ok').length, 0);
  });

  // 回归：曾经的实现把「任一点在 footprint 内」和「任一点低于完成面」分成两次 some 扫描，
  // 于是路线末端沿墙下引到 0.3m 插座那段（坐标根本不在任何吊顶分区里）也被算成冲突。
  it('only flags when the SAME point is inside the footprint and below the surface', () => {
    const result = lintMepCoordination(
      {
        ...coordination,
        routes: [{
          id: 'probe-mixed', layer: 'strong_power' as const, status: 'inferred', source_status: 'proposed',
          construction_status: 'pending', method: 'conduit', diameter: 0.02, from_height: 2.55, to_height: 2.55,
          // (8.0,4.6)y=2.55 在 ceiling_living 的 footprint 内且高于完成面 2.50；
          // 起点/终点也显式写 from_height/to_height=2.55，否则退回 strong_power 分层 2.45 制造假冲突。
          // (0.5,7.0)y=0.30 远低于任何完成面，但该坐标在主卧中部、不在任何吊顶分区里。
          from: { x: 7.5, z: 4.6 }, via: [{ x: 8.0, z: 4.6, y: 2.55 }, { x: 0.5, z: 7.0, y: 0.3 }], to: { x: 8.5, z: 4.6 },
        }],
      },
      sources,
      { ceiling },
    );
    assert.equal(result.warnings.filter((w) => w.routeId === 'probe-mixed').length, 0);
  });

  it('reports one warning per route x zone pair, not per point', () => {
    const route = {
      id: 'probe-dup', layer: 'strong_power' as const, status: 'inferred' as const, source_status: 'proposed' as const,
      construction_status: 'pending' as const, method: 'conduit' as const, diameter: 0.02, from_height: 2.45, to_height: 2.45,
      from: { x: 7.5, z: 4.6 }, via: [{ x: 8.0, z: 4.6, y: 2.45 }, { x: 9.0, z: 4.6, y: 2.45 }], to: { x: 8.5, z: 4.6 },
    };
    const result = lintMepCoordination({ ...coordination, routes: [route] }, sources, { ceiling });
    assert.equal(
      result.warnings.filter((w) => w.code === 'ceiling_clearance_unverified' && w.routeId === 'probe-dup').length,
      1,
    );
  });
});
