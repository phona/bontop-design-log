const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];

export function shouldToggleSeeThrough(code: string, repeat: boolean, mode: string): boolean {
  return code === 'KeyW' && !repeat && mode !== 'first-person';
}

export function shouldInterruptCameraAnimation(animating: boolean, animMode: string, code: string): boolean {
  return animating && animMode !== 'first-person' && MOVE_KEYS.includes(code);
}

/** L 键：室内灯光全局开关（InteriorLightingSystem） */
export function shouldToggleInteriorLights(code: string, repeat: boolean): boolean {
  return code === 'KeyL' && !repeat;
}
