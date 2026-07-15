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
  SceneElement,
  CurtainPoint,
  OpeningDef,
} from '@shared/types';
import { CameraAnimator } from '../scene/CameraAnimator.js';
import { TopDownView } from '../scene/TopDownView.js';
import { TopicRegistry } from '../topics/TopicRegistry.js';
import type { HoverTarget } from '../ui/HoverTooltip.js';
import { createMaterialTexture } from './TextureFactory.js';
import { placeFurnishings } from './FurnitureFactory.js';

const DEFAULT_PAINT = '#f7f5ef';
const GLASS_COLOR = 0x88ccff;
const GLASS_OPACITY = 0.6;
export const GLASS_THICKNESS = 0.08; // 8cm glass panel
const DEFAULT_FLOOR = '#e8e0d5';
const WALL_THICKNESS = 0.12;

type ArcDescriptor = {
  center: { x: number; z: number };
  radius: number;
  start: { x: number; z: number };
  startAngle: number;
  endAngle: number;
  clockwise: boolean;
};

interface ProjectData {
  house: {
    rooms: Array<{ id: string; name: string; x: number; z: number; width: number; depth: number; height: number; type: string; wall_finish?: string; openings?: OpeningDef[] }>;
    platform?: { id: string; name: string; x: number; z: number; width: number; depth: number; height: number };
    furnishings?: Record<string, Record<string, number>>;
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
  private glassMeshes: THREE.Mesh[] = [];
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  cameraAnimator: CameraAnimator;
  topDownView: TopDownView;
  private topicRegistry: TopicRegistry;
  private onClickCallback?: (target: HoverTarget) => void;
  private boundOnWindowResize: () => void;
  private _mode: 'orbit' | 'first-person' | 'top-down' = 'orbit';
  private compareSchemeData?: CurrentScheme;
  private roomMeta = new Map<string, { wall_finish?: string; openings?: OpeningDef[] }>();
  private gridHelper?: THREE.GridHelper;
  private topDownLayoutBounds = { minX: 0, maxX: 16.4, minZ: -2.9, maxZ: 9.8 };
  private readonly ORBIT_POSITION = new THREE.Vector3(8.2, 14, 19.2);
  private readonly ORBIT_TARGET = new THREE.Vector3(8.2, 0, 6.4);

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

    this.setupLights();
    this.buildBase();
    this.scene.add(this.topicGroup);

    this.controls.addEventListener('start', () => this.cameraAnimator.interrupt());

    this.boundOnWindowResize = () => this.onResize();
    window.addEventListener('resize', this.boundOnWindowResize);
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
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
    this.setTopDown(true);
    await new Promise((resolve) => setTimeout(resolve, 500));

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
    orthoCam.lookAt(centerX, 0, centerZ);
    orthoCam.up.set(0, 0, -1);
    orthoCam.updateProjectionMatrix();

    const originalSize = { width: this.canvas.width, height: this.canvas.height };
    const renderTarget = new THREE.WebGLRenderTarget(renderWidth, renderHeight);
    this.renderer.setRenderTarget(renderTarget);
    this.renderer.render(this.scene, orthoCam);

    const buffer = new Uint8Array(renderWidth * renderHeight * 4);
    this.renderer.readRenderTargetPixels(renderTarget, 0, 0, renderWidth, renderHeight, buffer);
    const pngData = await this.rgbaToPng(buffer, renderWidth, renderHeight);

    this.renderer.setRenderTarget(null);
    renderTarget.dispose();
    this.renderer.setSize(originalSize.width, originalSize.height);

    return pngData;
  }

  private async rgbaToPng(rgba: Uint8Array, width: number, height: number): Promise<string> {
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
    this.glassMeshes = [];
    this.roomMeta.clear();

    this.setupLights();
    this.buildBase();

    this.topicGroup = new THREE.Group();
    this.scene.add(this.topicGroup);

    const useSceneElements = Array.isArray(projectData.house.sceneElements)
      && projectData.house.sceneElements.length > 0;
    const wallHeight = projectData.house.rooms[0]?.height ?? 3.0;

    for (const room of projectData.house.rooms) {
      this.roomMeta.set(room.id, { wall_finish: room.wall_finish, openings: room.openings });
      this.createRoom(
        {
          id: room.id,
          name: room.name,
          x: room.x,
          z: room.z,
          width: room.width,
          depth: room.depth,
          height: room.height,
        },
        { fabricateWalls: !useSceneElements }
      );
    }

    if (useSceneElements) {
      this.buildSceneElements(projectData.house.sceneElements!, wallHeight);
    }

    if (projectData.house.platform) {
      this.createPlatform(projectData.house.platform);
    }

    if (projectData.house.furnishings) {
      placeFurnishings(this.scene, projectData.house.furnishings, this.rooms);
    }

    if (projectData.house.electrical) {
      this.placeElectricalMarkers(projectData.house.electrical);
    }
  }

  setSelection(topic: string, optionId: string): void {
    const topicImpl = this.topicRegistry.get(topic);
    if (topicImpl) {
      topicImpl.apply(this, optionId);
    }
  }

  private setupLights() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    this.scene.add(ambient);

    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(12, 20, 8);
    dir.castShadow = true;
    dir.shadow.mapSize.width = 2048;
    dir.shadow.mapSize.height = 2048;
    this.scene.add(dir);

    const fill = new THREE.DirectionalLight(0xffffff, 0.3);
    fill.position.set(-10, 8, -10);
    this.scene.add(fill);
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

    const floorGeo = new THREE.PlaneGeometry(r.width, r.depth);
    const floorMat = new THREE.MeshStandardMaterial({
      color: DEFAULT_FLOOR,
      roughness: 0.75,
      metalness: 0.05,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.005;
    floor.userData = { roomId: r.id, objectId: `floor:${r.id}`, type: 'floor' };
    floor.receiveShadow = true;
    group.add(floor);
    this.floorMeshes.push(floor);

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
        wall.userData = { roomId: r.id, objectId: `wall:${r.id}:${w.dir}`, type: 'wall' };
        wall.castShadow = true;
        wall.receiveShadow = true;
        group.add(wall);
        this.wallMeshes.push(wall);
      }

      const meta = this.roomMeta.get(r.id);
      if (meta?.openings) {
        for (const opening of meta.openings) {
          const pos = this._openingPosition(r, opening.wall, opening.center_offset ?? 0);
          this.addOpeningMarker(group, pos.x, 1.2, pos.z, opening.width, opening.height, `${opening.type}_${r.id}`);
        }
      }
    }

    this.scene.add(group);
    this.rooms[r.id] = { ...r };
  }

  private makeGlassMaterial(): THREE.MeshPhysicalMaterial {
    return new THREE.MeshPhysicalMaterial({
      color: GLASS_COLOR,
      transparent: true,
      opacity: GLASS_OPACITY,
      roughness: 0.05,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });
  }

  private buildSceneElements(elements: SceneElement[], defaultHeight: number) {
    for (const el of elements) {
      switch (el.type) {
        case 'wall': this.renderWallSegment(el, defaultHeight); break;
        case 'curtain_run': this.renderCurtainRun(el); break;
        case 'wall_run': this.renderWallRun(el); break;
        case 'glass_infill': this.renderGlassInfill(el); break;
        case 'floor_region': this.renderFloorRegion(el); break;
        case 'bay_sill': this.renderBaySill(el); break;
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
    const mat = new THREE.MeshStandardMaterial({ color: DEFAULT_PAINT, roughness: 0.85 });
    const mesh = this.renderBox(el.x1, el.z1, el.x2, el.z2, height, WALL_THICKNESS, mat);
    mesh.userData = { type: 'wall', objectId: el.id };
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.wallMeshes.push(mesh);
  }

  private renderCurtainRun(el: Extract<SceneElement, { type: 'curtain_run' }>) {
    const shape = this.buildCurtainShape(el.points, el.closed ?? false);
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: el.height,
      bevelEnabled: false,
      steps: 1,
    });
    geometry.rotateX(-Math.PI / 2);

    const mesh = new THREE.Mesh(geometry, this.makeGlassMaterial());
    mesh.userData = { type: 'curtain_run', objectId: el.id };
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.glassMeshes.push(mesh);
  }

  private buildCurtainShape(points: CurtainPoint[], closed: boolean): THREE.Shape {
    const T = GLASS_THICKNESS;
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
      left.push({ x: p.x + nx * (T / 2), z: p.y + ny * (T / 2) });
      right.push({ x: p.x - nx * (T / 2), z: p.y - ny * (T / 2) });
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
    if (d >= len1 || d >= len2) return null;

    const n1x = -u1z;
    const n1z = u1x;
    const cross = u1x * u2z - u1z * u2x;
    const sign = cross > 0 ? 1 : -1;

    const center = {
      x: c.x - u1x * d + sign * n1x * r,
      z: c.z - u1z * d + sign * n1z * r,
    };

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
      mesh.userData = { type: 'wall', objectId: `${el.id}:${i}` };
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.wallMeshes.push(mesh);
    }
  }

  private renderGlassInfill(el: Extract<SceneElement, { type: 'glass_infill' }>) {
    const room = this.rooms[el.room];
    if (!room) {
      console.error(`[HouseScene] glass_infill "${el.id}" 引用不存在的房间 "${el.room}"，未渲染`);
      return;
    }
    const halfW = room.width / 2;
    const halfD = room.depth / 2;
    let x = room.x;
    let z = room.z;
    let rotate = false;
    switch (el.wall) {
      case 'south': x += el.center_offset; z += halfD; break;
      case 'north': x += el.center_offset; z -= halfD; break;
      case 'east': x += halfW; z += el.center_offset; rotate = true; break;
      case 'west': x -= halfW; z += el.center_offset; rotate = true; break;
    }
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(el.width, el.height, GLASS_THICKNESS),
      this.makeGlassMaterial()
    );
    mesh.position.set(x, el.sill + el.height / 2, z);
    if (rotate) mesh.rotation.y = Math.PI / 2;
    mesh.userData = { type: 'glass_infill', objectId: el.id };
    mesh.castShadow = false;
    this.scene.add(mesh);
    this.glassMeshes.push(mesh);
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
    mesh.position.y = 0.006;
    mesh.userData = { type: 'floor_region', objectId: el.id, roomId: el.room };
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.floorMeshes.push(mesh);
  }

  private renderBaySill(el: Extract<SceneElement, { type: 'bay_sill' }>) {
    if (el.points.length < 2) return;
    const a = el.points[0];
    const b = el.points[el.points.length - 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-9) return;

    // curtain_run 为顺时针，室内在行进方向右侧 => 内法向为 (dz, -dx)
    const nx = dz / length;
    const nz = -dx / length;

    const cx = (a.x + b.x) / 2;
    const cz = (a.z + b.z) / 2;
    const cy = el.sill + el.height / 2;

    const concrete = new THREE.MeshStandardMaterial({
      color: 0xcccccc,
      roughness: 0.9,
    });
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(length, el.height, el.depth),
      concrete
    );
    mesh.position.set(
      cx + nx * el.depth / 2,
      cy,
      cz + nz * el.depth / 2
    );
    mesh.rotation.y = Math.atan2(dz, dx);
    mesh.userData = { type: 'bay_sill', objectId: el.id };
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  private createPlatform(p: ProjectData['house']['platform'] & { id: string; name: string }) {
    const geo = new THREE.BoxGeometry(p.width, 0.15, p.depth);
    const mat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.8 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(p.x, 0.075, p.z);
    mesh.userData = { roomId: p.id, objectId: 'platform_boundary', type: 'platform' };
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    this.platform = p;

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(p.width + 0.1, 0.05, p.depth + 0.1),
      new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.4 })
    );
    frame.position.set(p.x, 0.2, p.z);
    frame.userData = { roomId: p.id, objectId: 'platform_boundary', type: 'platform' };
    this.scene.add(frame);

    this.rooms[p.id] = { ...p };
  }

  private placeElectricalMarkers(markers: ElectricalMarker[]): void {
    const colorMap: Record<string, number> = {
      switch: 0xffffff,
      outlet: 0xaaaaaa,
      network: 0x4488ff,
      curtain_power: 0xaa44ff,
    };
    for (const m of markers) {
      const room = this.rooms[m.roomId];
      if (!room) continue;
      const geo = new THREE.BoxGeometry(0.08, 0.08, 0.02);
      const mat = new THREE.MeshBasicMaterial({ color: colorMap[m.type] ?? 0xffffff });
      const cube = new THREE.Mesh(geo, mat);
      cube.userData = { objectId: `electrical:${m.roomId}:${m.type}`, hoverable: false, type: 'electrical' };
      const dirVectors: Record<string, [number, number]> = {
        north: [0, -1],
        south: [0, 1],
        west: [-1, 0],
        east: [1, 0],
      };
      const [dx, dz] = dirVectors[m.wall] ?? [0, 0];
      cube.position.set(
        room.x + m.offset,
        m.height,
        room.z + dz * (room.depth / 2 + 0.01)
      );
      if (dx !== 0) {
        cube.position.set(
          room.x + dx * (room.width / 2 + 0.01),
          m.height,
          room.z + m.offset
        );
      }
      this.scene.add(cube);
    }
  }

  private _openingPosition(r: RoomObject, wall: string, centerOffset: number): { x: number; z: number } {
    const halfW = r.width / 2;
    const halfD = r.depth / 2;
    const offset = 0.01;
    switch (wall) {
      case 'south': return { x: centerOffset, z: halfD + offset };
      case 'north': return { x: centerOffset, z: -(halfD + offset) };
      case 'east':  return { x: halfW + offset, z: centerOffset };
      case 'west':  return { x: -(halfW + offset), z: centerOffset };
      default:      return { x: centerOffset, z: halfD + offset };
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
    for (const [topicId, selection] of Object.entries(this.compareSchemeData.selections)) {
      const effective = selection.default;
      if (effective) {
        this.applySchemeTextures(topicId, effective);
      }
    }
  }

  applySchemeTextures(topicId: string, optionId: string): void {
    const topic = this.topicRegistry.get(topicId);
    if (!topic) return;
    const option = topic.options.find((o) => o.id === optionId);
    if (!option) return;
    const data = (option.data as Record<string, unknown> | undefined);
    const appearance = data?.appearance as { type: string; color: string } | undefined;
    if (!appearance) return;

    const tex = createMaterialTexture(appearance);
    tex.repeat.set(2, 2);

    if (topicId === 'floor') {
      for (const mesh of this.floorMeshes) {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.map = tex;
        mat.color.set(appearance.color);
        mat.needsUpdate = true;
      }
    } else if (topicId === 'wall' || topicId === 'paint') {
      for (const mesh of this.wallMeshes) {
        if (topicId === 'paint') {
          const roomId = mesh.userData.roomId as string;
          const room = this.roomMeta.get(roomId);
          if (room?.wall_finish === 'tile') continue;
        }
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.map = tex;
        mat.color.set(appearance.color);
        mat.needsUpdate = true;
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
      this.controls.target.copy(target);
    } else {
      let found = false;
      this.scene.traverse((obj) => {
        if (!found && obj.userData?.objectId === targetId) {
          const pos = new THREE.Vector3();
          (obj as THREE.Object3D).getWorldPosition(pos);
          const camPos = new THREE.Vector3(pos.x + 4, pos.y + 4, pos.z + 4);
          this.cameraAnimator.animateTo(camPos, pos, 500);
          this.controls.target.copy(pos);
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
            this.controls.target.copy(pos);
            found = true;
          }
        });
      }
    }
    this.controls.update();
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
  }

  private objectDisplayName(objectId: string, type: string, roomId?: string): string {
    const room = roomId ? this.rooms[roomId] : undefined;
    const roomName = room?.name ?? '';
    const typeLabel: Record<string, string> = {
      floor: '地面',
      wall: '墙面',
      ceiling: '顶面',
      door: '门',
      window: '窗',
      hvac_indoor: '空调内机',
      hvac_outdoor: '空调外机',
      platform: '平台',
    };
    const dirLabel: Record<string, string> = {
      north: '北',
      south: '南',
      west: '西',
      east: '东',
    };

    if (type === 'platform' && this.platform) {
      return this.platform.name;
    }

    if (type === 'wall' && objectId.startsWith('wall:')) {
      const parts = objectId.split(':');
      const dir = parts[2];
      const direction = dir && dirLabel[dir];
      if (direction) {
        return roomName ? `${roomName}${direction}墙` : objectId;
      }
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
      const data = hit.object.userData;
      if (hoverableOnly && data?.hoverable === false) continue;
      if (data?.objectId || data?.roomId) {
        const id = (data.objectId as string) ?? (data.roomId as string);
        const type = (data.type as string) ?? (data.part as string) ?? 'room';
        const room = data.roomId as string | undefined;
        const roomObj = room ? this.rooms[room] : undefined;
        const name = this.objectDisplayName(id, type, room);
        return { objectId: id, name, type, room };
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
  }

  private onPointerDown(event: PointerEvent) {
    this.pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersects = this.raycaster.intersectObjects(this.scene.children, true);
    for (const hit of intersects) {
      const data = hit.object.userData;
      if (data?.objectId || data?.roomId) {
        const id = (data.objectId as string) ?? (data.roomId as string);
        const type = (data.type as string) ?? (data.part as string) ?? 'room';
        const room = data.roomId as string | undefined;
        const name = this.objectDisplayName(id, type, room);
        this.onClickCallback?.({ objectId: id, name, type, room });
        return;
      }
    }
  }

  private lastRenderTime = performance.now();

  render() {
    const now = performance.now();
    const deltaTime = now - this.lastRenderTime;
    this.lastRenderTime = now;
    if (this._mode === 'orbit') {
      this.controls.update();
    }
    this.cameraAnimator.update(deltaTime);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    window.removeEventListener('resize', this.boundOnWindowResize);
    this.renderer.dispose();
  }
}
