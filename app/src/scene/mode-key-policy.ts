const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];

/**
 * X-ray 透视开关。2026-10-26 控制面重构从 W 改到 X：W 在第一人称是“前进”，
 * 同一物理键在两种模式下含义不同是可用性陷阱，透视图移出 WASD 键位。
 */
export function shouldToggleSeeThrough(code: string, repeat: boolean, mode: string): boolean {
  return code === 'KeyX' && !repeat && mode !== 'first-person';
}

export function shouldInterruptCameraAnimation(animating: boolean, animMode: string, code: string): boolean {
  return animating && animMode !== 'first-person' && MOVE_KEYS.includes(code);
}

/** L 键：室内灯光全局开关（InteriorLightingSystem） */
export function shouldToggleInteriorLights(code: string, repeat: boolean): boolean {
  return code === 'KeyL' && !repeat;
}
