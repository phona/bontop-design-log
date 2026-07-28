import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import type { CollisionDetector } from './CollisionDetector.js';
import { PITCH_LIMIT, MAX_MOUSE_DELTA, MOUSE_SENSITIVITY } from './first-person-tuning.js';

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
  private domElement: HTMLCanvasElement;
  private keys: MovementKeys = { forward: false, backward: false, left: false, right: false };
  private direction = new THREE.Vector3();
  private _isLocked = false;
  private enabled = false;
  private onKeyDown: (e: KeyboardEvent) => void;
  private onKeyUp: (e: KeyboardEvent) => void;
  private onLockChange: () => void;
  private onMouseMove: (e: MouseEvent) => void;

  private yaw = 0;
  private pitch = 0;
  private lockTime = 0;
  private prevPitch = 0;

  constructor(
    camera: THREE.PerspectiveCamera,
    domElement: HTMLCanvasElement,
    collision: CollisionDetector
  ) {
    this.controls = new PointerLockControls(camera, domElement);
    this.controls.disconnect();
    this.domElement = domElement;
    this.collision = collision;

    this.onKeyDown = (e: KeyboardEvent) => this.handleKey(e, true);
    this.onKeyUp = (e: KeyboardEvent) => this.handleKey(e, false);
    this.onLockChange = () => {
      this._isLocked = document.pointerLockElement === this.domElement;
      if (this._isLocked) {
        this.lockTime = performance.now();
        this.syncFromCamera();
      }
    };
    this.onMouseMove = (e: MouseEvent) => {
      if (!this.enabled) return;
      if (document.pointerLockElement !== this.domElement) return;
      if (performance.now() - this.lockTime < 150) return;
      const rawX = e.movementX || 0;
      const rawY = e.movementY || 0;
      const mx = Math.max(-MAX_MOUSE_DELTA, Math.min(MAX_MOUSE_DELTA, rawX));
      const my = Math.max(-MAX_MOUSE_DELTA, Math.min(MAX_MOUSE_DELTA, rawY));
      if (Math.abs(my) > 40) {
        console.warn('[FP-DBG] large delta:', { mx, my, yaw: this.yaw, pitch: this.pitch });
      }
      this.yaw -= mx * MOUSE_SENSITIVITY;
      this.pitch -= my * MOUSE_SENSITIVITY;
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
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
    this.controls.disconnect();
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
  }

  disable() {
    this.enabled = false;
    this.keys = { forward: false, backward: false, left: false, right: false };
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
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

  syncFromCamera(): void {
    const camera = this.controls.getObject() as unknown as THREE.PerspectiveCamera;
    const euler = new THREE.Euler(0, 0, 0, 'YXZ');
    euler.setFromQuaternion(camera.quaternion, 'YXZ');
    this.yaw = Number.isFinite(euler.y) ? euler.y : 0;
    this.pitch = Number.isFinite(euler.x)
      ? Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, euler.x))
      : 0;
  }

  update(dt: number) {
    if (!this.enabled) return;

    if (!Number.isFinite(this.yaw)) this.yaw = 0;
    if (!Number.isFinite(this.pitch)) this.pitch = 0;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));

    if (Math.abs(this.pitch - this.prevPitch) > 0.1) {
      console.warn('[FP-DBG] pitch jump:', { prev: this.prevPitch, now: this.pitch, yaw: this.yaw });
    }
    this.prevPitch = this.pitch;

    const camera = this.controls.getObject() as unknown as THREE.PerspectiveCamera;

    const euler = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
    camera.quaternion.setFromEuler(euler);

    this.direction.set(0, 0, 0);

    if (this.keys.forward) this.direction.z -= 1;
    if (this.keys.backward) this.direction.z += 1;
    if (this.keys.left) this.direction.x -= 1;
    if (this.keys.right) this.direction.x += 1;

    if (this.direction.lengthSq() === 0) return;

    this.direction.normalize();

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
