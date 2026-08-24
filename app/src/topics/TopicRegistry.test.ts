import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';

vi.mock('@shared/houseData', () => ({
  hvacSchemes: [
    {
      id: 'A1',
      name: 'A1 Test',
      price_per_unit: 30000,
      price_range: '2.9–3.2 万',
      desc: 'Test scheme',
      outdoorUnits: [{ location: 'platform', w: 0.95, d: 0.35, h: 0.72 }],
      indoorUnits: [
        { roomId: 'living_dining', type: 'ceiling' },
        { roomId: 'master_bedroom', type: 'wall' },
      ],
      pros: ['pro1'],
      cons: ['con1'],
    },
    {
      id: 'E1',
      name: 'E1 Test',
      price_per_unit: 15000,
      price_range: '1.2–1.8 万',
      desc: 'Stacked scheme',
      outdoorUnits: [
        { location: 'platform', w: 0.85, d: 0.35, h: 0.6 },
        { location: 'platform', w: 0.85, d: 0.35, h: 0.6 },
      ],
      indoorUnits: [{ roomId: 'living_dining', type: 'cabinet' }],
      pros: ['cheap'],
      cons: ['risky'],
    },
    {
      id: 'F2',
      name: 'F2 Test',
      price_per_unit: 31500,
      price_range: '2.8–3.5 万',
      desc: 'Garden scheme',
      outdoorUnits: [{ location: 'entry_garden', w: 0.9, d: 0.35, h: 0.7 }],
      indoorUnits: [{ roomId: 'living_dining', type: 'ceiling' }],
      pros: ['pro'],
      cons: ['con'],
    },
  ],
}));

vi.mock('../render/ObjectFactory.js', () => ({
  createOutdoorUnit: (w: number, h: number, d: number) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: 0xa855f7 })
    );
    return mesh;
  },
  createIndoorUnit: (type: string, width: number, depth: number, height: number) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshStandardMaterial({ color: 0x22d3ee })
    );
    return mesh;
  },
  createLabel: (text: string) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial());
    sprite.userData = { text };
    return sprite;
  },
}));

vi.mock('../data/designData.js', () => ({
  floorOptions: [
    { id: 'floor_tile_01', name: '浅胡桃木纹砖', color: '#c49a6c' },
    { id: 'floor_tile_02', name: '深灰岩纹砖', color: '#8b8b8b' },
  ],
  wallOptions: [
    { id: 'wall_tile_01', name: '厨卫白色釉面砖', color: '#f5f5f5' },
    { id: 'wall_tile_02', name: '浅灰哑光砖', color: '#d0d0d0' },
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
import { WallTopic } from './WallTopic';
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
    expect(topics.length).toBe(9);
    const ids = topics.map((t) => t.id);
    expect(ids).toContain('hvac');
    expect(ids).toContain('floor');
    expect(ids).toContain('curtain');
    expect(ids).toContain('wall');
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
    expect(registry.list().length).toBe(10);
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

  it('should have options from hvacSchemes', () => {
    expect(topic.options.length).toBe(3);
    expect(topic.options[0].id).toBe('A1');
    expect(topic.options[0].name).toBe('A1 Test');
  });

  it('clears obsolete topic objects but delegates all HVAC geometry to render facts', () => {
    const mock = createMockSceneApi();
    const ids = topic.apply(mock.api as any, 'A1');

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
    topic.apply(mock.api as any, 'A1');
    const countAfterA1 = mock.addedObjects.size;

    topic.apply(mock.api as any, 'E1');
    expect(mock.api.clearTopicObjects).toHaveBeenCalledTimes(2);
  });

  it('does not use room availability to fabricate geometry', () => {
    const mock = createMockSceneApi();
    (mock.api.getRoom as any).mockReturnValue(undefined);
    expect(topic.apply(mock.api as any, 'A1')).toEqual([]);
    expect(mock.api.addObject).not.toHaveBeenCalled();
  });
});

describe('HvacTopic.validate', () => {
  let topic: HvacTopic;

  beforeEach(() => {
    topic = new HvacTopic();
  });

  it('should return empty warnings for valid scheme A1', () => {
    const mock = createMockSceneApi();
    const warnings = topic.validate!(mock.api as any, 'A1');
    expect(warnings).toEqual([]);
  });

  it('should warn about E1 stacked units', () => {
    const mock = createMockSceneApi();
    const warnings = topic.validate!(mock.api as any, 'E1');
    expect(warnings.some((w) => w.includes('叠叠乐'))).toBe(true);
  });

  it('should warn about F2 garden placement', () => {
    const mock = createMockSceneApi();
    const warnings = topic.validate!(mock.api as any, 'F2');
    expect(warnings.some((w) => w.includes('入户花园'))).toBe(true);
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

describe('WallTopic', () => {
  let topic: WallTopic;

  beforeEach(() => {
    topic = new WallTopic();
  });

  it('should have correct id and name', () => {
    expect(topic.id).toBe('wall');
    expect(topic.name).toBe('墙砖方案');
  });

  it('should have options from wallOptions', () => {
    expect(topic.options.length).toBe(2);
    expect(topic.options[0].id).toBe('wall_tile_01');
  });

  it('should apply wall material to tile rooms and return wall ids', () => {
    const scene = {
      setWallMaterial: vi.fn(),
      getRoomIdsWithWallFinish: vi.fn().mockReturnValue(['kitchen', 'master_bath', 'guest_bath']),
    };
    const ids = topic.apply(scene as any, 'wall_tile_01');
    expect(scene.getRoomIdsWithWallFinish).toHaveBeenCalledWith('tile');
    expect(scene.setWallMaterial).toHaveBeenCalledWith(
      'kitchen',
      { type: 'ceramic_tile_v2', color: '#f5f5f5', scale: 2 }
    );
    expect(ids).toEqual(['wall:kitchen', 'wall:master_bath', 'wall:guest_bath']);
  });

  it('should apply second wall option', () => {
    const scene = {
      setWallMaterial: vi.fn(),
      getRoomIdsWithWallFinish: vi.fn().mockReturnValue(['kitchen', 'master_bath', 'guest_bath']),
    };
    const ids = topic.apply(scene as any, 'wall_tile_02');
    expect(scene.getRoomIdsWithWallFinish).toHaveBeenCalledWith('tile');
    expect(scene.setWallMaterial).toHaveBeenCalledWith(
      'kitchen',
      { type: 'ceramic_tile_v2', color: '#d0d0d0', scale: 2 }
    );
    expect(ids.length).toBe(3);
  });

  it('DEC-041: per-room override beats default', () => {
    const scene = {
      setWallMaterial: vi.fn(),
      getRoomIdsWithWallFinish: vi.fn().mockReturnValue(['kitchen', 'master_bath']),
    };
    const selection = { default: 'wall_tile_01', roomOverrides: { kitchen: 'wall_tile_02' } };
    topic.apply(scene as any, 'wall_tile_01', selection);
    expect(scene.setWallMaterial).toHaveBeenCalledWith(
      'kitchen',
      { type: 'ceramic_tile_v2', color: '#d0d0d0', scale: 2 }
    );
    expect(scene.setWallMaterial).toHaveBeenCalledWith(
      'master_bath',
      { type: 'ceramic_tile_v2', color: '#f5f5f5', scale: 2 }
    );
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
