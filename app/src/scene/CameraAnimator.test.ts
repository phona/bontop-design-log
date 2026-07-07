import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { CameraAnimator } from './CameraAnimator';

function makeControlsMock() {
  return {
    target: new THREE.Vector3(0, 0, 0),
    update: vi.fn(),
    enableDamping: true,
    dampingFactor: 0.08,
    maxPolarAngle: Math.PI / 2,
    minDistance: 1,
    maxDistance: 60,
  } as any;
}

describe('CameraAnimator', () => {
  let camera: THREE.PerspectiveCamera;

  beforeEach(() => {
    camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 14, 20);
  });

  it('starts in orbit mode, not animating', () => {
    const animator = new CameraAnimator(camera);
    expect(animator.currentMode).toBe('orbit');
    expect(animator.isAnimating()).toBe(false);
  });

  it('transitions to first-person over time', () => {
    const controls = makeControlsMock();
    const animator = new CameraAnimator(camera, controls);

    animator.transitionToFirstPerson(
      new THREE.Vector3(0, 1.6, -8.8),
      new THREE.Vector3(0, 0, 1)
    );

    expect(animator.isAnimating()).toBe(true);
    expect(animator.currentMode).toBe('first-person');

    animator.update(250);
    expect(animator.isAnimating()).toBe(true);

    animator.update(300);
    expect(animator.isAnimating()).toBe(false);
    expect(camera.position.y).toBeCloseTo(1.6, 0);
  });

  it('interrupt stops animation immediately', () => {
    const controls = makeControlsMock();
    const animator = new CameraAnimator(camera, controls);

    animator.transitionToFirstPerson(
      new THREE.Vector3(0, 1.6, -8.8),
      new THREE.Vector3(0, 0, 1)
    );

    animator.update(100);
    expect(animator.isAnimating()).toBe(true);

    animator.interrupt();
    expect(animator.isAnimating()).toBe(false);
  });

  it('calls onComplete when transition finishes', () => {
    const controls = makeControlsMock();
    const animator = new CameraAnimator(camera, controls);

    let completedMode = '';
    animator.setOnComplete((m) => { completedMode = m; });

    animator.transitionToOrbit(
      new THREE.Vector3(0, 14, 20),
      new THREE.Vector3(0, 0, 0)
    );

    animator.update(600);
    expect(completedMode).toBe('orbit');
  });
});
