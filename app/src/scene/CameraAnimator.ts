import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type CameraMode = 'orbit' | 'first-person';

const DEFAULT_DURATION = 0.5;

export class CameraAnimator {
  private camera: THREE.PerspectiveCamera;
  private controls?: OrbitControls;
  private startPos: THREE.Vector3 | null = null;
  private endPos: THREE.Vector3 | null = null;
  private startTarget: THREE.Vector3 | null = null;
  private endTarget: THREE.Vector3 | null = null;
  private elapsed = 0;
  private duration = 0;
  private animating = false;
  private mode: CameraMode = 'orbit';
  private onComplete?: (mode: CameraMode) => void;

  constructor(camera: THREE.PerspectiveCamera, controls?: OrbitControls) {
    this.camera = camera;
    this.controls = controls;
  }

  get currentMode(): CameraMode {
    return this.mode;
  }

  setOnComplete(cb: (mode: CameraMode) => void) {
    this.onComplete = cb;
  }

  animateTo(position: THREE.Vector3, target: THREE.Vector3, durationMs: number): void {
    this.startPos = this.camera.position.clone();
    this.endPos = position.clone();
    this.startTarget = this.controls?.target.clone() ?? new THREE.Vector3(0, 0, 0);
    this.endTarget = target.clone();
    this.elapsed = 0;
    this.duration = durationMs;
    this.animating = true;
  }

  transitionToFirstPerson(fpPosition: THREE.Vector3, fpDirection: THREE.Vector3) {
    this.startPos = this.camera.position.clone();
    this.endPos = fpPosition.clone();
    this.startTarget = this.controls?.target.clone() ?? new THREE.Vector3(0, 0, 0);
    this.endTarget = fpPosition.clone().add(fpDirection);
    this.elapsed = 0;
    this.duration = DEFAULT_DURATION * 1000;
    this.animating = true;
    this.mode = 'first-person';
  }

  transitionToOrbit(orbitPosition: THREE.Vector3, orbitTarget: THREE.Vector3) {
    this.startPos = this.camera.position.clone();
    this.endPos = orbitPosition.clone();
    this.startTarget = new THREE.Vector3(
      this.camera.position.x,
      this.camera.position.y - 1.6,
      this.camera.position.z
    );
    if (this.controls) {
      this.controls.target.copy(this.startTarget);
    }
    this.endTarget = orbitTarget.clone();
    this.elapsed = 0;
    this.duration = DEFAULT_DURATION * 1000;
    this.animating = true;
    this.mode = 'orbit';
  }

  update(deltaTime: number): void {
    if (!this.animating || !this.startPos || !this.endPos || !this.startTarget || !this.endTarget) {
      return;
    }

    this.elapsed += deltaTime;
    const progress = Math.min(this.elapsed / this.duration, 1);

    const eased = progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;

    this.camera.position.lerpVectors(this.startPos, this.endPos, eased);

    const currentTarget = new THREE.Vector3().lerpVectors(this.startTarget, this.endTarget, eased);
    if (this.controls) {
      this.controls.target.copy(currentTarget);
      this.controls.update();
    } else {
      this.camera.lookAt(currentTarget);
    }

    if (progress >= 1) {
      this.animating = false;
      this.onComplete?.(this.mode);
    }
  }

  interrupt(): void {
    if (!this.animating) return;
    this.animating = false;
    if (this.startPos && this.endPos) {
      this.camera.position.copy(this.endPos);
    }
    if (this.controls && this.endTarget) {
      this.controls.target.copy(this.endTarget);
      this.controls.update();
    }
    this.onComplete?.(this.mode);
  }

  isAnimating(): boolean {
    return this.animating;
  }
}
