import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SceneApi, RoomObject, CameraState } from '@shared/types';
import { CameraAnimator } from '../scene/CameraAnimator.js';
import { TopicRegistry } from '../topics/TopicRegistry.js';
import type { HoverTarget } from '../ui/HoverTooltip.js';

const DEFAULT_PAINT = '#f7f5ef';
const DEFAULT_FLOOR = '#e8e0d5';
const WALL_THICKNESS = 0.12;

interface ProjectData {
  house: {
    rooms: Array<{ id: string; name: string; x: number; z: number; width: number; depth: number; height: number; type: string }>;
    platform?: { id: string; name: string; x: number; z: number; width: number; depth: number; height: number };
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
  private canvas: HTMLCanvasElement;
  private topicGroup = new THREE.Group();
  private floorMeshes: THREE.Mesh[] = [];
  private wallMeshes: THREE.Mesh[] = [];
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  cameraAnimator: CameraAnimator;
  private topicRegistry: TopicRegistry;
  private onClickCallback?: (objectId: string, type: string, room?: string) => void;
  private boundOnWindowResize: () => void;
  private _mode: 'orbit' | 'first-person' = 'orbit';

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
    this.camera.position.set(0, 14, 20);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0, 0);
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 60;

    this.cameraAnimator = new CameraAnimator(this.camera, this.controls);
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

  setOnObjectClick(cb: (objectId: string, type: string, room?: string) => void) {
    this.onClickCallback = cb;
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
    this.floorMeshes = [];
    this.wallMeshes = [];

    this.setupLights();
    this.buildBase();

    this.topicGroup = new THREE.Group();
    this.scene.add(this.topicGroup);

    for (const room of projectData.house.rooms) {
      this.createRoom({
        id: room.id,
        name: room.name,
        x: room.x,
        z: room.z,
        width: room.width,
        depth: room.depth,
        height: room.height,
      });
    }

    if (projectData.house.platform) {
      this.createPlatform(projectData.house.platform);
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
    this.scene.add(grid);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.9 })
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -0.01;
    plane.receiveShadow = true;
    this.scene.add(plane);
  }

  private createRoom(r: RoomObject) {
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

    if (r.id === 'living_dining') {
      this.addOpeningMarker(group, 0, 1.2, halfD + 0.01, r.width * 0.7, 1.6, 'south_window');
    }
    if (r.id === 'south_balcony') {
      this.addOpeningMarker(group, 0, 1.2, -halfD - 0.01, 2, 2, 'door_to_balcony');
    }

    this.scene.add(group);
    this.rooms[r.id] = { ...r };
  }

  private createPlatform(p: ProjectData['house']['platform'] & { id: string; name: string }) {
    const geo = new THREE.BoxGeometry(p.width, 0.15, p.depth);
    const mat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.8 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(p.x, 0.075, p.z);
    mesh.userData = { roomId: p.id, objectId: 'platform_boundary', type: 'platform' };
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(p.width + 0.1, 0.05, p.depth + 0.1),
      new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.4 })
    );
    frame.position.set(p.x, 0.2, p.z);
    frame.userData = { roomId: p.id, objectId: 'platform_boundary', type: 'platform' };
    this.scene.add(frame);

    this.rooms[p.id] = { ...p };
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

  addObject(topicId: string, objectId: string, obj: unknown) {
    const threeObj = obj as THREE.Object3D;
    threeObj.userData = { ...threeObj.userData, topic: topicId, objectId };
    this.topicGroup.add(threeObj);
  }

  getRoom(roomId: string): RoomObject | undefined {
    return this.rooms[roomId];
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

  setPaintColor(color: string, exclude?: string[]) {
    const excludeSet = new Set(exclude ?? []);
    for (const mesh of this.wallMeshes) {
      if (!excludeSet.has(mesh.userData.roomId as string)) {
        (mesh.material as THREE.MeshStandardMaterial).color.set(color);
      }
    }
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

  get mode(): 'orbit' | 'first-person' {
    return this._mode;
  }

  setMode(mode: 'orbit' | 'first-person') {
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
        this.onClickCallback?.(
          id,
          (data.type as string) ?? (data.part as string) ?? 'room',
          data.roomId as string | undefined
        );
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
