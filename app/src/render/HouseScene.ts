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
  ResolvedOpening,
  FurnishingsYaml,
  ProjectRenderFactsProjection,
  VrfOutdoorUnit,
  ElectricalPoint,
  WallSide,
  CurtainPresentationState,
  CurtainState,
} from '@shared/types';
import { FURNITURE_DIMS } from '@shared/types';
import { CameraAnimator } from '../scene/CameraAnimator.js';
import { TopDownView } from '../scene/TopDownView.js';
import { pickRoomIdFromHits } from '../scene/spawn-utils.js';
import { scalePlaneUvToMeters } from './uv-utils.js';
import { offsetCurtainPointsInterior } from './curtain-offset.js';
import { gatheredCurtainSegments } from './curtain-track.js';
import { TopicRegistry } from '../topics/TopicRegistry.js';
import type { HoverTarget } from '../ui/HoverTooltip.js';
import { TextureManager } from './TextureManager.js';
import type { MaterialAppearance } from './TextureFactory.js';
import { buildBathSideCabinetRun, buildFixture, buildKitchenCabinetRun, buildWardrobe180 } from './FixtureFactory.js';
import { EnvironmentManager } from './EnvironmentManager.js';
import { buildCeilingZone, type CeilingZoneSpec } from './CeilingZoneBuilder.js';
import { HvacDiagramRenderer } from './HvacDiagramRenderer.js';
import { MepCoordinationRenderer } from './MepCoordinationRenderer.js';
import type { MepCoordination } from '@shared/mep-hvac-coordination-schema';
import { checkHvacExportSet, collectExportSet } from './export-gltf.js';

const DEFAULT_PAINT = '#f7f5ef';
const GLASS_COLOR = 0x88ccff;
const GLASS_OPACITY = 0.6;
export const GLASS_THICKNESS = 0.024; // 24mm 中空双玻（2026-08-13 由 15cm 改真实厚度；俯视可见性改由材质双线承担）
const DEFAULT_FLOOR = '#e8e0d5';
const WALL_THICKNESS = 0.12;
const SHAFT_FLOOR = '#3a3a3a';
const DEFAULT_CEILING = '#f5f5f5';
const SHAFT_WALL = '#555555';
const ELEVATOR_DOOR_COLOR = 0x888899;

type LayoutBounds = { minX: number; maxX: number; minZ: number; maxZ: number };
const DEFAULT_LAYOUT_BOUNDS: LayoutBounds = { minX: -1.6, maxX: 16.4, minZ: -2.9, maxZ: 12.0 };

type ArcDescriptor = {
  center: { x: number; z: number };
  radius: number;
  start: { x: number; z: number };
  startAngle: number;
  endAngle: number;
  clockwise: boolean;
};

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
    furnishings?: FurnishingsYaml;
    electrical?: ElectricalMarker[];
    sceneElements?: SceneElement[];
  };
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
  private floorMeshes: THREE.Mesh[] = [];
  private wallMeshes: THREE.Mesh[] = [];
  private ceilingMeshes: THREE.Mesh[] = [];
  private curtainRegistry = new Map<string, CurtainRegistryEntry>();
  private curtainPresentationState: CurtainPresentationState = { default: 'open', roomOverrides: {}, updatedAt: '' };
  private glassMeshes: THREE.Mesh[] = [];
  private furnitureMeshes: THREE.Group[] = [];
  private countertopMeshes: THREE.Mesh[] = [];
  private electricalMeshes: THREE.Mesh[] = [];
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
  private gridHelper?: THREE.GridHelper;
  private envManager: EnvironmentManager;
  private ghostMesh: THREE.Mesh | null = null;
  private topDownLayoutBounds: LayoutBounds = DEFAULT_LAYOUT_BOUNDS;
  private readonly ORBIT_POSITION = new THREE.Vector3(7.4, 14, 19.2);
  private readonly ORBIT_TARGET = new THREE.Vector3(7.4, 0, 3.65);
  private hvacRenderer: HvacDiagramRenderer;
  private mepRenderer: MepCoordinationRenderer;
  private hvacExpectedExportIds: string[] = [];
  private wallSegmentIndex = new Map<string, Array<{ x1: number; z1: number; x2: number; z2: number }>>();

  constructor(canvas: HTMLCanvasElement) {
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

    this.envManager = new EnvironmentManager(this.scene, this.renderer);
    this.hvacRenderer = new HvacDiagramRenderer(this.scene);
    this.mepRenderer = new MepCoordinationRenderer(this.scene);
    this.setupLights();
    this.buildBase();
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

  async captureFloorPlan(): Promise<string> {
    let renderTarget: THREE.WebGLRenderTarget | null = null;
    const prevTopicVisible = this.topicGroup.visible;
    const prevGridOpacity = this.gridHelper ? this.getGridHelperOpacity() : 1.0;
    const prevFurnitureVisible = this.furnitureMeshes.map((m) => m.visible);
    const prevElectricalVisible = this.electricalMeshes.map((m) => m.visible);
    const prevCeilingVisible = this.ceilingMeshes.map((m) => m.visible);
    const prevShadowMapEnabled = this.renderer.shadowMap.enabled;

    this.topicGroup.visible = false;
    if (this.gridHelper) {
      this.setGridHelperOpacity(0);
    }
    for (const mesh of this.furnitureMeshes) {
      mesh.visible = false;
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
      this.renderer.render(this.scene, orthoCam);

      const buffer = new Uint8Array(renderWidth * renderHeight * 4);
      this.renderer.readRenderTargetPixels(renderTarget, 0, 0, renderWidth, renderHeight, buffer);
      return this.rgbaToPng(buffer, renderWidth, renderHeight);
    } finally {
      this.topicGroup.visible = prevTopicVisible;
      if (this.gridHelper) {
        this.setGridHelperOpacity(prevGridOpacity);
      }
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

  private getGridHelperOpacity(): number {
    if (!this.gridHelper) return 1.0;
    const mat = this.gridHelper.material as THREE.Material | THREE.Material[];
    if (Array.isArray(mat)) {
      return mat[0]?.opacity ?? 1.0;
    }
    return mat.opacity;
  }

  private setGridHelperOpacity(opacity: number): void {
    if (!this.gridHelper) return;
    const mat = this.gridHelper.material as THREE.Material | THREE.Material[];
    if (Array.isArray(mat)) {
      for (const m of mat) m.opacity = opacity;
    } else {
      mat.opacity = opacity;
    }
    this.gridHelper.material.transparent = true;
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

  private computeLayoutBounds(data: ProjectData): LayoutBounds {
    const rects: Array<{ x: number; z: number; width: number; depth: number }> = [
      ...data.house.rooms,
    ];
    if (data.house.platform) {
      rects.push(data.house.platform);
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const r of rects) {
      const halfW = r.width / 2;
      const halfD = r.depth / 2;
      minX = Math.min(minX, r.x - halfW);
      maxX = Math.max(maxX, r.x + halfW);
      minZ = Math.min(minZ, r.z - halfD);
      maxZ = Math.max(maxZ, r.z + halfD);
    }

    const expandSegment = (x1: number, z1: number, x2: number, z2: number, halfThick: number) => {
      const dx = x2 - x1;
      const dz = z2 - z1;
      const len = Math.hypot(dx, dz);
      if (len < 1e-9) return;
      const nx = (-dz / len) * halfThick;
      const nz = (dx / len) * halfThick;
      const corners = [
        { x: x1 + nx, z: z1 + nz },
        { x: x1 - nx, z: z1 - nz },
        { x: x2 + nx, z: z2 + nz },
        { x: x2 - nx, z: z2 - nz },
      ];
      for (const c of corners) {
        minX = Math.min(minX, c.x);
        maxX = Math.max(maxX, c.x);
        minZ = Math.min(minZ, c.z);
        maxZ = Math.max(maxZ, c.z);
      }
    };

    const elements = data.house.sceneElements;
    if (Array.isArray(elements)) {
      for (const el of elements) {
        switch (el.type) {
          case 'wall': {
            expandSegment(el.x1, el.z1, el.x2, el.z2, WALL_THICKNESS / 2);
            break;
          }
          case 'wall_run': {
            const halfThick = WALL_THICKNESS / 2;
            for (let i = 0; i < el.points.length - 1; i++) {
              const a = el.points[i];
              const b = el.points[i + 1];
              expandSegment(a.x, a.z, b.x, b.z, halfThick);
            }
            break;
          }
          case 'curtain_run':
          case 'shower_screen': {
            const halfThick = GLASS_THICKNESS / 2;
            for (let i = 0; i < el.points.length - 1; i++) {
              const a = el.points[i];
              const b = el.points[i + 1];
              expandSegment(a.x, a.z, b.x, b.z, halfThick);
            }
            break;
          }
          case 'floor_region':
          case 'bay_sill': {
            for (const p of el.points) {
              minX = Math.min(minX, p.x);
              maxX = Math.max(maxX, p.x);
              minZ = Math.min(minZ, p.z);
              maxZ = Math.max(maxZ, p.z);
            }
            break;
          }
          case 'glass_infill': {
            // footprint is already covered by the enclosing room
            break;
          }
          case 'railing_run': {
            for (const p of el.points) {
              minX = Math.min(minX, p.x);
              maxX = Math.max(maxX, p.x);
              minZ = Math.min(minZ, p.z);
              maxZ = Math.max(maxZ, p.z);
            }
            break;
          }
          case 'curtain': {
            for (const p of el.points) {
              minX = Math.min(minX, p.x);
              maxX = Math.max(maxX, p.x);
              minZ = Math.min(minZ, p.z);
              maxZ = Math.max(maxZ, p.z);
            }
            break;
          }
          case 'sliding_door_run': {
            for (const p of el.points) {
              minX = Math.min(minX, p.x);
              maxX = Math.max(maxX, p.x);
              minZ = Math.min(minZ, p.z);
              maxZ = Math.max(maxZ, p.z);
            }
            break;
          }
          default: {
            const exhaustive: never = el;
            console.error('[HouseScene] 未知场景元素类型（bounds 缺 case）', exhaustive);
          }
        }
      }
    }

    if (minX === Infinity) {
      return DEFAULT_LAYOUT_BOUNDS;
    }
    return { minX, maxX, minZ, maxZ };
  }

  private onTopDownChange(enabled: boolean): void {
    this.topicGroup.visible = !enabled;
    if (this.gridHelper) {
      const mat = this.gridHelper.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) {
        for (const m of mat) m.opacity = enabled ? 0.15 : 1.0;
      } else {
        mat.opacity = enabled ? 0.15 : 1.0;
      }
      this.gridHelper.material.transparent = true;
    }
    if (enabled) {
      this.controls.maxPolarAngle = 0.1;
    } else {
      this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
    }
    this.requestRender();
  }

  async buildFromCatalog(projectData: ProjectData): Promise<void> {
    const toRemove: THREE.Object3D[] = [];
    this.scene.traverse((obj) => {
      if (obj !== this.scene && obj.parent === this.scene) {
        toRemove.push(obj);
      }
    });
    for (const obj of toRemove) {
      this.scene.remove(obj);
    }

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
    this.wallSegmentIndex.clear();
    this.roomMeta.clear();

    this.setupLights();
    this.buildBase();

    this.topicGroup = new THREE.Group();
    this.scene.add(this.topicGroup);

    const useSceneElements = Array.isArray(projectData.house.sceneElements)
      && projectData.house.sceneElements.length > 0;
    const wallHeight = projectData.house.rooms[0]?.height ?? 3.0;

    const skipRooms = new Set(['elevator_shaft']);
    for (const room of projectData.house.rooms) {
      if (skipRooms.has(room.id)) continue;
      this.roomMeta.set(room.id, { wall_finish: room.wall_finish, wallOpenings: room.wallOpenings });
      this.createRoom(
        {
          id: room.id,
          name: room.name,
          x: room.x,
          z: room.z,
          width: room.width,
          depth: room.depth,
          height: room.height,
          points: (room as { points?: CurtainPoint[] }).points,
        },
        { fabricateWalls: !useSceneElements }
      );
    }

    if (useSceneElements) {
      this.buildSceneElements(projectData.house.sceneElements!, wallHeight);
    }

    if (projectData.house.platform && !skipRooms.has(projectData.house.platform.id)) {
      this.createPlatform(projectData.house.platform);
    }

    this.topDownLayoutBounds = this.computeLayoutBounds(projectData);
    this.topDownView.updateBounds(this.topDownLayoutBounds);

    if (projectData.house.furnishings) {
      this.furnitureMeshes = this.placeFurnitureFixtures(projectData.house.furnishings);
    }

    this.hvacRenderer.attach();
    this.textureManager.setMeshes(this.floorMeshes, this.wallMeshes, this.ceilingMeshes);
    const materials = HouseScene.extractMaterials(projectData.topics);
    this.textureManager.loadMaterials(materials);
    this.textureManager.preload();
  }

  private static extractMaterials(topics: ProjectData['topics']): Array<{ id: string; appearance: { type: string; color: string } }> {
    const seen = new Set<string>();
    const materials: Array<{ id: string; appearance: { type: string; color: string } }> = [];
    for (const topic of topics) {
      if (!topic.options) continue;
      for (const option of topic.options as Array<{ id: string; data?: { appearance?: { type: string; color: string } } }>) {
        const app = option.data?.appearance;
        if (app && !seen.has(app.type + ':' + app.color)) {
          seen.add(app.type + ':' + app.color);
          materials.push({ id: option.id, appearance: app });
        }
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

  loadHvacProjection(projection: ProjectRenderFactsProjection, outdoor: VrfOutdoorUnit[] = [], electrical: ElectricalPoint[] = []): void {
    this.hvacRenderer.clear();
    this.hvacExpectedExportIds = [];
    if (projection.hvac?.status !== 'implemented') return;
    const { planId, diagram } = projection.hvac;
    this.hvacExpectedExportIds = [
      ...diagram.anchors
        .filter((anchor) => anchor.status === 'confirmed' && anchor.ref?.source !== 'electrical')
        .map((anchor) => `hvac:${planId}:anchor:${anchor.id}`),
      ...diagram.terminals
        .filter((terminal) => terminal.kind !== 'condensate_drain_candidate')
        .map((terminal) => `hvac:${planId}:terminal:${terminal.id}`),
    ];
    this.hvacRenderer.render(planId, diagram, {
      ceiling: projection.ceiling,
      electrical,
      outdoor,
    });
    this.hvacRenderer.setCoordinationVisible(false);
  }

  getHvacExportStatus(): { required: boolean; ready: boolean; expected: string[]; included: string[]; missing: string[]; terminalCount: number } {
    const expected = [...this.hvacExpectedExportIds];
    const checked = checkHvacExportSet(collectExportSet(this.scene), expected);
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
    this.hvacExpectedExportIds = [];
  }

  setHvacCoordinationVisible(visible: boolean): void {
    this.hvacRenderer.setCoordinationVisible(visible);
    this.requestRender();
  }

  loadMepCoordination(config: MepCoordination, sources: import('@shared/mep-hvac-coordination-schema').MepEndpointSources): void {
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

  private buildBase() {
    const grid = new THREE.GridHelper(40, 40, 0x444444, 0x2a2a2a);
    const gridMat = grid.material as THREE.Material | THREE.Material[];
    if (Array.isArray(gridMat)) {
      for (const m of gridMat) {
        m.transparent = true;
        m.opacity = 1.0;
      }
    } else {
      gridMat.transparent = true;
      gridMat.opacity = 1.0;
    }
    this.scene.add(grid);
    this.gridHelper = grid;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.9 })
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -0.01;
    plane.receiveShadow = true;
    this.scene.add(plane);
  }

  private createRoom(r: RoomObject, opts: { fabricateWalls?: boolean } = {}) {
    const { fabricateWalls = true } = opts;
    const group = new THREE.Group();
    group.position.set(r.x, 0, r.z);

    const pts = r.points;
    const floorGeo = pts
      ? new THREE.ShapeGeometry(this.buildRoundedShape(pts.map(p => ({ x: p.x - r.x, z: r.z - p.z, radius: p.radius }))))
      : new THREE.PlaneGeometry(r.width, r.depth);
    if (!pts) scalePlaneUvToMeters(floorGeo as THREE.PlaneGeometry, r.width, r.depth);
    const isShaft = r.id === 'elevator_shaft';
    const floorMat = new THREE.MeshStandardMaterial({
      color: isShaft ? SHAFT_FLOOR : DEFAULT_FLOOR,
      roughness: isShaft ? 0.9 : 0.75,
      metalness: isShaft ? 0.1 : 0.05,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.005;
    floor.userData = { roomId: r.id, objectId: `floor:${r.id}`, type: 'floor' };
    floor.receiveShadow = true;
    group.add(floor);
    this.floorMeshes.push(floor);

    // 天花板：与地板同形状，位于 y=height。分模式可见（第一人称显示，轨道/俯视隐藏，见 setMode）
    const ceilingGeo = pts
      ? new THREE.ShapeGeometry(this.buildRoundedShape(pts.map(p => ({ x: p.x - r.x, z: r.z - p.z, radius: p.radius }))))
      : new THREE.PlaneGeometry(r.width, r.depth);
    if (!pts) scalePlaneUvToMeters(ceilingGeo as THREE.PlaneGeometry, r.width, r.depth);
    const ceilingMat = new THREE.MeshStandardMaterial({
      color: DEFAULT_CEILING,
      roughness: 0.9,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });
    const ceiling = new THREE.Mesh(ceilingGeo, ceilingMat);
    ceiling.rotation.x = -Math.PI / 2;
    ceiling.position.y = r.height - 0.005;
    ceiling.userData = { roomId: r.id, objectId: `ceiling:${r.id}`, type: 'ceiling' };
    ceiling.visible = false;
    group.add(ceiling);
    this.ceilingMeshes.push(ceiling);

    if (fabricateWalls) {
      const wallMat = new THREE.MeshStandardMaterial({
        color: DEFAULT_PAINT,
        roughness: 0.85,
      });

      const halfW = r.width / 2;
      const halfD = r.depth / 2;

      const walls: Array<{ x: number; z: number; w: number; d: number; dir: string }> = [
        { x: 0, z: -halfD, w: r.width, d: WALL_THICKNESS, dir: 'north' },
        { x: 0, z: halfD, w: r.width, d: WALL_THICKNESS, dir: 'south' },
        { x: -halfW, z: 0, w: WALL_THICKNESS, d: r.depth, dir: 'west' },
        { x: halfW, z: 0, w: WALL_THICKNESS, d: r.depth, dir: 'east' },
      ];

      for (const w of walls) {
        const wall = new THREE.Mesh(
          new THREE.BoxGeometry(w.w, r.height, w.d),
          wallMat.clone()
        );
        wall.position.set(w.x, r.height / 2, w.z);
        wall.userData = { roomId: r.id, objectId: `wall:${r.id}:${w.dir}`, type: 'wall', wallType: 'interior' };
        wall.castShadow = true;
        wall.receiveShadow = true;
        group.add(wall);
        this.wallMeshes.push(wall);
      }

      const meta = this.roomMeta.get(r.id);
      if (meta?.wallOpenings) {
        for (const opening of meta.wallOpenings) {
          this.addOpeningMarker(group, opening.x - r.x, 1.2, opening.z - r.z, opening.width, opening.height, `${opening.type}_${r.id}`);
        }
      }
    }

    this.scene.add(group);
    this.rooms[r.id] = { ...r };
  }

  private makeGlassMaterial(): THREE.MeshPhysicalMaterial {
    // transmission > 0 → GLTFExporter 写 KHR_materials_transmission，Twinmotion 导入为真玻璃；
    // metalness 必须为 0（金属度是导出后"灰镜"观感的主因）；本地渲染同为透射路径，更通透
    return new THREE.MeshPhysicalMaterial({
      color: GLASS_COLOR,
      transparent: true,
      opacity: GLASS_OPACITY,
      transmission: 0.92,
      ior: 1.5,
      thickness: 0.02,
      // 必须为有限值：默认 Infinity 经 GLTFExporter JSON 序列化成 null，Blender 导入器 1/null 崩溃
      attenuationDistance: 0.5,
      roughness: 0.05,
      metalness: 0,
      side: THREE.DoubleSide,
    });
  }

  // 竖纹长虹玻璃（DEC-044 推拉门芯板）：程序化竖向棱纹贴图 → roughnessMap + bumpMap，
  // 模拟 12mm 棱距的条纹磨砂透光效果；贴图按芯板宽度设置 repeat，使棱距≈真实尺寸
  private flutedGlassTexture: THREE.CanvasTexture | null = null;

  private makeFlutedGlassMaterial(paneW: number): THREE.MeshPhysicalMaterial {
    if (!this.flutedGlassTexture) {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 4;
      const ctx = canvas.getContext('2d')!;
      const period = 32; // 贴图空间内每道棱的像素宽
      for (let x = 0; x < canvas.width; x++) {
        const t = (x % period) / period;
        const v = Math.round(128 + 110 * Math.sin(t * Math.PI * 2));
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(x, 0, 1, canvas.height);
      }
      this.flutedGlassTexture = new THREE.CanvasTexture(canvas);
      this.flutedGlassTexture.wrapS = THREE.RepeatWrapping;
    }
    const stripes = this.flutedGlassTexture.clone();
    stripes.needsUpdate = true;
    stripes.repeat.x = Math.max(1, Math.round(paneW / 0.012));
    const mat = this.makeGlassMaterial();
    mat.roughness = 0.5; // three.js 中 roughness 与 roughnessMap 相乘，此处给棱纹留出起伏区间
    mat.roughnessMap = stripes;
    mat.bumpMap = stripes;
    mat.bumpScale = 0.3;
    return mat;
  }

  private buildSceneElements(elements: SceneElement[], defaultHeight: number) {
    for (const el of elements) {
      switch (el.type) {
        case 'wall': this.renderWallSegment(el, defaultHeight); break;
        case 'curtain_run': this.renderCurtainRun(el); break;
        case 'wall_run': this.renderWallRun(el); break;
        case 'glass_infill': this.renderGlassInfill(el); break;
        case 'shower_screen': this.renderShowerScreen(el); break;
        case 'floor_region': this.renderFloorRegion(el); break;
        case 'bay_sill': this.renderBaySill(el); break;
        case 'railing_run': this.renderRailingRun(el); break;
        case 'sliding_door_run': this.renderSlidingDoorRun(el); break;
        case 'curtain': this.renderCurtain(el); break;
        default: {
          const exhaustive: never = el;
          console.error('[HouseScene] 未知场景元素类型（渲染器缺 case）', exhaustive);
        }
      }
    }
  }

  private renderBox(
    x1: number, z1: number, x2: number, z2: number,
    height: number, thickness: number, mat: THREE.Material,
  ): THREE.Mesh {
    const cx = (x1 + x2) / 2;
    const cz = (z1 + z2) / 2;
    const length = Math.hypot(x2 - x1, z2 - z1);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(length, thickness), height, thickness),
      mat
    );
    mesh.position.set(cx, height / 2, cz);
    if (length > thickness) mesh.rotation.y = Math.atan2(z2 - z1, x2 - x1);
    this.scene.add(mesh);
    return mesh;
  }

  private renderWallSegment(el: Extract<SceneElement, { type: 'wall' }>, height: number) {
    const segments = el.segments?.length ? el.segments : [{ x1: el.x1, z1: el.z1, x2: el.x2, z2: el.z2 }];
    this.wallSegmentIndex.set(el.id, segments);
    const isShaftWall = el.id.includes('elev') || el.id.includes('foyer_outer_east') || el.id.includes('foyer_north_east');
    const wallType = isShaftWall ? 'structure' : 'interior';
    const mat = new THREE.MeshStandardMaterial({ color: isShaftWall ? SHAFT_WALL : DEFAULT_PAINT, roughness: 0.85 });
    // 导出命名附加房间归属：wall:seg:N:room=r1|r2（Blender 端按 room 给厨卫墙挂砖，见 dress_scene.classify）
    const exportName = el.rooms?.length ? `${el.id}:room=${el.rooms.join('|')}` : undefined;
    const wallUserData: Record<string, unknown> = { type: 'wall', objectId: el.id, wallType, ...(exportName ? { exportName } : {}) };
    const segs = (el as { segments?: Array<{ x1: number; z1: number; x2: number; z2: number }> }).segments;
    if (segs && segs.length > 1) {
      for (const s of segs) {
        const mesh = this.renderBox(s.x1, s.z1, s.x2, s.z2, height, WALL_THICKNESS, mat);
        mesh.userData = { ...wallUserData };
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.wallMeshes.push(mesh);
      }
      return;
    }
    const openings = (el as { openings?: ResolvedOpening[] }).openings;
    const doors = (openings ?? []).filter(o => o.type === 'door' || o.type === 'cased_opening' || o.type === 'sliding_door');
    if (doors.length === 0) {
      const mesh = this.renderBox(el.x1, el.z1, el.x2, el.z2, height, WALL_THICKNESS, mat);
      mesh.userData = { ...wallUserData };
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.wallMeshes.push(mesh);
      return;
    }
    const dx = el.x2 - el.x1;
    const dz = el.z2 - el.z1;
    const len = Math.hypot(dx, dz);
    if (len < 0.001) return;
    const ux = dx / len;
    const uz = dz / len;
    const projected = doors.map(o => ({
      o,
      t: (o.x - el.x1) * ux + (o.z - el.z1) * uz,
      half: o.width / 2,
    })).sort((a, b) => a.t - b.t);
    let cursor = 0;
    for (const { o, t, half } of projected) {
      const gapStart = Math.max(0, t - half);
      const gapEnd = Math.min(len, t + half);
      if (gapStart > cursor + 0.001) {
        const sx1 = el.x1 + ux * cursor;
        const sz1 = el.z1 + uz * cursor;
        const sx2 = el.x1 + ux * gapStart;
        const sz2 = el.z1 + uz * gapStart;
        const mesh = this.renderBox(sx1, sz1, sx2, sz2, height, WALL_THICKNESS, mat);
        mesh.userData = { ...wallUserData };
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.wallMeshes.push(mesh);
      }
      if (o.type === 'door') this.renderDoor(o, ux, uz, el.x1, el.z1, t, half, height);
      if (o.type === 'sliding_door') {
        // 推拉门扇：薄板覆盖洞口（2026-08-21 主卫推拉门可见性）
        const sx1 = el.x1 + ux * (t - half);
        const sz1 = el.z1 + uz * (t - half);
        const sx2 = el.x1 + ux * (t + half);
        const sz2 = el.z1 + uz * (t + half);
        const mesh = this.renderBox(sx1, sz1, sx2, sz2, o.height, 0.04,
          new THREE.MeshStandardMaterial({ color: 0x8a6f4d, roughness: 0.6 }));
        mesh.userData = { type: 'door', objectId: o.id };
      }
      // 洞口上方过梁墙段：洞口只开到门高，门楣以上补回墙体（2026-08-25 修复门上方镂空）
      const doorTop = (o.sill ?? 0) + o.height;
      if (doorTop < height - 0.001) {
        const lx1 = el.x1 + ux * (t - half);
        const lz1 = el.z1 + uz * (t - half);
        const lx2 = el.x1 + ux * (t + half);
        const lz2 = el.z1 + uz * (t + half);
        const lintel = this.renderBox(lx1, lz1, lx2, lz2, height - doorTop, WALL_THICKNESS, mat);
        lintel.position.y = doorTop + (height - doorTop) / 2;
        lintel.userData = { ...wallUserData };
        lintel.castShadow = true;
        lintel.receiveShadow = true;
        this.wallMeshes.push(lintel);
      }
      cursor = gapEnd;    }
    if (cursor < len - 0.001) {
      const sx1 = el.x1 + ux * cursor;
      const sz1 = el.z1 + uz * cursor;
      const mesh = this.renderBox(sx1, sz1, el.x2, el.z2, height, WALL_THICKNESS, mat);
      mesh.userData = { ...wallUserData };
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.wallMeshes.push(mesh);
    }
  }

  private renderDoor(
    o: ResolvedOpening,
    ux: number, uz: number,
    wallX1: number, wallZ1: number,
    t: number, half: number,
    wallHeight: number,
  ) {
    const hingeT = t - half;
    const hx = wallX1 + ux * hingeT;
    const hz = wallZ1 + uz * hingeT;
    const doorHeight = o.height;
    const sill = o.sill ?? 0;
    const isElevator = o.id === 'd_elev';
    if (isElevator) {
      // 电梯厅门：中分双开门扇 + 中缝 + 深色大门套，区别于普通平开木门
      const elevMat = new THREE.MeshStandardMaterial({ color: ELEVATOR_DOOR_COLOR, roughness: 0.25, metalness: 0.85 });
      const panelThick = 0.03;
      const seamGap = 0.015;
      const panelW = (o.width - seamGap) / 2;
      const cx = wallX1 + ux * t;
      const cz = wallZ1 + uz * t;
      const rotY = Math.atan2(uz, ux);
      for (const side of [-1, 1] as const) {
        const pt = t + side * (panelW / 2 + seamGap / 2);
        const panel = new THREE.Mesh(
          new THREE.BoxGeometry(panelW, doorHeight, panelThick),
          elevMat,
        );
        panel.position.set(wallX1 + ux * pt, sill + doorHeight / 2, wallZ1 + uz * pt);
        panel.rotation.y = rotY;
        panel.userData = { type: 'door', objectId: `${o.id}:panel:${side < 0 ? 'left' : 'right'}`, wallType: 'interior' };
        panel.castShadow = true;
        this.scene.add(panel);
        this.wallMeshes.push(panel);
        this.doorMeshes.push(panel);
      }
      // 中缝（深色细条，读出中分门）
      const seam = new THREE.Mesh(
        new THREE.BoxGeometry(seamGap, doorHeight, panelThick + 0.004),
        new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.5, metalness: 0.4 }),
      );
      seam.position.set(cx, sill + doorHeight / 2, cz);
      seam.rotation.y = rotY;
      seam.userData = { type: 'door', objectId: `${o.id}:seam`, wallType: 'interior' };
      this.scene.add(seam);
      this.wallMeshes.push(seam);
      const frameMat = new THREE.MeshStandardMaterial({ color: 0x333336, roughness: 0.35, metalness: 0.6 });
      const jambW = 0.1;
      const frameDepth = 0.16;
      const leftFrame = new THREE.Mesh(
        new THREE.BoxGeometry(jambW, doorHeight + jambW, frameDepth),
        frameMat,
      );
      leftFrame.position.set(wallX1 + ux * (t - half - jambW / 2), sill + (doorHeight + jambW) / 2, wallZ1 + uz * (t - half - jambW / 2));
      leftFrame.rotation.y = rotY;
      leftFrame.userData = { type: 'door', objectId: `${o.id}:frame:left`, wallType: 'interior' };
      this.scene.add(leftFrame);
      this.wallMeshes.push(leftFrame);
      const rightFrame = new THREE.Mesh(
        new THREE.BoxGeometry(jambW, doorHeight + jambW, frameDepth),
        frameMat,
      );
      rightFrame.position.set(wallX1 + ux * (t + half + jambW / 2), sill + (doorHeight + jambW) / 2, wallZ1 + uz * (t + half + jambW / 2));
      rightFrame.rotation.y = rotY;
      rightFrame.userData = { type: 'door', objectId: `${o.id}:frame:right`, wallType: 'interior' };
      this.scene.add(rightFrame);
      this.wallMeshes.push(rightFrame);
      const topFrame = new THREE.Mesh(
        new THREE.BoxGeometry(o.width + jambW * 2, jambW, frameDepth),
        frameMat,
      );
      topFrame.position.set(cx, sill + doorHeight + jambW / 2, cz);
      topFrame.rotation.y = rotY;
      topFrame.userData = { type: 'door', objectId: `${o.id}:frame:top`, wallType: 'interior' };
      this.scene.add(topFrame);
      this.wallMeshes.push(topFrame);
      return;
    }
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.6 });
    const panelThick = 0.04;
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(o.width, doorHeight, panelThick),
      doorMat,
    );
    const wallNormalX = -uz;
    const wallNormalZ = ux;
    const isInward = o.swing === 'inward';
    const hingeAtEnd = o.hinge === 'end';
    const hingeOffset = isInward || o.swing === 'outward'
      ? (hingeAtEnd ? half : -half)
      : -half;
    const actualHingeX = wallX1 + ux * (t + hingeOffset);
    const actualHingeZ = wallZ1 + uz * (t + hingeOffset);
    const panelDirX = isInward
      ? -wallNormalX
      : o.swing === 'outward'
        ? wallNormalX
        : -uz;
    const panelDirZ = isInward
      ? -wallNormalZ
      : o.swing === 'outward'
        ? wallNormalZ
        : ux;
    const panelCx = actualHingeX + panelDirX * (o.width / 2);
    const panelCz = actualHingeZ + panelDirZ * (o.width / 2);
    panel.position.set(panelCx, sill + doorHeight / 2, panelCz);
    // Three.js 的 Y 轴旋转会将局部 +x 映射为 (cos θ, 0, -sin θ)。
    panel.rotation.y = Math.atan2(-panelDirZ, panelDirX);
    panel.userData = { type: 'door', objectId: o.id, wallType: 'interior' };
    panel.castShadow = true;
    panel.receiveShadow = true;
    this.scene.add(panel);
    this.wallMeshes.push(panel);
    this.doorMeshes.push(panel);
    const frameDepth = 0.15;
    const frameThick = 0.05;
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.7 });
    const frameHeight = doorHeight + frameThick * 2;
    const sillBottom = sill;
    const sillTop = sill + doorHeight + frameThick * 2;
    const leftFrame = new THREE.Mesh(
      new THREE.BoxGeometry(frameThick, frameHeight, frameDepth),
      frameMat,
    );
    leftFrame.position.set(hx, (sillBottom + sillTop) / 2, hz);
    leftFrame.rotation.y = Math.atan2(uz, ux);
    leftFrame.userData = { type: 'door', objectId: `${o.id}:frame:left`, wallType: 'interior' };
    this.scene.add(leftFrame);
    this.wallMeshes.push(leftFrame);
    const rightHingeT = t + half;
    const rhx = wallX1 + ux * rightHingeT;
    const rhz = wallZ1 + uz * rightHingeT;
    const rightFrame = new THREE.Mesh(
      new THREE.BoxGeometry(frameThick, frameHeight, frameDepth),
      frameMat,
    );
    rightFrame.position.set(rhx, (sillBottom + sillTop) / 2, rhz);
    rightFrame.rotation.y = Math.atan2(uz, ux);
    rightFrame.userData = { type: 'door', objectId: `${o.id}:frame:right`, wallType: 'interior' };
    this.scene.add(rightFrame);
    this.wallMeshes.push(rightFrame);
    const topCenterT = t;
    const tcx = wallX1 + ux * topCenterT;
    const tcz = wallZ1 + uz * topCenterT;
    const topFrame = new THREE.Mesh(
      new THREE.BoxGeometry(o.width + frameThick * 2, frameThick, frameDepth),
      frameMat,
    );
    topFrame.position.set(tcx, sillTop - frameThick / 2, tcz);
    topFrame.rotation.y = Math.atan2(uz, ux);
    topFrame.userData = { type: 'door', objectId: `${o.id}:frame:top`, wallType: 'interior' };
    this.scene.add(topFrame);
    this.wallMeshes.push(topFrame);
  }

  private renderRailingRun(el: Extract<SceneElement, { type: 'railing_run' }>) {
    const pts = el.points;
    if (pts.length < 2) return;
    const shape = this.buildCurtainShape(pts, false);
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: el.height,
      bevelEnabled: false,
      steps: 1,
    });
    const mat = new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.3, metalness: 0.6, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.set(1, -1, 1);
    mesh.userData = { type: 'railing_run', objectId: el.id };
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  private renderCurtainRun(el: Extract<SceneElement, { type: 'curtain_run' }>) {
    const shape = this.buildCurtainShape(el.points, el.closed ?? false);
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: el.height,
      bevelEnabled: false,
      steps: 1,
    });

    const mesh = new THREE.Mesh(geometry, this.makeGlassMaterial());
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.set(1, -1, 1);
    mesh.userData = { type: 'curtain_run', objectId: el.id };
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.glassMeshes.push(mesh);
  }

  // 窗帘：保留展开与收拢几何变体；open 完全收起并隐藏，其他状态切换 variant 可见性。
  private renderCurtain(el: Extract<SceneElement, { type: 'curtain' }>) {
    const kind = el.kind ?? 'sheer_blackout';
    const height = el.height - 0.1;
    const pts = offsetCurtainPointsInterior(el.points, Object.values(this.rooms), 0.12);
    const gathered = gatheredCurtainSegments(pts);
    const createMesh = (
      points: CurtainPoint[],
      material: THREE.Material,
      layer: 'sheer' | 'blackout' | 'blinds',
      variant: 'deployed' | 'gathered',
      meshHeight = height,
      y = 0.05,
      thickness = variant === 'gathered' ? 0.12 : 0.04,
      segment: 'left' | 'right' | null = null,
    ) => {
      const shape = this.buildCurtainShape(points, false, thickness, true);
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: meshHeight, bevelEnabled: false, steps: 1 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.scale.set(1, -1, 1);
      mesh.position.y = y;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      // objectId 命名契约与 shared/curtain-projection.ts 的 expectedVisibleCurtainNodes 一致：
      // deployed 无分段后缀；gathered 左右分段追加 :left/:right（blinds gathered 除外）。
      // 左右约定：gatheredCurtainSegments 返回 [轨道起点 stack, 轨道终点 stack]，
      // 沿轨道 points[0] 起点端为 left、末点端为 right，与 curtain-track.ts 分段顺序对齐。
      mesh.userData = {
        type: 'curtain',
        objectId: `${el.id}:${layer}:${variant}${segment ? `:${segment}` : ''}`,
        curtainId: el.id,
        roomId: el.room,
        layer,
        variant,
        segment,
        state: 'open',
      };
      this.scene.add(mesh);
      return mesh;
    };

    const entry: CurtainRegistryEntry = { id: el.id, roomId: el.room, kind, state: 'open' };
    if (kind === 'sheer_blackout') {
      entry.sheer = {
        deployed: createMesh(pts, this.makeSheerMaterial(), 'sheer', 'deployed'),
        // gathered[0]=轨道起点段→left，gathered[1]=轨道终点段→right（见 createMesh 注释）
        gathered: gathered.map((segment, i) => createMesh(segment, this.makeSheerMaterial(), 'sheer', 'gathered', undefined, undefined, undefined, i === 0 ? 'left' : 'right')),
      };
      entry.blackout = {
        deployed: createMesh(pts, this.makeBlackoutMaterial(), 'blackout', 'deployed'),
        gathered: gathered.map((segment, i) => createMesh(segment, this.makeBlackoutMaterial(), 'blackout', 'gathered', undefined, undefined, undefined, i === 0 ? 'left' : 'right')),
      };
    } else {
      const gatheredHeight = Math.min(0.28, Math.max(0.16, height * 0.08));
      entry.blinds = {
        deployed: createMesh(pts, this.makeBlindMaterial(), 'blinds', 'deployed'),
        gathered: createMesh(pts, this.makeBlindMaterial(), 'blinds', 'gathered', gatheredHeight, el.height - gatheredHeight),
      };
    }
    this.curtainRegistry.set(el.id, entry);
    this.setCurtainState(el.id, this.effectiveCurtainState(el.room));
  }

  private makeSheerMaterial(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: 0xf5f2ea, transparent: true, opacity: 0.35,
      roughness: 0.9, side: THREE.DoubleSide, depthWrite: false,
    });
  }

  private makeBlackoutMaterial(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: 0xcfc8ba, roughness: 0.95, side: THREE.DoubleSide,
    });
  }

  private makeBlindMaterial(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: 0xdfe3e6, transparent: true, opacity: 0.75,
      roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide,
    });
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

  private buildCurtainShape(points: CurtainPoint[], closed: boolean, thickness: number = GLASS_THICKNESS, sided: boolean = false, flip: boolean = false): THREE.Shape {
    const T = thickness;
    const n = points.length;
    if (n < 2) return new THREE.Shape();

    const centerline = new THREE.Path();
    let started = false;
    let startX = 0;
    let startZ = 0;

    for (let i = 0; i < n; i++) {
      const prev = points[(i - 1 + n) % n];
      const curr = points[i];
      const next = points[(i + 1) % n];
      const isOpenEndpoint = !closed && (i === 0 || i === n - 1);

      if (!isOpenEndpoint && curr.radius && curr.radius > 0) {
        const arc = this.centerlineArc(prev, curr, next);
        if (arc) {
          if (!started) {
            startX = arc.start.x;
            startZ = arc.start.z;
            centerline.moveTo(startX, startZ);
            started = true;
          } else {
            centerline.lineTo(arc.start.x, arc.start.z);
          }
          centerline.absarc(arc.center.x, arc.center.z, arc.radius, arc.startAngle, arc.endAngle, arc.clockwise);
        } else {
          if (!started) {
            startX = curr.x;
            startZ = curr.z;
            centerline.moveTo(startX, startZ);
            started = true;
          } else {
            centerline.lineTo(curr.x, curr.z);
          }
        }
      } else {
        if (!started) {
          startX = curr.x;
          startZ = curr.z;
          centerline.moveTo(startX, startZ);
          started = true;
        } else {
          centerline.lineTo(curr.x, curr.z);
        }
      }
    }

    if (!started) return new THREE.Shape();

    if (closed) {
      centerline.lineTo(startX, startZ);
    }

    const samples = centerline.getPoints(Math.max(16, n * 8));
    if (samples.length < 2) return new THREE.Shape();

    const left: { x: number; z: number }[] = [];
    const right: { x: number; z: number }[] = [];
    for (let i = 0; i < samples.length; i++) {
      const p = samples[i];
      let dx: number;
      let dy: number;
      if (i === 0) {
        dx = samples[1].x - samples[0].x;
        dy = samples[1].y - samples[0].y;
      } else if (i === samples.length - 1) {
        dx = samples[i].x - samples[i - 1].x;
        dy = samples[i].y - samples[i - 1].y;
      } else {
        dx = samples[i + 1].x - samples[i - 1].x;
        dy = samples[i + 1].y - samples[i - 1].y;
      }
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) continue;
      const nx = -dy / len;
      const ny = dx / len;
      const offL = sided ? (flip ? 0 : T) : T / 2;
      const offR = sided ? (flip ? T : 0) : T / 2;
      left.push({ x: p.x + nx * offL, z: p.y + ny * offL });
      right.push({ x: p.x - nx * offR, z: p.y - ny * offR });
    }

    if (left.length < 2 || right.length < 2) return new THREE.Shape();

    const shape = new THREE.Shape();
    if (closed) {
      const leftArea = Math.abs(this.signedArea(left.map((p) => ({ x: p.x, y: p.z }))));
      const rightArea = Math.abs(this.signedArea(right.map((p) => ({ x: p.x, y: p.z }))));
      const outer = leftArea >= rightArea ? left : right;
      const inner = leftArea >= rightArea ? right : left;
      shape.moveTo(outer[0].x, outer[0].z);
      for (let i = 1; i < outer.length; i++) shape.lineTo(outer[i].x, outer[i].z);
      shape.closePath();
      const hole = new THREE.Path();
      hole.moveTo(inner[inner.length - 1].x, inner[inner.length - 1].z);
      for (let i = inner.length - 2; i >= 0; i--) hole.lineTo(inner[i].x, inner[i].z);
      hole.closePath();
      shape.holes.push(hole);
    } else {
      shape.moveTo(left[0].x, left[0].z);
      for (let i = 1; i < left.length; i++) shape.lineTo(left[i].x, left[i].z);
      shape.lineTo(right[right.length - 1].x, right[right.length - 1].z);
      for (let i = right.length - 2; i >= 0; i--) shape.lineTo(right[i].x, right[i].z);
      shape.lineTo(left[0].x, left[0].z);
      shape.closePath();
    }
    return shape;
  }

  private buildRoundedShape(points: CurtainPoint[]): THREE.Shape {
    const n = points.length;
    const shape = new THREE.Shape();
    if (n < 3) return shape;

    let first = true;
    for (let i = 0; i < n; i++) {
      const prev = points[(i - 1 + n) % n];
      const curr = points[i];
      const next = points[(i + 1) % n];
      if (curr.radius && curr.radius > 0) {
        const arc = this.centerlineArc(prev, curr, next);
        if (arc) {
          if (first) {
            shape.moveTo(arc.start.x, arc.start.z);
            first = false;
          } else {
            shape.lineTo(arc.start.x, arc.start.z);
          }
          shape.absarc(arc.center.x, arc.center.z, arc.radius, arc.startAngle, arc.endAngle, arc.clockwise);
        } else {
          if (first) {
            shape.moveTo(curr.x, curr.z);
            first = false;
          } else {
            shape.lineTo(curr.x, curr.z);
          }
        }
      } else {
        if (first) {
          shape.moveTo(curr.x, curr.z);
          first = false;
        } else {
          shape.lineTo(curr.x, curr.z);
        }
      }
    }
    shape.closePath();
    return shape;
  }

  private centerlineArc(
    a: CurtainPoint,
    c: CurtainPoint,
    b: CurtainPoint
  ): ArcDescriptor | null {
    const r = c.radius ?? 0;
    if (r <= 0) return null;

    const v1x = c.x - a.x;
    const v1z = c.z - a.z;
    const v2x = b.x - c.x;
    const v2z = b.z - c.z;
    const len1 = Math.hypot(v1x, v1z);
    const len2 = Math.hypot(v2x, v2z);
    if (len1 < 1e-9 || len2 < 1e-9) return null;

    const u1x = v1x / len1;
    const u1z = v1z / len1;
    const u2x = v2x / len2;
    const u2z = v2z / len2;

    const dot = u1x * u2x + u1z * u2z;
    const theta = Math.acos(Math.max(-1, Math.min(1, dot)));
    if (theta < 0.001 || Math.abs(theta - Math.PI) < 0.001) return null;

    const d = r / Math.tan(theta / 2);
    if (d - len1 > 0.001 || d - len2 > 0.001) return null;

    // Use resolver-computed arc center if available, otherwise compute
    let center: { x: number; z: number };
    if (c.cx !== undefined && c.cz !== undefined) {
      center = { x: c.cx, z: c.cz };
    } else {
      const n1x = -u1z; const n1z = u1x;
      const cross = u1x * u2z - u1z * u2x;
      const sign = cross > 0 ? 1 : -1;
      center = { x: c.x - u1x * d + sign * n1x * r, z: c.z - u1z * d + sign * n1z * r };
    }

    const start = { x: c.x - u1x * d, z: c.z - u1z * d };
    const end = { x: c.x + u2x * d, z: c.z + u2z * d };

    const startAngle = Math.atan2(start.z - center.z, start.x - center.x);
    let endAngle = Math.atan2(end.z - center.z, end.x - center.x);
    let delta = endAngle - startAngle;
    while (delta <= -Math.PI) delta += 2 * Math.PI;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    const clockwise = delta < 0;

    return { center, radius: r, start, startAngle, endAngle, clockwise };
  }

  private signedArea(pts: { x: number; y: number }[]): number {
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return area;
  }

  private renderWallRun(el: Extract<SceneElement, { type: 'wall_run' }>) {
    for (let i = 0; i < el.points.length - 1; i++) {
      const a = el.points[i];
      const b = el.points[i + 1];
      const mat = new THREE.MeshStandardMaterial({ color: DEFAULT_PAINT, roughness: 0.85 });
      const mesh = this.renderBox(a.x, a.z, b.x, b.z, el.height, WALL_THICKNESS, mat);
      mesh.userData = { type: 'wall', objectId: `${el.id}:${i}`, wallType: 'interior' };
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.wallMeshes.push(mesh);
    }
  }

  private slidingDoorGroups = new Map<string, THREE.Group>();

  refreshSlidingDoor(el: Extract<SceneElement, { type: 'sliding_door_run' }>): void {
    this.renderSlidingDoorRun(el);
  }

  private renderSlidingDoorRun(el: Extract<SceneElement, { type: 'sliding_door_run' }>) {
    const pts = el.points;
    if (!pts || pts.length < 2) {
      console.error(`[HouseScene] sliding_door_run "${el.id}" 缺少 points`);
      return;
    }
    const oldGroup = this.slidingDoorGroups.get(el.id);
    if (oldGroup) this.scene.remove(oldGroup);
    const group = new THREE.Group();
    const [a, b] = [pts[0], pts[1]];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const ang = Math.atan2(b.z - a.z, b.x - a.x);
    const nx = -(b.z - a.z) / len;
    const nz = (b.x - a.x) / len;
    const railMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.6, roughness: 0.4 });
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 0.16), railMat);
    rail.position.set((a.x + b.x) / 2, el.height + 0.03, (a.z + b.z) / 2);
    rail.rotation.y = ang;
    group.add(rail);
    const panels = el.panels ?? 3;
    const open = el.open ?? true;
    const panelW = len / panels;
    // DEC-044 形态：极窄边哑光黑框（25mm 可视面）+ 竖纹长虹玻璃（程序化棱纹贴图）
    const FRAME_W = 0.025;
    const FRAME_D = 0.04;
    const outerW = panelW - 0.06;
    const paneW = outerW - 2 * FRAME_W;
    const paneH = el.height - 2 * FRAME_W;
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x141414, metalness: 0.5, roughness: 0.45 });
    const glass = this.makeFlutedGlassMaterial(paneW);
    for (let i = 0; i < panels; i++) {
      // open 布局（2026-08-26 DEC-044）：一固三活单向叠收——东端（points 末段）固定扇不动，
      // 其余活动扇全部叠收至东端、贴固定扇停成一摞（落在冰箱侧板前的死段，与冰箱并排）；
      // 西侧让出 len-panelW 的完整通道
      const along = open
        ? len - panelW / 2 - (panels - 1 - i) * 0.08
        : (i + 0.5) * panelW;
      const track = i * 0.05 - 0.05;
      const ud = { objectId: `sliding_door:${el.id}`, hoverable: true, type: 'sliding_door' };
      const panel = new THREE.Group();
      // 玻璃芯板（内嵌框内）
      const pane = new THREE.Mesh(new THREE.BoxGeometry(paneW, paneH, 0.008), glass);
      pane.userData = ud;
      panel.add(pane);
      // 上下横梃
      for (const ySign of [1, -1]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(outerW, FRAME_W, FRAME_D), frameMat);
        bar.position.y = ySign * (el.height / 2 - FRAME_W / 2);
        bar.userData = ud;
        panel.add(bar);
      }
      // 左右竖梃
      for (const xSign of [1, -1]) {
        const stile = new THREE.Mesh(new THREE.BoxGeometry(FRAME_W, paneH, FRAME_D), frameMat);
        stile.position.x = xSign * (outerW / 2 - FRAME_W / 2);
        stile.userData = ud;
        panel.add(stile);
      }
      panel.position.set(
        a.x + (b.x - a.x) * (along / len) + nx * track,
        el.height / 2,
        a.z + (b.z - a.z) * (along / len) + nz * track
      );
      panel.rotation.y = ang;
      group.add(panel);
    }
    this.scene.add(group);
    this.slidingDoorGroups.set(el.id, group);
  }

  private renderGlassInfill(el: Extract<SceneElement, { type: 'glass_infill' }>) {
    const pts = (el as { points?: CurtainPoint[] }).points;
    if (!pts || pts.length < 2) {
      console.error(`[HouseScene] glass_infill "${el.id}" 缺少 points（wall 引用未解析）`);
      return;
    }
    const [a, b] = pts;
    const cx = (a.x + b.x) / 2;
    const cz = (a.z + b.z) / 2;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(len, GLASS_THICKNESS), el.height, GLASS_THICKNESS),
      this.makeGlassMaterial()
    );
    mesh.position.set(cx, el.sill + el.height / 2, cz);
    mesh.rotation.y = Math.atan2(b.z - a.z, b.x - a.x);
    mesh.userData = { type: 'glass_infill', objectId: el.id };
    mesh.castShadow = false;
    this.scene.add(mesh);
    this.glassMeshes.push(mesh);
  }

  // 淋浴玻璃隔断：points 折线逐段生成透明玻璃（无碰撞，2026-08-21）
  private renderShowerScreen(el: Extract<SceneElement, { type: 'shower_screen' }>) {
    const sill = el.sill ?? 0;
    for (let i = 0; i < el.points.length - 1; i++) {
      const a = el.points[i];
      const b = el.points[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 1e-9) continue;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(len, GLASS_THICKNESS), el.height, GLASS_THICKNESS),
        this.makeGlassMaterial()
      );
      mesh.position.set((a.x + b.x) / 2, sill + el.height / 2, (a.z + b.z) / 2);
      mesh.rotation.y = Math.atan2(b.z - a.z, b.x - a.x);
      mesh.userData = { type: 'shower_screen', objectId: el.id };
      mesh.castShadow = false;
      this.scene.add(mesh);
      this.glassMeshes.push(mesh);
    }
  }

  private renderFloorRegion(el: Extract<SceneElement, { type: 'floor_region' }>) {
    const shape = this.buildRoundedShape(el.points);
    const geometry = new THREE.ShapeGeometry(shape);
    const mat = new THREE.MeshStandardMaterial({
      color: DEFAULT_FLOOR,
      roughness: 0.75,
      metalness: 0.05,
    });
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.set(1, -1, 1);
    mesh.position.y = 0.006;
    mesh.userData = { type: 'floor_region', objectId: el.id, roomId: el.room, follow: el.follow };
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.floorMeshes.push(mesh);
  }

  private detectInteriorFlip(pts: CurtainPoint[]): boolean {
    const p0 = pts[0];
    const pn = pts[pts.length - 1];
    const dx = pn.x - p0.x;
    const dz = pn.z - p0.z;
    if (Math.hypot(dx, dz) < 1e-9) return false;
    let mx = 0, mz = 0;
    for (const p of pts) { mx += p.x; mz += p.z; }
    mx /= pts.length;
    mz /= pts.length;
    const rooms = Object.values(this.rooms);
    if (rooms.length === 0) return false;
    let best: RoomObject | undefined;
    let bestDist = Infinity;
    for (const r of rooms) {
      const d = Math.hypot(r.x - mx, r.z - mz);
      if (d < bestDist) { bestDist = d; best = r; }
    }
    if (!best) return false;
    const cross = dx * (best.z - mz) - dz * (best.x - mx);
    return cross < 0;
  }

  private renderBaySill(el: Extract<SceneElement, { type: 'bay_sill' }>) {
    if (el.points.length < 2) return;
    const pts = el.points as CurtainPoint[];
    const flip = this.detectInteriorFlip(pts);
    const shape = this.buildCurtainShape(pts, false, el.depth, true, flip);
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: el.height, bevelEnabled: false, steps: 1 });
    const concrete = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.9 });
    const mesh = new THREE.Mesh(geometry, concrete);
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.set(1, -1, 1);
    mesh.position.y = el.sill;
    mesh.userData = { type: 'bay_sill', objectId: el.id };
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  private createPlatform(p: ProjectData['house']['platform'] & { id: string; name: string }) {
    const height = p.height ?? 0.15;
    const geo = new THREE.BoxGeometry(p.width, height, p.depth);
    const mat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.8 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(p.x, height / 2, p.z);
    mesh.userData = { roomId: p.id, objectId: 'platform_boundary', type: 'platform' };
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    this.platform = p;

    this.rooms[p.id] = { ...p };
  }

  private placeFurnitureFixtures(furnishings: FurnishingsYaml): THREE.Group[] {
    const placed: THREE.Group[] = [];
    for (const [roomId, items] of Object.entries(furnishings)) {
      let index = 0;
      for (const item of items) {
        if (item.x === undefined || item.z === undefined) continue;
        const model = item.type === 'kitchen_cabinet_run' && item.length !== undefined && item.depth !== undefined
          ? buildKitchenCabinetRun({
            length: item.length,
            depth: item.depth,
            cabinetHeight: item.cabinetHeight,
            countertopThickness: item.countertopThickness,
          })
          : item.type === 'bath_side_cabinet' && item.length !== undefined && item.depth !== undefined
            ? buildBathSideCabinetRun({ length: item.length, depth: item.depth, cabinetHeight: item.cabinetHeight })
            : item.type === 'wardrobe_180' && item.cabinetHeight !== undefined
              ? buildWardrobe180(item.cabinetHeight)
            : buildFixture(item.type);
        if (!model) continue;
        model.position.set(item.x, 0, item.z);
        model.rotation.y = THREE.MathUtils.degToRad(item.rotation ?? 0);
        model.userData = { objectId: `furniture:${roomId}:${item.type}:${index}`, hoverable: true, type: 'furniture', roomId };
        this.scene.add(model);
        model.traverse((object) => {
          if (object instanceof THREE.Mesh && object.userData.surface === 'countertop') this.countertopMeshes.push(object);
        });
        placed.push(model);
        index++;
      }
    }
    return placed;
  }

  private projectInfrastructurePoint(point: { x: number; z: number; wall?: string; wallSide?: WallSide }): { x: number; z: number; rotation: number; wallSide?: WallSide } | null {
    if (!point.wall) return null;
    const segments = this.wallSegmentIndex.get(point.wall);
    if (!segments || segments.length === 0) return null;

    const worldDirections: Record<WallSide, { x: number; z: number }> = {
      north: { x: 0, z: -1 },
      south: { x: 0, z: 1 },
      east: { x: 1, z: 0 },
      west: { x: -1, z: 0 },
    };
    let best: { x: number; z: number; rotation: number; distance: number; wallSide?: WallSide } | undefined;
    for (const segment of segments) {
      const dx = segment.x2 - segment.x1;
      const dz = segment.z2 - segment.z1;
      const lengthSquared = dx * dx + dz * dz;
      if (lengthSquared < 1e-12) continue;
      const t = Math.max(0, Math.min(1, ((point.x - segment.x1) * dx + (point.z - segment.z1) * dz) / lengthSquared));
      const x = segment.x1 + t * dx;
      const z = segment.z1 + t * dz;
      const distance = Math.hypot(point.x - x, point.z - z);
      const length = Math.sqrt(lengthSquared);
      const ux = dx / length;
      const uz = dz / length;
      const left = { x: -uz, z: ux };
      const right = { x: uz, z: -ux };
      const authoredSide = (point.x - x) * left.x + (point.z - z) * left.z;
      let normal = authoredSide < -1e-9 ? right : left;
      if (point.wallSide) {
        const direction = worldDirections[point.wallSide];
        normal = left.x * direction.x + left.z * direction.z >= right.x * direction.x + right.z * direction.z ? left : right;
      }
      const rotation = Math.atan2(normal.x, normal.z);
      best = !best || distance < best.distance
        ? { x, z, rotation, distance, wallSide: point.wallSide }
        : best;
    }
    return best ? { x: best.x, z: best.z, rotation: best.rotation, wallSide: best.wallSide } : null;
  }

  private placeInfrastructureModel(
    model: THREE.Group,
    point: { x: number; z: number; wall?: string; wallSide?: WallSide },
    y: number,
    dimensions?: { depth?: number; frontProjection?: number },
  ): void {
    const projected = this.projectInfrastructurePoint(point);
    if (!projected) {
      model.position.set(point.x, y, point.z);
      return;
    }
    const wallThickness = WALL_THICKNESS;
    const wallGap = 0.005;
    const fixtureHalfThickness = 0.01;
    const nx = Math.sin(projected.rotation);
    const nz = Math.cos(projected.rotation);
    const offset = wallThickness / 2 + wallGap + fixtureHalfThickness - (dimensions?.frontProjection ?? 0);
    model.position.set(projected.x + nx * offset, y, projected.z + nz * offset);
    model.rotation.y = projected.rotation;
  }

  placeInfrastructureFixtures(
    electrical: Array<{ id: string; room: string; type: string; x: number; z: number; height?: number; mount_height?: number; body_height?: number; width?: number; depth?: number; wall?: string; wallSide?: WallSide; status?: string; position_status?: string }>,
    plumbing: Array<{ id: string; room: string; type: string; x: number; z: number; height?: number; wall?: string; wallSide?: WallSide }>,
  ): void {
    const infraMeshes: THREE.Group[] = [];
    const typeMap: Record<string, string> = {
      socket: 'socket',
      switch: 'switch',
      switch_2way: 'switch_2way',
      network: 'network',
      usb: 'usb',
      floor_socket: 'floor_socket',
      strong_panel: 'strong_panel',
      weak_panel: 'weak_panel',
      faucet: 'faucet',
      faucet_outdoor: 'faucet_outdoor',
      toilet: 'toilet',
      shower: 'shower',
      drain: 'drain',
      washer: 'washer',
    };
    const panelDimensions: Record<string, { width: number; depth: number; height: number; frontProjection: number }> = {
      // Recipe local z positions place the door slightly behind the nominal body front.
      // Use the authored visible front projection so the developer-reserved door sits flush with the wall face.
      strong_panel: { width: 0.60, depth: 0.16, height: 1.00, frontProjection: 0.08 },
      weak_panel: { width: 0.45, depth: 0.14, height: 0.75, frontProjection: 0.13 },
    };

    for (const p of electrical) {
      const fixtureType = typeMap[p.type];
      if (!fixtureType) continue;
      const model = buildFixture(fixtureType);
      if (!model) continue;
      const dimensions = panelDimensions[p.type];
      const panelHeight = dimensions ? (p.body_height ?? p.height ?? dimensions.height) : undefined;
      const mountHeight = dimensions ? (p.mount_height ?? 0) : undefined;
      if (dimensions) {
        model.scale.set(
          (p.width ?? dimensions.width) / dimensions.width,
          panelHeight! / dimensions.height,
          (p.depth ?? dimensions.depth) / dimensions.depth,
        );
      }
      this.placeInfrastructureModel(
        model,
        p,
        dimensions ? mountHeight! + panelHeight! / 2 : p.type === 'floor_socket' ? 0.05 : p.height!,
        dimensions ? { frontProjection: dimensions.frontProjection } : undefined,
      );
      model.userData = {
        objectId: 'electrical:' + p.id,
        hoverable: true,
        type: 'electrical',
        roomId: p.room,
        fixtureType: p.type,
        wallSide: p.wallSide,
        label: p.type === 'strong_panel' ? '强电箱' : p.type === 'weak_panel' ? '弱电箱' : undefined,
        status: p.status,
        position_status: p.position_status,
        mount_height: dimensions ? mountHeight : undefined,
        body_height: dimensions ? panelHeight : undefined,
        recessed: dimensions ? true : undefined,
        developer_reserved: dimensions ? true : undefined,
        dimensions: dimensions ? { width: p.width ?? dimensions.width, depth: p.depth ?? dimensions.depth, height: panelHeight } : undefined,
      };
      this.scene.add(model);
      infraMeshes.push(model);
    }

    for (const p of plumbing) {
      const fixtureType = typeMap[p.type];
      if (!fixtureType) continue;
      const model = buildFixture(fixtureType);
      if (!model) continue;
      this.placeInfrastructureModel(model, p, p.height ?? 0.5);
      model.userData = { objectId: 'plumbing:' + p.id, hoverable: true, type: 'plumbing', roomId: p.room, fixtureType: p.type, wallSide: p.wallSide };
      this.scene.add(model);
      infraMeshes.push(model);
    }
  }

  private addOpeningMarker(
    group: THREE.Group,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    kind: string
  ) {
    const mat = new THREE.MeshBasicMaterial({
      color: kind.includes('door') ? 0x3b82f6 : 0x93c5fd,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.set(x, y, z);
    if (Math.abs(z) > Math.abs(x)) mesh.rotation.y = Math.PI;
    group.add(mesh);
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

  private ceilingZoneGroups: THREE.Group[] = [];

  async loadCeilingZones(): Promise<void> {
    let zones: CeilingZoneSpec[];
    try {
      const res = await fetch('/api/annotations/ceiling');
      zones = (await res.json()) as CeilingZoneSpec[];
    } catch (err) {
      console.warn('[ceiling] load failed, skipped', err);
      return;
    }
    if (!Array.isArray(zones)) {
      console.warn('[ceiling] unexpected response shape, skipped');
      return;
    }
    this.renderCeilingZones(zones);
  }

  private renderCeilingZones(zones: CeilingZoneSpec[]): void {
    for (const g of this.ceilingZoneGroups) {
      this.scene.remove(g);
    }
    this.ceilingZoneGroups = [];
    this.ceilingMeshes = this.ceilingMeshes.filter((m) => m.userData.type !== 'ceiling_zone_solid');

    for (const zone of zones) {
      const group = buildCeilingZone(zone);
      if (!group) {
        if (zone.type !== 'ac_indoor' && zone.type !== 'none') {
          console.warn(`[ceiling] skipped zone ${zone.id} (type=${zone.type})`);
        }
        continue;
      }
      this.scene.add(group);
      this.ceilingZoneGroups.push(group);
      group.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.userData.type = 'ceiling_zone_solid';
          mesh.userData.objectId = zone.id;
          mesh.userData.roomId = zone.room;
          this.ceilingMeshes.push(mesh);
        }
      });
    }
    this.setCeilingVisible(this._mode === 'first-person');
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
    };
    if (objectId.startsWith('electrical:')) {
      const pointName = objectId.slice('electrical:'.length);
      const label = fixtureLabel[fixtureType ?? ''] ?? '电气';
      const sideLabel = wallSide ? ` · ${roomId === 'kitchen' && wallSide === 'west' ? '厨房侧' : roomId === 'entry_garden' && wallSide === 'east' ? '入户花园侧' : wallSide === 'east' ? '东侧' : wallSide === 'west' ? '西侧' : wallSide === 'north' ? '北侧' : '南侧'}` : '';
      return roomName ? `${roomName} · ${label} · ${pointName}${sideLabel}` : `${label} · ${pointName}${sideLabel}`;
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

  raycastFromScreenCenter(options?: { hoverableOnly?: boolean }): HoverTarget | null {
    const { hoverableOnly = false } = options ?? {};
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const intersects = this.raycaster.intersectObjects(this.scene.children, true);
    for (const hit of intersects) {
      let target: THREE.Object3D | null = hit.object;
      while (target && !target.userData?.objectId && !target.userData?.roomId) {
        target = target.parent;
      }
      const data = target?.userData;
      if (hoverableOnly && data?.hoverable === false) continue;
      if (data?.objectId || data?.roomId) {
        const id = (data.objectId as string) ?? (data.roomId as string);
        const type = (data.type as string) ?? (data.part as string) ?? 'room';
        const room = data.roomId as string | undefined;
        const name = this.objectDisplayName(id, type, room, data.fixtureType as string | undefined, data.wallSide as WallSide | undefined);
        return { objectId: id, name, type, room, curtainId: data.curtainId as string | undefined, curtainKind: data.curtainId ? this.curtainRegistry.get(data.curtainId as string)?.kind : undefined, layer: data.layer as HoverTarget['layer'] };
      }
    }
    return null;
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
    const intersects = this.raycaster.intersectObjects(this.scene.children, true);
    for (const hit of intersects) {
      let target: THREE.Object3D | null = hit.object;
      while (target && !target.userData?.objectId && !target.userData?.roomId) {
        target = target.parent;
      }
      const data = target?.userData;
      if (data?.objectId || data?.roomId) {
        const id = (data.objectId as string) ?? (data.roomId as string);
        const type = (data.type as string) ?? (data.part as string) ?? 'room';
        const room = data.roomId as string | undefined;
        const name = this.objectDisplayName(id, type, room, data.fixtureType as string | undefined, data.wallSide as WallSide | undefined);
        this.onClickCallback?.({ objectId: id, name, type, room, curtainId: data.curtainId as string | undefined, curtainKind: data.curtainId ? this.curtainRegistry.get(data.curtainId as string)?.kind : undefined, layer: data.layer as HoverTarget['layer'] });
        return;
      }
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
    this.hideGhost();
    const dims = FURNITURE_DIMS[type];
    const geo = new THREE.BoxGeometry(dims?.width ?? 1, 0.8, dims?.depth ?? 1);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x44aaff, transparent: true, opacity: 0.4, depthWrite: false,
    });
    this.ghostMesh = new THREE.Mesh(geo, mat);
    this.ghostMesh.position.set(x, 0, z);
    this.ghostMesh.rotation.y = rotation * Math.PI / 180;
    this.scene.add(this.ghostMesh);
  }

  hideGhost(): void {
    if (this.ghostMesh) {
      this.scene.remove(this.ghostMesh);
      this.ghostMesh.geometry.dispose();
      (this.ghostMesh.material as THREE.Material).dispose();
      this.ghostMesh = null;
    }
  }

  updateGhostPosition(x: number, z: number, rotation?: number): void {
    if (this.ghostMesh) {
      this.ghostMesh.position.set(x, 0, z);
      if (rotation !== undefined) {
        this.ghostMesh.rotation.y = rotation * Math.PI / 180;
      }
    }
  }

  getGhostPosition(): { x: number; z: number } | null {
    if (this.ghostMesh) {
      return { x: this.ghostMesh.position.x, z: this.ghostMesh.position.z };
    }
    return null;
  }

  dispose(): void {
    window.removeEventListener('resize', this.boundOnWindowResize);
    this.hvacRenderer.dispose();
    this.mepRenderer.dispose();
    this.renderer.dispose();
  }
}
