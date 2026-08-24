import { describe, it, expect, vi } from 'vitest';

vi.mock('three', async (importOriginal: any) => {
  const __three = await importOriginal();
  class MockObject3D {
    userData: Record<string, unknown> = {};
    children: MockObject3D[] = [];
    parent: MockObject3D | null = null;
    material = new MockMaterial();
    position = { x: 0, y: 0, z: 0, set: function() { return this; }, copy: function(v: any) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }, clone: function() { return { x: this.x, y: this.y, z: this.z, set: function() { return this; }, copy: function(v: any) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }, clone: function() { return this; } }; } };
    rotation = { x: 0, y: 0, z: 0 };
    scale = { x: 1, y: 1, z: 1, set: function(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; } };
    castShadow = false;
    receiveShadow = false;
    add(child: MockObject3D) { child.parent = this; this.children.push(child); }
    remove(child: MockObject3D) { const i = this.children.indexOf(child); if (i >= 0) { this.children.splice(i, 1); child.parent = null; } return child; }
    traverse(cb: (obj: MockObject3D) => void) { cb(this); this.children.forEach(c => c.traverse(cb)); }
    rotateX(x: number) { this.rotation.x += x; }
    rotateY(y: number) { this.rotation.y += y; }
    rotateZ(z: number) { this.rotation.z += z; }
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
    dispose() {}
  }

  return { ...__three,
    Scene: class extends MockObject3D { background: unknown = null; },
    Group: class extends MockObject3D {},
    Mesh: class extends MockObject3D { material = new MockMaterial(); geometry: any = {}; constructor(geometry?: any, material?: any) { super(); if (geometry) this.geometry = geometry; if (material) this.material = material; } },
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
    PlaneGeometry: class {
      getAttribute() {
        return { count: 0, getX: () => 0, getY: () => 0, setXY() {}, needsUpdate: false };
      }
    },
    BoxGeometry: class { dispose() {} },
    // Shape / Path / ExtrudeGeometry / ShapeGeometry: real three (step A) — fake command-log removed
    CanvasTexture: class {},
    MeshStandardMaterial: MockMaterial,
    MeshBasicMaterial: MockMaterial,
    MeshPhysicalMaterial: MockMaterial,
    SpriteMaterial: MockMaterial,
    DoubleSide: 2,
    WebGLRenderer: class { domElement = {}; shadowMap = { enabled: false }; setSize() {} setPixelRatio() {} render() {} dispose() {} },
  };
});

vi.mock('three/examples/jsm/controls/OrbitControls.js', () => ({
  OrbitControls: class {
    target = { x: 0, y: 0, z: 0, set() {}, copy() {}, clone() { return { x: 0, y: 0, z: 0, set() {}, copy() {} }; } };
    enabled = true;
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

vi.mock('../render/EnvironmentManager.js', () => ({
  EnvironmentManager: class {
    setup() {}
    setTimeOfDay() {}
    toggleIBL() {}
    getLightingState() { return { hour: 12, azimuth: 180, elevation: 60, iblEnabled: false }; }
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

import { HouseScene, GLASS_THICKNESS } from '../render/HouseScene';

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

  it('uses default layout bounds before a catalog is loaded', () => {
    const canvas = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const scene = new HouseScene(canvas);
    expect((scene as any).topDownLayoutBounds).toEqual({
      minX: -1.6,
      maxX: 16.4,
      minZ: -2.9,
      maxZ: 12.0,
    });
  });

  it('computes layout bounds from rooms and platform after buildFromCatalog', async () => {
    const canvas = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const scene = new HouseScene(canvas);

    const projectData = {
      house: {
        rooms: [
          { id: 'entry_garden', name: 'Entry Garden', x: -2, z: -3, width: 4, depth: 6, height: 3, type: 'outdoor' },
          { id: 'living_room', name: 'Living', x: 5, z: 2, width: 6, depth: 4, height: 3, type: 'public' },
        ],
        platform: { id: 'east_platform', name: 'East Platform', x: 12, z: -1, width: 4, depth: 2, height: 0.15 },
      },
      topics: [],
      budgetCategories: [],
    };

    await scene.buildFromCatalog(projectData);
    const bounds = (scene as any).topDownLayoutBounds;
    expect(bounds.minX).toBeCloseTo(-4);
    expect(bounds.maxX).toBeCloseTo(14);
    expect(bounds.minZ).toBeCloseTo(-6);
    expect(bounds.maxZ).toBeCloseTo(4);
    expect((scene as any).topDownView.options.bounds).toEqual(bounds);
  });

  it('includes wall scene elements in layout bounds', async () => {
    const canvas = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const scene = new HouseScene(canvas);

    const projectData = {
      house: {
        rooms: [
          { id: 'room1', name: 'Room 1', x: 0, z: 0, width: 4, depth: 4, height: 3, type: 'public' },
        ],
        sceneElements: [
          { type: 'wall' as const, id: 'wall:outer', x1: -2, z1: -2, x2: -2, z2: 2 },
        ],
      },
      topics: [],
      budgetCategories: [],
    };

    await scene.buildFromCatalog(projectData);
    const bounds = (scene as any).topDownLayoutBounds;
    expect(bounds.minX).toBeCloseTo(-2.06);
    expect(bounds.maxX).toBeCloseTo(2);
    expect(bounds.minZ).toBeCloseTo(-2);
    expect(bounds.maxZ).toBeCloseTo(2);
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
      if (obj.userData?.type === 'floor') floorCount++;
      if (obj.userData?.type === 'wall') wallCount++;
    });
    expect(floorCount).toBe(1);
    expect(wallCount).toBe(4);
  });

  it('builds walls from scene elements when provided', async () => {
    const canvas = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const scene = new HouseScene(canvas);

    const projectData = {
      house: {
        rooms: [
          { id: 'a', name: 'A', x: 0, z: 0, width: 4, depth: 3, height: 3, type: 'public' },
        ],
        sceneElements: [
          { type: 'wall' as const, id: 'wall:0', x1: -2, z1: -1.5, x2: 2, z2: -1.5 },
          { type: 'wall' as const, id: 'wall:1', x1: -2, z1: 1.5, x2: 2, z2: 1.5 },
        ],
      },
      topics: [],
      budgetCategories: [],
    };

    await scene.buildFromCatalog(projectData);

    let wallCount = 0;
    scene.getScene().traverse((obj: any) => {
      if (obj.userData?.type === 'wall') wallCount++;
    });
    expect(wallCount).toBe(2);
  });

  it('renders curtain_run as a single continuous mesh', async () => {
    const canvas = { addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as HTMLCanvasElement;
    const scene = new HouseScene(canvas);
    const projectData = {
      house: {
        rooms: [],
        sceneElements: [
          {
            type: 'curtain_run' as const,
            id: 'curtain:rounded',
            points: [
              { x: 0, z: 0 },
              { x: 5, z: 0, radius: 1 },
              { x: 5, z: 5 },
            ],
            height: 2.8,
          },
        ],
      },
      topics: [],
      budgetCategories: [],
    };
    await scene.buildFromCatalog(projectData);
    let curtainCount = 0;
    scene.getScene().traverse((obj: any) => {
      if (obj.userData?.type === 'curtain_run') curtainCount++;
    });
    expect(curtainCount).toBe(1);
  });

  it('uses single objectId for curtain_run mesh', async () => {
    const canvas = { addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as HTMLCanvasElement;
    const scene = new HouseScene(canvas);
    const projectData = {
      house: {
        rooms: [],
        sceneElements: [
          {
            type: 'curtain_run' as const,
            id: 'curtain:west',
            points: [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 2 }],
            height: 2.8,
          },
        ],
      },
      topics: [],
      budgetCategories: [],
    };
    await scene.buildFromCatalog(projectData);
    let objectId: string | undefined;
    scene.getScene().traverse((obj: any) => {
      if (obj.userData?.type === 'curtain_run') objectId = obj.userData.objectId;
    });
    expect(objectId).toBe('curtain:west');
  });

  it('renders closed curtain_run as a single mesh with a hole', async () => {
    const canvas = { addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as HTMLCanvasElement;
    const scene = new HouseScene(canvas);
    const projectData = {
      house: {
        rooms: [],
        sceneElements: [
          {
            type: 'curtain_run' as const,
            id: 'curtain:closed',
            closed: true,
            points: [
              { x: 0, z: 0 },
              { x: 3, z: 0, radius: 0.5 },
              { x: 3, z: 3 },
              { x: 0, z: 3 },
            ],
            height: 2.8,
          },
        ],
      },
      topics: [],
      budgetCategories: [],
    };
    await scene.buildFromCatalog(projectData);
    let curtainCount = 0;
    let shape: any = null;
    scene.getScene().traverse((obj: any) => {
      if (obj.userData?.type === 'curtain_run') {
        curtainCount++;
        shape = obj.geometry?.parameters?.shapes;
      }
    });
    expect(curtainCount).toBe(1);
    expect(shape?.holes?.length).toBe(1);
  });

  it('builds correct ribbon boundary for straight curtain_run', async () => {
    const canvas = { addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as HTMLCanvasElement;
    const scene = new HouseScene(canvas);
    const projectData = {
      house: {
        rooms: [],
        sceneElements: [
          {
            type: 'curtain_run' as const,
            id: 'curtain:straight',
            points: [{ x: 0, z: 0 }, { x: 4, z: 0 }],
            height: 2.8,
          },
        ],
      },
      topics: [],
      budgetCategories: [],
    };
    await scene.buildFromCatalog(projectData);
    let shape: any = null;
    scene.getScene().traverse((obj: any) => {
      if (obj.userData?.type === 'curtain_run') {
        shape = obj.geometry?.parameters?.shapes;
      }
    });
    expect(shape).not.toBeNull();
    const offset = GLASS_THICKNESS / 2;
    const outline = (shape.extractPoints(1).shape as Array<{ x: number; y: number }>)
      .map((p) => ({ x: +p.x.toFixed(4), y: +p.y.toFixed(4) }));
    const o = +offset.toFixed(4);
    expect(outline).toEqual([
      { x: 0, y: o },
      { x: 4, y: o },
      { x: 4, y: -o },
      { x: 0, y: -o },
      { x: 0, y: o },
    ]);
  });

  it('rounded curtain_run produces more boundary points than straight one', async () => {
    const canvas = { addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as HTMLCanvasElement;
    const scene = new HouseScene(canvas);
    const projectData = {
      house: {
        rooms: [],
        sceneElements: [
          {
            type: 'curtain_run' as const,
            id: 'curtain:rounded',
            points: [
              { x: 0, z: 0 },
              { x: 5, z: 0, radius: 1 },
              { x: 5, z: 5 },
            ],
            height: 2.8,
          },
        ],
      },
      topics: [],
      budgetCategories: [],
    };
    await scene.buildFromCatalog(projectData);
    const outlineLen = (s: any): number => {
      let sh: any = null;
      s.getScene().traverse((obj: any) => {
        if (obj.userData?.type === 'curtain_run') sh = obj.geometry?.parameters?.shapes;
      });
      expect(sh).not.toBeNull();
      return (sh.extractPoints(1).shape as unknown[]).length;
    };
    const roundedLen = outlineLen(scene);

    const straightScene = new HouseScene(canvas);
    await straightScene.buildFromCatalog({
      house: {
        rooms: [],
        sceneElements: [
          { type: 'curtain_run' as const, id: 'curtain:straight', points: [{ x: 0, z: 0 }, { x: 5, z: 0 }], height: 2.8 },
        ],
      },
      topics: [],
      budgetCategories: [],
    });
    const straightLen = outlineLen(straightScene);

    expect(roundedLen).toBeGreaterThan(8);
    expect(roundedLen).toBeGreaterThan(straightLen);
  });

  it('curtain_run applies scale-y-flip to preserve overlay z', async () => {
    const canvas = { addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as HTMLCanvasElement;
    const scene = new HouseScene(canvas);
    const projectData = {
      house: {
        rooms: [],
        sceneElements: [
          {
            type: 'curtain_run' as const,
            id: 'curtain:z-sign',
            closed: false,
            points: [{ x: 0, z: 0 }, { x: 0, z: 5 }],
            height: 3,
          },
        ],
      },
      topics: [],
      budgetCategories: [],
    };
    await scene.buildFromCatalog(projectData);
    let mesh: any;
    scene.getScene().traverse((obj: any) => {
      if (obj.userData?.type === 'curtain_run') mesh = obj;
    });
    expect(mesh).toBeDefined();
    expect(mesh.rotation.x).toBeCloseTo(-Math.PI / 2, 5);
    expect(mesh.scale.y).toBeCloseTo(-1, 5);
  });

  it('floor_region applies scale-y-flip to preserve overlay z', async () => {
    const canvas = { addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as HTMLCanvasElement;
    const scene = new HouseScene(canvas);
    const projectData = {
      house: {
        rooms: [],
        sceneElements: [
          {
            type: 'floor_region' as const,
            id: 'floor:z-sign',
            points: [
              { x: 0, z: 0 },
              { x: 2, z: 0 },
              { x: 2, z: 2 },
              { x: 0, z: 2 },
            ],
          },
        ],
      },
      topics: [],
      budgetCategories: [],
    };
    await scene.buildFromCatalog(projectData);
    let mesh: any;
    scene.getScene().traverse((obj: any) => {
      if (obj.userData?.type === 'floor_region') mesh = obj;
    });
    expect(mesh).toBeDefined();
    expect(mesh.rotation.x).toBeCloseTo(-Math.PI / 2, 5);
    expect(mesh.scale.y).toBeCloseTo(-1, 5);
  });

  it('renders a shared wall once between adjacent rooms', async () => {
    const canvas = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const scene = new HouseScene(canvas);

    const projectData = {
      house: {
        rooms: [
          { id: 'a', name: 'A', x: -2.5, z: 0, width: 3, depth: 4, height: 3, type: 'public' },
          { id: 'b', name: 'B', x: 2.5, z: 0, width: 3, depth: 4, height: 3, type: 'public' },
        ],
        // A single shared wall segment between the two rooms.
        sceneElements: [{ type: 'wall' as const, id: 'wall:shared', x1: 0, z1: -2, x2: 0, z2: 2 }],
      },
      topics: [],
      budgetCategories: [],
    };

    await scene.buildFromCatalog(projectData);

    let wallCount = 0;
    scene.getScene().traverse((obj: any) => {
      if (obj.userData?.type === 'wall') wallCount++;
    });
    expect(wallCount).toBe(1);
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
    expect(platformCount).toBe(1); // platform mesh only, no debug frame
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

    // Mock the raycaster to return a non-hoverable floor first, then a wall
    const mockedThree = await import('three');
    const originalRaycaster = mockedThree.Raycaster;
    const originalSceneRaycaster = (scene as any).raycaster;
    (mockedThree as any).Raycaster = class {
      setFromCamera() {}
      intersectObjects() {
        return [
          { object: { userData: { objectId: 'floor:test_room', type: 'floor', roomId: 'test_room', hoverable: false } } },
          { object: { userData: { objectId: 'wall:test_room:north', type: 'wall', roomId: 'test_room' } } },
        ];
      }
    };
    (scene as any).raycaster = new (mockedThree as any).Raycaster();

    try {
      const withoutFilter = scene.raycastFromScreenCenter();
      expect(withoutFilter?.objectId).toBe('floor:test_room');

      const withFilter = scene.raycastFromScreenCenter({ hoverableOnly: true });
      expect(withFilter?.objectId).toBe('wall:test_room:north');
    } finally {
      (mockedThree as any).Raycaster = originalRaycaster;
      (scene as any).raycaster = originalSceneRaycaster;
    }
  });

  it('shows object-first hover name for floor', async () => {
    const canvas = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const scene = new HouseScene(canvas);

    const projectData = {
      house: {
        rooms: [
          { id: 'master_bedroom', name: '主卧', x: 0, z: 0, width: 4, depth: 4, height: 3, type: 'private' },
        ],
      },
      topics: [],
      budgetCategories: [],
    };
    await scene.buildFromCatalog(projectData);

    const mockedThree = await import('three');
    const originalRaycaster = mockedThree.Raycaster;
    const originalSceneRaycaster = (scene as any).raycaster;
    (mockedThree as any).Raycaster = class {
      setFromCamera() {}
      intersectObjects() {
        return [
          { object: { userData: { objectId: 'floor:master_bedroom', type: 'floor', roomId: 'master_bedroom' } } },
        ];
      }
    };
    (scene as any).raycaster = new (mockedThree as any).Raycaster();

    try {
      const result = scene.raycastFromScreenCenter();
      expect(result?.name).toBe('主卧地面');
      expect(result?.objectId).toBe('floor:master_bedroom');
      expect(result?.type).toBe('floor');
    } finally {
      (mockedThree as any).Raycaster = originalRaycaster;
      (scene as any).raycaster = originalSceneRaycaster;
    }
  });

  it('tags floor meshes with floor objectId', async () => {
    const canvas = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const scene = new HouseScene(canvas);
    const projectData = {
      house: {
        rooms: [
          { id: 'master_bedroom', name: 'Master Bedroom', x: 0, z: 0, width: 4, depth: 4, height: 3, type: 'private' },
        ],
      },
      topics: [],
      budgetCategories: [],
    };
    await scene.buildFromCatalog(projectData);

    let found = false;
    scene.getScene().traverse((obj: any) => {
      if (obj.userData?.type === 'floor' && obj.userData?.objectId === 'floor:master_bedroom') {
        found = true;
      }
    });
    expect(found).toBe(true);
  });

  it('shows wall hover name with direction', async () => {
    const canvas = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const scene = new HouseScene(canvas);

    const projectData = {
      house: {
        rooms: [
          { id: 'master_bedroom', name: '主卧', x: 0, z: 0, width: 4, depth: 4, height: 3, type: 'private' },
        ],
      },
      topics: [],
      budgetCategories: [],
    };
    await scene.buildFromCatalog(projectData);

    const mockedThree = await import('three');
    const originalRaycaster = mockedThree.Raycaster;
    const originalSceneRaycaster = (scene as any).raycaster;
    (mockedThree as any).Raycaster = class {
      setFromCamera() {}
      intersectObjects() {
        return [
          { object: { userData: { objectId: 'wall:master_bedroom:north', type: 'wall', roomId: 'master_bedroom' } } },
        ];
      }
    };
    (scene as any).raycaster = new (mockedThree as any).Raycaster();

    try {
      const result = scene.raycastFromScreenCenter();
      expect(result?.name).toBe('主卧北墙');
      expect(result?.objectId).toBe('wall:master_bedroom:north');
      expect(result?.type).toBe('wall');
    } finally {
      (mockedThree as any).Raycaster = originalRaycaster;
      (scene as any).raycaster = originalSceneRaycaster;
    }
  });

  it('shows readable platform hover name', async () => {
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
        platform: { id: 'west_platform', name: '西设备平台', x: -3, z: 0, width: 2, depth: 1.5, height: 3 },
      },
      topics: [],
      budgetCategories: [],
    };
    await scene.buildFromCatalog(projectData);

    const mockedThree = await import('three');
    const originalRaycaster = mockedThree.Raycaster;
    const originalSceneRaycaster = (scene as any).raycaster;
    (mockedThree as any).Raycaster = class {
      setFromCamera() {}
      intersectObjects() {
        return [
          { object: { userData: { objectId: 'platform_boundary', type: 'platform', roomId: 'west_platform' } } },
        ];
      }
    };
    (scene as any).raycaster = new (mockedThree as any).Raycaster();

    try {
      const result = scene.raycastFromScreenCenter();
      expect(result?.name).toBe('西设备平台');
      expect(result?.objectId).toBe('platform_boundary');
      expect(result?.type).toBe('platform');
    } finally {
      (mockedThree as any).Raycaster = originalRaycaster;
      (scene as any).raycaster = originalSceneRaycaster;
    }
  });

  it('reattaches the HVAC root after it is removed by a scene rebuild and exports equipment but not routes', async () => {
    const canvas = { addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as HTMLCanvasElement;
    const scene = new HouseScene(canvas);
    const projection: any = {
      ceiling: [
        { id: 'indoor_living', room: 'living', type: 'ac_indoor', x: 1, z: 2, height: 2.85 },
        { id: 'indoor_bedroom_1', room: 'bedroom_1', type: 'ac_indoor', x: 2, z: 2, height: 2.85 },
        { id: 'indoor_bedroom_2', room: 'bedroom_2', type: 'ac_indoor', x: 3, z: 2, height: 2.85 },
        { id: 'indoor_bedroom_3', room: 'bedroom_3', type: 'ac_indoor', x: 4, z: 2, height: 2.85 },
        { id: 'indoor_study', room: 'study', type: 'ac_indoor', x: 5, z: 2, height: 2.85 },
      ],
      hvac: {
        status: 'implemented', planId: 'A2',
        diagram: {
          anchors: [
            { id: 'outdoor', status: 'confirmed', system: 'refrigerant', ref: { source: 'outdoor', id: 'outdoor_a2' } },
            ...['living', 'bedroom_1', 'bedroom_2', 'bedroom_3', 'study'].map((id) => ({ id: `indoor_${id}`, status: 'confirmed', system: 'refrigerant', ref: { source: 'ceiling', id: `indoor_${id}` } })),
          ],
          terminals: ['supply_living', 'supply_bedroom_1', 'supply_bedroom_2', 'supply_bedroom_3', 'supply_study'].map((id, index) => ({ id, status: 'confirmed', system: 'supply_air', position: { x: index + 1, y: 2.8, z: 2 } })),
          routes: [{ id: 'trunk', status: 'confirmed', system: 'refrigerant', from: 'outdoor', to: 'indoor_living' }],
          reference_constraints: [{ id: 'reference', status: 'inferred', source: 'survey/neighbor_ys01_original_structure_2025-06.png', uncertainty_m: 0.15, not_for_construction: true, range: { x1: 1, x2: 2, z1: 3, z2: 3.2 }, reference_beam_bottom_y: 2.65, risk: 'test', reason: 'test', survey_confirmation: 'test' }],
        },
      },
    };
    const outdoor = [{ id: 'outdoor_a2', platform: 'west', x: 0, z: 0, direction: 'south', width: 0.9, depth: 0.335, height: 0.7, model: '6HP' }];
    scene.loadHvacProjection(projection, outdoor, []);

    const hvacRoot = scene.getScene().children.find((object: any) => object.name === 'HVAC_DIAGRAM')!;
    scene.getScene().remove(hvacRoot);
    expect(scene.getScene().children).not.toContain(hvacRoot);

    scene.loadHvacProjection(projection, outdoor, []);
    expect(scene.getScene().children.filter((object: any) => object.name === 'HVAC_DIAGRAM')).toEqual([hvacRoot]);

    const exportSet = (await import('../render/export-gltf.js')).collectExportSet(scene.getScene());
    const exportIds: string[] = [];
    for (const object of exportSet) object.traverse((child: any) => {
      if (typeof child.userData?.objectId === 'string') exportIds.push(child.userData.objectId);
    });
    expect(exportIds.filter((id) => id.includes(':anchor:'))).toHaveLength(6);
    expect(exportIds.filter((id) => id.includes(':terminal:'))).toHaveLength(5);
    expect(exportIds.some((id) => id.includes(':route:'))).toBe(false);
    expect(exportIds.some((id) => id.includes(':reference:'))).toBe(false);
    expect(scene.getHvacExportStatus()).toMatchObject({ required: true, ready: true, missing: [], terminalCount: 5 });

    scene.clearHvacProjection();
    expect(scene.getHvacExportStatus()).toEqual({
      required: false, ready: true, expected: [], included: [], missing: [], terminalCount: 0,
    });
  });
});
