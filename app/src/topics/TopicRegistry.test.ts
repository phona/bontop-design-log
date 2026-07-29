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
}));

import { TopicRegistry } from './TopicRegistry';
import { HvacTopic } from './HvacTopic';
import { FloorTopic } from './FloorTopic';
import { WallTopic } from './WallTopic';
import { PaintTopic } from './PaintTopic';

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
    expect(topics.length).toBe(4);
    const ids = topics.map((t) => t.id);
    expect(ids).toContain('hvac');
    expect(ids).toContain('floor');
    expect(ids).toContain('wall');
    expect(ids).toContain('paint');
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
    expect(registry.list().length).toBe(5);
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

  it('should apply scheme A1 with outdoor and indoor units', () => {
    const mock = createMockSceneApi();
    const ids = topic.apply(mock.api as any, 'A1');

    expect(ids.length).toBeGreaterThan(0);
    expect(mock.api.clearTopicObjects).toHaveBeenCalledWith('hvac');

    const outdoorIds = ids.filter((id) => id.includes('outdoor'));
    const indoorIds = ids.filter((id) => id.includes('indoor'));
    expect(outdoorIds.length).toBe(1);
    expect(indoorIds.length).toBe(2);

    expect(mock.api.addObject).toHaveBeenCalled();
  });

  it('should place outdoor unit on platform for scheme A1', () => {
    const mock = createMockSceneApi();
    topic.apply(mock.api as any, 'A1');

    const outdoorCall = (mock.api.addObject as any).mock.calls.find(
      (c: any[]) => c[1].includes('outdoor') && !c[1].includes('label')
    );
    expect(outdoorCall).toBeDefined();
    const mesh = outdoorCall[2] as THREE.Mesh;
    expect(mesh.position.x).toBeCloseTo(-8.5, 0);
    expect(mesh.position.z).toBeCloseTo(2.0, 0);
  });

  it('should place ceiling indoor unit at room center near ceiling', () => {
    const mock = createMockSceneApi();
    topic.apply(mock.api as any, 'A1');

    const ceilingCall = (mock.api.addObject as any).mock.calls.find(
      (c: any[]) => c[1] === 'hvac:indoor:A1:living_dining'
    );
    expect(ceilingCall).toBeDefined();
    const mesh = ceilingCall[2] as THREE.Mesh;
    expect(mesh.position.x).toBeCloseTo(0, 0);
    expect(mesh.position.z).toBeCloseTo(0, 0);
    expect(mesh.position.y).toBeCloseTo(2.85, 1);
  });

  it('should place wall indoor unit on north wall', () => {
    const mock = createMockSceneApi();
    topic.apply(mock.api as any, 'A1');

    const wallCall = (mock.api.addObject as any).mock.calls.find(
      (c: any[]) => c[1] === 'hvac:indoor:A1:master_bedroom'
    );
    expect(wallCall).toBeDefined();
    const mesh = wallCall[2] as THREE.Mesh;
    expect(mesh.position.y).toBeCloseTo(1.95, 0);
  });

  it('should handle multiple outdoor units with x-offset', () => {
    const mock = createMockSceneApi();
    topic.apply(mock.api as any, 'E1');

    const outdoorCalls = (mock.api.addObject as any).mock.calls.filter(
      (c: any[]) => c[1].includes('outdoor') && !c[1].includes('label')
    );
    expect(outdoorCalls.length).toBe(2);

    const x0 = outdoorCalls[0][2].position.x;
    const x1 = outdoorCalls[1][2].position.x;
    expect(x0).not.toBeCloseTo(x1, 2);
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

  it('should add labels for outdoor units', () => {
    const mock = createMockSceneApi();
    topic.apply(mock.api as any, 'A1');

    const labelCalls = (mock.api.addObject as any).mock.calls.filter(
      (c: any[]) => c[1].includes('label')
    );
    expect(labelCalls.length).toBeGreaterThan(0);
  });

  it('should skip indoor unit if room not found', () => {
    const mock = createMockSceneApi();
    (mock.api.getRoom as any).mockReturnValue(undefined);
    const ids = topic.apply(mock.api as any, 'A1');
    const indoorIds = ids.filter((id) => id.includes('indoor'));
    expect(indoorIds.length).toBe(0);
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

  it('should apply floor material and return floor:all', () => {
    const scene = {
      setFloorMaterial: vi.fn(),
      getAllRoomIds: vi.fn(() => ['living_dining', 'bedroom_nw']),
    };
    const ids = topic.apply(scene as any, 'floor_tile_01');
    expect(scene.getAllRoomIds).toHaveBeenCalled();
    expect(scene.setFloorMaterial).toHaveBeenCalledWith(
      'living_dining',
      { type: 'ceramic_tile_v2', color: '#c49a6c', scale: 2 }
    );
    expect(ids).toEqual(['floor:all']);
  });

  it('should apply second floor option', () => {
    const scene = {
      setFloorMaterial: vi.fn(),
      getAllRoomIds: vi.fn(() => ['living_dining', 'bedroom_nw']),
    };
    const ids = topic.apply(scene as any, 'floor_tile_02');
    expect(scene.setFloorMaterial).toHaveBeenCalledWith(
      'living_dining',
      { type: 'ceramic_tile_v2', color: '#8b8b8b', scale: 2 }
    );
    expect(ids).toEqual(['floor:all']);
  });

  it('should return empty array for unknown option', () => {
    const scene = {
      setFloorMaterial: vi.fn(),
      getAllRoomIds: vi.fn(),
    };
    const ids = topic.apply(scene as any, 'nonexistent');
    expect(ids).toEqual([]);
    expect(scene.setFloorMaterial).not.toHaveBeenCalled();
  });

  it('should apply floor material even without data.appearance using color fallback', () => {
    const scene = {
      setFloorMaterial: vi.fn(),
      getAllRoomIds: vi.fn(() => ['living_dining']),
    };
    const ids = topic.apply(scene as any, 'floor_tile_01');
    expect(scene.setFloorMaterial).toHaveBeenCalled();
    expect(ids).toEqual(['floor:all']);
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

  it('should return empty array for unknown option', () => {
    const scene = {
      setWallMaterial: vi.fn(),
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
