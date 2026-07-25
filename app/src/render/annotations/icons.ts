import * as THREE from 'three';

function makeSprite(text: string, bgColor: string, size: number = 0.15): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.roundRect(0, 0, 128, 64, 8);
  ctx.fill();
  ctx.fillStyle = 'white';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 32);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(size, size * 0.5, 1);
  return sprite;
}

export function createSocketIcon(count: number = 1): THREE.Sprite {
  return makeSprite(`🔌×${count}`, 'rgba(68,136,255,0.85)');
}

export function createSwitchIcon(): THREE.Sprite {
  return makeSprite('🔘', 'rgba(100,100,100,0.85)');
}

export function createFaucetIcon(): THREE.Sprite {
  return makeSprite('💧', 'rgba(68,136,255,0.85)');
}

export function createDrainIcon(): THREE.Sprite {
  return makeSprite('🕳', 'rgba(136,136,136,0.85)');
}

export function createNetworkIcon(): THREE.Sprite {
  return makeSprite('🌐', 'rgba(68,68,68,0.85)');
}

export function createCeilingZoneIndicator(width: number, depth: number): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(width, depth);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x8888ff,
    transparent: true,
    opacity: 0.12,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  return new THREE.Mesh(geo, mat);
}

export function createACIndoorIcon(model: string = ''): THREE.Sprite {
  return makeSprite(`❄ ${model}`, 'rgba(100,180,255,0.85)', 0.25);
}
