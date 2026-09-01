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
  CaptureOptions,
  CaptureBounds,
  RoomAuditCaptureOptions,
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
import { ElectricalTopologyRenderer } from './ElectricalTopologyRenderer.js';
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
  private ceilingRaycast: Array<THREE.Mesh['raycast']> = [];
  private curtainRegistry = new Map<string, CurtainRegistryEntry>();
  private curtainPresentationState: CurtainPresentationState = { default: 'open', roomOverrides: {}, updatedAt: '' };
  private glassMeshes: THREE.Mesh[] = [];
  private furnitureMeshes: THREE.Group[] = [];
  private countertopMeshes: THREE.Mesh[] = [];
  private electricalMeshes: THREE.Group[] = [];
  private infrastructureMeshes: THREE.Group[] = [];
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
  private auditFurnishings: FurnishingsYaml = {};
  private auditSceneElements: SceneElement[] = [];
  private auditPlumbing: PlumbingPoint[] = [];
  private textureManager = new TextureManager();
  private envManager: EnvironmentManager;
  private topDownLayoutBounds: LayoutBounds = DEFAULT_LAYOUT_BOUNDS;
  private readonly ORBIT_POSITION = new THREE.Vector3(7.4, 14, 19.2);
  private readonly ORBIT_TARGET = new THREE.Vector3(7.4, 0, 3.65);
  private hvacRenderer: HvacDiagramRenderer;
  private mepRenderer: MepCoordinationRenderer;
  private electricalTopologyRenderer: ElectricalTopologyRenderer;
  private mepOverviewState?: {
    ceiling: boolean;
    infrastructure: boolean;
    hvac: boolean;
    mep: boolean;
    mepOpacityMultiplier: number;
    ceilingOpacity: number;
    electricalTopology: boolean;
  };
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
    this.electricalTopologyRenderer = new ElectricalTopologyRenderer(this.viewOnlyRoot);
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

  async captureFloorPlan(options: CaptureOptions = {}): Promise<string> {
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
    this.viewOnlyRoot.visible = options.includeViewOnly === true;
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
      const bounds = options.bounds ?? this.topDownLayoutBounds;
      const padding = options.bounds ? 0.12 : 0;
      const minX = bounds.minX - padding;
      const maxX = bounds.maxX + padding;
      const minZ = bounds.minZ - padding;
      const maxZ = bounds.maxZ + padding;
      const width = maxX - minX;
      const depth = maxZ - minZ;
      const size = options.size ?? 2048;
      const aspect = width / depth;
      const renderWidth = Math.round(size * Math.max(aspect, 1));
      const renderHeight = Math.round(size / Math.min(aspect, 1));

      const centerX = (minX + maxX) / 2;
      const centerZ = (minZ + maxZ) / 2;
      const orthoCam = options.view === 'high-perspective'
        ? new THREE.PerspectiveCamera(48, renderWidth / renderHeight, 0.1, 200)
        : new THREE.OrthographicCamera(width / -2, width / 2, depth / 2, depth / -2, 0.1, 200);
      if (options.view === 'high-perspective') {
        orthoCam.position.set(centerX + width * 0.72, 8.5, centerZ + depth * 0.78);
        orthoCam.lookAt(centerX, 0.7, centerZ);
      } else {
        orthoCam.position.set(centerX, 50, centerZ);
        orthoCam.up.set(0, 0, -1);
        orthoCam.lookAt(centerX, 0, centerZ);
      }
      orthoCam.updateProjectionMatrix();

      renderTarget = new THREE.WebGLRenderTarget(renderWidth, renderHeight);
      this.renderer.setRenderTarget(renderTarget);
      // 渲染 scene 而非孤立 exportRoot：灯光/scene.environment 挂在 scene 上，
      // 只渲染 exportRoot 会丢光导致全黑。capture 前已隐藏 viewOnlyRoot/topicGroup，
      // 因此画面仍只包含 HOUSE_EXPORT 内容。
      this.renderer.render(this.scene, orthoCam);

      const buffer = new Uint8Array(renderWidth * renderHeight * 4);
      this.renderer.readRenderTargetPixels(renderTarget, 0, 0, renderWidth, renderHeight, buffer);
      return this.rgbaToPng(buffer, renderWidth, renderHeight, options.bounds, options.view);
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

  async captureRoomAudit(options: RoomAuditCaptureOptions): Promise<string> {
    await this.whenReady();
    const bounds = options.bounds;
    const size = options.size ?? 1800;
    const width = Math.round(size * Math.max((bounds.maxX - bounds.minX) / (bounds.maxZ - bounds.minZ), 1));
    const height = Math.round(size / Math.min((bounds.maxX - bounds.minX) / (bounds.maxZ - bounds.minZ), 1));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const pad = 110;
    const sx = (width - pad * 2) / (bounds.maxX - bounds.minX);
    const sz = (height - pad * 2) / (bounds.maxZ - bounds.minZ);
    const point = (x: number, z: number) => ({ x: pad + (x - bounds.minX) * sx, y: height - pad - (z - bounds.minZ) * sz });
    const rect = (minX: number, maxX: number, minZ: number, maxZ: number, fill: string, stroke = fill, lineWidth = 3) => {
      const a = point(minX, minZ); const b = point(maxX, maxZ);
      ctx.fillStyle = fill; ctx.fillRect(a.x, b.y, b.x - a.x, a.y - b.y);
      ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.strokeRect(a.x, b.y, b.x - a.x, a.y - b.y);
    };
    const line = (x1: number, z1: number, x2: number, z2: number, color: string, lineWidth = 8, dash: number[] = []) => {
      const a = point(x1, z1); const b = point(x2, z2); ctx.beginPath(); ctx.setLineDash(dash); ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
    };
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
    const label = (text: string, x: number, z: number, _color = '#000000', font = 'bold 42px sans-serif') => {
      ctx.font = font;
      const metrics = ctx.measureText(text);
      const margin = 18;
      const p = point(x, z);
      const px = clamp(p.x, margin + metrics.width / 2, width - margin - metrics.width / 2);
      const fontSize = Number.parseFloat(font) || 42;
      const py = clamp(p.y, margin + fontSize, height - margin);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(px - metrics.width / 2 - 12, py - fontSize - 10, metrics.width + 24, fontSize + 20);
      ctx.fillStyle = '#000000';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 8;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.strokeText(text, px, py);
      ctx.fillText(text, px, py);
      ctx.textAlign = 'start';
    };
    ctx.fillStyle = '#f8fafc'; ctx.fillRect(0, 0, width, height);
    rect(bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ, '#eef2f6', '#17212b', 12);
    const aabb = (object: THREE.Object3D | undefined) => { if (!object) return undefined; const box = new THREE.Box3().setFromObject(object); return { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z }; };
    const element = (id: string) => this.auditSceneElements.find((candidate) => candidate.id === id);
    const points = (id: string) => {
      const candidate = element(id) as (SceneElement & { points?: Array<{ x: number; z: number }> }) | undefined;
      return candidate?.points;
    };
    const segmentBox = (segment: Array<{ x: number; z: number }> | undefined) => {
      if (!segment || segment.length < 2) return undefined;
      return { minX: Math.min(...segment.map((p) => p.x)), maxX: Math.max(...segment.map((p) => p.x)), minZ: Math.min(...segment.map((p) => p.z)), maxZ: Math.max(...segment.map((p) => p.z)) };
    };
    const configuredFurnishing = this.auditFurnishings.guest_bath?.find((item) => item.type === 'vanity' && item.x !== undefined && item.z !== undefined);
    const vanityBox = configuredFurnishing ? { minX: configuredFurnishing.x! - 0.20, maxX: configuredFurnishing.x! + 0.20, minZ: configuredFurnishing.z! - 0.40, maxZ: configuredFurnishing.z! + 0.40 } : aabb(this.findAuditObject('furniture:guest_bath:vanity:0'));
    const configuredToilet = this.auditFurnishings.guest_bath?.find((item) => item.type === 'toilet' && item.x !== undefined && item.z !== undefined);
    const toiletBox = configuredToilet ? { minX: configuredToilet.x! - 0.225, maxX: configuredToilet.x! + 0.325, minZ: configuredToilet.z! - 0.20, maxZ: configuredToilet.z! + 0.20 } : aabb(this.findAuditObject('furniture:guest_bath:toilet:1'));
    const screenBox = segmentBox(points('shower_screen_gbath'));
    const doorBox = segmentBox(points('gbath_west_glass_door'));
    const shower = this.auditPlumbing.find((candidate) => candidate.room === 'guest_bath' && candidate.type === 'shower');
    const showerPoint = shower ? { x: shower.x, z: shower.z } : { x: 7.10, z: 2.45 };
    const dividerZ = screenBox ? (screenBox.minZ + screenBox.maxZ) / 2 : 2.80;
    const vanitySouth = vanityBox?.minZ ?? dividerZ;
    rect(bounds.minX, bounds.maxX, dividerZ, bounds.maxZ, 'rgba(245, 158, 11, 0.18)', '#d97706', 4);
    rect(bounds.minX, bounds.maxX, bounds.minZ, dividerZ, 'rgba(14, 165, 233, 0.18)', '#0284c7', 4);
    rect(bounds.minX, bounds.maxX, vanitySouth, bounds.maxZ, 'rgba(168, 85, 247, 0.16)', '#7e22ce', 3);
    for (const candidate of this.auditSceneElements) {
      if (candidate.type === 'wall') {
        const x1 = candidate.x1; const z1 = candidate.z1; const x2 = candidate.x2; const z2 = candidate.z2;
        if (Math.max(x1, x2) >= bounds.minX && Math.min(x1, x2) <= bounds.maxX && Math.max(z1, z2) >= bounds.minZ && Math.min(z1, z2) <= bounds.maxZ) line(x1, z1, x2, z2, '#17212b', 12);
      }
    }
    const arrowWest = (x: number, z: number, _color = '#000000', length = 0.7) => {
      const head = Math.max(24, Math.min(42, Math.abs(sx) * 0.14));
      const margin = 24;
      const center = point(x, z);
      const startX = clamp(center.x + Math.abs(sx) * length / 2, margin + head, width - margin);
      const endX = clamp(center.x - Math.abs(sx) * length / 2, margin, width - margin - head);
      const y = clamp(center.y, margin + head, height - margin - head);
      ctx.strokeStyle = '#000000'; ctx.fillStyle = '#000000'; ctx.lineWidth = 18; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(startX, y); ctx.lineTo(endX, y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(endX, y); ctx.lineTo(endX + head, y - head * 0.62); ctx.lineTo(endX + head, y + head * 0.62); ctx.closePath(); ctx.fill(); ctx.lineCap = 'butt';
    };
    const drawVanity = (box: ReturnType<typeof aabb>) => {
      if (!box) return; const w = box.maxX - box.minX; const d = box.maxZ - box.minZ; const inset = Math.min(w, d) * 0.16;
      rect(box.minX, box.maxX, box.minZ, box.maxZ, 'rgba(124, 58, 237, 0.28)', '#4c1d95', 8);
      line(box.minX, box.minZ, box.minX, box.maxZ, '#2e1065', 14);
      rect(box.minX + inset, box.maxX - inset, box.minZ + inset, box.maxZ - inset, 'rgba(255,255,255,0.82)', '#6d28d9', 5);
      const basin = point((box.minX + box.maxX) / 2, (box.minZ + box.maxZ) / 2); ctx.fillStyle = '#bfdbfe'; ctx.strokeStyle = '#1e3a8a'; ctx.lineWidth = 5; ctx.beginPath(); ctx.ellipse(basin.x, basin.y, Math.max(18, Math.abs(sx) * w * 0.19), Math.max(12, Math.abs(sz) * d * 0.22), 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      const markerZ = clamp(box.minZ + d * 0.5, bounds.minZ + 0.45, bounds.maxZ - 0.45);
      arrowWest((box.minX + box.maxX) / 2, markerZ); label('台盆正面←西', (box.minX + box.maxX) / 2, markerZ - 0.32);
    };
    const drawToilet = (box: ReturnType<typeof aabb>) => {
      if (!box) return; const w = box.maxX - box.minX; const d = box.maxZ - box.minZ; const tankW = Math.max(w * 0.28, 0.12); const tankX = box.maxX - tankW;
      rect(box.minX, box.maxX, box.minZ, box.maxZ, 'rgba(220, 38, 38, 0.16)', '#991b1b', 7); rect(tankX, box.maxX, box.minZ, box.maxZ, 'rgba(127, 29, 29, 0.72)', '#450a0a', 6);
      const bowl = point((box.minX + tankX) / 2, (box.minZ + box.maxZ) / 2); ctx.fillStyle = '#fee2e2'; ctx.strokeStyle = '#991b1b'; ctx.lineWidth = 6; ctx.beginPath(); ctx.ellipse(bowl.x, bowl.y, Math.max(20, Math.abs(sx) * w * 0.25), Math.max(14, Math.abs(sz) * d * 0.32), 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      const markerZ = clamp(box.minZ + d * 0.5, bounds.minZ + 0.45, bounds.maxZ - 0.45);
      arrowWest((box.minX + box.maxX) / 2, markerZ); label('马桶朝西', (box.minX + box.maxX) / 2, markerZ + 0.32);
    };
    const drawShower = (box: ReturnType<typeof aabb>) => {
      if (!box) return; const x = box.maxX - Math.max(0.14, (box.maxX - box.minX) * 0.12); const z = clamp(bounds.minZ + Math.max(0.28, (dividerZ - bounds.minZ) * 0.28), bounds.minZ + 0.45, bounds.maxZ - 0.45); const p = point(x, z);
      ctx.fillStyle = '#0f766e'; ctx.strokeStyle = '#064e3b'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(p.x, p.y, 16, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      line(x - 0.08, z, x - 0.42, z, '#000000', 12); line(x - 0.18, z - 0.12, x - 0.42, z, '#000000', 10); line(x - 0.18, z + 0.12, x - 0.42, z, '#000000', 10);
      label('花洒朝西', clamp(x - 0.55, bounds.minX + 0.7, bounds.maxX - 0.7), z + 0.32);
    };
    if (screenBox) { line(screenBox.minX, dividerZ, screenBox.maxX, dividerZ, '#075bd5', 24); label(`玻璃隔断 z=${dividerZ.toFixed(2)}`, (screenBox.minX + screenBox.maxX) / 2, dividerZ - 0.32); }
    if (doorBox) { const doorWidth = doorBox.maxX - doorBox.minX; const d0 = point(doorBox.minX, dividerZ); const d1 = point(doorBox.maxX, dividerZ); ctx.fillStyle = 'rgba(34, 197, 94, 0.42)'; ctx.strokeStyle = '#15803d'; ctx.lineWidth = 10; ctx.fillRect(d0.x, d0.y - 18, d1.x - d0.x, 36); ctx.strokeRect(d0.x, d0.y - 18, d1.x - d0.x, 36); ctx.fillStyle = '#166534'; ctx.beginPath(); ctx.arc(d0.x, d0.y, 10, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#166534'; ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(d0.x, d0.y, Math.abs(sx) * doorWidth, Math.PI, Math.PI * 1.5); ctx.stroke(); label('西侧玻璃门←向北开启', (doorBox.minX + doorBox.maxX) / 2, dividerZ + 0.58); }
    drawVanity(vanityBox); drawToilet(toiletBox); drawShower({ minX: showerPoint.x, maxX: showerPoint.x, minZ: showerPoint.z, maxZ: showerPoint.z });
    label(`马桶 AABB x[${toiletBox?.minX.toFixed(3) ?? 'n/a'},${toiletBox?.maxX.toFixed(3) ?? 'n/a'}] z[${toiletBox?.minZ.toFixed(3) ?? 'n/a'},${toiletBox?.maxZ.toFixed(3) ?? 'n/a'}]`, bounds.minX + 0.05, bounds.minZ + 0.28, '#991b1b', 'bold 20px sans-serif');
    line(bounds.minX, bounds.maxZ, bounds.maxX, bounds.maxZ, '#17212b', 12); label(`南墙 z=${bounds.maxZ.toFixed(2)}`, bounds.minX + 0.08, bounds.maxZ - 0.16, '#17212b', 'bold 20px sans-serif');
    line(bounds.minX, bounds.minZ, bounds.minX, bounds.maxZ, '#17212b', 12); line(bounds.maxX, bounds.minZ, bounds.maxX, bounds.maxZ, '#17212b', 12); label('南侧开放边', bounds.minX + 0.08, bounds.maxZ + 0.28, '#475569', 'bold 20px sans-serif');
    label('北 ↑', bounds.minX + 0.12, bounds.minZ + 0.34, '#111827'); label('东 →', bounds.maxX - 0.58, (bounds.minZ + bounds.maxZ) / 2, '#111827');
    ctx.font = 'bold 26px sans-serif'; ctx.fillStyle = '#111827'; ctx.fillText(`客卫专用平面审查 · bounds x[${bounds.minX.toFixed(2)}, ${bounds.maxX.toFixed(2)}] z[${bounds.minZ.toFixed(2)}, ${bounds.maxZ.toFixed(2)}]`, 30, 42);
    return canvas.toDataURL('image/png');
  }

  private findAuditObject(objectId: string): THREE.Object3D | undefined {
    let found: THREE.Object3D | undefined;
    this.scene.traverse((object) => { if (!found && object.userData?.objectId === objectId) found = object; });
    return found;
  }

  private rgbaToPng(rgba: Uint8Array, width: number, height: number, bounds?: CaptureBounds, view?: CaptureOptions['view']): string {
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
    if (bounds) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillRect(18, 18, Math.min(width - 36, 560), 72);
      ctx.fillStyle = '#18212b';
      ctx.font = 'bold 22px sans-serif';
      ctx.fillText(view === 'high-perspective' ? '客卫高位透视审查' : '客卫正俯瞰审查 · 北↑ 东→', 32, 48);
      ctx.font = '16px sans-serif';
      ctx.fillText(`bounds x[${bounds.minX.toFixed(2)}, ${bounds.maxX.toFixed(2)}] z[${bounds.minZ.toFixed(2)}, ${bounds.maxZ.toFixed(2)}] · toilet/vanity 朝西`, 32, 74);
      ctx.restore();
    }
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
    this.ceilingRaycast = [];
    this.curtainRegistry.clear();
    this.glassMeshes = [];
    this.furnitureMeshes = [];
    this.countertopMeshes = [];
    this.electricalMeshes = [];
    this.infrastructureMeshes = [];
    this.doorMeshes = [];
    this.slidingDoorGroups.clear();
    this.wallSegmentIndex.clear();
    this.roomMeta.clear();
    this.auditFurnishings = projectData.house.furnishings ?? {};
    this.auditSceneElements = projectData.house.sceneElements ?? [];
    this.auditPlumbing = [];

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

  loadMepCoordination(config: MepCoordination, sources: import('@shared/mep-hvac-coordination-schema').MepEndpointSources, lint?: import('@shared/mep-hvac-lint').MepLintResult): void {
    this.mepRenderer.attach(this.viewOnlyRoot);
    this.mepRenderer.render(config, sources, lint);
    this.mepRenderer.setVisible(false);
  }

  getMepRenderReport(): import('./MepCoordinationRenderer.js').MepRenderReport {
    return this.mepRenderer.getRenderReport();
  }

  getMepStatusSummary(): Record<'confirmed' | 'inferred' | 'pending' | 'requirement', number> {
    return this.mepRenderer.getRouteStatusSummary();
  }

  loadElectricalTopology(topology: import('@shared/types').ElectricalTopology, points: ElectricalPoint[]): void {
    this.electricalTopologyRenderer.render(topology, points);
    this.electricalTopologyRenderer.setVisible(false);
  }

  getElectricalTopologySummary(): import('./ElectricalTopologyRenderer.js').ElectricalTopologyRenderSummary {
    return this.electricalTopologyRenderer.getSummary();
  }

  clearElectricalTopology(): void {
    this.electricalTopologyRenderer.clear();
  }

  setElectricalTopologyVisible(visible: boolean): void {
    this.electricalTopologyRenderer.setVisible(visible);
    this.requestRender();
  }

  setElectricalTopologyPurposeVisible(purpose: import('@shared/types').ElectricalCircuitPurpose, visible: boolean): void {
    this.electricalTopologyRenderer.setPurposeVisible(purpose, visible);
    this.requestRender();
  }

  highlightElectricalCircuit(circuitId: string): void {
    this.electricalTopologyRenderer.highlightCircuit(circuitId);
    this.requestRender();
  }

  highlightMepRoute(routeId: string): void {
    this.mepRenderer.highlightRoute(routeId);
    this.requestRender();
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

  setMepOverviewVisible(visible: boolean, hvacVisible: boolean): void {
    if (visible) {
      if (!this.mepOverviewState) {
        this.mepOverviewState = {
          ceiling: this.ceilingMeshes[0]?.visible ?? false,
          infrastructure: this.infrastructureMeshes[0]?.visible ?? true,
          hvac: this.hvacRenderer.isCoordinationVisible(),
          mep: this.mepRenderer.group.visible,
          mepOpacityMultiplier: this.mepRenderer.getOpacityMultiplier(),
          ceilingOpacity: this.ceilingMeshes[0]?.material instanceof THREE.Material ? (this.ceilingMeshes[0].material as THREE.MeshStandardMaterial).opacity : 1,
          electricalTopology: this.electricalTopologyRenderer.group.visible,
        };
      }
      this.setCeilingVisible(true, 0.22);
      this.ceilingRaycast = this.ceilingMeshes.map((mesh) => mesh.raycast);
      this.ceilingMeshes.forEach((mesh) => { mesh.raycast = () => undefined; });
      this.infrastructureMeshes.forEach((mesh) => { mesh.visible = true; });
      this.setHvacCoordinationVisible(hvacVisible);
      // Overview must not flatten confirmed/inferred/pending base opacity differences.
      this.mepRenderer.setOpacityMultiplier(1);
      this.setMepCoordinationVisible(true);
      if (this.electricalTopologyRenderer.group.children.length > 0) {
        this.setElectricalTopologyVisible(true);
      }
    } else {
      const state = this.mepOverviewState;
      this.mepOverviewState = undefined;
      if (state) {
        this.setCeilingVisible(state.ceiling, state.ceilingOpacity);
        this.ceilingMeshes.forEach((mesh, index) => {
          const raycast = this.ceilingRaycast[index];
          if (raycast) mesh.raycast = raycast;
        });
        this.ceilingRaycast = [];
        this.infrastructureMeshes.forEach((mesh) => { mesh.visible = state.infrastructure; });
        this.setHvacCoordinationVisible(state.hvac);
        this.mepRenderer.setOpacityMultiplier(state.mepOpacityMultiplier);
        this.setMepCoordinationVisible(state.mep);
        this.setElectricalTopologyVisible(state.electricalTopology);
      }
    }
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
    this.auditPlumbing = plumbing;
    this.decorations.clearMarkers();
    const result = buildInfrastructure({
      electrical,
      plumbing,
      wallSegments: this.wallSegmentIndex as ReadonlyMap<string, InfrastructureWallSegment[]>,
    });
    this.electricalMeshes = result.electrical;
    this.infrastructureMeshes = result.objects;
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
    const targetIds = new Set([objectId]);
    let route: THREE.Object3D | undefined;
    this.scene.traverse((object) => {
      if (!route && object.name === objectId) route = object;
    });
    if (route?.userData?.type === 'mep_coordination_route') {
      const endpointMeta = route.userData.endpointMeta as { from?: { ref?: unknown }; to?: { ref?: unknown } } | undefined;
      if (typeof endpointMeta?.from?.ref === 'string') targetIds.add(endpointMeta.from.ref);
      if (typeof endpointMeta?.to?.ref === 'string') targetIds.add(endpointMeta.to.ref);
    }
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
      if (!mat || !mesh.userData) return;
      if (targetIds.has(mesh.userData.objectId as string) || mesh.userData.roomId === objectId) {
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

  setCeilingVisible(visible: boolean, opacity = 1): void {
    for (const mesh of this.ceilingMeshes) {
      mesh.visible = visible;
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.transparent = opacity < 1;
      material.opacity = opacity;
      material.depthWrite = opacity >= 1;
      material.needsUpdate = true;
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
        mep: type === 'mep_coordination_route' || type.startsWith('hvac_') || type === 'hvac_reference_constraint' ? {
          routeId: data.routeId as string | undefined, status: data.status as string | undefined,
          sourceStatus: data.source_status as string | undefined, constructionStatus: data.construction_status as string | undefined,
          from: data.endpointMeta ? (data.endpointMeta as { from?: { ref?: unknown } }).from?.ref : undefined,
          to: data.endpointMeta ? (data.endpointMeta as { to?: { ref?: unknown } }).to?.ref : undefined,
          points: data.points as Array<{ x: number; y?: number; z: number }> | undefined,
          reason: data.reason as string | undefined, label: data.label as string | undefined,
          dimensions: { diameter: data.diameter as number | undefined, width: data.width as number | undefined, depth: data.depth as number | undefined },
          lintLevel: data.lintLevel as string | undefined, lintCodes: data.lintCodes as string[] | undefined, lintWarnings: data.lintWarnings as string[] | undefined,
          notForConstruction: Boolean(data.notForConstruction ?? data.not_for_construction), source: data.source as string | undefined,
          range: data.range as { x1: number; x2: number; z1: number; z2: number } | undefined,
          height: data.height as number | undefined, uncertainty: data.uncertainty as string | undefined,
          risk: data.risk as string | undefined, surveyConfirmation: data.surveyConfirmation as string | undefined,
        } : undefined,
        infrastructure: type === 'electrical' || type === 'plumbing' ? {
          fixtureType: data.fixtureType as string | undefined, height: data.height as number | undefined,
          mountHeight: data.mount_height as number | undefined, bodyHeight: data.body_height as number | undefined,
          wallSide: data.wallSide as string | undefined,
        } : undefined,
        electricalTopology: type.startsWith('electrical_topology_') ? {
          circuitIds: data.circuitId ? [String(data.circuitId)] : (data.circuitIds as string[] | undefined) ?? [],
          controlIds: Array.isArray(data.controlIds) ? data.controlIds.filter((id): id is string => typeof id === 'string') : [],
          notes: [data.note, ...(Array.isArray(data.notes) ? data.notes : []), data.notForConstruction ? '仅表示面板—回路—点位归属，不表示施工路径' : ''].filter((note): note is string => typeof note === 'string' && note.length > 0),
          panelId: data.panelId as string | undefined,
          memberPointIds: data.memberPointIds as string[] | undefined,
          memberPointId: data.memberPointId as string | undefined,
          purpose: data.purpose as string | undefined,
          status: data.status as string | undefined,
          pendingParameters: data.pendingParameters as string[] | undefined,
          controlsIncomplete: data.controlsIncomplete === true,
          controlsPending: data.controlsPending === true,
          representation: data.representation as string | undefined,
          relation: data.relation as string | undefined,
          notForConstruction: Boolean(data.notForConstruction ?? data.not_for_construction),
        } : undefined,
        ceiling: type === 'ceiling_zone' || type === 'ceiling_zone_solid' ? data.ceiling as { area?: [number, number, number, number]; thickness?: number; type?: string; room?: string; height?: number } | undefined : undefined,
      };
      const isMepRouteTarget = type === 'mep_coordination_route';
      const isElectricalTopologyTarget = type.startsWith('electrical_topology_');
      const isHvacTarget = type === 'hvac_equipment'
        || type === 'hvac_terminal'
        || type === 'hvac_condensate_candidate'
        || type === 'hvac_reference_constraint'
        || type.startsWith('hvac_');
      const isInfrastructureTarget = type === 'electrical'
        || type === 'plumbing'
        || type === 'lighting_fixture';
      const isCeilingTarget = type === 'ceiling_zone_solid'
        || (type === 'annotation' && data.category === 'ceiling');
      const priority = this.mepOverviewState
        ? isMepRouteTarget
          ? 0
          : isElectricalTopologyTarget
            ? 1
            : isHvacTarget
              ? 2
              : isInfrastructureTarget
                ? 3
                : isCeilingTarget
                  ? 4
                  : 5
        : type === 'lighting_fixture'
          ? 0
          : isCeilingTarget
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
    this.electricalTopologyRenderer.dispose();
    this.decorations.dispose();
    this.materials.dispose();
    this.renderer.dispose();
  }
}
