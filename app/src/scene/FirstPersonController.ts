import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import type { CollisionDetector } from './CollisionDetector.js';

const MOVE_SPEED = 2.0;
const EYE_HEIGHT = 1.7;
const PITCH_LIMIT = Math.PI * 80 / 180;
const SMOOTH_FACTOR = 0.6;
const MOUSE_SENSITIVITY = 0.002;

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

  private targetYaw = 0;
  private targetPitch = 0;
  private currentYaw = 0;
  private currentPitch = 0;
  private skipNextMove = false;

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
        this.skipNextMove = true;
        const euler = new THREE.Euler(0, 0, 0, 'YXZ');
        euler.setFromQuaternion(camera.quaternion, 'YXZ');
        this.currentYaw = euler.y;
        this.currentPitch = this.clampPitch(euler.x);
        this.targetYaw = euler.y;
        this.targetPitch = this.clampPitch(euler.x);
      }
    };
    this.onMouseMove = (e: MouseEvent) => {
      if (!this._isLocked || !this.enabled) return;
      if (this.skipNextMove) {
        this.skipNextMove = false;
        return;
      }
      this.targetYaw -= e.movementX * MOUSE_SENSITIVITY;
      this.targetPitch -= e.movementY * MOUSE_SENSITIVITY;
      this.targetPitch = this.clampPitch(this.targetPitch);
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
    this.currentYaw = euler.y;
    this.currentPitch = this.clampPitch(euler.x);
    this.targetYaw = euler.y;
    this.targetPitch = this.clampPitch(euler.x);
  }

  private clampPitch(v: number): number {
    return Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, v));
  }

  update(dt: number) {
    if (!this.enabled) return;

    const camera = this.controls.getObject() as unknown as THREE.PerspectiveCamera;

    const lerpT = 1 - Math.pow(SMOOTH_FACTOR, dt * 60);
    this.currentYaw += (this.targetYaw - this.currentYaw) * lerpT;
    this.currentPitch += (this.targetPitch - this.currentPitch) * lerpT;
    this.currentPitch = this.clampPitch(this.currentPitch);

    const euler = new THREE.Euler(this.currentPitch, this.currentYaw, 0, 'YXZ');
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
