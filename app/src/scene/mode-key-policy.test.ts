import { describe, it, expect } from 'vitest';
import { shouldToggleSeeThrough, shouldInterruptCameraAnimation, shouldToggleInteriorLights } from './mode-key-policy.js';

describe('shouldToggleSeeThrough', () => {
  it('toggles on X in orbit mode', () => {
    expect(shouldToggleSeeThrough('KeyX', false, 'orbit')).toBe(true);
  });

  it('does NOT toggle on X in first-person', () => {
    expect(shouldToggleSeeThrough('KeyX', false, 'first-person')).toBe(false);
  });

  it('does not toggle on X in top-down', () => {
    expect(shouldToggleSeeThrough('KeyX', false, 'top-down')).toBe(true);
  });

  it('ignores auto-repeat X', () => {
    expect(shouldToggleSeeThrough('KeyX', true, 'orbit')).toBe(false);
  });

  it('W 不再触发透视（2026-10-26 去陷阱：W 专属第一人称前进）', () => {
    expect(shouldToggleSeeThrough('KeyW', false, 'orbit')).toBe(false);
  });

  it('ignores non-X keys', () => {
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
