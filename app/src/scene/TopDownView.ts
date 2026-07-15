/**
 * TopDownView: 在 3D 透视和正俯视之间切换的薄壳。
 *
 * 设计：相机位置和缓动委托给 CameraAnimator（复用现有动画管线），
 * 本类只负责：
 *   1. 跟踪当前 view 状态
 *   2. 根据场景 bounds 计算 top-down 相机位置
 *   3. 在切换时通知 scene 隐藏 topic UI / 降 grid 透明度
 *   4. 切换 up 向量避免正俯视时矩阵退化
 */
import * as THREE from 'three';
import type { CameraAnimator } from './CameraAnimator.js';

export interface TopDownViewOptions {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  orbitPosition: THREE.Vector3;
  orbitTarget: THREE.Vector3;
  topDownHeight?: number;
  durationMs?: number;
}

const DEFAULT_UP = new THREE.Vector3(0, 1, 0);
const TOP_DOWN_UP = new THREE.Vector3(0, 0, -1);

export class TopDownView {
  private enabled = false;
  private readonly animator: CameraAnimator;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly options: Required<TopDownViewOptions>;
  private onChange?: (enabled: boolean) => void;

  constructor(animator: CameraAnimator, camera: THREE.PerspectiveCamera, options: TopDownViewOptions) {
    this.animator = animator;
    this.camera = camera;
    this.options = {
      topDownHeight: 30,
      durationMs: 400,
      ...options,
    };
  }

  setOnChange(cb: (enabled: boolean) => void): void {
    this.onChange = cb;
  }

  updateBounds(bounds: { minX: number; maxX: number; minZ: number; maxZ: number }): void {
    this.options.bounds = bounds;
    if (this.enabled) {
      const centerX = (bounds.minX + bounds.maxX) / 2;
      const centerZ = (bounds.minZ + bounds.maxZ) / 2;
      this.camera.up.copy(TOP_DOWN_UP);
      const pos = new THREE.Vector3(centerX, this.options.topDownHeight, centerZ + 0.01);
      const tgt = new THREE.Vector3(centerX, 0, centerZ);
      this.animator.transitionToTopDown(pos, tgt);
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  toggle(): void {
    if (this.enabled) {
      this.disable();
    } else {
      this.enable();
    }
  }

  enable(): void {
    if (this.enabled) return;
    const centerX = (this.options.bounds.minX + this.options.bounds.maxX) / 2;
    const centerZ = (this.options.bounds.minZ + this.options.bounds.maxZ) / 2;
    // 俯视时用 (0,0,-1) 作为 up：top 方向对应 -z（北），right 方向 +x（东），避免与 (0,1,0) 视线平行
    this.camera.up.copy(TOP_DOWN_UP);
    const pos = new THREE.Vector3(centerX, this.options.topDownHeight, centerZ + 0.01);
    const tgt = new THREE.Vector3(centerX, 0, centerZ);
    this.animator.transitionToTopDown(pos, tgt);
    this.enabled = true;
    this.onChange?.(true);
  }

  disable(): void {
    if (!this.enabled) return;
    this.camera.up.copy(DEFAULT_UP);
    this.animator.transitionToOrbit(this.options.orbitPosition, this.options.orbitTarget);
    this.enabled = false;
    this.onChange?.(false);
  }
}
