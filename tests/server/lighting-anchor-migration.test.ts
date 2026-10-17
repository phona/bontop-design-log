// 吸顶灯渲染锚点迁移守门测试（DEC-2026-10-17-R12）。
//
// 背景：overrides.yaml 曾残留 5 条 Blender 时代的 anchorY_offset（-0.25/-0.5），
// 让吸顶灯可见实体悬在宿主吊顶完成面下方 0.10–0.50m，被 verify-spatial 的
// lighting_ceiling_mount_detached 检查抓出。R12 将其归零并确立口径：渲染锚点 =
// 施工安装完成面，灯体下垂由共享几何表达（与 DEC-2026-10-16-R2 / R8/R9 同源）。
//
// 本文件钉住三件事：
// ① 5 盏迁移灯 overrides 归零、basis 引 R12、派生锚点 == electrical.height（kitchen 2.65）；
// ② dome 默认分支几何包围盒顶 == 锚点（灯体贴顶，这是 detached 检查的通过前提；
//    若未来改几何导致「顶≠锚点」，本测试先红，防止检查与渲染再次脱钩）；
// ③ 宿主面选择/容差纯函数的机制行为：多分区取最低实心面、非实心分区（ac_indoor）
//    不作宿主、downlight/track 明装容差分支。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  buildRenderLightingFixtureHeights,
  CEILING_MOUNTED_LIGHT_TYPES,
  ceilingMountGapTolerance,
  selectCeilingHost,
} from '../../shared/lighting-fixtures.js';
import {
  parseCeilingZones,
  parseElectricalPoints,
  parseLightingRenderConfig,
  parseRenderLightingOverrides,
} from '../../shared/project-render-facts-schema.js';
import { buildLightingFixtures } from '../../shared/render/LightingFixtureBuilder.js';
import type { ElectricalPoint, RenderLightingFixture, ResolvedRoom } from '../../shared/types.js';

const read = (relative: string) => readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8');

const MIGRATED_IDS = ['light_master_dome', 'light_parent_dome', 'light_child_dome', 'light_study_dome', 'light_kitchen_panel'] as const;
// kitchen 宿主为 ceiling_kitchen 铝扣板完成面 2.65m，其余 4 盏落在原顶 2.80m 平顶区。
const MIGRATED_HEIGHTS: Record<(typeof MIGRATED_IDS)[number], number> = {
  light_master_dome: 2.8,
  light_parent_dome: 2.8,
  light_child_dome: 2.8,
  light_study_dome: 2.8,
  light_kitchen_panel: 2.65,
};

const room = (id: string, height = 2.8): ResolvedRoom => ({
  id,
  name: id,
  x: 2,
  z: 2,
  width: 4,
  depth: 4,
  height,
  type: 'private',
  boundary_count: 4,
});

describe('DEC-2026-10-17-R12 吸顶灯锚点迁移', () => {
  it('5 盏迁移灯 overrides 归零、basis 引 R12、派生锚点等于 electrical.height', () => {
    const electrical = parseElectricalPoints(read('config/electrical.yaml'));
    const overrides = parseRenderLightingOverrides(read('config/render/overrides.yaml'));
    const byId = new Map(electrical.map((point) => [point.id, point]));
    const heights = buildRenderLightingFixtureHeights(electrical, overrides);
    for (const id of MIGRATED_IDS) {
      const override = overrides.find((candidate) => candidate.id === id);
      assert.ok(override, `${id} 的 render override 缺失`);
      assert.equal(override.anchorY_offset, 0, `${id} 必须保持 anchorY_offset=0（R12 口径）`);
      assert.ok(override.basis.includes('DEC-2026-10-17-R12'), `${id} basis 须引用 DEC-2026-10-17-R12`);
      const point = byId.get(id);
      assert.ok(point?.height !== undefined, `${id} 缺 electrical.height`);
      assert.equal(heights.get(id), point.height, `${id} 派生锚点须等于 electrical.height`);
      assert.ok(Math.abs((heights.get(id) ?? 0) - MIGRATED_HEIGHTS[id]) < 1e-9, `${id} 锚点应为 ${MIGRATED_HEIGHTS[id]}`);
    }
  });

  it('kitchen 平板灯安装面 2.65 与 ceiling_kitchen 宿主面一致（宿主选择取最低实心面）', () => {
    const electrical = parseElectricalPoints(read('config/electrical.yaml'));
    const zones = parseCeilingZones(read('config/ceiling.yaml'));
    const rooms = [room('kitchen')];
    const point = electrical.find((candidate) => candidate.id === 'light_kitchen_panel');
    assert.ok(point);
    assert.equal(point.height, 2.65);
    const host = selectCeilingHost(point, zones, rooms);
    assert.ok(host, 'kitchen 点位必须落在某个实心吊顶分区内');
    assert.equal(host.zone.id, 'ceiling_kitchen');
    assert.ok(Math.abs(host.surfaceY - 2.65) < 1e-9);
  });

  it('4 间卧室 dome 点位均不在任何吊顶分区内（宿主回退原顶 2.80）', () => {
    const electrical = parseElectricalPoints(read('config/electrical.yaml'));
    const zones = parseCeilingZones(read('config/ceiling.yaml'));
    const rooms = ['master_bedroom', 'study', 'bedroom_nw', 'bedroom_se'].map((id) => room(id));
    for (const id of ['light_master_dome', 'light_parent_dome', 'light_child_dome', 'light_study_dome'] as const) {
      const point = electrical.find((candidate) => candidate.id === id);
      assert.ok(point);
      assert.equal(selectCeilingHost(point, zones, rooms), undefined, `${id} 应落在原顶平顶区`);
      assert.equal(point.height, 2.8);
    }
  });

  it('dome 默认分支渲染包围盒顶贴锚点（detached 检查的通过前提）', () => {
    const lighting = parseLightingRenderConfig(read('config/render/lighting.yaml'));
    for (const id of ['light_master_dome', 'light_kitchen_panel'] as const) {
      const fixture: RenderLightingFixture = {
        id,
        room: 'kitchen',
        type: 'dome',
        position: { x: 9.0, y: MIGRATED_HEIGHTS[id], z: 1.2 },
        temperatureK: 4000,
        enabled: true,
      };
      const built = buildLightingFixtures([fixture], lighting);
      const object = built.fixtures.get(`electrical:${id}`);
      assert.ok(object, `${id} 未产出渲染实体`);
      object.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(object);
      assert.ok(
        Math.abs(bounds.max.y - MIGRATED_HEIGHTS[id]) < 1e-6,
        `${id} bbox 顶 ${bounds.max.y} 应恰为锚点 ${MIGRATED_HEIGHTS[id]}（灯体贴顶）`,
      );
    }
  });

  it('selectCeilingHost 机制：多分区取最低实心面、ac_indoor 不作宿主、区外回退 undefined', () => {
    const zones = parseCeilingZones([
      '- { id: zone_thick, room: r1, type: drop, thickness: 0.30, area: [0, 0, 4, 4] }',
      '- { id: zone_shallow, room: r2, type: drop, thickness: 0.15, area: [1, 1, 3, 3] }',
      '- { id: zone_ac, room: r1, type: ac_indoor, x: 2, z: 2, height: 2.85 }',
    ].join('\n'));
    const rooms = [room('r1'), room('r2')];
    const overlap = selectCeilingHost({ x: 2, z: 2 }, zones, rooms);
    assert.ok(overlap);
    assert.equal(overlap.zone.id, 'zone_thick', '重叠覆盖时应取最低实心完成面（厚板完成面更低）');
    assert.ok(Math.abs(overlap.surfaceY - 2.50) < 1e-9);
    const onlyThick = selectCeilingHost({ x: 0.5, z: 0.5 }, zones, rooms);
    assert.ok(onlyThick && onlyThick.zone.id === 'zone_thick');
    assert.equal(selectCeilingHost({ x: 10, z: 10 }, zones, rooms), undefined, '无覆盖时返回 undefined（调用方回退原顶）');
  });

  it('ceilingMountGapTolerance 按 renderer 分支', () => {
    const point = (type: ElectricalPoint['type'], extra: Partial<ElectricalPoint> = {}): ElectricalPoint => (
      { id: 't', room: 'r', type, ...extra } as ElectricalPoint
    );
    assert.equal(ceilingMountGapTolerance(point('dome')), 0.02);
    assert.equal(ceilingMountGapTolerance(point('ceiling_light')), 0.02);
    assert.equal(ceilingMountGapTolerance(point('pendant')), 0.02);
    assert.equal(ceilingMountGapTolerance(point('downlight', { recessed: true })), 0.02);
    assert.equal(ceilingMountGapTolerance(point('downlight', { recessed: false })), 0.055);
    assert.equal(ceilingMountGapTolerance(point('track_light')), 0.05);
    assert.ok(CEILING_MOUNTED_LIGHT_TYPES.has('dome'));
    assert.ok(!CEILING_MOUNTED_LIGHT_TYPES.has('wall_lamp'));
    assert.ok(!CEILING_MOUNTED_LIGHT_TYPES.has('night_light'));
  });
});
