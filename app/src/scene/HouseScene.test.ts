import { describe, it, expect, vi } from 'vitest';

vi.mock('three', () => {
  class MockObject3D {
    userData: Record<string, unknown> = {};
    children: MockObject3D[] = [];
    parent: MockObject3D | null = null;
    position = { x: 0, y: 0, z: 0, set: function() { return this; }, clone: function() { return { x: this.x, y: this.y, z: this.z, set: function() { return this; }, clone: function() { return this; } }; } };
    rotation = { x: 0, y: 0, z: 0 };
    scale = { x: 1, y: 1, z: 1, set: function() { return this; } };
    castShadow = false;
    receiveShadow = false;
    add(child: MockObject3D) { child.parent = this; this.children.push(child); }
    remove(child: MockObject3D) { const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); }
    traverse(cb: (obj: MockObject3D) => void) { cb(this); this.children.forEach(c => c.traverse(cb)); }
    getWorldPosition(t: any) { t.x = this.position.x; t.y = this.position.y; t.z = this.position.z; return t; }
  }

  class MockMaterial {
    color = { set() { return this; } };
    emissive = { set() { return this; }, clone() { return { set() { return this; }, copy() { return this; } }; } };
    emissiveIntensity = 0;
    roughness = 0;
    metalness = 0;
    side = 0;
    transparent = false;
    opacity = 1;
    visible = true;
    map: unknown = null;
    clone() { return new (this.constructor as any)(); }
    set() { return this; }
    copy() { return this; }
  }

  return {
    Scene: class extends MockObject3D { background: unknown = null; },
    Group: class extends MockObject3D {},
    Mesh: class extends MockObject3D { material = new MockMaterial(); geometry = {}; },
    Object3D: MockObject3D,
    Sprite: class extends MockObject3D {},
    PerspectiveCamera: class extends MockObject3D { aspect = 1; updateProjectionMatrix() {} lookAt() {} },
    AmbientLight: class extends MockObject3D {},
    DirectionalLight: class extends MockObject3D { shadow = { mapSize: { width: 0, height: 0 } }; castShadow = false; },
    GridHelper: class extends MockObject3D {},
    Raycaster: class { setFromCamera() {} intersectObjects() { return []; } },
    Vector2: class { x = 0; y = 0; },
    Vector3: class {
      x = 0; y = 0; z = 0;
      constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
      set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
      copy(v: any) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
      clone() { return new (this.constructor as any)(this.x, this.y, this.z); }
    },
    Color: class { set() { return this; } copy() { return this; } clone() { return new (this.constructor as any)(); } },
    PlaneGeometry: class {},
    BoxGeometry: class {},
    CanvasTexture: class {},
    MeshStandardMaterial: MockMaterial,
    MeshBasicMaterial: MockMaterial,
    SpriteMaterial: MockMaterial,
    DoubleSide: 2,
    WebGLRenderer: class { domElement = {}; shadowMap = { enabled: false }; setSize() {} setPixelRatio() {} render() {} dispose() {} },
  };
});

vi.mock('three/examples/jsm/controls/OrbitControls.js', () => ({
  OrbitControls: class {
    target = { x: 0, y: 0, z: 0, set() {}, copy() {}, clone() { return { x: 0, y: 0, z: 0, set() {}, copy() {} }; } };
    enableDamping = true;
    dampingFactor = 0.08;
    maxPolarAngle = 0;
    minDistance = 1;
    maxDistance = 60;
    update() {}
    dispose() {}
    addEventListener() {}
    removeEventListener() {}
  },
}));

vi.mock('../topics/TopicRegistry.js', () => ({
  TopicRegistry: class {
    constructor() {}
    get() { return undefined; }
    list() { return []; }
    register() {}
  },
}));

const mockWindow = {
  innerWidth: 800,
  innerHeight: 600,
  devicePixelRatio: 1,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};

vi.stubGlobal('window', mockWindow);

import { HouseScene } from '../render/HouseScene';

describe('HouseScene', () => {
  it('should initialize', () => {
    const canvas = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    } as unknown as HTMLCanvasElement;
    const scene = new HouseScene(canvas);
    expect(scene).toBeDefined();
    expect(scene.getScene()).toBeDefined();
    expect(scene.getCamera()).toBeDefined();
  });

  it('should render rooms from catalog', async () => {
    const canvas = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const scene = new HouseScene(canvas);

    const projectData = {
      house: {
        rooms: [
          { id: 'living_room', name: 'Living', x: 0, z: 0, width: 5, depth: 4, height: 3, type: 'public' },
          { id: 'bedroom', name: 'Bedroom', x: 6, z: 0, width: 4, depth: 3, height: 3, type: 'private' },
        ],
      },
      topics: [],
      budgetCategories: [],
    };

    await scene.buildFromCatalog(projectData);
    expect(Object.keys(scene.rooms).length).toBe(2);
    expect(scene.rooms['living_room']).toBeDefined();
    expect(scene.rooms['bedroom']).toBeDefined();
  });

  it('should create floors and walls for each room', async () => {
    const canvas = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const scene = new HouseScene(canvas);

    const projectData = {
      house: {
        rooms: [
          { id: 'kitchen', name: 'Kitchen', x: 0, z: 0, width: 3, depth: 3, height: 3, type: 'service' },
        ],
      },
      topics: [],
      budgetCategories: [],
    };

    await scene.buildFromCatalog(projectData);

    let floorCount = 0;
    let wallCount = 0;
    scene.getScene().traverse((obj: any) => {
      if (obj.userData?.part === 'floor') floorCount++;
      if (obj.userData?.part === 'wall') wallCount++;
    });
    expect(floorCount).toBe(1);
    expect(wallCount).toBe(4);
  });

  it('should render platform from catalog', async () => {
    const canvas = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const scene = new HouseScene(canvas);

    const projectData = {
      house: {
        rooms: [
          { id: 'living_room', name: 'Living', x: 0, z: 0, width: 5, depth: 4, height: 3, type: 'public' },
        ],
        platform: { id: 'west_platform', name: 'West Platform', x: -3, z: 0, width: 2, depth: 1.5, height: 3 },
      },
      topics: [],
      budgetCategories: [],
    };

    await scene.buildFromCatalog(projectData);
    expect(scene.rooms['west_platform']).toBeDefined();
    expect(scene.rooms['west_platform'].name).toBe('West Platform');

    let platformCount = 0;
    scene.getScene().traverse((obj: any) => {
      if (obj.userData?.type === 'platform') platformCount++;
    });
    expect(platformCount).toBe(2); // mesh + frame
  });

  it('should register object click callback', () => {
    const canvas = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const scene = new HouseScene(canvas);
    const cb = vi.fn();
    scene.setOnObjectClick(cb);
    expect(cb).not.toHaveBeenCalled();
  });

  it('should highlight object by id', async () => {
    const canvas = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const scene = new HouseScene(canvas);

    const projectData = {
      house: {
        rooms: [
          { id: 'test_room', name: 'Test', x: 0, z: 0, width: 3, depth: 3, height: 3, type: 'public' },
        ],
      },
      topics: [],
      budgetCategories: [],
    };
    await scene.buildFromCatalog(projectData);
    expect(() => scene.highlightObject('test_room')).not.toThrow();
  });

  it('should set camera target to room', async () => {
    const canvas = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const scene = new HouseScene(canvas);

    const projectData = {
      house: {
        rooms: [
          { id: 'test_room', name: 'Test', x: 5, z: 5, width: 3, depth: 3, height: 3, type: 'public' },
        ],
      },
      topics: [],
      budgetCategories: [],
    };
    await scene.buildFromCatalog(projectData);
    expect(() => scene.setCameraTarget('test_room')).not.toThrow();
  });

  it('should render without throwing', () => {
    const canvas = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const scene = new HouseScene(canvas);
    expect(() => scene.render()).not.toThrow();
  });

  it('marks room label as non-hoverable', async () => {
    const canvas = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const scene = new HouseScene(canvas);

    const projectData = {
      house: {
        rooms: [
          { id: 'test_room', name: 'Test', x: 0, z: 0, width: 3, depth: 3, height: 3, type: 'public' },
        ],
      },
      topics: [],
      budgetCategories: [],
    };
    await scene.buildFromCatalog(projectData);

    let roomLabelHoverable: boolean | undefined = undefined;
    scene.getScene().traverse((obj: any) => {
      if (obj.userData?.objectId === 'room:test_room') {
        roomLabelHoverable = obj.userData.hoverable;
      }
    });
    expect(roomLabelHoverable).toBe(false);
  });

  it('raycastFromScreenCenter with hoverableOnly skips non-hoverable objects', async () => {
    const canvas = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const scene = new HouseScene(canvas);

    const projectData = {
      house: {
        rooms: [
          { id: 'test_room', name: 'Test', x: 0, z: 0, width: 3, depth: 3, height: 3, type: 'public' },
        ],
      },
      topics: [],
      budgetCategories: [],
    };
    await scene.buildFromCatalog(projectData);

    // Mock the raycaster to return a room label first, then a wall
    const mockedThree = await import('three');
    const originalRaycaster = mockedThree.Raycaster;
    const originalSceneRaycaster = (scene as any).raycaster;
    (mockedThree as any).Raycaster = class {
      setFromCamera() {}
      intersectObjects() {
        return [
          { object: { userData: { objectId: 'room:test_room', hoverable: false } } },
          { object: { userData: { objectId: 'wall:test_room:north', part: 'wall', roomId: 'test_room' } } },
        ];
      }
    };
    (scene as any).raycaster = new (mockedThree as any).Raycaster();

    try {
      const withoutFilter = scene.raycastFromScreenCenter();
      expect(withoutFilter?.objectId).toBe('room:test_room');

      const withFilter = scene.raycastFromScreenCenter({ hoverableOnly: true });
      expect(withFilter?.objectId).toBe('wall:test_room:north');
    } finally {
      (mockedThree as any).Raycaster = originalRaycaster;
      (scene as any).raycaster = originalSceneRaycaster;
    }
  });
});
