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

// base.json 只提供分科目明细：total_budget / project_ceiling 已退场为历史快照。
const budgetBaseFixture = {
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
    // 2026-10-13 阶段 3：hvac 选项来自 config/hvac.yaml（不再是 shared/houseData.ts 的七套
    // invented 报价表），单价是 DEC-2026-10-04-R1 的成交价 36,000，status 透传 contracted。
    assert.deepEqual(
      catalog.getOptions('hvac').map((o) => [o.id, o.price_per_unit, (o.data as { status?: string }).status]),
      [['A2', 36000, 'contracted']],
    );
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

  it('getRoomLayoutDetail includes wall-anchored and furniture-anchored items in placed (Tier 1 regression)', () => {
    // #98 Tier 1：厨房 9 件与阳台 2 件改关系化后不再声明 x/z——placed 坐标须取共享解算结果，
    // 旧口径（直读声明 x/z）会把它们静默排除出 placed，而 counts 仍含它们。
    const catalog = ProjectCatalog.load('.');
    const kitchen = catalog.getRoomLayoutDetail('kitchen');
    assert.ok(kitchen);
    const close = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;
    const at = (type: string, x: number, z: number): boolean =>
      kitchen.furnishings.placed.some((p) => p.type === type && close(p.x, x) && close(p.z, z));
    assert.equal(kitchen.furnishings.placed.filter((p) => p.type === 'kitchen_cabinet_run').length, 3, '北墙两段 + 东墙一段 run 必须在 placed 里');
    // 2026-11-27 量房回填：厨房北墙 w_kit_north 起点 7.20→7.50（x +0.30）、北墙完成面 z −0.15→0.17（z −0.15）；
    // 入户西墙 w_ent_west 10.80→11.11（东段 x +0.31）；阳台 washer 随平台北墙改位 (5.95,1.5)→(6.04,0.35)。
    assert.ok(at('kitchen_cabinet_run', 8.16, 0.17), 'cabinet_run_north_west 应解在 (8.16, 0.17)');
    assert.ok(at('kitchen_cabinet_run', 10.24, 0.17), 'cabinet_run_north_east 应解在 (10.24, 0.17)');
    assert.ok(at('kitchen_cabinet_run', 10.79, 1.275), 'cabinet_run_east 应解在 (10.79, 1.275)');
    assert.ok(at('kitchen_countertop_bridge', 9.10, 0.17), 'countertop_bridge 应解在 (9.10, 0.17)');
    assert.ok(at('dishwasher', 9.10, 0.15), 'dishwasher（anchor ← bridge）应解在 (9.10, 0.15)');
    assert.ok(at('gas_stove', 10.81, 1.5), 'gas_stove（anchor ← east run）应解在 (10.81, 1.5)');
    assert.ok(at('range_hood', 10.81, 1.5), 'range_hood（anchor ← stove）应解在 (10.81, 1.5)');
    assert.ok(at('sink', 9.80, 0.15), 'sink（anchor ← NE run）应解在 (9.80, 0.15)');
    assert.ok(at('mijia_ro_purifier_1400g_under_sink_preview', 10.35, 0.17), 'ro_purifier（anchor ← NE run）应解在 (10.35, 0.17)');

    const balcony = catalog.getRoomLayoutDetail('balcony');
    assert.ok(balcony);
    assert.ok(balcony.furnishings.placed.some((p) => p.type === 'washer' && close(p.x, 6.04) && close(p.z, 0.35)), 'washer（墙锚）应解在 (6.04, 0.35)');
    assert.ok(balcony.furnishings.placed.some((p) => p.type === 'dryer' && close(p.x, 6.04) && close(p.z, 0.35)), 'dryer（anchor ← washer，叠放）应解在 (6.04, 0.35)');
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
    const bedroomDoors = (masterBedroom.wallOpenings ?? []).filter(o => o.type === 'door' || o.type === 'sliding_door');
    assert.ok(bedroomDoors.some(o => o.id === 'd_mb'), 'master_bedroom should have entry d_mb');
    const masterBath = catalog.getRoom('master_bath');
    assert.ok(masterBath);
    const doors = (masterBath.wallOpenings ?? []).filter(o => o.type === 'door' || o.type === 'sliding_door');
    assert.equal(doors.some(o => o.id === 'd_mb'), false, 'd_mb is the master-bedroom entry, not a master_bath door');
    assert.ok(doors.length >= 1, `master_bath should have bath door d_mbath, got ${doors.length}`);
    const door = doors.find(o => o.id === 'd_mbath') ?? doors[0];
    assert.ok(door.x !== undefined && door.z !== undefined, 'door should have absolute x/z');
  });

  it('getDataPrecision reports inferred geometry/structure but completed survey (决策闭环)', () => {
    const catalog = ProjectCatalog.load('.');
    const confidence = catalog.getDataPrecision();
    // 2026-11-27 业主激光实测 + 修正版 DWG 后：geometry/structure 的 coarse 值仍为 inferred
    // （两轮量房均无逐间净平面尺寸、无梁位平面），但 survey_completed 翻 true →
    // overallMaturity 从 inferred 升 partial。逐项实测登记在 config/house.yaml 的 survey_coverage 段。
    // 与 c38c6b5c（archive 分支，只基于 2026-11-26 PDF）不同：source_doc 不再指向 ky51，
    // 改指 2026-11-27 权威量房登记 survey/701_survey_corrected.yaml。
    assert.equal(confidence.geometry, 'inferred');
    assert.equal(confidence.structure, 'inferred');
    assert.equal(confidence.surveyCompleted, true);
    assert.equal(confidence.overallMaturity, 'partial');
    assert.ok(confidence.sourceDoc?.includes('701_survey_corrected'), 'source_doc 指向 2026-11-27 权威量房登记');
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
