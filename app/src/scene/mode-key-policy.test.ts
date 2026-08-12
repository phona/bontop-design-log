import { describe, it, expect } from 'vitest';
import { shouldToggleSeeThrough, shouldInterruptCameraAnimation, shouldToggleInteriorLights } from './mode-key-policy.js';

describe('shouldToggleSeeThrough', () => {
  it('toggles on W in orbit mode', () => {
    expect(shouldToggleSeeThrough('KeyW', false, 'orbit')).toBe(true);
  });

  it('does NOT toggle on W in first-person (W must walk forward)', () => {
    expect(shouldToggleSeeThrough('KeyW', false, 'first-person')).toBe(false);
  });

  it('does not toggle on W in top-down', () => {
    expect(shouldToggleSeeThrough('KeyW', false, 'top-down')).toBe(true);
  });

  it('ignores auto-repeat W', () => {
    expect(shouldToggleSeeThrough('KeyW', true, 'orbit')).toBe(false);
  });

  it('ignores non-W keys', () => {
    expect(shouldToggleSeeThrough('KeyA', false, 'orbit')).toBe(false);
    expect(shouldToggleSeeThrough('KeyP', false, 'orbit')).toBe(false);
  });
});

describe('shouldInterruptCameraAnimation', () => {
  it('interrupts on WASD while animating in orbit', () => {
    expect(shouldInterruptCameraAnimation(true, 'orbit', 'KeyW')).toBe(true);
    expect(shouldInterruptCameraAnimation(true, 'orbit', 'KeyA')).toBe(true);
    expect(shouldInterruptCameraAnimation(true, 'orbit', 'KeyS')).toBe(true);
    expect(shouldInterruptCameraAnimation(true, 'orbit', 'KeyD')).toBe(true);
  });

  it('does NOT interrupt WASD while animating INTO first-person (fly-in must finish)', () => {
    expect(shouldInterruptCameraAnimation(true, 'first-person', 'KeyW')).toBe(false);
    expect(shouldInterruptCameraAnimation(true, 'first-person', 'KeyD')).toBe(false);
  });

  it('does not interrupt when not animating', () => {
    expect(shouldInterruptCameraAnimation(false, 'orbit', 'KeyW')).toBe(false);
  });

  it('does not interrupt on non-movement keys', () => {
    expect(shouldInterruptCameraAnimation(true, 'orbit', 'KeyM')).toBe(false);
    expect(shouldInterruptCameraAnimation(true, 'orbit', 'KeyV')).toBe(false);
  });
});

describe('shouldToggleInteriorLights', () => {
  it('L 键触发，repeat 不触发', () => {
    expect(shouldToggleInteriorLights('KeyL', false)).toBe(true);
    expect(shouldToggleInteriorLights('KeyL', true)).toBe(false);
    expect(shouldToggleInteriorLights('KeyK', false)).toBe(false);
  });
});
