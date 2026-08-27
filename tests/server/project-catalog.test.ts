import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { ProjectCatalog } from '../../server/project-catalog.js';
import type { CadLayoutYaml, MaterialsYaml } from '../../shared/types.js';

const layoutFixture: CadLayoutYaml = {
  version: '1.0',
  source: 'test.dxf',
  unit: 'mm',
  scale: 0.001,
  origin: { x: 0, z: 0 },
  export_date: '2026-07-09',
  rooms: [
    { id: 'master_bedroom', name: '主卧', x: -5.35, z: 2.0, width: 4.5, depth: 4.05, height: 3.0, area: 18.16, perimeter: 18.39 },
  ],
  platform: { id: 'west_platform', name: '西设备平台', x: -8.5, z: 2.0, width: 1.6, depth: 1.55, height: 3.0, area: 2.48 },
};

const materialsFixture: MaterialsYaml = {
  materials: [
    {
      id: 'floor_tile_01',
      topic_id: 'floor',
      category: '地砖',
      name: '浅胡桃木纹砖',
      brand: '马可波罗',
      model: '800x800',
      spec: '800x800mm',
      unit: '片',
      price_per_unit: 65,
      coverage_per_unit: 0.64,
      loss_rate: 1.08,
      supplier: '',
      online_link: '',
      sample_acquired: false,
      sample_date: null,
      status: 'candidate',
      notes: '',
    },
  ],
};

const budgetBaseFixture = {
  total_budget: 110000,
  categories: {
    floor: { budget: 10000, actual: 0, status: 'draft', notes: '' },
  },
};

describe('ProjectCatalog', () => {
  it('loads topics and options from the real config directory', () => {
    const catalog = ProjectCatalog.load('.');
    const topics = catalog.getTopics();
    assert.ok(topics.some((t) => t.id === 'floor'));
    assert.ok(topics.some((t) => t.id === 'hvac'));
    assert.ok(catalog.getOptions('hvac').some((o) => o.id === 'A2'));
    assert.equal(catalog.getOption('hvac', 'A2')?.price_per_unit, 29000);
  });

  it('validates topics, options, and rooms from the real config directory', () => {
    const catalog = ProjectCatalog.load('.');
    assert.ok(catalog.isValidTopic('floor'));
    assert.ok(catalog.isValidOption('floor', 'floor_tile_01'));
    assert.ok(catalog.isValidRoom('master_bedroom'));
    assert.ok(!catalog.isValidOption('floor', 'no-such-tile'));
  });

  it('builds catalog from an inline layout fixture', () => {
    const catalog = ProjectCatalog.fromMaterials(materialsFixture, budgetBaseFixture, layoutFixture);
    assert.ok(catalog.isValidRoom('master_bedroom'));
    assert.equal(catalog.getRoom('master_bedroom')?.type, 'public');
    const platform = catalog.getPlatform();
    assert.ok(platform);
    assert.equal(platform?.id, 'west_platform');
    assert.equal(platform?.type, 'service');
    assert.equal(platform?.name, '西设备平台');
    assert.ok(!catalog.getRooms().some((r) => r.id === 'west_platform'));
    assert.ok(catalog.isValidTopic('floor'));
    assert.ok(catalog.isValidOption('floor', 'floor_tile_01'));
  });

  it('loads a layout YAML fixture', () => {
    const layout = load(readFileSync('tests/fixtures/layout.yaml', 'utf8')) as CadLayoutYaml;
    const catalog = ProjectCatalog.fromMaterials(materialsFixture, budgetBaseFixture, layout);
    assert.ok(catalog.isValidRoom('master_bedroom'));
    assert.equal(catalog.getRoom('master_bedroom')?.name, '主卧');
    const platform = catalog.getPlatform();
    assert.ok(platform);
    assert.equal(platform?.name, '西设备平台');
    assert.ok(!catalog.getRooms().some((r) => r.id === 'west_platform'));
  });

  it('getAllMaterials returns raw material items', () => {
    const catalog = ProjectCatalog.load('.');
    const materials = catalog.getAllMaterials();
    assert.ok(materials.length >= 28);
    const sofa = materials.find((m) => m.id === 'sofa_3seat_01');
    assert.ok(sofa);
    assert.equal(sofa.spec, '2800×900×750mm（坐高≤420mm）');
    assert.equal(sofa.alternative_group, 'sofa');
  });

  it('getRoomLayoutDetail returns room with walls, openings, furnishings', () => {
    const catalog = ProjectCatalog.load('.');
    const detail = catalog.getRoomLayoutDetail('master_bedroom');
    assert.ok(detail);
    assert.equal(detail.room.id, 'master_bedroom');
    assert.ok(detail.room.width > 0);
    assert.ok(detail.room.depth > 0);
    assert.ok(detail.walls.length > 0, 'must find boundary walls');
    assert.ok(detail.furnishings.counts.bed_180 === 1);
    const bed = detail.furnishings.placed.find((p) => p.type === 'bed_180');
    assert.ok(bed, 'bed_180 must be a placed item');
    assert.equal(typeof bed.x, 'number');
    assert.equal(typeof bed.z, 'number');
    assert.equal(typeof bed.rotation, 'number');
    assert.ok(Array.isArray(detail.electricalMarkers));
    assert.ok(Array.isArray(detail.adjacentRooms));
  });

  it('getFurnishingCounts derives counts from furnishing list', () => {
    const catalog = ProjectCatalog.load('.');
    const counts = catalog.getFurnishingCounts('living_dining');
    assert.equal(counts.sofa_3seat, 1);
    assert.equal(counts.dining_chair, 4, '4 placed dining_chair entries derive to count 4 (餐桌横置西北角：南北各2椅)');
    assert.equal(counts.curtain_set, 2, 'count-only entry uses count field');
    assert.equal(counts.ceiling_light, 2);
    const mbCounts = catalog.getFurnishingCounts('master_bedroom');
    assert.equal(mbCounts.bed_180, 1);
    assert.equal(mbCounts.mattress_180, 1, 'count-only mattress still counted');
    assert.deepEqual(catalog.getFurnishingCounts('nonexistent_room'), {});
  });

  it('getRoomLayoutDetail returns undefined for unknown room', () => {
    const catalog = ProjectCatalog.load('.');
    assert.equal(catalog.getRoomLayoutDetail('nonexistent_room'), undefined);
  });

  it('getRoomLayoutDetail includes wall openings for rooms with doors', () => {
    const catalog = ProjectCatalog.load('.');
    const detail = catalog.getRoomLayoutDetail('master_bedroom');
    assert.ok(detail);
    const openings = detail.walls.flatMap((w) => w.openings ?? []);
    assert.ok(openings.length > 0, 'master_bedroom must have at least one door opening');
  });
});

describe('ProjectCatalog — vertex v2.0 data path', () => {
  it('wall segments from arc expansion reach getWalls() (Gap 1)', () => {
    const catalog = ProjectCatalog.load('.');
    const walls = catalog.getWalls();
    const wMbSouth = walls.find(w => w.id === 'w_mb_south');
    assert.ok(wMbSouth, 'w_mb_south should exist');
    assert.ok(wMbSouth.segments, 'w_mb_south (from=v_sw radius) should have arc segments');
    assert.ok(wMbSouth.segments!.length >= 16, `expected >=16 arc segments, got ${wMbSouth.segments!.length}`);
  });

  it('resolved room area is set for non-rectangular rooms (Gap 2)', () => {
    const catalog = ProjectCatalog.load('.');
    // 2026-08-21 隔墙北移后非矩形房间为主卧（含存储条带 L 形）
    const masterBedroom = catalog.getRoom('master_bedroom');
    assert.ok(masterBedroom);
    assert.ok(masterBedroom.area && masterBedroom.area > 0, 'master_bedroom should have area');
    assert.ok(Math.abs(masterBedroom.area! - (masterBedroom.width * masterBedroom.depth)) > 0.01,
      'non-rectangular room area should differ from bbox');
  });

  it('wall openings are dispatched to rooms as wallOpenings (Gap 3)', () => {
    const catalog = ProjectCatalog.load('.');
    const masterBedroom = catalog.getRoom('master_bedroom');
    assert.ok(masterBedroom);
    // w_mb_win was an unconfirmed CAD residue and is intentionally removed;
    // the shared master-bedroom/east-parent-room wall is continuous.
    assert.equal((masterBedroom.wallOpenings ?? []).some(o => o.id === 'w_mb_win'), false);
    const masterBath = catalog.getRoom('master_bath');
    assert.ok(masterBath);
    const doors = (masterBath.wallOpenings ?? []).filter(o => o.type === 'door' || o.type === 'sliding_door');
    assert.ok(doors.length >= 2, `master_bath should have suite entry d_mb + bath door d_mbath (sliding), got ${doors.length}`);
    const door = doors.find(o => o.id === 'd_mb') ?? doors[0];
    assert.ok(door.x !== undefined && door.z !== undefined, 'door should have absolute x/z');
  });

  it('getDataPrecision reports inferred geometry and material confirmation stats (决策闭环)', () => {
    const catalog = ProjectCatalog.load('.');
    const confidence = catalog.getDataPrecision();
    assert.equal(confidence.geometry, 'inferred');
    assert.equal(confidence.structure, 'inferred');
    assert.equal(confidence.surveyCompleted, false);
    assert.equal(confidence.overallMaturity, 'inferred');
    assert.ok(confidence.materials.total > 0, 'has materials');
    assert.ok(confidence.materials.candidate > 0, 'candidate materials exist');
    assert.equal(
      confidence.materials.candidate + confidence.materials.confirmed,
      confidence.materials.total
    );
    assert.ok(confidence.warning.length > 0);
  });

  it('procurement entries all reference existing materials (no orphans)', () => {
    const procurement = load(readFileSync('config/procurement.yaml', 'utf8')) as {
      materials: Array<{ id: string }>;
    };
    const materials = load(readFileSync('config/materials.yaml', 'utf8')) as {
      materials: Array<{ id: string }>;
    };
    const materialIds = new Set(materials.materials.map((m) => m.id));
    const orphans = procurement.materials.filter((p) => !materialIds.has(p.id));
    assert.deepEqual(orphans, [], 'every procurement entry must match a material');
  });
});
