import * as THREE from 'three';

export class CameraAnimator {
  private camera: THREE.Camera;
  private startPos: THREE.Vector3 | null = null;
  private endPos: THREE.Vector3 | null = null;
  private startTarget: THREE.Vector3 | null = null;
  private endTarget: THREE.Vector3 | null = null;
  private elapsed = 0;
  private duration = 0;
  private animating = false;

  constructor(camera: THREE.Camera) {
    this.camera = camera;
  }

  animateTo(position: THREE.Vector3, target: THREE.Vector3, duration: number): void {
    this.startPos = this.camera.position.clone();
    this.endPos = position.clone();
    this.startTarget = new THREE.Vector3(0, 0, 0);
    this.endTarget = target.clone();
    this.elapsed = 0;
    this.duration = duration;
    this.animating = true;
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
    this.camera.lookAt(currentTarget);

    if (progress >= 1) {
      this.animating = false;
    }
  }

  interrupt(): void {
    this.animating = false;
  }

  isAnimating(): boolean {
    return this.animating;
  }
}
