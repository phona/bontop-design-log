import * as THREE from 'three';

export interface MaterialAppearance {
  type: string;
  color: string;
  textureUrl?: string;
}

export function createMaterialTexture(appearance: MaterialAppearance): THREE.CanvasTexture | THREE.Texture {
  if (appearance.textureUrl) {
    const loader = new THREE.TextureLoader();
    const tex = loader.load(appearance.textureUrl);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  switch (appearance.type) {
    case 'wood_grain':
      drawWoodGrain(ctx, 512, 512, appearance.color);
      break;
    case 'ceramic_tile':
      drawCeramicTile(ctx, 512, 512, appearance.color);
      break;
    case 'matte_paint':
      drawMattePaint(ctx, 512, 512, appearance.color);
      break;
    default:
      ctx.fillStyle = appearance.color;
      ctx.fillRect(0, 0, 512, 512);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function drawWoodGrain(ctx: CanvasRenderingContext2D, w: number, h: number, baseColor: string): void {
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, w, h);

  for (let y = 0; y < h; y += 8 + Math.random() * 24) {
    const alpha = 0.05 + Math.random() * 0.1;
    ctx.strokeStyle = `rgba(80, 50, 20, ${alpha})`;
    ctx.lineWidth = 1 + Math.random() * 3;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x < w; x += 20) {
      const yOff = Math.sin(x * 0.02 + y * 0.1) * 3 + (Math.random() - 0.5) * 2;
      ctx.lineTo(x, y + yOff);
    }
    ctx.stroke();
  }
}

function drawCeramicTile(ctx: CanvasRenderingContext2D, w: number, h: number, baseColor: string): void {
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, w, h);

  const tileSize = 128;
  ctx.strokeStyle = '#999999';
  ctx.lineWidth = 2;

  for (let x = 0; x <= w; x += tileSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += tileSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

function drawMattePaint(ctx: CanvasRenderingContext2D, w: number, h: number, baseColor: string): void {
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() - 0.5) * 16;
    data[i] = Math.min(255, Math.max(0, data[i] + noise));
    data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
    data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
  }
  ctx.putImageData(imageData, 0, 0);
}
