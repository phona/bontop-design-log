import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SceneApi, RoomObject } from '@shared/types';
import { CameraAnimator } from './CameraAnimator.js';
import { TopicRegistry } from '../topics/TopicRegistry.js';

type ObjectClickCallback = (objectId: string) => void;

interface ProjectData {
  house: { rooms: Array<{ id: string; name: string; x: number; z: number; width: number; depth: number; height: number; type: string }> };
  topics: Array<{ id: string; name: string; perRoom: boolean; options: unknown[] }>;
  budgetCategories: unknown[];
}

export class HouseScene implements SceneApi {
  private canvas: HTMLCanvasElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private cameraAnimator: CameraAnimator;
  private topicRegistry: TopicRegistry;
  private objectClickCallbacks: ObjectClickCallback[] = [];
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  private topicGroup = new THREE.Group();
  rooms: Record<string, RoomObject> = {};
  private boundOnCanvasClick: (e: MouseEvent) => void;
  private boundOnWindowResize: () => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf0f0f0);

    this.camera = new THREE.PerspectiveCamera(
      75,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 10, 15);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    this.scene.add(directionalLight);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;

    this.cameraAnimator = new CameraAnimator(this.camera);

    this.topicRegistry = new TopicRegistry();

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.scene.add(this.topicGroup);

    this.boundOnCanvasClick = this.onCanvasClick.bind(this);
    this.boundOnWindowResize = this.onWindowResize.bind(this);
    canvas.addEventListener('click', this.boundOnCanvasClick);
    window.addEventListener('resize', this.boundOnWindowResize);
  }

  getScene(): THREE.Scene {
    return this.scene;
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  buildFromCatalog(projectData: ProjectData): void {
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

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    this.scene.add(directionalLight);

    this.topicGroup = new THREE.Group();
    this.scene.add(this.topicGroup);

    for (const room of projectData.house.rooms) {
      this.buildRoom(room);
    }
  }

  private buildRoom(room: { id: string; name: string; x: number; z: number; width: number; depth: number; height: number; type: string }): void {
    const { id, x, z, width, depth, height, type } = room;

    const floorGeometry = new THREE.PlaneGeometry(width, depth);
    const floorColor = type === 'public' ? 0xd0d0d0 : type === 'private' ? 0xc0c0d0 : 0xc0d0e0;
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: floorColor,
      side: THREE.DoubleSide,
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(x, 0, z);
    floor.userData.objectId = `floor:${id}`;
    this.scene.add(floor);

    const wallHeight = height;
    const wallThickness = 0.1;
    const wallColor = 0xe0e0e0;

    const northWall = new THREE.Mesh(
      new THREE.BoxGeometry(width, wallHeight, wallThickness),
      new THREE.MeshStandardMaterial({ color: wallColor })
    );
    northWall.position.set(x, wallHeight / 2, z - depth / 2);
    northWall.userData.objectId = `wall:${id}:north`;
    this.scene.add(northWall);

    const southWall = new THREE.Mesh(
      new THREE.BoxGeometry(width, wallHeight, wallThickness),
      new THREE.MeshStandardMaterial({ color: wallColor })
    );
    southWall.position.set(x, wallHeight / 2, z + depth / 2);
    southWall.userData.objectId = `wall:${id}:south`;
    this.scene.add(southWall);

    const eastWall = new THREE.Mesh(
      new THREE.BoxGeometry(wallThickness, wallHeight, depth),
      new THREE.MeshStandardMaterial({ color: wallColor })
    );
    eastWall.position.set(x + width / 2, wallHeight / 2, z);
    eastWall.userData.objectId = `wall:${id}:east`;
    this.scene.add(eastWall);

    const westWall = new THREE.Mesh(
      new THREE.BoxGeometry(wallThickness, wallHeight, depth),
      new THREE.MeshStandardMaterial({ color: wallColor })
    );
    westWall.position.set(x - width / 2, wallHeight / 2, z);
    westWall.userData.objectId = `wall:${id}:west`;
    this.scene.add(westWall);

    const roomLabel = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    roomLabel.rotation.x = -Math.PI / 2;
    roomLabel.position.set(x, 0.01, z);
    roomLabel.userData.objectId = `room:${id}`;
    this.scene.add(roomLabel);

    this.rooms[id] = { id, name: room.name, x, z, width, depth, height };
  }

  setSelection(topic: string, optionId: string): void {
    const topicImpl = this.topicRegistry.get(topic);
    if (topicImpl) {
      topicImpl.apply(this, optionId);
    }
  }

  highlightObject(objectId: string): void {
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
      if (!mat?.emissive) return;
      if (mesh.userData?.objectId === objectId) {
        const original = mat.emissive.clone();
        mat.emissive.set(0xffff00);
        mat.emissiveIntensity = 0.5;
        setTimeout(() => {
          mat.emissive.copy(original);
          mat.emissiveIntensity = 0;
        }, 2000);
      }
    });
  }

  setCameraTarget(targetId: string): void {
    let targetObj: THREE.Object3D | null = null;
    this.scene.traverse((obj) => {
      if (!targetObj && obj.userData?.objectId === targetId) {
        targetObj = obj;
      }
    });

    if (targetObj) {
      const box = new THREE.Box3().setFromObject(targetObj);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const distance = Math.max(maxDim * 2, 3);

      const cameraPos = new THREE.Vector3(
        center.x + distance,
        center.y + distance,
        center.z + distance
      );

      this.cameraAnimator.animateTo(cameraPos, center, 500);
    }
  }

  onObjectClick(callback: ObjectClickCallback): void {
    this.objectClickCallbacks.push(callback);
  }

  clearTopicObjects(topicId: string): void {
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

  addObject(topicId: string, objectId: string, obj: unknown): void {
    const threeObj = obj as THREE.Object3D;
    threeObj.userData = { ...threeObj.userData, topic: topicId, objectId };
    this.topicGroup.add(threeObj);
  }

  getRoom(roomId: string): RoomObject | undefined {
    return this.rooms[roomId];
  }

  private onCanvasClick(event: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.scene.children, true);

    if (intersects.length > 0) {
      let obj: THREE.Object3D | null = intersects[0].object;
      while (obj && !obj.userData.objectId) {
        obj = obj.parent;
      }

      if (obj?.userData.objectId) {
        this.objectClickCallbacks.forEach((cb) => cb(obj!.userData.objectId));
      }
    }
  }

  private onWindowResize(): void {
    this.camera.aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
  }

  render(): void {
    this.controls.update();
    this.cameraAnimator.update(16);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.canvas.removeEventListener('click', this.boundOnCanvasClick);
    window.removeEventListener('resize', this.boundOnWindowResize);
    this.renderer.dispose();
  }
}
