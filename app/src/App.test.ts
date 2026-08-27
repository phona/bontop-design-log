import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('three', async (importOriginal: any) => {
  const __three = await importOriginal();
  class MockObject3D {
    userData: Record<string, unknown> = {};
    children: MockObject3D[] = [];
    parent: MockObject3D | null = null;
    material = new MockMaterial();
    position = { x: 0, y: 0, z: 0, set() { return this; }, copy(v: any) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }, clone() { return this; } };
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
  return { ...__three,
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
    PlaneGeometry: class {
      getAttribute() {
        return { count: 0, getX: () => 0, getY: () => 0, setXY() {}, needsUpdate: false };
      }
      dispose() {}
    },
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

vi.mock('three/examples/jsm/controls/PointerLockControls.js', () => ({
  PointerLockControls: class {
    isLocked = false;
    lock() {}
    unlock() {}
    getObject() {
      return { position: { x: 0, y: 1.6, z: 0, set() {} }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };
    }
    connect() {}
    disconnect() {}
  },
}));

vi.mock('./render/EnvironmentManager.js', () => ({
  EnvironmentManager: class {
    setup() {}
    setTimeOfDay() {}
    toggleIBL() {}
    getLightingState() { return { hour: 12, azimuth: 180, elevation: 60, iblEnabled: false }; }
  },
}));

vi.mock('./render/annotations/AnnotationRenderer.js', () => ({
  AnnotationRenderer: class {
    async load() {}
    setVisible() {}
    updateLabels() {}
    clear() {}
    getElectricalData() { return []; }
    getPlumbingData() { return []; }
  },
}));

vi.mock('@shared/houseData', () => ({
  hvacSchemes: [],
}));

vi.mock('./data/designData.js', () => ({
  floorOptions: [],
  bedroomFloorOptions: [],
  wallOptions: [],
  paintOptions: [],
  cabinetOptions: [],
  countertopOptions: [],
  sanitaryOptions: [],
  interiorDoorOptions: [],
  curtainOptions: [],
  materialCategories: { floor: [], wall: [], paint: [], cabinet: [], countertop: [], sanitary: [], door: [], curtain: [] },
  getMaterialOptions: () => ({ floor: [], wall: [], paint: [], cabinet: [], countertop: [], sanitary: [], door: [], curtain: [] }),
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
  setTimeout,
};
vi.stubGlobal('window', mockWindow);

const documentEventListeners: Record<string, Array<(e: any) => void>> = {};
function createMockElement(id?: string) {
  return {
    id: id ?? '',
    classList: { toggle: vi.fn(), add: vi.fn(), remove: vi.fn() },
    style: {},
    innerHTML: '',
    textContent: '',
    value: '',
    disabled: false,
    appendChild: vi.fn(),
    querySelectorAll: vi.fn(() => []),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

const exportGlbButton = createMockElement('export-glb-btn');
const hvacCoordinationButton = createMockElement('hvac-coordination-btn');
const mockDocument = {
  getElementById: vi.fn((id: string) => {
    if (id === 'export-glb-btn') return exportGlbButton;
    if (id === 'hvac-coordination-btn') return hvacCoordinationButton;
    return createMockElement(id);
  }),
  createElement: vi.fn((tag: string) => ({
    tagName: tag,
    className: '',
    style: {},
    innerHTML: '',
    textContent: '',
    appendChild: vi.fn(),
    addEventListener: vi.fn(),
    querySelector: vi.fn(() => createMockElement()),
    querySelectorAll: vi.fn(() => []),
  })),
  addEventListener: vi.fn((event: string, handler: (e: any) => void) => {
    if (!documentEventListeners[event]) documentEventListeners[event] = [];
    documentEventListeners[event].push(handler);
  }),
  removeEventListener: vi.fn(),
  pointerLockElement: null,
  body: { appendChild: vi.fn() } as unknown as HTMLBodyElement,
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
    exportGlbButton.addEventListener.mockClear();
    hvacCoordinationButton.addEventListener.mockClear();
    hvacCoordinationButton.textContent = '';
    hvacCoordinationButton.disabled = false;
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
      if (urlStr.includes('/api/render-facts/projection')) {
        return { ok: true, json: async () => ({
          version: '2.0', lightingFixtures: [], plumbing: [], ceiling: [], hvac: { status: 'unimplemented', planId: null },
          materials: { floor: { default: null, roomOverrides: {} } },
          presentation: { curtains: {
            source: { default: 'open', roomOverrides: {}, updatedAt: '' }, effectiveByRoom: {}, curtains: [],
            snapshotSha256: '0000000000000000000000000000000000000000000000000000000000000000',
          } },
        }) } as Response;
      }
      if (urlStr.includes('/api/scheme/current')) {
        return { ok: true, json: async () => ({ updatedAt: '', selections: {} }) } as Response;
      }
      if (urlStr.includes('/api/presentation-state')) {
        return { ok: true, json: async () => ({ default: 'open', roomOverrides: {}, updatedAt: '1' }) } as Response;
      }
      if (urlStr.includes('/api/visual-commands')) {
        return { ok: true, json: async () => [] } as Response;
      }
      if (urlStr.includes('/api/topics')) {
        return { ok: true, json: async () => [{ id: 'hvac', name: 'HVAC', options: [{ id: 'A1', name: 'A1' }] }] } as Response;
      }
      if (urlStr.includes('/api/decisions')) {
        return { ok: true, json: async () => [] } as Response;
      }
      if (urlStr.includes('/api/budget')) {
        return { ok: true, json: async () => ({ totalBudget: 0, totalActual: 0, categories: [], lineItems: [] }) } as Response;
      }
      if (urlStr.includes('/api/risks')) {
        return { ok: true, json: async () => ({ risks: [], constraintViolations: [] }) } as Response;
      }
      if (urlStr.includes('/api/schemes')) {
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
    expect(app.isReady()).toBe(false);
  });

  it('marks app ready only after start completes', async () => {
    const app = new App(canvas);
    expect(app.isReady()).toBe(false);
    const pending = app.whenReady();
    await app.start();
    await expect(pending).resolves.toBeUndefined();
    expect(app.isReady()).toBe(true);
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

    expect(setSelectionSpy).toHaveBeenCalledWith('hvac', 'A1', { default: 'A1', roomOverrides: {} });
    expect(setActiveOptionSpy).toHaveBeenCalledWith('hvac', 'A1', []);
  });

  it('applies polled presentation state to the scene and panels', async () => {
    const app = new App(canvas);
    await app.start();
    const apply = vi.spyOn(app['houseScene'], 'applyCurtainPresentationState');
    const state = { default: 'privacy' as const, roomOverrides: { living_room: 'blackout' as const }, updatedAt: '2' };
    app['stateSync']['presentationStateCallbacks'][0](state);
    expect(app['curtainPresentationState']).toEqual(state);
    expect(apply).toHaveBeenCalledWith(state);
  });

  it('cycles C through persistent whole-house curtain states', async () => {
    const app = new App(canvas);
    await app.start();
    const update = vi.spyOn(app['stateSync'], 'updateCurtainState').mockResolvedValue({ default: 'privacy', roomOverrides: {}, updatedAt: '2' });
    const keydown = documentEventListeners.keydown.at(-1)!;
    keydown({ code: 'KeyC', repeat: false, preventDefault: vi.fn() });
    await Promise.resolve();
    expect(update).toHaveBeenCalledWith('privacy', undefined, '1');
  });

  it('keeps the measurement L shortcut working when render projection is unavailable', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url;
      if (urlStr.includes('/api/project')) return { ok: true, json: async () => mockProjectData } as Response;
      if (urlStr.includes('/api/render-facts/projection')) return { ok: false, json: async () => ({ error: 'not ready' }) } as Response;
      if (urlStr.includes('/api/scheme/current')) return { ok: true, json: async () => ({ updatedAt: '', selections: {} }) } as Response;
      if (urlStr.includes('/api/presentation-state')) return { ok: true, json: async () => ({ default: 'open', roomOverrides: {}, updatedAt: '1' }) } as Response;
      if (urlStr.includes('/api/visual-commands') || urlStr.includes('/api/decisions') || urlStr.includes('/api/schemes')) return { ok: true, json: async () => [] } as Response;
      if (urlStr.includes('/api/topics')) return { ok: true, json: async () => [{ id: 'hvac', name: 'HVAC', options: [{ id: 'A1', name: 'A1' }] }] } as Response;
      if (urlStr.includes('/api/budget')) return { ok: true, json: async () => ({ totalBudget: 0, totalActual: 0, categories: [], lineItems: [] }) } as Response;
      if (urlStr.includes('/api/risks')) return { ok: true, json: async () => ({ risks: [], constraintViolations: [] }) } as Response;
      return { ok: true, json: async () => ({}) } as Response;
    });
    const app = new App(canvas);
    const toast = vi.spyOn(app as any, 'showToast').mockImplementation(() => undefined);
    await app.start();
    const toggleMeasurement = vi.spyOn(app['analysisTools'], 'toggleMeasurement');
    const keydown = documentEventListeners.keydown.at(-1)!;

    keydown({ code: 'KeyL', repeat: false, preventDefault: vi.fn() });

    expect(toggleMeasurement).toHaveBeenCalledOnce();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('室内灯光配置不可用'));
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

  it('keeps HVAC coordination unavailable for an unimplemented projection', async () => {
    const app = new App(canvas);
    await app.start();

    expect(app['hvacCoordinationState']).toBe('unimplemented');
    expect(hvacCoordinationButton.disabled).toBe(true);
    expect(hvacCoordinationButton.textContent).toBe('未实现');
  });

  it('enables HVAC coordination only when implemented projection export status is ready', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url;
      if (urlStr.includes('/api/project')) return { ok: true, json: async () => mockProjectData } as Response;
      if (urlStr.includes('/api/render-facts/projection')) {
        return { ok: true, json: async () => ({
          version: '2.0', lightingFixtures: [], plumbing: [], ceiling: [],
          hvac: { status: 'implemented', planId: 'A2', diagram: {
            anchors: [
              { id: 'outdoor', status: 'confirmed', system: 'refrigerant', ref: { source: 'outdoor', id: 'outdoor_a2' } },
              { id: 'indoor', status: 'confirmed', system: 'refrigerant', ref: { source: 'ceiling', id: 'ac_living' } },
            ], terminals: [], routes: [{ id: 'trunk', status: 'confirmed', system: 'refrigerant', from: 'outdoor', to: 'indoor' }], reference_constraints: [],
          } },
          materials: { floor: { default: null, roomOverrides: {} } },
          presentation: { curtains: {
            source: { default: 'open', roomOverrides: {}, updatedAt: '' }, effectiveByRoom: {}, curtains: [],
            snapshotSha256: '0000000000000000000000000000000000000000000000000000000000000000',
          } },
        }) } as Response;
      }
      if (urlStr.includes('/api/render-facts')) return { ok: true, json: async () => ({ hvac: { plans: [{ outdoor: { id: 'outdoor_a2', x: 0, z: 0, height: 1 } }] } }) } as Response;
      if (urlStr.includes('/api/scheme/current')) return { ok: true, json: async () => ({ updatedAt: '', selections: {} }) } as Response;
      if (urlStr.includes('/api/visual-commands') || urlStr.includes('/api/decisions') || urlStr.includes('/api/schemes')) return { ok: true, json: async () => [] } as Response;
      if (urlStr.includes('/api/layouts')) return { ok: true, json: async () => ({ layouts: [] }) } as Response;
      if (urlStr.includes('/api/budget')) return { ok: true, json: async () => ({ totalBudget: 0, totalActual: 0, categories: [], lineItems: [] }) } as Response;
      if (urlStr.includes('/api/risks')) return { ok: true, json: async () => ({ risks: [], constraintViolations: [] }) } as Response;
      return { ok: true, json: async () => ({}) } as Response;
    });
    const app = new App(canvas);
    vi.spyOn(app['houseScene'], 'getHvacExportStatus').mockReturnValue({ required: true, ready: true, expected: ['hvac:A2:anchor:outdoor'], included: ['hvac:A2:anchor:outdoor'], missing: [], terminalCount: 0 });
    const setVisible = vi.spyOn(app['houseScene'], 'setHvacCoordinationVisible');
    const toast = vi.spyOn(app as any, 'showToast').mockImplementation(() => undefined);

    await app.start();

    expect(app['hvacCoordinationState']).toBe('ready');
    expect(hvacCoordinationButton.disabled).toBe(false);
    expect(toast).toHaveBeenCalledWith('A2 一拖五已就绪：外机 1 / 内机 1 / 预深化路线 1');
    (window as any).setHvacCoordinationVisible(true);
    expect(setVisible).toHaveBeenLastCalledWith(true);
    expect(app['hvacCoordinationVisible']).toBe(true);
  });

  it('does not mark detached or missing HVAC entities ready', async () => {
    const app = new App(canvas);
    vi.spyOn(app['houseScene'], 'getHvacExportStatus').mockReturnValue({ required: true, ready: false, expected: ['hvac:A2:anchor:outdoor'], included: [], missing: ['hvac:A2:anchor:outdoor'], terminalCount: 0 });
    await app.start();

    expect(app['hvacCoordinationState']).toBe('unimplemented');
    expect(hvacCoordinationButton.disabled).toBe(true);
  });

  it('blocks GLB download when required HVAC export IDs are missing', async () => {
    const app = new App(canvas);
    const getStatus = vi.spyOn(app['houseScene'], 'getHvacExportStatus').mockReturnValue({
      required: true,
      ready: false,
      expected: ['hvac:A2:anchor:outdoor'],
      included: [],
      missing: ['hvac:A2:anchor:outdoor'],
      terminalCount: 0,
    });
    const toast = vi.spyOn(app as any, 'showToast').mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const handler = exportGlbButton.addEventListener.mock.calls.find((call) => call[0] === 'click')?.[1] as () => Promise<void>;

    await handler();

    expect(getStatus).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith(
      'GLB 导出已阻止：HVAC 缺失 hvac:A2:anchor:outdoor',
      expect.objectContaining({ message: 'GLB 导出已阻止：HVAC 缺失 hvac:A2:anchor:outdoor' }),
    );
    expect(toast).toHaveBeenCalledWith('GLB 导出已阻止：HVAC 缺失 hvac:A2:anchor:outdoor');
  });

  it('blocks programmatic GLB export when required HVAC export IDs are missing', async () => {
    const app = new App(canvas);
    vi.spyOn(app['houseScene'], 'getHvacExportStatus').mockReturnValue({
      required: true,
      ready: false,
      expected: ['hvac:A2:terminal:supply_living'],
      included: [],
      missing: ['hvac:A2:terminal:supply_living'],
      terminalCount: 0,
    });

    await expect(app.exportGlbDataUrl()).rejects.toThrow('GLB 导出已阻止：HVAC 缺失 hvac:A2:terminal:supply_living');
  });
});
