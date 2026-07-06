import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { CameraAnimator } from './CameraAnimator';

describe('CameraAnimator', () => {
  let animator: CameraAnimator;
  let camera: THREE.PerspectiveCamera;

  beforeEach(() => {
    camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 5, 10);
    animator = new CameraAnimator(camera);
  });

  it('should animate camera position over time', () => {
    const targetPos = new THREE.Vector3(5, 5, 5);
    const targetLookAt = new THREE.Vector3(0, 0, 0);

    animator.animateTo(targetPos, targetLookAt, 500);

    expect(animator.isAnimating()).toBe(true);

    // At 250ms (halfway), should be halfway
    animator.update(250);
    expect(camera.position.x).toBeCloseTo(2.5, 1);
    expect(camera.position.z).toBeCloseTo(7.5, 1);

    // At 500ms (complete), should be at target
    animator.update(500);
    expect(camera.position.x).toBeCloseTo(5, 1);
    expect(camera.position.z).toBeCloseTo(5, 1);
    expect(animator.isAnimating()).toBe(false);
  });

  it('should interrupt animation', () => {
    const targetPos = new THREE.Vector3(5, 5, 5);
    const targetLookAt = new THREE.Vector3(0, 0, 0);

    animator.animateTo(targetPos, targetLookAt, 500);
    expect(animator.isAnimating()).toBe(true);

    animator.interrupt();
    expect(animator.isAnimating()).toBe(false);
  });
});
