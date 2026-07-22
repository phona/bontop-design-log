import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import type { CollisionDetector } from './CollisionDetector.js';

const MOVE_SPEED = 2.0;
const EYE_HEIGHT = 1.7;

export interface MovementKeys {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
}

export class FirstPersonController {
  private controls: PointerLockControls;
  private collision: CollisionDetector;
  private keys: MovementKeys = { forward: false, backward: false, left: false, right: false };
  private direction = new THREE.Vector3();
  private _isLocked = false;
  private enabled = false;
  private onKeyDown: (e: KeyboardEvent) => void;
  private onKeyUp: (e: KeyboardEvent) => void;
  private onLockChange: () => void;

  constructor(
    camera: THREE.PerspectiveCamera,
    domElement: HTMLCanvasElement,
    collision: CollisionDetector
  ) {
    this.controls = new PointerLockControls(camera, domElement);
    this.collision = collision;

    this.onKeyDown = (e: KeyboardEvent) => this.handleKey(e, true);
    this.onKeyUp = (e: KeyboardEvent) => this.handleKey(e, false);
    this.onLockChange = () => {
      this._isLocked = this.controls.isLocked;
    };

    document.addEventListener('pointerlockchange', this.onLockChange);
  }

  private handleKey(e: KeyboardEvent, pressed: boolean) {
    if (!this.enabled) return;
    switch (e.code) {
      case 'KeyW':
        this.keys.forward = pressed;
        break;
      case 'KeyS':
        this.keys.backward = pressed;
        break;
      case 'KeyA':
        this.keys.left = pressed;
        break;
      case 'KeyD':
        this.keys.right = pressed;
        break;
    }
  }

  enable() {
    this.enabled = true;
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
  }

  disable() {
    this.enabled = false;
    this.keys = { forward: false, backward: false, left: false, right: false };
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    if (this._isLocked) {
      this.controls.unlock();
    }
  }

  requestLock() {
    this.controls.lock();
  }

  get isLocked(): boolean {
    return this._isLocked;
  }

  get isAnyKeyDown(): boolean {
    return this.keys.forward || this.keys.backward || this.keys.left || this.keys.right;
  }

  update(dt: number) {
    if (!this.enabled) return;

    this.direction.set(0, 0, 0);

    if (this.keys.forward) this.direction.z -= 1;
    if (this.keys.backward) this.direction.z += 1;
    if (this.keys.left) this.direction.x -= 1;
    if (this.keys.right) this.direction.x += 1;

    if (this.direction.lengthSq() === 0) return;

    this.direction.normalize();

    const camera = this.controls.getObject();
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(camera.quaternion);
    forward.y = 0;
    forward.normalize();

    const right = new THREE.Vector3(1, 0, 0);
    right.applyQuaternion(camera.quaternion);
    right.y = 0;
    right.normalize();

    const moveX = (forward.x * (-this.direction.z) + right.x * this.direction.x) * MOVE_SPEED * dt;
    const moveZ = (forward.z * (-this.direction.z) + right.z * this.direction.x) * MOVE_SPEED * dt;

    const from = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    const desired = { x: camera.position.x + moveX, y: EYE_HEIGHT, z: camera.position.z + moveZ };

    const corrected = this.collision.tryMove(from, desired);
    camera.position.set(corrected.x, corrected.y, corrected.z);
  }

  dispose() {
    this.disable();
    document.removeEventListener('pointerlockchange', this.onLockChange);
  }
}
