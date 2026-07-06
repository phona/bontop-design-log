import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SceneApi, RoomObject, CameraState } from '@shared/types';
import { rooms, platform } from '@shared/houseData';

const DEFAULT_PAINT = '#f7f5ef';
const DEFAULT_FLOOR = '#e8e0d5';
const WALL_THICKNESS = 0.12;

export class HouseScene implements SceneApi {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  rooms: Record<string, RoomObject> = {};
  private topicGroup = new THREE.Group();
  private floorMeshes: THREE.Mesh[] = [];
  private wallMeshes: THREE.Mesh[] = [];
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private onObjectClick?: (objectId: string, type: string, room?: string) => void;

  constructor(canvas: HTMLCanvasElement) {
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

    this.setupLights();
    this.buildBase();
    this.buildRooms();
    this.buildPlatform();
    this.scene.add(this.topicGroup);

    window.addEventListener('resize', () => this.onResize());
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
  }

  setOnObjectClick(cb: (objectId: string, type: string, room?: string) => void) {
    this.onObjectClick = cb;
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

  private buildRooms() {
    for (const r of rooms) {
      this.createRoom(r);
    }
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
    floor.userData = { roomId: r.id, part: 'floor' };
    floor.receiveShadow = true;
    group.add(floor);
    this.floorMeshes.push(floor);

    const wallMat = new THREE.MeshStandardMaterial({
      color: DEFAULT_PAINT,
      roughness: 0.85,
    });

    const halfW = r.width / 2;
    const halfD = r.depth / 2;

    const walls: Array<{ x: number; z: number; w: number; d: number }> = [
      { x: 0, z: -halfD, w: r.width, d: WALL_THICKNESS }, // north
      { x: 0, z: halfD, w: r.width, d: WALL_THICKNESS }, // south
      { x: -halfW, z: 0, w: WALL_THICKNESS, d: r.depth }, // west
      { x: halfW, z: 0, w: WALL_THICKNESS, d: r.depth }, // east
    ];

    for (const w of walls) {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(w.w, r.height, w.d),
        wallMat.clone()
      );
      wall.position.set(w.x, r.height / 2, w.z);
      wall.userData = { roomId: r.id, part: 'wall' };
      wall.castShadow = true;
      wall.receiveShadow = true;
      group.add(wall);
      this.wallMeshes.push(wall);
    }

    // simple window/door markers (colored planes on walls)
    if (r.id === 'living_dining') {
      this.addOpeningMarker(group, 0, 1.2, halfD + 0.01, r.width * 0.7, 1.6, 'south_window');
    }
    if (r.id === 'south_balcony') {
      this.addOpeningMarker(group, 0, 1.2, -halfD - 0.01, 2, 2, 'door_to_balcony');
    }

    this.scene.add(group);
    this.rooms[r.id] = { ...r };
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

  private buildPlatform() {
    const p = platform;
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
      this.controls.target.set(r.x, 0, r.z);
      this.camera.position.set(r.x, 10, r.z + 10);
    } else {
      // try topic object
      let found = false;
      this.topicGroup.traverse((obj) => {
        if (!found && obj.userData?.objectId === targetId) {
          const pos = new THREE.Vector3();
          obj.getWorldPosition(pos);
          this.controls.target.copy(pos);
          this.camera.position.set(pos.x + 4, pos.y + 4, pos.z + 4);
          found = true;
        }
      });
    }
    this.controls.update();
  }

  getCameraState(): CameraState {
    return {
      position: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
      target: { x: this.controls.target.x, y: this.controls.target.y, z: this.controls.target.z },
    };
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
        this.onObjectClick?.(
          (data.objectId as string) ?? (data.roomId as string),
          (data.type as string) ?? (data.part as string) ?? 'room',
          data.roomId as string | undefined
        );
        return;
      }
    }
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
