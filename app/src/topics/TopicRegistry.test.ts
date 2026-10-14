import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 2026-10-13 阶段 3：HvacTopic 的选项改从 config/hvac.yaml 读（?raw + shared/hvac-plants 的
 * 纯映射），与 server/project-catalog.ts 同一个文件、同一个函数——原先这里 mock 的是
 * shared/houseData.ts 的七套 invented 报价表（A1 30,500 / A2 29,000 / …）。
 *
 * 两个层次都要钉：
 *   ① **真实 config**：app 看到的方案/单价必须与预算同源（A2 = 36,000，合同已成交）；
 *   ② **合成 fixture**：平台多台外机超宽的告警分支用注入的 raw YAML 驱动（真实配置只有一台）。
 */
const REAL_PLAN_COUNT = 1;

const FIXTURE_YAML = vi.hoisted(() => [
  'plans:',
  '  - id: A2',
  '    kind: vrf_ducted',
  '    name: 单外机方案',
  '    summary: fixture',
  '    commercial: { status: contracted, price_cny: 36000 }',
  '    outdoor: { platform: west_platform, width: 0.99, depth: 0.40, height: 0.81 }',
  '    diagram: { anchors: [], terminals: [], routes: [], reference_constraints: [] }',
  '  - id: E1',
  '    kind: vrf_ducted',
  '    name: 多外机方案',
  '    commercial: { status: candidate, price_cny: 15000 }',
  '    outdoor: { platform: west_platform, width: 0.85, depth: 0.35, height: 0.6 }',
  '    outdoors:',
  '      - { platform: west_platform, width: 0.85, depth: 0.35, height: 0.6 }',
  '      - { platform: west_platform, width: 0.85, depth: 0.35, height: 0.6 }',
  '    diagram: { anchors: [], terminals: [], routes: [], reference_constraints: [] }',
  '  - id: F2',
  '    kind: vrf_ducted',
  '    name: 花园方案',
  '    commercial: { status: candidate, price_cny: 31500 }',
  '    outdoor: { location: entry_garden, width: 0.9, depth: 0.35, height: 0.7 }',
  '    diagram: { anchors: [], terminals: [], routes: [], reference_constraints: [] }',
  '',
].join('\n'));

vi.mock('../../../config/hvac.yaml?raw', () => ({ default: FIXTURE_YAML }));

vi.mock('../data/designData.js', () => ({
  floorOptions: [
    { id: 'floor_tile_01', name: '浅胡桃木纹砖', color: '#c49a6c' },
    { id: 'floor_tile_02', name: '深灰岩纹砖', color: '#8b8b8b' },
  ],
  paintOptions: [
    { id: 'latex_paint_01', name: '金装净味五合一', color: '#f7f5ef' },
    { id: 'latex_paint_02', name: '奶油白', color: '#fff4e6' },
    { id: 'latex_paint_03', name: '浅蓝', color: '#e6f3ff' },
  ],
  cabinetOptions: [
    { id: 'cabinet_board_01', name: '多层实木板柜体 + PET 肤感柜门', color: '#cccccc' },
  ],
  countertopOptions: [
    { id: 'quartz_stone_01', name: '石英石台面', color: '#cccccc' },
  ],
  sanitaryOptions: [
    { id: 'sanitary_toilet_01', name: '虹吸式马桶', color: '#cccccc' },
  ],
  interiorDoorOptions: [
    { id: 'interior_door_01', name: '实木复合免漆门', color: '#cccccc' },
    { id: 'bathroom_door_01', name: '钛镁铝合金极窄平开门', color: '#cccccc' },
    { id: 'entry_door_01', name: '甲级防盗门', color: '#cccccc' },
  ],
  curtainOptions: [
    { id: 'curtain_01', name: '雪尼尔遮光帘+幻影纱+铝百叶', color: '#e8e0d0' },
    { id: 'curtain_02', name: '电动雪尼尔遮光+幻影纱', color: '#d8d2c4' },
  ],
}));

import { TopicRegistry } from './TopicRegistry';
import { HvacTopic } from './HvacTopic';
import { FloorTopic } from './FloorTopic';
import { PaintTopic } from './PaintTopic';
import { CabinetTopic } from './CabinetTopic';
import { CountertopTopic } from './CountertopTopic';
import { SanitaryTopic } from './SanitaryTopic';
import { DoorTopic } from './DoorTopic';

function createMockSceneApi() {
  const addedObjects: Map<string, any> = new Map();
  const topicObjects: Map<string, Set<string>> = new Map();
  const roomsMap: Record<string, any> = {
    living_dining: { id: 'living_dining', name: '客餐厅', x: 0, z: 0, width: 6.2, depth: 5.68, height: 3.0 },
    master_bedroom: { id: 'master_bedroom', name: '主卧', x: -5.35, z: 2.0, width: 4.5, depth: 4.05, height: 3.0 },
    west_platform: { id: 'west_platform', name: '西设备平台', x: -8.5, z: 2.0, width: 1.6, depth: 1.55, height: 3.0 },
  };

  return {
    api: {
      clearTopicObjects: vi.fn((topicId: string) => {
        const ids = topicObjects.get(topicId);
        if (ids) {
          for (const id of ids) addedObjects.delete(id);
          ids.clear();
        }
      }),
      addObject: vi.fn((topicId: string, objectId: string, obj: any) => {
        addedObjects.set(objectId, obj);
        if (!topicObjects.has(topicId)) topicObjects.set(topicId, new Set());
        topicObjects.get(topicId)!.add(objectId);
      }),
      getRoom: vi.fn((roomId: string) => roomsMap[roomId]),
      getPlatformRoomId: vi.fn(() => 'west_platform'),
      highlightObject: vi.fn(),
      setCameraTarget: vi.fn(),
      rooms: roomsMap,
    },
    addedObjects,
    topicObjects,
  };
}

describe('TopicRegistry', () => {
  it('should register all topics on construction', () => {
    const mock = createMockSceneApi();
    const registry = new TopicRegistry(mock.api as any);
    const topics = registry.list();
    expect(topics.length).toBe(8);
    const ids = topics.map((t) => t.id);
    expect(ids).toContain('hvac');
    expect(ids).toContain('floor');
    expect(ids).toContain('curtain');
    expect(ids).toContain('paint');
    expect(ids).toContain('cabinet');
    expect(ids).toContain('countertop');
    expect(ids).toContain('sanitary');
    expect(ids).toContain('door');
  });

  it('should get topic by id', () => {
    const mock = createMockSceneApi();
    const registry = new TopicRegistry(mock.api as any);
    const hvac = registry.get('hvac');
    expect(hvac).toBeDefined();
    expect(hvac!.id).toBe('hvac');
  });

  it('should return undefined for unknown topic', () => {
    const mock = createMockSceneApi();
    const registry = new TopicRegistry(mock.api as any);
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('should allow registering custom topic', () => {
    const mock = createMockSceneApi();
    const registry = new TopicRegistry(mock.api as any);
    const custom = { id: 'custom', name: 'Custom', options: [], apply: vi.fn() };
    registry.register(custom as any);
    expect(registry.get('custom')).toBeDefined();
    expect(registry.list().length).toBe(9);
  });
});

describe('HvacTopic', () => {
  let topic: HvacTopic;

  beforeEach(() => {
    topic = new HvacTopic();
  });

  it('should have correct id and name', () => {
    expect(topic.id).toBe('hvac');
    expect(topic.name).toBe('空调方案');
  });

  it('should have options from config/hvac.yaml (fixture above)', () => {
    expect(topic.options.length).toBe(3);
    expect(topic.options[0].id).toBe('A2');
    expect(topic.options[0].name).toBe('单外机方案');
    // 单价随配置透传，不再有 invented 区间
    expect(topic.options[0].price).toBe(36000);
  });

  it('clears obsolete topic objects but delegates all HVAC geometry to render facts', () => {
    const mock = createMockSceneApi();
    const ids = topic.apply(mock.api as any, 'A2');

    expect(ids).toEqual([]);
    expect(mock.api.clearTopicObjects).toHaveBeenCalledWith('hvac');
    expect(mock.api.addObject).not.toHaveBeenCalled();
  });

  it('should return empty array for unknown scheme', () => {
    const mock = createMockSceneApi();
    const ids = topic.apply(mock.api as any, 'UNKNOWN');
    expect(ids).toEqual([]);
  });

  it('should clear previous objects before applying new scheme', () => {
    const mock = createMockSceneApi();
    topic.apply(mock.api as any, 'A2');
    const countAfterA1 = mock.addedObjects.size;

    topic.apply(mock.api as any, 'E1');
    expect(mock.api.clearTopicObjects).toHaveBeenCalledTimes(2);
  });

  it('does not use room availability to fabricate geometry', () => {
    const mock = createMockSceneApi();
    (mock.api.getRoom as any).mockReturnValue(undefined);
    expect(topic.apply(mock.api as any, 'A2')).toEqual([]);
    expect(mock.api.addObject).not.toHaveBeenCalled();
  });

  it('reads the real config/hvac.yaml: exactly the contracted plan at the contract price', async () => {
    // 不经过上面的 fixture mock：直接解析真实配置，钉住「app 与预算同源」。
    // 真实配置 2026-10-13 阶段 3 起只有成交方案 A2（36,000 / contracted）。
    const { readFileSync } = await import('node:fs');
    const { load } = await import('js-yaml');
    const { hvacPlanOptions } = await import('@shared/hvac-plans');
    // vitest 的 cwd 不保证是 app/，import.meta.url 又带 /@fs 前缀——两步都避开，直接定位仓库根。
    const here = import.meta.url.replace(/^\/@fs/, '');
    const repoRoot = new URL('../../../', here).pathname;
    const doc = load(readFileSync(`${repoRoot}config/hvac.yaml`, 'utf8'));
    const options = hvacPlanOptions(doc);
    expect(options.length).toBe(REAL_PLAN_COUNT);
    expect(options.map((o) => [o.id, o.price_per_unit, (o.data as { status: string }).status]))
      .toEqual([['A2', 36000, 'contracted']]);
  });
});

describe('HvacTopic.validate', () => {
  let topic: HvacTopic;

  beforeEach(() => {
    topic = new HvacTopic();
  });

  it('should return empty warnings for valid scheme A2', () => {
    const mock = createMockSceneApi();
    const warnings = topic.validate!(mock.api as any, 'A2');
    expect(warnings).toEqual([]);
  });

  it('should warn if platform units total width exceeds platform', () => {
    const mock = createMockSceneApi();
    const warnings = topic.validate!(mock.api as any, 'E1');
    expect(warnings.some((w) => w.includes('宽度'))).toBe(true);
  });

  it('should not warn for a plan whose outdoor sits outside the platform', () => {
    const mock = createMockSceneApi();
    const warnings = topic.validate!(mock.api as any, 'F2');
    expect(warnings).toEqual([]);
  });

  it('should return warning for unknown scheme', () => {
    const mock = createMockSceneApi();
    const warnings = topic.validate!(mock.api as any, 'UNKNOWN');
    expect(warnings).toContain('未知 HVAC 方案');
  });

  it('should warn if platform units total width exceeds platform', () => {
    const mock = createMockSceneApi();
    const warnings = topic.validate!(mock.api as any, 'E1');
    expect(warnings.some((w) => w.includes('宽度'))).toBe(true);
  });
});

describe('FloorTopic', () => {
  let topic: FloorTopic;

  beforeEach(() => {
    topic = new FloorTopic();
  });

  it('should have correct id and name', () => {
    expect(topic.id).toBe('floor');
    expect(topic.name).toBe('地砖方案');
  });

  it('should have options from floorOptions', () => {
    expect(topic.options.length).toBe(2);
    expect(topic.options[0].id).toBe('floor_tile_01');
  });

  it('should apply default material to every room and return per-room ids', () => {
    const scene = {
      setFloorMaterial: vi.fn(),
      getAllRoomIds: vi.fn(() => ['living_dining', 'kitchen']),
      applyFloorRegionMaterials: vi.fn(),
    };
    const ids = topic.apply(scene as any, 'floor_tile_01');
    expect(scene.getAllRoomIds).toHaveBeenCalled();
    expect(scene.setFloorMaterial).toHaveBeenCalledWith(
      'living_dining',
      { type: 'ceramic_tile_v2', color: '#c49a6c', scale: 2 }
    );
    expect(ids).toEqual(['floor:living_dining', 'floor:kitchen']);
    expect(scene.applyFloorRegionMaterials).toHaveBeenCalled();
  });

  it('should apply second floor option', () => {
    const scene = {
      setFloorMaterial: vi.fn(),
      getAllRoomIds: vi.fn(() => ['living_dining', 'kitchen']),
      applyFloorRegionMaterials: vi.fn(),
    };
    topic.apply(scene as any, 'floor_tile_02');
    expect(scene.setFloorMaterial).toHaveBeenCalledWith(
      'living_dining',
      { type: 'ceramic_tile_v2', color: '#8b8b8b', scale: 2 }
    );
  });

  it('DEC-041: applies to all rooms incl. bedrooms (no hardcoded exclusion)', () => {
    const scene = {
      setFloorMaterial: vi.fn(),
      getAllRoomIds: vi.fn(() => ['living_dining', 'master_bedroom', 'study', 'bedroom_nw', 'bedroom_se', 'kitchen']),
      applyFloorRegionMaterials: vi.fn(),
    };
    topic.apply(scene as any, 'floor_tile_01');
    const calledRooms = (scene.setFloorMaterial as any).mock.calls.map((c: any[]) => c[0]);
    expect(calledRooms.sort()).toEqual(
      ['living_dining', 'master_bedroom', 'study', 'bedroom_nw', 'bedroom_se', 'kitchen'].sort()
    );
  });

  it('DEC-041: per-room override beats default', () => {
    const scene = {
      setFloorMaterial: vi.fn(),
      getAllRoomIds: vi.fn(() => ['living_dining', 'kitchen']),
      applyFloorRegionMaterials: vi.fn(),
    };
    const selection = { default: 'floor_tile_01', roomOverrides: { living_dining: 'floor_tile_02' } };
    topic.apply(scene as any, 'floor_tile_01', selection);
    expect(scene.setFloorMaterial).toHaveBeenCalledWith(
      'living_dining',
      { type: 'ceramic_tile_v2', color: '#8b8b8b', scale: 2 }
    );
    expect(scene.setFloorMaterial).toHaveBeenCalledWith(
      'kitchen',
      { type: 'ceramic_tile_v2', color: '#c49a6c', scale: 2 }
    );
  });

  it('DEC-041: floor_region follow resolver sees the room effective option', () => {
    const scene = {
      setFloorMaterial: vi.fn(),
      getAllRoomIds: vi.fn(() => ['living_dining']),
      applyFloorRegionMaterials: vi.fn(),
    };
    const selection = { default: 'floor_tile_01', roomOverrides: { living_dining: 'floor_tile_02' } };
    topic.apply(scene as any, 'floor_tile_01', selection);
    const [defaultApp, resolver] = (scene.applyFloorRegionMaterials as any).mock.calls[0];
    expect(defaultApp).toEqual({ type: 'ceramic_tile_v2', color: '#c49a6c', scale: 2 });
    expect(resolver('living_dining')).toEqual({ type: 'ceramic_tile_v2', color: '#8b8b8b', scale: 2 });
    expect(resolver('kitchen')).toEqual({ type: 'ceramic_tile_v2', color: '#c49a6c', scale: 2 });
  });

  it('unknown per-room override falls back to default', () => {
    const scene = {
      setFloorMaterial: vi.fn(),
      getAllRoomIds: vi.fn(() => ['living_dining']),
      applyFloorRegionMaterials: vi.fn(),
    };
    const selection = { default: 'floor_tile_01', roomOverrides: { living_dining: 'nonexistent' } };
    topic.apply(scene as any, 'floor_tile_01', selection);
    expect(scene.setFloorMaterial).toHaveBeenCalledWith(
      'living_dining',
      { type: 'ceramic_tile_v2', color: '#c49a6c', scale: 2 }
    );
  });

  it('should return empty array for unknown option', () => {
    const scene = {
      setFloorMaterial: vi.fn(),
      getAllRoomIds: vi.fn(),
      applyFloorRegionMaterials: vi.fn(),
    };
    const ids = topic.apply(scene as any, 'nonexistent');
    expect(ids).toEqual([]);
    expect(scene.setFloorMaterial).not.toHaveBeenCalled();
  });

  it('validate should return empty array', () => {
    expect(topic.validate()).toEqual([]);
  });
});

describe('PaintTopic', () => {
  let topic: PaintTopic;

  beforeEach(() => {
    topic = new PaintTopic();
  });

  it('should have correct id and name', () => {
    expect(topic.id).toBe('paint');
    expect(topic.name).toBe('乳胶漆方案');
  });

  it('should have options from paintOptions', () => {
    expect(topic.options.length).toBe(3);
    expect(topic.options[0].id).toBe('latex_paint_01');
  });

  it('should apply paint material to paint rooms and return paint ids', () => {
    const scene = {
      setWallMaterial: vi.fn(),
      setCeilingMaterial: vi.fn(),
      getRoomIdsWithWallFinish: vi.fn().mockReturnValue(['living_dining', 'bedroom_nw', 'study']),
    };
    const ids = topic.apply(scene as any, 'latex_paint_01');
    expect(scene.getRoomIdsWithWallFinish).toHaveBeenCalledWith('paint');
    expect(scene.setWallMaterial).toHaveBeenCalledWith(
      'living_dining',
      { type: 'matte_paint', color: '#f7f5ef', scale: 1 }
    );
    expect(ids).toEqual(['paint:living_dining', 'paint:bedroom_nw', 'paint:study']);
  });

  it('should apply cream paint option', () => {
    const scene = {
      setWallMaterial: vi.fn(),
      setCeilingMaterial: vi.fn(),
      getRoomIdsWithWallFinish: vi.fn().mockReturnValue(['living_dining', 'bedroom_nw', 'study']),
    };
    const ids = topic.apply(scene as any, 'latex_paint_02');
    expect(scene.setWallMaterial).toHaveBeenCalledWith(
      'living_dining',
      { type: 'matte_paint', color: '#fff4e6', scale: 1 }
    );
    expect(ids.length).toBe(3);
  });

  it('should apply light blue paint option', () => {
    const scene = {
      setWallMaterial: vi.fn(),
      setCeilingMaterial: vi.fn(),
      getRoomIdsWithWallFinish: vi.fn().mockReturnValue(['living_dining', 'bedroom_nw', 'study']),
    };
    const ids = topic.apply(scene as any, 'latex_paint_03');
    expect(scene.setWallMaterial).toHaveBeenCalledWith(
      'living_dining',
      { type: 'matte_paint', color: '#e6f3ff', scale: 1 }
    );
    expect(ids.length).toBe(3);
  });

  it('should return empty array for unknown option', () => {
    const scene = {
      setWallMaterial: vi.fn(),
      setCeilingMaterial: vi.fn(),
      getRoomIdsWithWallFinish: vi.fn(),
    };
    const ids = topic.apply(scene as any, 'nonexistent');
    expect(ids).toEqual([]);
    expect(scene.setWallMaterial).not.toHaveBeenCalled();
  });

  it('DEC-041: ceiling follows the room wall paint', () => {
    const scene = {
      setWallMaterial: vi.fn(),
      setCeilingMaterial: vi.fn(),
      getRoomIdsWithWallFinish: vi.fn().mockReturnValue(['living_dining']),
    };
    topic.apply(scene as any, 'latex_paint_01');
    expect(scene.setCeilingMaterial).toHaveBeenCalledWith(
      'living_dining',
      { type: 'matte_paint', color: '#f7f5ef', scale: 1 }
    );
  });

  it('DEC-041: per-room override beats default (wall + ceiling)', () => {
    const scene = {
      setWallMaterial: vi.fn(),
      setCeilingMaterial: vi.fn(),
      getRoomIdsWithWallFinish: vi.fn().mockReturnValue(['living_dining', 'study']),
    };
    const selection = { default: 'latex_paint_01', roomOverrides: { study: 'latex_paint_03' } };
    topic.apply(scene as any, 'latex_paint_01', selection);
    expect(scene.setWallMaterial).toHaveBeenCalledWith(
      'study',
      { type: 'matte_paint', color: '#e6f3ff', scale: 1 }
    );
    expect(scene.setWallMaterial).toHaveBeenCalledWith(
      'living_dining',
      { type: 'matte_paint', color: '#f7f5ef', scale: 1 }
    );
  });

  it('PaintTopic validate should return empty array', () => {
    expect(topic.validate()).toEqual([]);
  });
});

describe('CabinetTopic', () => {
  let topic: CabinetTopic;

  beforeEach(() => {
    topic = new CabinetTopic();
  });

  it('should have correct id and name', () => {
    expect(topic.id).toBe('cabinet');
    expect(topic.name).toBe('柜体板材');
  });

  it('should have options from cabinetOptions', () => {
    expect(topic.options.length).toBe(1);
    expect(topic.options[0].id).toBe('cabinet_board_01');
  });

  it('should return empty array on apply (no 3D meshes)', () => {
    const scene = {};
    const ids = topic.apply(scene as any, 'cabinet_board_01');
    expect(ids).toEqual([]);
  });

  it('should return empty array for unknown option', () => {
    const scene = {};
    const ids = topic.apply(scene as any, 'nonexistent');
    expect(ids).toEqual([]);
  });

  it('CabinetTopic validate should return empty array', () => {
    expect(topic.validate()).toEqual([]);
  });
});

describe('CountertopTopic', () => {
  let topic: CountertopTopic;

  beforeEach(() => {
    topic = new CountertopTopic();
  });

  it('should have correct id and name', () => {
    expect(topic.id).toBe('countertop');
    expect(topic.name).toBe('台面方案');
  });

  it('should have options from countertopOptions', () => {
    expect(topic.options.length).toBe(1);
    expect(topic.options[0].id).toBe('quartz_stone_01');
  });

  it('should return empty array on apply (no 3D meshes)', () => {
    const scene = {};
    const ids = topic.apply(scene as any, 'quartz_stone_01');
    expect(ids).toEqual([]);
  });

  it('should return empty array for unknown option', () => {
    const scene = {};
    const ids = topic.apply(scene as any, 'nonexistent');
    expect(ids).toEqual([]);
  });

  it('CountertopTopic validate should return empty array', () => {
    expect(topic.validate()).toEqual([]);
  });
});

describe('SanitaryTopic', () => {
  let topic: SanitaryTopic;

  beforeEach(() => {
    topic = new SanitaryTopic();
  });

  it('should have correct id and name', () => {
    expect(topic.id).toBe('sanitary');
    expect(topic.name).toBe('卫浴洁具');
  });

  it('should have options from sanitaryOptions', () => {
    expect(topic.options.length).toBe(1);
    expect(topic.options[0].id).toBe('sanitary_toilet_01');
  });

  it('should return empty array on apply (no 3D meshes)', () => {
    const scene = {};
    const ids = topic.apply(scene as any, 'sanitary_toilet_01');
    expect(ids).toEqual([]);
  });

  it('should return empty array for unknown option', () => {
    const scene = {};
    const ids = topic.apply(scene as any, 'nonexistent');
    expect(ids).toEqual([]);
  });

  it('SanitaryTopic validate should return empty array', () => {
    expect(topic.validate()).toEqual([]);
  });
});

describe('DoorTopic', () => {
  let topic: DoorTopic;

  beforeEach(() => {
    topic = new DoorTopic();
  });

  it('should have correct id and name', () => {
    expect(topic.id).toBe('door');
    expect(topic.name).toBe('门方案');
  });

  it('should have options from interiorDoorOptions (combined)', () => {
    expect(topic.options.length).toBe(3);
    expect(topic.options[0].id).toBe('interior_door_01');
    expect(topic.options[1].id).toBe('bathroom_door_01');
    expect(topic.options[2].id).toBe('entry_door_01');
  });

  it('should apply door material and return door:all', () => {
    const scene = {
      setDoorMaterial: vi.fn(),
      getAllRoomIds: vi.fn(() => ['living_dining', 'bedroom_nw']),
    };
    const ids = topic.apply(scene as any, 'interior_door_01');
    expect(scene.setDoorMaterial).toHaveBeenCalled();
    expect(ids).toEqual(['door:all']);
  });

  it('should return empty array for unknown option', () => {
    const scene = { setDoorMaterial: vi.fn(), getAllRoomIds: vi.fn() };
    const ids = topic.apply(scene as any, 'nonexistent');
    expect(ids).toEqual([]);
    expect(scene.setDoorMaterial).not.toHaveBeenCalled();
  });

  it('DoorTopic validate should return empty array', () => {
    expect(topic.validate()).toEqual([]);
  });
});
