import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('three', () => {
  class MockObject3D {
    userData: Record<string, unknown> = {};
    children: MockObject3D[] = [];
    parent: MockObject3D | null = null;
    position = { x: 0, y: 0, z: 0, set() { return this; }, clone() { return this; } };
    rotation = { x: 0, y: 0, z: 0 };
    scale = { x: 1, y: 1, z: 1, set() { return this; } };
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
    target = { x: 0, y: 0, z: 0, set() {}, copy() {} };
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

vi.mock('@shared/houseData', () => ({
  rooms: [],
  platform: { id: 'test', name: 'Test', x: 0, z: 0, width: 1, depth: 1, height: 3 },
  hvacSchemes: [],
}));

const mockRequestAnimationFrame = vi.fn(() => 1);
const mockCancelAnimationFrame = vi.fn();

vi.stubGlobal('requestAnimationFrame', mockRequestAnimationFrame);
vi.stubGlobal('cancelAnimationFrame', mockCancelAnimationFrame);

const mockWindow = {
  innerWidth: 800,
  innerHeight: 600,
  devicePixelRatio: 1,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};
vi.stubGlobal('window', mockWindow);

const mockDocument = {
  getElementById: vi.fn((id: string) => ({
    id,
    style: {},
    innerHTML: '',
    textContent: '',
    appendChild: vi.fn(),
    querySelectorAll: vi.fn(() => []),
  })),
  createElement: vi.fn((tag: string) => ({
    tagName: tag,
    style: {},
    innerHTML: '',
    textContent: '',
    appendChild: vi.fn(),
  })),
};
vi.stubGlobal('document', mockDocument);

import { App } from './App';

describe('App', () => {
  let canvas: any;

  const mockProjectData = {
    house: {
      rooms: [
        { id: 'living_room', name: 'Living', x: 0, z: 0, width: 5, depth: 4, height: 3, type: 'public' },
      ],
    },
    topics: [
      { id: 'hvac', name: 'HVAC', perRoom: false, options: [{ id: 'A1', name: 'A1' }] },
    ],
    budgetCategories: [],
  };

  beforeEach(() => {
    canvas = {
      id: 'canvas',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    };

    vi.spyOn(global, 'fetch').mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url;
      if (urlStr.includes('/api/project')) {
        return { ok: true, json: async () => mockProjectData } as Response;
      }
      if (urlStr.includes('/api/scheme/current')) {
        return { ok: true, json: async () => ({ updatedAt: '', selections: {} }) } as Response;
      }
      if (urlStr.includes('/api/visual-commands')) {
        return { ok: true, json: async () => [] } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create an instance with canvas', () => {
    const app = new App(canvas);
    expect(app).toBeDefined();
  });

  it('should fetch project data on start', async () => {
    const app = new App(canvas);
    await app.start();

    expect(global.fetch).toHaveBeenCalledWith('/api/project');
  });

  it('should start render loop', async () => {
    const app = new App(canvas);
    await app.start();

    expect(mockRequestAnimationFrame).toHaveBeenCalled();
  });

  it('should call schemePanel.init with topics on start', async () => {
    const app = new App(canvas);
    await app.start();

    expect(app['schemePanel'].getActiveTopicId()).toBeDefined();
  });

  it('should call dispose and cancel animation frame', async () => {
    const app = new App(canvas);
    await app.start();

    app.dispose();
    expect(mockCancelAnimationFrame).toHaveBeenCalled();
  });

  it('should update scene and panel on scheme change', async () => {
    const app = new App(canvas);
    await app.start();

    const setSelectionSpy = vi.spyOn(app['houseScene'], 'setSelection');
    const setActiveOptionSpy = vi.spyOn(app['schemePanel'], 'setActiveOption');

    const schemeCallback = app['stateSync']['schemeCallbacks'][0];
    schemeCallback({
      updatedAt: '2024-01-01',
      selections: {
        hvac: { default: 'A1', roomOverrides: {} },
      },
    });

    expect(setSelectionSpy).toHaveBeenCalledWith('hvac', 'A1');
    expect(setActiveOptionSpy).toHaveBeenCalledWith('hvac', 'A1', []);
  });

  it('should handle visual command set_camera_target', async () => {
    const app = new App(canvas);
    await app.start();

    const setCameraTargetSpy = vi.spyOn(app['houseScene'], 'setCameraTarget');

    const visualCommandCallback = app['stateSync']['visualCommandCallbacks'][0];
    visualCommandCallback({
      commandId: 'cmd-1',
      type: 'set_camera_target',
      payload: { targetId: 'living_room' },
      createdAt: '2024-01-01',
      expiresAt: '2024-12-31',
    });

    expect(setCameraTargetSpy).toHaveBeenCalledWith('living_room');
  });

  it('should handle visual command highlight_object', async () => {
    const app = new App(canvas);
    await app.start();

    const highlightObjectSpy = vi.spyOn(app['houseScene'], 'highlightObject');

    const visualCommandCallback = app['stateSync']['visualCommandCallbacks'][0];
    visualCommandCallback({
      commandId: 'cmd-2',
      type: 'highlight_object',
      payload: { objectId: 'obj-1' },
      createdAt: '2024-01-01',
      expiresAt: '2024-12-31',
    });

    expect(highlightObjectSpy).toHaveBeenCalledWith('obj-1');
  });

  it('should update offline indicator on offline change', async () => {
    const app = new App(canvas);
    await app.start();

    const setOfflineSpy = vi.spyOn(app['offlineIndicator'], 'setOffline');

    const offlineCallback = app['stateSync']['offlineCallbacks'][0];
    offlineCallback(true);

    expect(setOfflineSpy).toHaveBeenCalledWith(true);
  });
});
