/**
 * 3D 场景渲染。
 * 铁律：场景元素按 /api/project 下发的声明 type 渲染（见 AGENTS.md）。
 * 本文件禁止出现任何"根据位置猜这是什么"的逻辑。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type {
  SceneApi,
  RoomObject,
  CameraState,
  ElectricalMarker,
  CurrentScheme,
  TopicSelection,
  SceneElement,
  CurtainPoint,
  FurnishingsYaml,
  ProjectRenderFactsProjection,
  VrfOutdoorUnit,
  ElectricalPoint,
  WallSide,
  CurtainPresentationState,
  CurtainState,
  PlumbingPoint,
} from '@shared/types';
import { CameraAnimator } from '../scene/CameraAnimator.js';
import { TopDownView } from '../scene/TopDownView.js';
import { pickRoomIdFromHits } from '../scene/spawn-utils.js';
import { scalePlaneUvToMeters } from './uv-utils.js';

import { TopicRegistry } from '../topics/TopicRegistry.js';
import type { HoverTarget } from '../ui/HoverTooltip.js';
import { TextureManager } from './TextureManager.js';
import type { MaterialAppearance } from './TextureFactory.js';
import { EnvironmentManager } from './EnvironmentManager.js';
import { parseSceneInput } from '@shared/render/scene-input';
import { HvacDiagramRenderer } from './HvacDiagramRenderer.js';
import { MepCoordinationRenderer } from './MepCoordinationRenderer.js';
import type { MepCoordination } from '@shared/mep-hvac-coordination-schema';
import { checkHvacExport } from './hvac-export-check.js';
import { BrowserSceneDecorations } from './BrowserSceneDecorations.js';
import { BrowserSceneMaterials } from './BrowserSceneMaterials.js';
import { buildScene, refreshSlidingDoorGroup, type CurtainBuildEntry, type SceneMaterialProvider } from '@shared/render/SceneBuilder';
import { buildHvacGeometry, type HvacEntityIndex } from '@shared/render/HvacGeometryBuilder';
import { buildHvacBuilderSources, type HvacBuilderSources } from '@shared/render/HvacBuilder';
import { buildInfrastructure, type InfrastructureWallSegment } from '@shared/render/InfrastructureBuilder';
import { computeLayoutBounds, DEFAULT_LAYOUT_BOUNDS, type LayoutBounds } from '@shared/render/layout-bounds';
import type { WallSegment, ResolvedRoom, ResolvedOpening } from '@shared/types';

export const GLASS_THICKNESS = 0.024;
const DEFAULT_FLOOR = '#e8e0d5';
const WALL_THICKNESS = 0.12;

interface CurtainRegistryEntry {
  id: string;
  roomId?: string;
  kind: 'sheer_blackout' | 'blinds';
  state: CurtainState;
  sheer?: { deployed: THREE.Mesh; gathered: THREE.Mesh[] };
  blackout?: { deployed: THREE.Mesh; gathered: THREE.Mesh[] };
  blinds?: { deployed: THREE.Mesh; gathered: THREE.Mesh };
}

interface ProjectData {
  house: {
    rooms: Array<{ id: string; name: string; x: number; z: number; width: number; depth: number; height: number; type: string; wall_finish?: string; wallOpenings?: ResolvedOpening[] }>;
    platform?: { id: string; name: string; x: number; z: number; width: number; depth: number; height: number };
    ceilingZones?: import('@shared/types').CeilingZone[];
    furnishings?: FurnishingsYaml;
    electrical?: ElectricalMarker[];
    sceneElements?: SceneElement[];
  };
  renderFactsProjection?: ProjectRenderFactsProjection;
  renderFactsSources?: HvacBuilderSources;
  topics: Array<{ id: string; name: string; perRoom: boolean; options: unknown[] }>;
  budgetCategories: unknown[];
}

export class HouseScene implements SceneApi {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  rooms: Record<string, RoomObject> = {};
  private platform?: ProjectData['house']['platform'];
  private canvas: HTMLCanvasElement;
  private topicGroup = new THREE.Group();
  private readonly exportRoot = new THREE.Group();
  private readonly decorations: BrowserSceneDecorations;
  private readonly materials = new BrowserSceneMaterials();
  private readonly viewOnlyRoot: THREE.Group;
  private readonly builderViewRoot = new THREE.Group();
  private floorMeshes: THREE.Mesh[] = [];
  private wallMeshes: THREE.Mesh[] = [];
  private ceilingMeshes: THREE.Mesh[] = [];
  private curtainRegistry = new Map<string, CurtainRegistryEntry>();
  private curtainPresentationState: CurtainPresentationState = { default: 'open', roomOverrides: {}, updatedAt: '' };
  private glassMeshes: THREE.Mesh[] = [];
  private furnitureMeshes: THREE.Group[] = [];
  private countertopMeshes: THREE.Mesh[] = [];
  private electricalMeshes: THREE.Group[] = [];
  private doorMeshes: THREE.Mesh[] = [];
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private lastPointer = new THREE.Vector2(0, 0);
  cameraAnimator: CameraAnimator;
  topDownView: TopDownView;
  private topicRegistry: TopicRegistry;
  private onClickCallback?: (target: HoverTarget) => void;
  private onRenderRequested?: () => void;
  private boundOnWindowResize: () => void;
  private _mode: 'orbit' | 'first-person' | 'top-down' = 'orbit';
  private compareSchemeData?: CurrentScheme;
  private roomMeta = new Map<string, { wall_finish?: string; wallOpenings?: ResolvedOpening[] }>();
  private textureManager = new TextureManager();
  private envManager: EnvironmentManager;
  private topDownLayoutBounds: LayoutBounds = DEFAULT_LAYOUT_BOUNDS;
  private readonly ORBIT_POSITION = new THREE.Vector3(7.4, 14, 19.2);
  private readonly ORBIT_TARGET = new THREE.Vector3(7.4, 0, 3.65);
  private hvacRenderer: HvacDiagramRenderer;
  private mepRenderer: MepCoordinationRenderer;
  private hvacExpectedExportIds: string[] = [];
  private hvacProjection?: ProjectRenderFactsProjection;
  private hvacEntityIndex: HvacEntityIndex = { equipment: new Map(), terminals: new Map(), all: new Map() };
  private wallSegmentIndex = new Map<string, Array<{ x1: number; z1: number; x2: number; z2: number }>>();
  private readyState: 'loading' | 'ready' | 'failed' = 'loading';
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: unknown) => void;

  constructor(canvas: HTMLCanvasElement) {
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#1a1a20');

    this.camera = new THREE.PerspectiveCamera(
      55,
      window.innerWidth / window.innerHeight,
      0.1,
      200
    );
    this.camera.position.copy(this.ORBIT_POSITION);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.copy(this.ORBIT_TARGET);
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 60;

    this.cameraAnimator = new CameraAnimator(this.camera, this.controls);
    this.topDownView = new TopDownView(this.cameraAnimator, this.camera, {
      bounds: this.topDownLayoutBounds,
      orbitPosition: this.ORBIT_POSITION,
      orbitTarget: this.ORBIT_TARGET,
      topDownHeight: 28,
      durationMs: 400,
    });
    this.topDownView.setOnChange((enabled) => this.onTopDownChange(enabled));
    this.topicRegistry = new TopicRegistry(this);

    this.exportRoot.name = 'HOUSE_EXPORT';
    this.scene.add(this.exportRoot);
    this.decorations = new BrowserSceneDecorations(this.scene);
    this.viewOnlyRoot = this.decorations.root;
    this.builderViewRoot.name = 'HOUSE_VIEW_ONLY_DYNAMIC';
    this.viewOnlyRoot.add(this.builderViewRoot);
    this.envManager = new EnvironmentManager(this.scene, this.renderer);
    this.hvacRenderer = new HvacDiagramRenderer(this.scene);
    this.mepRenderer = new MepCoordinationRenderer(this.scene);
    this.hvacRenderer.attach(this.exportRoot, this.viewOnlyRoot);
    this.mepRenderer.attach(this.viewOnlyRoot);
    this.setupLights();
    this.scene.add(this.topicGroup);

    this.controls.addEventListener('start', () => {
      this.cameraAnimator.interrupt();
      this.requestRender();
    });
    this.controls.addEventListener('change', () => this.requestRender());

    this.boundOnWindowResize = () => this.onResize();
    window.addEventListener('resize', this.boundOnWindowResize);
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => {
      if (document.pointerLockElement) return;
      this.lastPointer.set(
        (e.clientX / window.innerWidth) * 2 - 1,
        -(e.clientY / window.innerHeight) * 2 + 1,
      );
    });
  }

  getScene(): THREE.Scene {
    return this.scene;
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  getExportRoot(): THREE.Group {
    return this.exportRoot;
  }

  getViewOnlyRoot(): THREE.Group {
    return this.viewOnlyRoot;
  }

  private clearRoot(root: THREE.Group, predicate?: (object: THREE.Object3D) => boolean): void {
    for (const child of [...root.children]) {
      if (!predicate || predicate(child)) root.remove(child);
    }
  }

  private addExportObject(object: THREE.Object3D): void {
    this.exportRoot.add(object);
  }

  setOnObjectClick(cb: (target: HoverTarget) => void) {
    this.onClickCallback = cb;
  }

  setOnRenderRequested(cb: () => void): void {
    this.onRenderRequested = cb;
  }

  private requestRender(): void {
    this.onRenderRequested?.();
  }

  isTopDown(): boolean {
    return this.topDownView?.isEnabled() ?? false;
  }

  setTopDown(enabled: boolean): void {
    if (!this.topDownView) return;
    if (enabled) {
      this.topDownView.enable();
    } else {
      this.topDownView.disable();
    }
  }

  toggleTopDown(): void {
    this.topDownView?.toggle();
  }

  isReady(): boolean {
    return this.readyState === 'ready';
  }

  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  async captureFloorPlan(options: { includeFurniture?: boolean } = {}): Promise<string> {
    await this.whenReady();
    let renderTarget: THREE.WebGLRenderTarget | null = null;
    const prevTopicVisible = this.topicGroup.visible;
    const prevExportVisible = this.exportRoot.visible;
    const prevViewOnlyVisible = this.viewOnlyRoot.visible;
    const prevGridOpacity = this.decorations.getGridOpacity();
    const prevFurnitureVisible = this.furnitureMeshes.map((m) => m.visible);
    const prevElectricalVisible = this.electricalMeshes.map((m) => m.visible);
    const prevCeilingVisible = this.ceilingMeshes.map((m) => m.visible);
    const prevShadowMapEnabled = this.renderer.shadowMap.enabled;

    this.topicGroup.visible = false;
    this.exportRoot.visible = true;
    this.viewOnlyRoot.visible = false;
    this.decorations.setGridOpacity(0);
    if (!options.includeFurniture) {
      for (const mesh of this.furnitureMeshes) {
        mesh.visible = false;
      }
    }
    for (const mesh of this.electricalMeshes) {
      mesh.visible = false;
    }
    for (const mesh of this.ceilingMeshes) {
      mesh.visible = false;
    }
    this.renderer.shadowMap.enabled = false;

    try {
      const { minX, maxX, minZ, maxZ } = this.topDownLayoutBounds;
      const width = maxX - minX;
      const depth = maxZ - minZ;
      const size = 2048;
      const aspect = width / depth;
      const renderWidth = Math.round(size * Math.max(aspect, 1));
      const renderHeight = Math.round(size / Math.min(aspect, 1));

      const orthoCam = new THREE.OrthographicCamera(
        width / -2, width / 2,
        depth / 2, depth / -2,
        0.1, 200
      );
      const centerX = (minX + maxX) / 2;
      const centerZ = (minZ + maxZ) / 2;
      orthoCam.position.set(centerX, 50, centerZ);
      orthoCam.up.set(0, 0, -1);
      orthoCam.lookAt(centerX, 0, centerZ);
      orthoCam.updateProjectionMatrix();

      renderTarget = new THREE.WebGLRenderTarget(renderWidth, renderHeight);
      this.renderer.setRenderTarget(renderTarget);
      // 渲染 scene 而非孤立 exportRoot：灯光/scene.environment 挂在 scene 上，
      // 只渲染 exportRoot 会丢光导致全黑。capture 前已隐藏 viewOnlyRoot/topicGroup，
      // 因此画面仍只包含 HOUSE_EXPORT 内容。
      this.renderer.render(this.scene, orthoCam);

      const buffer = new Uint8Array(renderWidth * renderHeight * 4);
      this.renderer.readRenderTargetPixels(renderTarget, 0, 0, renderWidth, renderHeight, buffer);
      return this.rgbaToPng(buffer, renderWidth, renderHeight);
    } finally {
      this.topicGroup.visible = prevTopicVisible;
      this.exportRoot.visible = prevExportVisible;
      this.viewOnlyRoot.visible = prevViewOnlyVisible;
      this.decorations.setGridOpacity(prevGridOpacity);
      for (let i = 0; i < this.furnitureMeshes.length; i++) {
        this.furnitureMeshes[i].visible = prevFurnitureVisible[i];
      }
      for (let i = 0; i < this.electricalMeshes.length; i++) {
        this.electricalMeshes[i].visible = prevElectricalVisible[i];
      }
      for (let i = 0; i < this.ceilingMeshes.length; i++) {
        this.ceilingMeshes[i].visible = prevCeilingVisible[i];
      }
      this.renderer.shadowMap.enabled = prevShadowMapEnabled;
      this.renderer.setRenderTarget(null);
      if (renderTarget) {
        renderTarget.dispose();
      }
    }
  }

  private rgbaToPng(rgba: Uint8Array, width: number, height: number): string {
    const flipped = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      const srcRow = (height - 1 - y) * width * 4;
      const dstRow = y * width * 4;
      flipped.set(rgba.subarray(srcRow, srcRow + width * 4), dstRow);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const imageData = new ImageData(new Uint8ClampedArray(flipped), width, height);
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  }

  private onTopDownChange(enabled: boolean): void {
    this.topicGroup.visible = !enabled;
    this.decorations.setGridOpacity(enabled ? 0.15 : 1.0);
    if (enabled) {
      this.controls.maxPolarAngle = 0.1;
    } else {
      this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
    }
    this.requestRender();
  }

  async buildFromCatalog(projectData: ProjectData): Promise<void> {
    this.readyState = 'loading';
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    try {
    this.clearRoot(this.exportRoot);
    this.clearRoot(this.builderViewRoot);
    this.clearRoot(this.viewOnlyRoot, (object) => object.userData.type === 'platform');
    this.decorations.clearDynamic();
    this.rooms = {};
    this.platform = undefined;
    this.floorMeshes = [];
    this.wallMeshes = [];
    this.ceilingMeshes = [];
    this.curtainRegistry.clear();
    this.glassMeshes = [];
    this.furnitureMeshes = [];
    this.countertopMeshes = [];
    this.electricalMeshes = [];
    this.doorMeshes = [];
    this.slidingDoorGroups.clear();
    this.wallSegmentIndex.clear();
    this.roomMeta.clear();

    this.clearRoot(this.topicGroup);
    if (this.topicGroup.parent !== this.scene) this.scene.add(this.topicGroup);

    const input = parseSceneInput({
      rooms: projectData.house.rooms,
      platform: projectData.house.platform,
      elements: projectData.house.sceneElements,
      ceilingZones: projectData.house.ceilingZones,
      furnishings: projectData.house.furnishings,
    });
    const materialProvider: SceneMaterialProvider = {
      curtain: ({ layer }) => layer === 'sheer' ? this.materials.makeSheerMaterial() : layer === 'blackout' ? this.materials.makeBlackoutMaterial() : this.materials.makeBlindMaterial(),
      curtainRun: () => this.materials.makeLowEGlassMaterial(),
      showerScreen: () => this.materials.makeShowerScreenMaterial(),
      slidingDoorGlass: ({ paneWidth }) => this.materials.makeFlutedGlassMaterial(paneWidth),
      hingedGlassDoorFrame: () => new THREE.MeshStandardMaterial({ color: 0x202328, metalness: 0.7, roughness: 0.3 }),
      hingedGlassDoorGlass: () => this.materials.makeShowerScreenMaterial(),
    };
    const result = buildScene({
      ...input,
      options: {
        materialProvider,
        curtainRooms: input.rooms,
        hvac: projectData.renderFactsProjection ? { projection: projectData.renderFactsProjection, sources: projectData.renderFactsSources ?? buildHvacBuilderSources({ projection: projectData.renderFactsProjection }) } : undefined,
      },
    });
    for (const child of [...result.exportRoot.children]) this.exportRoot.add(child);
    for (const child of [...result.viewOnlyRoot.children]) {
      if (child.userData.type === 'platform') this.viewOnlyRoot.add(child);
      else this.builderViewRoot.add(child);
    }
    const index = result.index;
    this.rooms = index.rooms;
    this.floorMeshes = index.floorMeshes;
    this.wallMeshes = index.wallMeshes;
    this.ceilingMeshes = index.ceilingMeshes;
    this.furnitureMeshes = index.furnitureMeshes;
    this.countertopMeshes = index.countertopMeshes;
    this.glassMeshes = index.glassMeshes;
    this.doorMeshes = index.doorMeshes;
    this.slidingDoorGroups = index.slidingDoorGroups;
    this.wallSegmentIndex = index.wallSegments;
    this.hvacEntityIndex = index.hvac;
    this.hvacProjection = projectData.renderFactsProjection;
    this.hvacExpectedExportIds = [...this.hvacEntityIndex.all.keys()];
    for (const [id, curtain] of index.curtains) this.registerSharedCurtain(curtain);
    for (const room of projectData.house.rooms) {
      this.roomMeta.set(room.id, { wall_finish: room.wall_finish, wallOpenings: room.wallOpenings });
    }
    if (projectData.house.platform) this.platform = projectData.house.platform;

    this.topDownLayoutBounds = computeLayoutBounds({
      rooms: projectData.house.rooms,
      platform: projectData.house.platform,
      elements: projectData.house.sceneElements,
      wallThickness: WALL_THICKNESS,
      glassThickness: GLASS_THICKNESS,
      defaultBounds: DEFAULT_LAYOUT_BOUNDS,
    });
    this.topDownView.updateBounds(this.topDownLayoutBounds);

    this.hvacRenderer.attach(this.exportRoot, this.viewOnlyRoot);
    this.mepRenderer.attach(this.viewOnlyRoot);
    this.textureManager.setMeshes(this.floorMeshes, this.wallMeshes, this.ceilingMeshes);
    // 重建后按当前模式恢复天花可见性（新 ceiling mesh 默认 visible=true，
    // 否则轨道/俯视模式下天花板会盖住房间，直到下一次模式切换才被隐藏）
    this.setCeilingVisible(this._mode === 'first-person');
    const materials = HouseScene.extractMaterials(projectData.topics);
    this.textureManager.loadMaterials(materials);
    this.textureManager.preload();
    this.readyState = 'ready';
    this.resolveReady();
    } catch (error) {
      this.readyState = 'failed';
      this.rejectReady(error);
      throw error;
    }
  }

  private static extractMaterials(topics: ProjectData['topics']): Array<{ id: string; appearance: MaterialAppearance }> {
    const seen = new Set<string>();
    const materials: Array<{ id: string; appearance: MaterialAppearance }> = [];
    for (const topic of topics) {
      if (!topic.options) continue;
      for (const option of topic.options as Array<{ id: string; data?: { appearance?: MaterialAppearance } }>) {
        const app = option.data?.appearance;
        if (!app) continue;
        const key = JSON.stringify(app);
        if (seen.has(key)) continue;
        seen.add(key);
        materials.push({ id: option.id, appearance: app });
      }
    }
    return materials;
  }

  setSelection(topic: string, optionId: string, selection?: TopicSelection): void {
    const topicImpl = this.topicRegistry.get(topic);
    if (topicImpl) {
      topicImpl.apply(this, optionId, selection);
    }
  }

  rebuildHvacProjection(projection: ProjectRenderFactsProjection | undefined, sources: HvacBuilderSources = buildHvacBuilderSources({ projection })): void {
    this.clearRoot(this.exportRoot, (object) => object.name === 'HVAC_CONFIRMED_ENTITIES');
    this.hvacEntityIndex = buildHvacGeometry(this.exportRoot, projection, sources).index;
    this.hvacProjection = projection;
    this.hvacExpectedExportIds = [...this.hvacEntityIndex.all.keys()];
  }

  loadHvacProjection(projection: ProjectRenderFactsProjection, sources: HvacBuilderSources = buildHvacBuilderSources({ projection })): void {
    this.hvacRenderer.clear();
    if (projection.hvac?.status !== 'implemented') {
      this.hvacProjection = projection;
      this.hvacExpectedExportIds = [];
      this.hvacRenderer.setCoordinationVisible(false);
      return;
    }
    if (!this.hvacProjection || this.hvacProjection !== projection) this.rebuildHvacProjection(projection, sources);
    const { planId, diagram } = projection.hvac;
    this.hvacRenderer.render(planId, diagram, { ceiling: sources.ceiling ?? [], electrical: sources.electrical ?? [], outdoor: sources.outdoor ?? [] });
    this.hvacRenderer.setCoordinationVisible(false);
  }

  getHvacExportStatus(): { required: boolean; ready: boolean; expected: string[]; included: string[]; missing: string[]; terminalCount: number } {
    const expected = [...this.hvacExpectedExportIds];
    const checked = checkHvacExport(this.exportRoot, expected);
    return {
      required: expected.length > 0,
      ready: checked.missing.length === 0,
      expected,
      included: checked.included,
      missing: checked.missing,
      terminalCount: checked.terminalCount,
    };
  }

  clearHvacProjection(): void {
    this.hvacRenderer.clear();
    this.clearRoot(this.exportRoot, (object) => object.name === 'HVAC_CONFIRMED_ENTITIES');
    this.hvacEntityIndex = { equipment: new Map(), terminals: new Map(), all: new Map() };
    this.hvacProjection = undefined;
    this.hvacExpectedExportIds = [];
  }

  setHvacCoordinationVisible(visible: boolean): void {
    this.hvacRenderer.setCoordinationVisible(visible);
    this.requestRender();
  }

  loadMepCoordination(config: MepCoordination, sources: import('@shared/mep-hvac-coordination-schema').MepEndpointSources): void {
    this.mepRenderer.attach(this.viewOnlyRoot);
    this.mepRenderer.render(config, sources);
    this.mepRenderer.setVisible(false);
  }

  getMepRenderReport(): import('./MepCoordinationRenderer.js').MepRenderReport {
    return this.mepRenderer.getRenderReport();
  }

  setMepCoordinationVisible(visible: boolean): void {
    this.mepRenderer.setVisible(visible);
    this.requestRender();
  }

  setMepLayerVisible(layer: import('@shared/mep-hvac-coordination-schema').MepRoute['layer'], visible: boolean): void {
    this.mepRenderer.setLayerVisible(layer, visible);
    this.requestRender();
  }

  setMepBendsVisible(visible: boolean): void {
    this.mepRenderer.setBendsVisible(visible);
    this.requestRender();
  }

  private setupLights() {
    this.envManager.setup();
  }

  private registerSharedCurtain(shared: CurtainBuildEntry): void {
    const variants = shared.variants;
    const entry: CurtainRegistryEntry = { id: shared.id, roomId: shared.roomId, kind: shared.kind, state: 'open' };
    if (shared.kind === 'sheer_blackout' && variants.sheer && variants.blackout) {
      entry.sheer = variants.sheer; entry.blackout = variants.blackout;
    } else if (variants.blinds) entry.blinds = variants.blinds;
    this.curtainRegistry.set(shared.id, entry);
    this.setCurtainState(shared.id, this.effectiveCurtainState(shared.roomId));
  }

  private effectiveCurtainState(roomId?: string): CurtainState {
    return roomId ? (this.curtainPresentationState.roomOverrides[roomId] ?? this.curtainPresentationState.default) : this.curtainPresentationState.default;
  }

  setCurtainState(curtainId: string, state: CurtainState): void {
    const entry = this.curtainRegistry.get(curtainId);
    if (!entry) return;
    const normalized = entry.kind === 'blinds' && state === 'blackout' ? 'privacy' : state;
    entry.state = normalized;
    const setVariant = (mesh: THREE.Mesh, visible: boolean) => {
      mesh.visible = visible;
      mesh.userData.state = normalized;
    };
    if (entry.kind === 'sheer_blackout' && entry.sheer && entry.blackout) {
      setVariant(entry.sheer.deployed, normalized !== 'open');
      entry.sheer.gathered.forEach((mesh) => setVariant(mesh, false));
      setVariant(entry.blackout.deployed, normalized === 'blackout');
      entry.blackout.gathered.forEach((mesh) => setVariant(mesh, normalized === 'privacy'));
    } else if (entry.blinds) {
      setVariant(entry.blinds.deployed, normalized === 'privacy');
      setVariant(entry.blinds.gathered, false);
    }
    this.requestRender();
  }

  setRoomCurtainState(roomId: string, state: CurtainState): void {
    for (const entry of this.curtainRegistry.values()) {
      if (entry.roomId === roomId) this.setCurtainState(entry.id, state);
    }
  }

  setAllCurtainStates(state: CurtainState): void {
    for (const entry of this.curtainRegistry.values()) this.setCurtainState(entry.id, state);
  }

  applyCurtainPresentationState(state: CurtainPresentationState): void {
    this.curtainPresentationState = structuredClone(state);
    for (const entry of this.curtainRegistry.values()) {
      this.setCurtainState(entry.id, this.effectiveCurtainState(entry.roomId));
    }
  }

  getCurtainState(curtainId: string): CurtainState | undefined {
    return this.curtainRegistry.get(curtainId)?.state;
  }

  setCurtainMaterial(appearance: { color?: string; opacity?: number }): void {
    const color = appearance.color ? new THREE.Color(appearance.color) : undefined;
    const meshes: THREE.Mesh[] = [];
    for (const entry of this.curtainRegistry.values()) {
      if (entry.sheer) meshes.push(entry.sheer.deployed, ...entry.sheer.gathered);
      if (entry.blackout) meshes.push(entry.blackout.deployed, ...entry.blackout.gathered);
    }
    for (const mesh of meshes) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (color) mat.color = color;
      if (appearance.opacity !== undefined) {
        mat.transparent = true;
        mat.opacity = appearance.opacity;
      }
      mat.needsUpdate = true;
    }
  }

  private slidingDoorGroups = new Map<string, THREE.Group>();

  refreshSlidingDoor(el: Extract<SceneElement, { type: 'sliding_door_run' }>): void {
    const group = this.slidingDoorGroups.get(el.id);
    if (!group) return;
    refreshSlidingDoorGroup(this.exportRoot, group, el, {
      slidingDoorGlass: ({ paneWidth }) => this.materials.makeFlutedGlassMaterial(paneWidth),
    });
    this.requestRender();
  }

  placeInfrastructureFixtures(electrical: ElectricalPoint[], plumbing: PlumbingPoint[]): void {
    this.decorations.clearMarkers();
    const result = buildInfrastructure({
      electrical,
      plumbing,
      wallSegments: this.wallSegmentIndex as ReadonlyMap<string, InfrastructureWallSegment[]>,
    });
    this.electricalMeshes = result.electrical;
    for (const model of result.objects) this.decorations.addMarker(model);
  }

  clearTopicObjects(topicId: string) {
    const toRemove: THREE.Object3D[] = [];
    this.topicGroup.traverse((child) => {
      if (child.userData?.topic === topicId && child.parent === this.topicGroup) {
        toRemove.push(child);
      }
    });
    for (const obj of toRemove) {
      this.topicGroup.remove(obj);
    }
  }

  setCompareScheme(scheme: CurrentScheme): void {
    this.compareSchemeData = scheme;
  }

  applyCompareScheme(): void {
    if (!this.compareSchemeData) return;
    // DEC-041：对比路径与主路径同走 setSelection → topic.apply，分房覆盖（roomOverrides）两处一致生效
    for (const [topicId, selection] of Object.entries(this.compareSchemeData.selections)) {
      const effective = selection.default;
      if (effective) {
        this.setSelection(topicId, effective, selection);
      }
    }
  }

  setCountertopMaterial(appearance: MaterialAppearance): void {
    for (const mesh of this.countertopMeshes) {
      const material = mesh.material;
      if (material instanceof THREE.MeshStandardMaterial) {
        material.color.set(appearance.color);
        material.needsUpdate = true;
      }
    }
  }

  addObject(topicId: string, objectId: string, obj: unknown) {
    const threeObj = obj as THREE.Object3D;
    threeObj.userData = { ...threeObj.userData, topic: topicId, objectId };
    this.topicGroup.add(threeObj);
  }

  getRoom(roomId: string): RoomObject | undefined {
    return this.rooms[roomId];
  }

  getPlatformRoomId(): string | undefined {
    return this.platform?.id;
  }

  getObjectPosition(objectId: string): { x: number; z: number } | null {
    let result: { x: number; z: number } | null = null;
    this.scene.traverse((obj) => {
      if (!result && obj.userData?.objectId === objectId) {
        result = { x: obj.position.x, z: obj.position.z };
      }
    });
    return result;
  }

  getFurnitureMeshes(): THREE.Group[] {
    return this.furnitureMeshes;
  }

  getEnvironmentManager(): EnvironmentManager {
    return this.envManager;
  }

  getFloorMeshes(): THREE.Mesh[] {
    return this.floorMeshes;
  }

  getFurniturePosition(objectId: string): { x: number; z: number; rotation: number } | null {
    for (const mesh of this.furnitureMeshes) {
      if (mesh.userData.objectId === objectId) {
        return {
          x: mesh.position.x,
          z: mesh.position.z,
          rotation: mesh.rotation.y * 180 / Math.PI,
        };
      }
    }
    return null;
  }

  setFloorColor(color: string) {
    for (const mesh of this.floorMeshes) {
      (mesh.material as THREE.MeshStandardMaterial).color.set(color);
    }
  }

  setWallColor(roomIds: string[], color: string) {
    const set = new Set(roomIds);
    for (const mesh of this.wallMeshes) {
      if (set.has(mesh.userData.roomId as string)) {
        (mesh.material as THREE.MeshStandardMaterial).color.set(color);
      }
    }
  }

  setPaintColor(color: string) {
    for (const mesh of this.wallMeshes) {
      const roomId = mesh.userData.roomId as string;
      const room = this.roomMeta.get(roomId);
      if (room?.wall_finish === 'tile') continue;
      (mesh.material as THREE.MeshStandardMaterial).color.set(color);
    }
  }

  getRoomIdsWithWallFinish(finish: 'paint' | 'tile'): string[] {
    const ids: string[] = [];
    for (const [id, meta] of this.roomMeta.entries()) {
      if (meta.wall_finish === finish) ids.push(id);
    }
    return ids;
  }

  setFloorMaterial(roomId: string, appearance: MaterialAppearance): void {
    this.textureManager.applyToRoom(roomId, appearance, 'floor');
  }

  setWallMaterial(roomId: string, appearance: MaterialAppearance): void {
    this.textureManager.applyToRoom(roomId, appearance, 'wall');
  }

  // DEC-041：天花跟随所在房间墙漆（点击天花=选该房间漆面，消除旧映射误导）
  setCeilingMaterial(roomId: string, appearance: MaterialAppearance): void {
    this.textureManager.applyToRoom(roomId, appearance, 'ceiling');
  }

  // DEC-041：floor_region 换材——default 兜底，带 follow 的过渡带跟随目标房间有效地材
  applyFloorRegionMaterials(
    defaultAppearance: MaterialAppearance,
    followAppearance?: (roomId: string) => MaterialAppearance | null
  ): void {
    this.textureManager.applyToFloorRegions(defaultAppearance, followAppearance);
  }

  setDoorMaterial(_roomId: string, appearance: { type: string; color: string; scale?: number }): void {
    for (const mesh of this.doorMeshes) {
      (mesh.material as THREE.MeshStandardMaterial).color.set(appearance.color);
    }
  }

  getAllRoomIds(): string[] {
    const ids = new Set<string>();
    for (const mesh of this.floorMeshes) {
      ids.add(mesh.userData.roomId as string);
    }
    return [...ids];
  }

  highlightObject(objectId: string) {
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
      if (!mat || !mesh.userData) return;
      if (mesh.userData.objectId === objectId || mesh.userData.roomId === objectId) {
        const original = mat.emissive?.clone() ?? new THREE.Color(0x000000);
        mat.emissive.set(0xffaa00);
        setTimeout(() => {
          mat.emissive.copy(original);
        }, 1200);
      }
    });
  }

  setCameraTarget(targetId: string) {
    const r = this.rooms[targetId];
    if (r) {
      const target = new THREE.Vector3(r.x, 0, r.z);
      const camPos = new THREE.Vector3(r.x + 6, 8, r.z + 8);
      this.cameraAnimator.animateTo(camPos, target, 500);
    } else {
      let found = false;
      this.scene.traverse((obj) => {
        if (!found && obj.userData?.objectId === targetId) {
          const pos = new THREE.Vector3();
          (obj as THREE.Object3D).getWorldPosition(pos);
          const camPos = new THREE.Vector3(pos.x + 4, pos.y + 4, pos.z + 4);
          this.cameraAnimator.animateTo(camPos, pos, 500);
          found = true;
        }
      });
      if (!found) {
        this.topicGroup.traverse((obj) => {
          if (!found && obj.userData?.objectId === targetId) {
            const pos = new THREE.Vector3();
            obj.getWorldPosition(pos);
            const camPos = new THREE.Vector3(pos.x + 4, pos.y + 4, pos.z + 4);
            this.cameraAnimator.animateTo(camPos, pos, 500);
            found = true;
          }
        });
      }
    }
    this.requestRender();
  }

  getCameraState(): CameraState {
    return {
      position: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
      target: { x: this.controls.target.x, y: this.controls.target.y, z: this.controls.target.z },
    };
  }

  get mode(): 'orbit' | 'first-person' | 'top-down' {
    return this._mode;
  }

  setMode(mode: 'orbit' | 'first-person' | 'top-down') {
    this._mode = mode;
    this.controls.enabled = mode === 'orbit';
    // 天花板：第一人称显示（沉浸），轨道/俯视隐藏（保持 dollhouse 俯视通透）
    this.setCeilingVisible(mode === 'first-person');
  }

  setCeilingVisible(visible: boolean): void {
    for (const mesh of this.ceilingMeshes) {
      mesh.visible = visible;
    }
  }

  private objectDisplayName(objectId: string, type: string, roomId?: string, fixtureType?: string, wallSide?: WallSide): string {
    const room = roomId ? this.rooms[roomId] : undefined;
    const roomName = room?.name ?? '';
    const typeLabel: Record<string, string> = {
      floor: '地面',
      wall: '墙面',
      ceiling: '顶面',
      ceiling_zone_solid: '吊顶',
      door: '门',
      window: '窗',
      hvac_indoor: '空调内机',
      hvac_outdoor: '空调外机',
      platform: '平台',
      shower_screen: '淋浴玻璃隔断',
      hvac_condensate_candidate: 'HVAC · 冷凝水候选接入点 · 待确认',
    };
    if (type === 'hvac_condensate_candidate') return `${typeLabel[type]} + ${objectId.slice(objectId.lastIndexOf(':') + 1)}`;
    const dirLabel: Record<string, string> = {
      north: '北',
      south: '南',
      west: '西',
      east: '东',
    };

    if (type === 'platform' && this.platform) {
      return this.platform.name;
    }

    const fixtureLabel: Record<string, string> = {
      socket: '插座',
      switch: '开关',
      switch_2way: '开关',
      network: '网口',
      usb: 'USB',
      floor_socket: '地插',
      strong_panel: '强电箱',
      weak_panel: '弱电箱',
      faucet: '水龙头',
      faucet_outdoor: '户外水龙头',
      toilet: '马桶',
      shower: '淋浴',
      drain: '地漏',
      washer: '洗衣机给排水',
      ceiling_light: '吸顶灯',
      pendant: '吊灯',
      dome: '吸顶灯',
      downlight: '筒灯',
      track_light: '轨道灯',
      wall_lamp: '壁灯',
      led_strip: '灯带',
    };
    if (objectId.startsWith('electrical:')) {
      const label = fixtureLabel[fixtureType ?? ''] ?? '电气';
      const sideLabel = wallSide ? ` · ${roomId === 'kitchen' && wallSide === 'west' ? '厨房侧' : roomId === 'entry_garden' && wallSide === 'east' ? '入户花园侧' : wallSide === 'east' ? '东侧' : wallSide === 'west' ? '西侧' : wallSide === 'north' ? '北侧' : '南侧'}` : '';
      return roomName ? `${roomName} · ${label}${sideLabel}` : `${label}${sideLabel}`;
    }
    if (objectId.startsWith('plumbing:')) {
      const pointName = objectId.slice('plumbing:'.length);
      const label = fixtureLabel[fixtureType ?? ''] ?? '给排水';
      const sideLabel = wallSide ? ` · ${roomId === 'kitchen' && wallSide === 'west' ? '厨房侧' : roomId === 'entry_garden' && wallSide === 'east' ? '入户花园侧' : wallSide === 'east' ? '东侧' : wallSide === 'west' ? '西侧' : wallSide === 'north' ? '北侧' : '南侧'}` : '';
      return roomName ? `${roomName} · ${label} · ${pointName}${sideLabel}` : `${label} · ${pointName}${sideLabel}`;
    }
    if (type === 'wall' && objectId.startsWith('wall:')) {
      const parts = objectId.split(':');
      const dir = parts[2];
      const direction = dir && dirLabel[dir];
      if (direction) {
        return roomName ? `${roomName}${direction}墙` : objectId;
      }
    }

    if (type === 'furniture' && objectId.startsWith('furniture:')) {
      const parts = objectId.split(':');
      const furnitureType = parts[2] ?? '';
      return roomName ? `${roomName} · 家具 · ${furnitureType}` : `家具 · ${furnitureType}`;
    }
    const label = typeLabel[type] ?? type;
    if (roomName) return `${roomName}${label}`;
    return objectId;
  }

  private targetFromIntersects(
    intersects: Array<{ object: THREE.Object3D }>,
    hoverableOnly: boolean,
  ): HoverTarget | null {
    let best: { target: HoverTarget; priority: number } | null = null;
    for (const hit of intersects) {
      let object: THREE.Object3D | null = hit.object;
      while (object && !object.userData?.objectId && !object.userData?.roomId) {
        object = object.parent;
      }
      const data = object?.userData;
      if (hoverableOnly && data?.hoverable === false) continue;
      if (!data?.objectId && !data?.roomId) continue;

      const id = (data.objectId as string) ?? (data.roomId as string);
      const type = (data.type as string) ?? (data.part as string) ?? 'room';
      const room = data.roomId as string | undefined;
      const name = this.objectDisplayName(id, type, room, data.fixtureType as string | undefined, data.wallSide as WallSide | undefined);
      const target: HoverTarget = {
        objectId: id,
        name,
        type,
        room,
        curtainId: data.curtainId as string | undefined,
        curtainKind: data.curtainId ? this.curtainRegistry.get(data.curtainId as string)?.kind : undefined,
        layer: data.layer as HoverTarget['layer'],
      };
      const priority = type === 'lighting_fixture'
        ? 0
        : type === 'ceiling_zone_solid' || (type === 'annotation' && data.category === 'ceiling')
          ? 2
          : 1;
      if (!best || priority < best.priority) best = { target, priority };
      if (best.priority === 0) break;
    }
    return best?.target ?? null;
  }

  raycastFromScreenCenter(options?: { hoverableOnly?: boolean }): HoverTarget | null {
    const { hoverableOnly = false } = options ?? {};
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    return this.targetFromIntersects(this.raycaster.intersectObjects(this.scene.children, true), hoverableOnly);
  }

  getVisibleObjects(): string[] {
    return [
      ...Object.keys(this.rooms),
      ...this.getTopicObjectIds(),
      'platform_boundary',
    ];
  }

  getSelectedObjects(): string[] {
    // future: raycast selection
    return [];
  }

  getTopicObjectIds(): string[] {
    const ids: string[] = [];
    this.topicGroup.traverse((obj) => {
      if (obj.userData?.objectId) ids.push(obj.userData.objectId as string);
    });
    return ids;
  }

  private onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.requestRender();
  }

  raycastRoomAtPointer(): string | null {
    this.raycaster.setFromCamera(this.lastPointer, this.camera);
    const intersects = this.raycaster.intersectObjects(this.scene.children, true);
    const hits = intersects.map((hit) => ({
      roomId: hit.object.userData?.roomId as string | undefined,
      type: hit.object.userData?.type as string | undefined,
    }));
    return pickRoomIdFromHits(hits);
  }

  private onPointerDown(event: PointerEvent) {
    this.pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const target = this.targetFromIntersects(
      this.raycaster.intersectObjects(this.scene.children, true),
      false,
    );
    if (target) {
      this.onClickCallback?.(target);
    }
  }

  private lastRenderTime = performance.now();

  updateCameras(): void {
    const now = performance.now();
    const deltaTime = now - this.lastRenderTime;
    this.lastRenderTime = now;
    if (this._mode === 'orbit' && !this.cameraAnimator.isAnimating()) {
      this.controls.update();
    }
    this.cameraAnimator.update(deltaTime);
  }

  renderFrame(): void {
    this.updateCompassLabels();
    this.renderer.render(this.scene, this.camera);
  }

  render(): void {
    this.updateCameras();
    this.renderFrame();
  }

  private readonly COMPASS_ANCHORS: Record<'n' | 's' | 'e' | 'w', THREE.Vector3> = {
    n: new THREE.Vector3(7.4, 0.05, -5.0),
    s: new THREE.Vector3(7.4, 0.05, 12.5),
    e: new THREE.Vector3(18.6, 0.05, 3.65),
    w: new THREE.Vector3(-3.0, 0.05, 3.65),
  };

  private readonly compassEls: Partial<Record<'n' | 's' | 'e' | 'w', HTMLElement | null>> = {};

  private initCompassLabels() {
    if (Object.keys(this.compassEls).length > 0) return;
    for (const key of ['n', 's', 'e', 'w'] as const) {
      this.compassEls[key] = document.getElementById(`compass-${key}`);
    }
  }

  private updateCompassLabels() {
    this.initCompassLabels();
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const key of ['n', 's', 'e', 'w'] as const) {
      const el = this.compassEls[key];
      if (!el) continue;
      const anchor = this.COMPASS_ANCHORS[key];
      const projected = anchor.clone().project(this.camera);
      if (projected.z > 1) {
        el.style.opacity = '0';
        continue;
      }
      const x = (projected.x + 1) * 0.5 * w;
      const y = (1 - projected.y) * 0.5 * h;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.opacity = '0.95';
    }
  }

  getGroundPosition(clientX: number, clientY: number): { x: number; z: number } | null {
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1,
    );
    raycaster.setFromCamera(mouse, this.camera);
    const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const intersection = new THREE.Vector3();
    const hit = raycaster.ray.intersectPlane(floorPlane, intersection);
    if (hit) return { x: intersection.x, z: intersection.z };
    return null;
  }

  showGhost(x: number, z: number, rotation: number, type: string): void {
    this.decorations.showGhost(x, z, rotation, type);
  }

  hideGhost(): void {
    this.decorations.hideGhost();
  }

  updateGhostPosition(x: number, z: number, rotation?: number): void {
    this.decorations.updateGhostPosition(x, z, rotation);
  }

  getGhostPosition(): { x: number; z: number } | null {
    return this.decorations.getGhostPosition();
  }

  dispose(): void {
    window.removeEventListener('resize', this.boundOnWindowResize);
    this.hvacRenderer.dispose();
    this.mepRenderer.dispose();
    this.decorations.dispose();
    this.materials.dispose();
    this.renderer.dispose();
  }
}
