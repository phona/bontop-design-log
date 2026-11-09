import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

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
    // emissive 带 r/g/b + set/copy/clone，对齐真 three.Color（2026-11-04 issue #66：
    // HouseScene 高亮改走 emissive.copy(new Color(0xffaa00))，原桩缺 copy 会让
    // highlightObjects 抛 TypeError，被 App「高亮失败不打断审批流」catch 吞掉后
    // 后续 highlightPoints 不再执行）。
    emissive = {
      r: 0, g: 0, b: 0,
      set(r: number, g?: number, b?: number) { this.r = r; this.g = g ?? 0; this.b = b ?? 0; return this; },
      copy(c: { r: number; g: number; b: number }) { if (c) { this.r = c.r; this.g = c.g; this.b = c.b; } return this; },
      clone() { return { r: this.r, g: this.g, b: this.b, set() { return this; }, copy() { return this; } }; },
    };
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
    Color: class {
      set() { return this; }
      setRGB() { return this; }
      copy() { return this; }
      clone() { return new (this.constructor as any)(); }
    },
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
    setSunlightEnabled() {}
    setInteriorOnlyNightPreview() {}
    requestShadowUpdate() {}
    getLightingState() { return { hour: 12, azimuth: 180, elevation: 60, iblEnabled: false, isNight: false, altitudeDeg: 60 }; }
  },
}));

vi.mock('./render/annotations/AnnotationRenderer.js', () => ({
  AnnotationRenderer: class {
    async load() {}
    setVisible() {}
    updateLabels() {}
    clear() {}
    // issue #98 S1：标注层坐标经 shared/point-placement.ts 解算，宿主墙索引由 App 注入
    setPointWalls() {}
    // issue #98 S2：mount 挂载点位的家具宿主索引由 App 注入
    setMountHosts() {}
    getElectricalData() { return []; }
    getPlumbingData() { return []; }
  },
}));

// 2026-10-13 阶段 3：原先这里 mock `@shared/houseData`（七套 invented HVAC 报价表）。
// 该文件已删除，HvacTopic 改读 config/hvac.yaml?raw——真实配置只有一个成交方案，
// 不需要 mock（HvacTopic.apply 不清几何，见 TopicRegistry.test.ts 的同源断言）。

vi.mock('./data/designData.js', () => ({
  floorOptions: [],
  bedroomFloorOptions: [],
  paintOptions: [],
  cabinetOptions: [],
  countertopOptions: [],
  sanitaryOptions: [],
  interiorDoorOptions: [],
  curtainOptions: [],
  materialCategories: { floor: [], paint: [], cabinet: [], countertop: [], sanitary: [], door: [], curtain: [] },
  getMaterialOptions: () => ({ floor: [], paint: [], cabinet: [], countertop: [], sanitary: [], door: [], curtain: [] }),
}));

const mockRequestAnimationFrame = vi.fn(() => 1);
const mockCancelAnimationFrame = vi.fn();

vi.stubGlobal('requestAnimationFrame', mockRequestAnimationFrame);
vi.stubGlobal('cancelAnimationFrame', mockCancelAnimationFrame);
// jsdom 没有 ResizeObserver；HouseScene 构造时新建一个观察画布尺寸
vi.stubGlobal('ResizeObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
});

const mockWindow = {
  innerWidth: 800,
  innerHeight: 600,
  devicePixelRatio: 1,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
  setTimeout,
};
vi.stubGlobal('window', mockWindow);

// jsdom 没有 URL.createObjectURL（DXF/GLB 导出下载用）
const createdBlobs: Blob[] = [];
vi.stubGlobal('URL', class extends URL {
  static createObjectURL = vi.fn((blob: Blob) => { createdBlobs.push(blob); return 'blob:mock'; });
  static revokeObjectURL = vi.fn();
});

const documentEventListeners: Record<string, Array<(e: any) => void>> = {};
function createMockElement(id?: string) {
  return {
    id: id ?? '',
    classList: { toggle: vi.fn(), add: vi.fn(), remove: vi.fn() },
    style: {},
    innerHTML: '',
    textContent: '',
    value: '',
    hidden: false,
    type: '',
    title: '',
    disabled: false,
    onclick: null,
    setAttribute: vi.fn(),
    appendChild: vi.fn(),
    replaceChildren: vi.fn(),
    remove: vi.fn(),
    querySelector: vi.fn(() => createMockElement()),
    querySelectorAll: vi.fn(() => []),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

const exportGlbButton = createMockElement('export-glb-btn');
const exportDxfButton = createMockElement('export-dxf-btn');
const hvacCoordinationButton = createMockElement('hvac-coordination-btn');
const mockDocument = {
  getElementById: vi.fn((id: string) => {
    if (id === 'export-glb-btn') return exportGlbButton;
    if (id === 'export-dxf-btn') return exportDxfButton;
    if (id === 'hvac-coordination-btn') return hvacCoordinationButton;
    return createMockElement(id);
  }),
  createElement: vi.fn((tag: string) => ({
    tagName: tag,
    className: '',
    dataset: {},
    classList: { toggle: vi.fn(), add: vi.fn(), remove: vi.fn() },
    style: {},
    click: vi.fn(),
    innerHTML: '',
    textContent: '',
    appendChild: vi.fn(),
    replaceChildren: vi.fn(),
    remove: vi.fn(),
    addEventListener: vi.fn(),
    setAttribute: vi.fn(),
    querySelector: vi.fn(() => createMockElement()),
    querySelectorAll: vi.fn(() => []),
  })),
  addEventListener: vi.fn((event: string, handler: (e: any) => void) => {
    if (!documentEventListeners[event]) documentEventListeners[event] = [];
    documentEventListeners[event].push(handler);
  }),
  removeEventListener: vi.fn(),
  querySelectorAll: vi.fn(() => []),
  pointerLockElement: null,
  body: {
    appendChild: vi.fn(),
    classList: { toggle: vi.fn(), add: vi.fn(), remove: vi.fn() },
  } as unknown as HTMLBodyElement,
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

  const mockRenderFactsProjection = {
    version: '2.0', lightingFixtures: [], plumbing: [], ceiling: [], hvac: { status: 'unimplemented', planId: null },
    materials: { floor: { default: null, roomOverrides: {} } },
    presentation: { curtains: {
      source: { default: 'open', roomOverrides: {}, updatedAt: '' }, effectiveByRoom: {}, curtains: [],
      snapshotSha256: '0000000000000000000000000000000000000000000000000000000000000000',
    } },
  };

  // 默认 fetch mock（beforeEach 与 DXF 导出用例的窄覆写共用：未命中用例规则时委托回这里）
  const defaultFetchMock = async (url: string | URL | Request): Promise<Response> => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url;
    if (urlStr.includes('/api/project')) {
      return { ok: true, json: async () => mockProjectData } as Response;
    }
    if (urlStr.includes('/api/render-facts/projection')) {
      return { ok: true, json: async () => mockRenderFactsProjection } as Response;
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
  };

  beforeEach(() => {
    createdBlobs.length = 0;
    exportGlbButton.addEventListener.mockClear();
    exportDxfButton.addEventListener.mockClear();
    hvacCoordinationButton.addEventListener.mockClear();
    hvacCoordinationButton.textContent = '';
    hvacCoordinationButton.disabled = false;
    canvas = {
      id: 'canvas',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    };

    vi.spyOn(global, 'fetch').mockImplementation(defaultFetchMock);
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
    // 方案面板改走 applySchemeSelections（按主题记忆选案，展示第一个有选案的主题），
    // 不再逐键 setActiveOption——后者会让 activeTopicId 停在最后一个 selections 键。
    const applySelectionsSpy = vi.spyOn(app['schemePanel'], 'applySchemeSelections');

    const schemeCallback = app['stateSync']['schemeCallbacks'][0];
    schemeCallback({
      updatedAt: '2024-01-01',
      selections: {
        hvac: { default: 'A1', roomOverrides: {} },
      },
    });

    expect(setSelectionSpy).toHaveBeenCalledWith('hvac', 'A1', { default: 'A1', roomOverrides: {} });
    expect(applySelectionsSpy).toHaveBeenCalledWith({ hvac: 'A1' });
    // 面板展示落到第一个有选案的主题与其选中项
    expect(app['schemePanel'].getActiveTopicId()).toBe('hvac');
    expect(app['schemePanel'].getActiveOptionId()).toBe('A1');
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

  it('L only toggles lights; toasts (not measurement fallback) when projection is unavailable', async () => {
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

    // 2026-10-26 去陷阱：L 只管灯；灯不可用时只 toast，不再顺手切换测量
    expect(toggleMeasurement).not.toHaveBeenCalled();
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
    expect(toast).toHaveBeenCalledWith('A2 空调协调已就绪：外机 1 / 内机 1 / 预深化路线 1');
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

  // 2026-11-03 路由级独立页：boot 的路由应用。守两条——首访不再自动开审批页
  // （旧行为还会强行拉预演工作台，挤出「对象信息点开没东西」）；#pkg= 深链仍落 detail。
  it('boot：无 hash 首访 = 3D 页，不自动开审批页', async () => {
    location.hash = '';
    const app = new App(canvas);
    await app.start();
    expect(app['approvalView']).toBe(null);
  });

  it('boot：#pkg= 深链落审批页 detail', async () => {
    location.hash = '#pkg=PKG-060';
    try {
      const app = new App(canvas);
      await app.start();
      expect(app['approvalView']).toBe('detail');
    } finally {
      location.hash = '';
    }
  });

  // 2026-11-03 codex 四审 major：命令面板的「切换视角模式」是键盘屏蔽的漏网入口——
  // 审批页里切第一人格会 requestLock 把指针锁给背后的画布。toggleMode 本体加守卫。
  it('审批页打开期间 toggleMode 是 no-op（命令面板漏网入口）', async () => {
    location.hash = '#approval=flow';
    try {
      const app = new App(canvas);
      await app.start();
      expect(app['approvalView']).toBe('flow');
      const modeBefore = app['houseScene'].mode;
      app['toggleMode']();
      expect(app['houseScene'].mode).toBe(modeBefore);
    } finally {
      location.hash = '';
    }
  });

  // 2026-11-03 浏览器复验挖出的死代码修复：退出时若把 approvalView 持久化成 null，
  // 刷新后 lastApprovalPage 永远回落 next_action——「记忆上次所在审批页」死亡。
  // 正确语义：退出保留最后看过的子页。
  it('退出审批页后持久化仍保留上次子页（刷新后点审批回该子页）', async () => {
    location.hash = '#approval=flow';
    try {
      const app = new App(canvas);
      await app.start();
      expect(app['approvalView']).toBe('flow');
      app['toggleApprovalView'](); // 退出
      expect(app['approvalView']).toBe(null);
      const persisted = JSON.parse(localStorage.getItem('bontop-view-state/v1') ?? '{}');
      expect(persisted.approvalView).toBe('flow'); // 退出不抹记忆
      expect(app['lastApprovalPage']).toBe('flow');
    } finally {
      location.hash = '';
      localStorage.removeItem('bontop-view-state/v1');
    }
  });

  // 2026-11-03 浏览器复验缺陷 A 的回归：深链首 entry（没得可 pop）点「在 3D 中
  // 高亮」——exitApproval 走 replace 兜底，此时必须自己应用路由，否则 hash 回了
  // 3D 但审批页还开着，6s 高亮在全屏页背后燃尽。
  it('viewPackageIn3d：replace 兜底路径下审批页必须真的关', async () => {
    location.hash = '#pkg=PKG-060';
    try {
      const app = new App(canvas);
      await app.start();
      expect(app['approvalView']).toBe('detail');
      // 路由镜像已是 detail 且不可 pop（未经 push 进入）——模拟深链首 entry
      app['viewPackageIn3d']('PKG-060');
      expect(app['approvalView']).toBe(null);
      expect(location.hash).toBe('');
    } finally {
      location.hash = '';
    }
  });

  it('exports DXF from toolbar button: blob download named house-YYYYMMDD.dxf', async () => {
    // render-facts / schedule-state 挡 503（start() 前装好）：面板后台刷新拿到 {} 会在 render 崩
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url;
      if (urlStr.includes('/api/render-facts') && !urlStr.includes('/api/render-facts/projection')) {
        return { ok: false, status: 503 } as Response;
      }
      if (urlStr.includes('/api/schedule/state')) {
        return { ok: false, status: 503 } as Response;
      }
      return defaultFetchMock(url);
    });
    const app = new App(canvas);
    await app.start();
    const toast = vi.spyOn(app as any, 'showToast').mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockDocument.createElement.mockClear();
    const handler = exportDxfButton.addEventListener.mock.calls.find((call) => call[0] === 'click')?.[1] as () => Promise<void>;

    await handler();
    // handler 以 void 触发 detached async 链（含两次 fetch mock），flush 宏任务等它走完
    await new Promise((resolve) => setTimeout(resolve, 0));

    const anchor = mockDocument.createElement.mock.results.map((result: any) => result.value).find((el: any) => el.tagName === 'a');
    expect(anchor).toBeDefined();
    expect(anchor.download).toMatch(/^house-\d{8}\.dxf$/);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('DXF 已导出'));
    // 默认 fetch mock 的 render-facts 回 {}：plumbing/mep 降级为告警而不是失败
    expect(consoleWarn).toHaveBeenCalledWith('[dxf] warnings:', expect.arrayContaining([expect.stringContaining('plumbing:')]));
    toast.mockRestore();
    consoleWarn.mockRestore();
  });

  it('refuses to download DXF when a point cannot be placed (errors fail-closed)', async () => {
    // issue #98 / Codex 266331dd blocking：点位定位解算失败必须让页面导出口抛错，
    // 不创建下载锚点。1m 墙 + 插座 along=2 是最小复现（越出墙长）。
    const projectWithWall = {
      house: {
        rooms: [{ id: 'living_room', name: 'Living', x: 0, z: 0, width: 5, depth: 4, height: 3, type: 'public' }],
        sceneElements: [{ type: 'wall', id: 'w_1m', x1: 0, z1: 0, x2: 1, z2: 0, line_datum: 'centerline' }],
      },
    };
    const factsWithBadPoint = {
      electrical: [{ id: 'sock_over', room: 'living_room', type: 'socket', wall: 'w_1m', wallSide: 'south', along: 2 }],
      plumbing: [],
      ceiling: [],
      hvac: null,
    };
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url;
      if (urlStr.includes('/api/project')) {
        return { ok: true, json: async () => projectWithWall } as Response;
      }
      if (urlStr.includes('/api/render-facts') && !urlStr.includes('/api/render-facts/projection')) {
        return { ok: true, json: async () => factsWithBadPoint } as Response;
      }
      if (urlStr.includes('/api/config-status')) {
        return { ok: true, json: async () => ({ configs: [] }) } as Response;
      }
      if (urlStr.includes('/api/schedule/state')) {
        return { ok: false, status: 503 } as Response;
      }
      return defaultFetchMock(url);
    });
    const app = new App(canvas);
    await app.start();
    const toast = vi.spyOn(app as any, 'showToast').mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockDocument.createElement.mockClear();
    const handler = exportDxfButton.addEventListener.mock.calls.find((call) => call[0] === 'click')?.[1] as () => Promise<void>;

    await handler();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const anchor = mockDocument.createElement.mock.results.map((result: any) => result.value).find((el: any) => el.tagName === 'a');
    expect(anchor).toBeUndefined();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('DXF 导出失败'));
    expect(consoleError).toHaveBeenCalledWith('[dxf] placement error:', expect.stringContaining('sock_over'));
    toast.mockRestore();
    consoleError.mockRestore();
  });

  it('still exports DXF when render-facts and mep-coordination both fail (503 → layer downgrade)', async () => {
    // 在 start() 之前装好：render-facts/mep 503 是本用例主题；schedule/state 同挡避免面板 render 崩
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url;
      if (urlStr.includes('/api/render-facts') && !urlStr.includes('/api/render-facts/projection')) {
        return { ok: false, status: 503 } as Response;
      }
      if (urlStr.includes('/api/mep-coordination') || urlStr.includes('/api/schedule/state')) {
        return { ok: false, status: 503 } as Response;
      }
      return defaultFetchMock(url);
    });
    const app = new App(canvas);
    await app.start();
    const toast = vi.spyOn(app as any, 'showToast').mockImplementation(() => undefined);
    mockDocument.createElement.mockClear();
    const handler = exportDxfButton.addEventListener.mock.calls.find((call) => call[0] === 'click')?.[1] as () => Promise<void>;

    await handler();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const anchor = mockDocument.createElement.mock.results.map((result: any) => result.value).find((el: any) => el.tagName === 'a');
    expect(anchor).toBeDefined();
    expect(anchor.download).toMatch(/^house-\d{8}\.dxf$/);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('DXF 已导出'));
    toast.mockRestore();
  });

  it('export uses fresh facts.electrical, not cached projectData house.electrical (codex 十二审 blocking)', async () => {
    // projectData 里是旧点位缓存；render-facts 返回新点位——导出必须用 facts
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url;
      if (urlStr.includes('/api/render-facts') && !urlStr.includes('/api/render-facts/projection')) {
        return { ok: true, json: async () => ({
          electrical: [{ id: 'e_fresh', room: 'living_room', type: 'socket', x: 1.2, z: 0.8 }],
          plumbing: [], ceiling: [],
          hvac: { plans: [{ outdoor: { id: 'outdoor_main', x: 5, z: 5 }, diagram: { anchors: [], terminals: [] } }] },
        }) } as Response;
      }
      if (urlStr.includes('/api/mep-coordination')) {
        return { ok: true, json: async () => ({ version: '1', status: 'ok', layers: {}, routes: [], junctions: [] }) } as Response;
      }
      if (urlStr.includes('/api/schedule/state')) {
        return { ok: false, status: 503 } as Response;
      }
      return defaultFetchMock(url);
    });
    const app = new App(canvas);
    await app.start();
    vi.spyOn(app as any, 'showToast').mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockDocument.createElement.mockClear();
    const handler = exportDxfButton.addEventListener.mock.calls.find((call) => call[0] === 'click')?.[1] as () => Promise<void>;

    await handler();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(createdBlobs.length).toBe(1);
    const text = await createdBlobs[0].text();
    expect(text).toContain('e_fresh');
    expect(consoleWarn).not.toHaveBeenCalledWith('[dxf] warnings:', expect.arrayContaining([expect.stringContaining('plumbing:')]));
    consoleWarn.mockRestore();
  });

  it('config-status failed facts path → facts isolated, no E-* entities, D-NOTE declares stale (codex 十六审 blocking)', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url;
      if (urlStr.includes('/api/config-status')) {
        // 电气配置重载失败：render-facts 会返回上次成功缓存，导出必须隔离不用
        return { ok: true, json: async () => ({ configs: [{ path: 'config/electrical.yaml', status: 'failed' }] }) } as Response;
      }
      if (urlStr.includes('/api/render-facts') && !urlStr.includes('/api/render-facts/projection')) {
        return { ok: true, json: async () => ({
          electrical: [{ id: 'e_stale', room: 'living_room', type: 'socket', x: 9, z: 9 }],
          plumbing: [], ceiling: [],
          hvac: { plans: [{ outdoor: { id: 'outdoor_main', x: 5, z: 5 }, diagram: { anchors: [], terminals: [] } }] },
        }) } as Response;
      }
      if (urlStr.includes('/api/mep-coordination')) {
        return { ok: true, json: async () => ({ version: '1', status: 'ok', layers: {}, routes: [], junctions: [] }) } as Response;
      }
      if (urlStr.includes('/api/schedule/state')) {
        return { ok: false, status: 503 } as Response;
      }
      return defaultFetchMock(url);
    });
    const app = new App(canvas);
    await app.start();
    vi.spyOn(app as any, 'showToast').mockImplementation(() => undefined);
    mockDocument.createElement.mockClear();
    const handler = exportDxfButton.addEventListener.mock.calls.find((call) => call[0] === 'click')?.[1] as () => Promise<void>;

    await handler();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(createdBlobs.length).toBe(1);
    const text = await createdBlobs[0].text();
    expect(text).toContain('RENDER FACTS STALE');
    expect(text).toContain('CONFIG RELOAD FAILED');
    // e_stale 来自重载失败的缓存——绝不可出现在导出里
    expect(text).not.toContain('e_stale');
  });

  it('any config reload failure → conservative isolation (overrides failed kills facts; model-geometry failed kills geometry) (codex 十八审 blocking)', async () => {
    const makeFetch = (failedPath: string) => async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url;
      if (urlStr.includes('/api/config-status')) {
        return { ok: true, json: async () => ({ configs: [{ path: failedPath, status: 'failed' }] }) } as Response;
      }
      if (urlStr.includes('/api/render-facts') && !urlStr.includes('/api/render-facts/projection')) {
        return { ok: true, json: async () => ({
          electrical: [{ id: 'e_cached', room: 'living_room', type: 'socket', x: 9, z: 9 }],
          plumbing: [], ceiling: [{ id: 'ceil_cached', room: 'living_room', type: 'drop' }],
          hvac: { plans: [{ outdoor: { id: 'outdoor_main', x: 5, z: 5 }, diagram: { anchors: [], terminals: [] } }] },
        }) } as Response;
      }
      if (urlStr.includes('/api/project')) {
        return { ok: true, json: async () => ({ topics: [], house: {
          rooms: [{ id: 'r', name: 'R', x: 0, z: 0, width: 1, depth: 1, height: 2.8 }],
          sceneElements: [{ type: 'wall', id: 'w_cached', x1: 0, z1: 0, x2: 1, z2: 0 }],
        } }) } as Response;
      }
      if (urlStr.includes('/api/schedule/state')) {
        return { ok: false, status: 503 } as Response;
      }
      return defaultFetchMock(url);
    };
    // overrides.yaml 失败 → facts loader 整包 stale：缓存点位与吊顶都不出现
    vi.spyOn(global, 'fetch').mockImplementation(makeFetch('config/render/overrides.yaml'));
    let app = new App(canvas);
    await app.start();
    mockDocument.createElement.mockClear();
    await (exportDxfButton.addEventListener.mock.calls.find((call) => call[0] === 'click')?.[1] as () => Promise<void>)();
    await new Promise((resolve) => setTimeout(resolve, 0));
    let text = await createdBlobs[createdBlobs.length - 1].text();
    expect(text).toContain('RENDER FACTS STALE');
    expect(text).not.toContain('e_cached');
    expect(text).not.toContain('ceil_cached');

    // model-geometry.yaml 失败 → 几何隔离：缓存墙体不出现，但直读磁盘的说明在
    vi.spyOn(global, 'fetch').mockImplementation(makeFetch('config/layout/model-geometry.yaml'));
    app = new App(canvas);
    await app.start();
    mockDocument.createElement.mockClear();
    await (exportDxfButton.addEventListener.mock.calls.find((call) => call[0] === 'click')?.[1] as () => Promise<void>)();
    await new Promise((resolve) => setTimeout(resolve, 0));
    text = await createdBlobs[createdBlobs.length - 1].text();
    expect(text).toContain('GEOMETRY/ROOMS/CEILINGS NOT EXPORTED');
    expect(text).not.toContain('w_cached');
  });

  // 点包 3D 高亮的聚合路径（highlightApprovalPackage）：房间/对象走 highlightObjects、
  // 点位走 highlightPoints（第三步落地后点位不再被静默丢弃）。start() 已把 projectData
  // 拉到手，这里只覆写 links 响应，验证聚合口径与「失败不打断审批流」。
  it('点包高亮聚合全部 link：房间进 highlightObjects、点位进 highlightPoints', async () => {
    const app = new App(canvas);
    await app.start();
    const objectsSpy = vi.spyOn(app['houseScene'], 'highlightObjects');
    const pointsSpy = vi.spyOn(app['houseScene'], 'highlightPoints');
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url;
      if (urlStr.includes('/api/model-package-links')) {
        return {
          ok: true,
          json: async () => ({
            links: [
              // 同一包两条 link（2026-11-02 评审 P1：曾用 find 只取第一个）——必须都聚合
              // source 用真实来源（electrical/plumbing）：select.ids 是裸 id，resolvePackageScope
              // 归一化成场景 objectId 约定（electrical:sock_kitchen_gas）——2026-11-02 浏览器
              // 实证裸 id 直接进高亮集合会全线静默不命中，这条断言就是那条回归的哨兵。
              { budget_ref: { id: 'PKG-1' }, scope: [
                { source: 'model_geometry', select: { room_ids: ['living_room'] } },
                { source: 'electrical', select: { ids: ['sock_kitchen_gas'] } },
                { source: 'plumbing', select: { ids: ['drain_kitchen'] } },
              ] },
              { budget_ref: { id: 'PKG-1' }, scope: [{ source: 'electrical', select: { ids: ['sock_living_ac'] } }] },
              // 别的包的 link：不能被算进来
              { budget_ref: { id: 'PKG-2' }, scope: [{ source: 'electrical', select: { ids: ['sock_other'] } }] },
            ],
          }),
        } as Response;
      }
      // 其余端点与 beforeEach 默认同口径（ok + 空对象），避免给后台轮询面板制造新的未处理拒绝
      return { ok: true, json: async () => ({}) } as Response;
    });

    app['highlightApprovalPackage']('PKG-1');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(objectsSpy).toHaveBeenCalledWith(['living_room'], 1200); // 第二参 2026-11-03 起为时长；页内点击默认 1200ms
    expect(pointsSpy).toHaveBeenCalledWith(['electrical:sock_kitchen_gas', 'plumbing:drain_kitchen', 'electrical:sock_living_ac'], 1200);
  });

  // 2026-11-04 issue #65：点位来源的 select.all 不再短路成「全项目范围」。真实
  // MODEL-PKG-040（水电改造）就是 electrical/plumbing select.all——旧实现解析出 0 个
  // 点位，highlightPoints 收空数组，详情面板「点位 0 个」、流程图按钮还被判「没有具体
  // 3D 范围」而禁用。这条断言钉住新口径：all → 该分类全部点位 id（带场景前缀）。
  it('点包高亮：点位来源的 select.all 展开成该分类全部点位（PKG-040 水电改造）', async () => {
    const app = new App(canvas);
    await app.start();
    // projectData 补上点位全量清单（/api/project 的 house.electrical/house.plumbing；
    // sceneElements 里没有点位，resolvePackageScope 只认这两个字段）。其余字段保留，
    // 避免动到后台轮询面板读的 budgetCategories 等。
    // 点位按真实形状补齐：id / room / type 是 ElectricalPoint、PlumbingPoint 的必填字段
    // （原夹具只写了 id，是夹具写瘦了，不是契约该放宽）。
    const loaded = app['projectData'];
    if (!loaded) throw new Error('projectData 未加载：start() 应先完成 /api/project 拉取');
    app['projectData'] = {
      ...loaded,
      house: {
        ...loaded.house,
        electrical: [
          { id: 'sock_living_ac', room: 'living_dining', type: 'socket' },
          { id: 'sock_kitchen_gas', room: 'kitchen', type: 'socket' },
        ],
        plumbing: [
          { id: 'drain_kitchen', room: 'kitchen', type: 'drain' },
          { id: 'faucet_kitchen', room: 'kitchen', type: 'faucet' },
        ],
      },
    };
    const objectsSpy = vi.spyOn(app['houseScene'], 'highlightObjects');
    const pointsSpy = vi.spyOn(app['houseScene'], 'highlightPoints');
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url;
      if (urlStr.includes('/api/model-package-links')) {
        return {
          ok: true,
          json: async () => ({
            links: [
              // 真实 config/model-package-links.yaml 的 MODEL-PKG-040 同形
              {budget_ref: {id: 'PKG-040'}, scope: [
                {source: 'electrical', select: {all: true}},
                {source: 'plumbing', select: {all: true}},
                {source: 'electrical_topology', select: {all: true}},
              ]},
            ],
          }),
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });

    app['highlightApprovalPackage']('PKG-040');
    await new Promise((resolve) => setTimeout(resolve, 0));

    // 全部水电点位（带 electrical:/plumbing: 前缀——与 batchUserData.objectId 对齐）
    expect(pointsSpy).toHaveBeenCalledWith([
      'electrical:sock_living_ac',
      'electrical:sock_kitchen_gas',
      'plumbing:drain_kitchen',
      'plumbing:faucet_kitchen',
    ], 1200);
    // 房间/对象为空照旧走 highlightObjects（空数组 = 无区域级范围），不因点位可用而造假
    expect(objectsSpy).toHaveBeenCalledWith([], 1200);
  });

  it('点包高亮：links 拉取失败时不高亮也不抛（高亮失败不打断审批流）', async () => {
    const app = new App(canvas);
    await app.start();
    const objectsSpy = vi.spyOn(app['houseScene'], 'highlightObjects');
    const pointsSpy = vi.spyOn(app['houseScene'], 'highlightPoints');
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url;
      // 只有 links 端点失败（其余同 beforeEach 默认口径），隔离验证「拉取失败不抛不高亮」
      if (urlStr.includes('/api/model-package-links')) return { ok: false, json: async () => ({}) } as Response;
      return { ok: true, json: async () => ({}) } as Response;
    });

    expect(() => app['highlightApprovalPackage']('PKG-1')).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(objectsSpy).not.toHaveBeenCalled();
    expect(pointsSpy).not.toHaveBeenCalled();
  });

  // #67：3D 反查命中多包时，选中态/详情目标不预设首个包（旧实现恒取
  // packageIds[0]，业主想看的另一个包被静默替换）。两条允许的行为二选一落地：
  // 当前选中仍命中本轮集合 → 保留（记住用户上次选择）；否则留空 + 流程图提示
  // 由业主点节点选。单包行为不变（仍落该包，维持 #49 深链口径）。
  it('3D 反查命中多包：选中态不预设首个包，保留仍命中的上次选择', async () => {
    const app = new App(canvas);
    await app.start();
    // start() 已把 projectData 拉到到手；注入 links：living_room 同属 PKG-1/PKG-2
    (app as any).projectData = {
      ...(app as any).projectData,
      modelPackageLinks: [
        {budget_ref: {id: 'PKG-1'}, scope: [{source: 'model_geometry', select: {room_ids: ['living_room']}}]},
        {budget_ref: {id: 'PKG-2'}, scope: [{source: 'model_geometry', select: {room_ids: ['living_room']}}]},
      ],
    };
    const highlightSpy = vi.spyOn(app['flowChartPanel']!, 'highlightPackages');
    // 流程图面板 refresh 需要 /api/schedule/state 的合法快照（默认 mock 返回 {}，
    // packages 缺失会在渲染期抛未处理拒绝）；其余端点沿用 beforeEach 口径。
    const baseFetch = (global.fetch as any).getMockImplementation();
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url;
      if (urlStr.includes('/api/schedule/state')) return {ok: true, json: async () => ({packages: []})} as Response;
      return baseFetch(url, init);
    });

    try {
      // 当前无选中 → 进流程图全部标出，但选中态留空（不取首个 PKG-1）
      location.hash = '';
      app['revealPackageForObject']('living_room');
      expect(app['approvalView']).toBe('flow');
      expect(highlightSpy).toHaveBeenCalledWith(['PKG-1', 'PKG-2']);
      expect(app['scheduleSelection']!.get()).toEqual({packageId: null, checkId: null});

      // 上次选择仍命中本轮集合 → 保留（记住用户上次选择，不用重新点）
      app['scheduleSelection']!.set({packageId: 'PKG-2', checkId: null});
      app['revealPackageForObject']('living_room');
      expect(app['scheduleSelection']!.get().packageId).toBe('PKG-2');

      // 上次选择不在集合里 → 清空，仍不预设首个包
      app['scheduleSelection']!.set({packageId: 'PKG-9', checkId: null});
      app['revealPackageForObject']('living_room');
      expect(app['scheduleSelection']!.get().packageId).toBeNull();
    } finally {
      location.hash = '';
    }
  });

  // #67 的单包口径守门：反查只命中一个包时维持旧行为——选中并落该包（详情/
  // 分享链接需要一个确定目标），别被多包分支的「留空」误伤。
  it('3D 反查命中单包：选中态仍落该包（#67 不误伤单包口径）', async () => {
    const app = new App(canvas);
    await app.start();
    (app as any).projectData = {
      ...(app as any).projectData,
      modelPackageLinks: [
        {budget_ref: {id: 'PKG-1'}, scope: [{source: 'model_geometry', select: {room_ids: ['living_room']}}]},
      ],
    };
    // 详情页 refresh 读 /api/schedule/state：给合法空快照，避免渲染期抛未处理拒绝
    const baseFetch = (global.fetch as any).getMockImplementation();
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url;
      if (urlStr.includes('/api/schedule/state')) return {ok: true, json: async () => ({packages: []})} as Response;
      return baseFetch(url, init);
    });

    app['revealPackageForObject']('living_room');
    expect(app['approvalView']).toBe('detail');
    expect(app['scheduleSelection']!.get().packageId).toBe('PKG-1');
    location.hash = '';
  });
});

// ── 投影索引注入必须下沉在 refreshInfrastructure（2026-11-09 Codex blocking 回归锚）──
// 失效形态：AnnotationRenderer 的 setPointWalls/setMountHosts 若只在个别重建入口调用，
// 新建 AnnotationRenderer 的入口（阶段切换 / 异常恢复）漏注入 → 索引为空 → 挂墙/挂载
// 点位解算失败 → planOf 无坐标可回落 → 当场抛错（2026-11-09 疗法①：原 (0,0) 回落分支已删，
// 标注层不再给假坐标）。点位的 x/z 声明已在第四阶段 S3 删光，该失败必现。
it('refreshInfrastructure 内部注入 pointWalls/mountHosts，任一重建入口都不会漏', () => {
  const src = readFileSync('src/App.ts', 'utf8');
  const start = src.indexOf('private async refreshInfrastructure()');
  expect(start >= 0).toBeTruthy();
  const body = src.slice(start, src.indexOf('\n  }', start));
  expect(body).toMatch(/setPointWalls\(/);
  expect(body).toMatch(/setMountHosts\(/);
});
