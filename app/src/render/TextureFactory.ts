import * as THREE from 'three';
import { mulberry32 } from './seeded-rng.js';

export interface MaterialAppearance {
  type: string;
  color: string;
  textureUrl?: string;
  species?: string;
  pattern?: string;
  variety?: string;
  [key: string]: unknown;
}

export interface ProceduralTextures {
  map: THREE.CanvasTexture;
  normalMap?: THREE.CanvasTexture;
  roughnessMap?: THREE.CanvasTexture;
  /** 贴图 canvas 代表的实际边长（米）；存在时 UV 按米制标定（repeat=1/worldSize），不存在走旧 repeat(2,2) */
  worldSize?: number;
}

const NEW_TYPES = new Set(['wood_grain_v2', 'ceramic_tile_v2', 'stone']);

export function createMaterialTexture(appearance: MaterialAppearance): ProceduralTextures | THREE.Texture {
  if (appearance.textureUrl) {
    const loader = new THREE.TextureLoader();
    const tex = loader.load(appearance.textureUrl);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  // wood_plank 走独立管线（1024 canvas + roughnessMap + worldSize 米制标定）
  if (appearance.type === 'wood_plank') {
    return drawWoodPlankTextures(appearance);
  }

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  let heightCtx: CanvasRenderingContext2D | null = null;
  let heightCanvas: HTMLCanvasElement | null = null;

  if (NEW_TYPES.has(appearance.type)) {
    heightCanvas = document.createElement('canvas');
    heightCanvas.width = heightCanvas.height = 512;
    heightCtx = heightCanvas.getContext('2d')!;
  }

  switch (appearance.type) {
    case 'wood_grain_v2':
      drawWoodGrainV2(ctx, heightCtx!, 512, 512, appearance);
      break;
    case 'ceramic_tile_v2':
      drawCeramicTileV2(ctx, heightCtx!, 512, 512, appearance);
      break;
    case 'stone':
      drawStone(ctx, heightCtx!, 512, 512, appearance);
      break;
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

  if (heightCanvas) {
    const normalCanvas = computeNormalMap(heightCanvas);
    const mapTex = new THREE.CanvasTexture(canvas);
    mapTex.wrapS = THREE.RepeatWrapping;
    mapTex.wrapT = THREE.RepeatWrapping;
    mapTex.colorSpace = THREE.SRGBColorSpace;

    const normalTex = new THREE.CanvasTexture(normalCanvas);
    normalTex.wrapS = THREE.RepeatWrapping;
    normalTex.wrapT = THREE.RepeatWrapping;

    return { map: mapTex, normalMap: normalTex };
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function parseHex(color: string): [number, number, number] {
  const hex = parseInt(color.slice(1), 16);
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

function drawWoodGrainV2(
  ctx: CanvasRenderingContext2D,
  heightCtx: CanvasRenderingContext2D,
  w: number,
  h: number,
  appearance: MaterialAppearance,
): void {
  const species = appearance.species || 'oak';
  let ringSpacing: number;
  let ringVariation: number;
  switch (species) {
    case 'pine': ringSpacing = 40; ringVariation = 12; break;
    case 'walnut': ringSpacing = 16; ringVariation = 6; break;
    case 'maple': ringSpacing = 20; ringVariation = 5; break;
    default: ringSpacing = 24; ringVariation = 8;
  }

  const [r, g, b] = parseHex(appearance.color);
  const darkR = Math.max(0, r - 60);
  const darkG = Math.max(0, g - 50);
  const darkB = Math.max(0, b - 40);

  ctx.fillStyle = appearance.color;
  ctx.fillRect(0, 0, w, h);
  heightCtx.fillStyle = '#808080';
  heightCtx.fillRect(0, 0, w, h);

  const cx = w / 2 + (Math.random() - 0.5) * 60;
  const cy = h / 2 + (Math.random() - 0.5) * 60;
  const maxR = Math.sqrt(cx * cx + cy * cy) + 100;

  for (let radius = 5; radius < maxR; radius += ringSpacing + (Math.random() - 0.5) * ringVariation) {
    const ox = (Math.random() - 0.5) * 3;
    const oy = (Math.random() - 0.5) * 3;
    const rx = radius + (Math.random() - 0.5) * 2;
    const ry = radius * (0.7 + Math.random() * 0.2);

    ctx.strokeStyle = `rgba(${darkR}, ${darkG}, ${darkB}, 0.35)`;
    ctx.lineWidth = 1 + Math.random() * 2;
    ctx.beginPath();
    ctx.ellipse(cx + ox, cy + oy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    heightCtx.strokeStyle = 'rgba(50, 50, 50, 0.35)';
    heightCtx.lineWidth = 1 + Math.random() * 2;
    heightCtx.beginPath();
    heightCtx.ellipse(cx + ox, cy + oy, rx, ry, 0, 0, Math.PI * 2);
    heightCtx.stroke();
  }

  const numKnots = 2 + Math.floor(Math.random() * 4);
  for (let k = 0; k < numKnots; k++) {
    const kx = Math.random() * w;
    const ky = Math.random() * h;
    const knotSize = 4 + Math.random() * 8;

    for (let angle = 0; angle < Math.PI * 4; angle += 0.2) {
      const sr = knotSize * (1 - angle / (Math.PI * 4)) * 0.5;
      const sx = kx + Math.cos(angle) * sr;
      const sy = ky + Math.sin(angle) * sr;
      ctx.fillStyle = `rgba(${Math.max(0, r - 70)}, ${Math.max(0, g - 60)}, ${Math.max(0, b - 50)}, 0.6)`;
      ctx.beginPath();
      ctx.arc(sx, sy, 1.5, 0, Math.PI * 2);
      ctx.fill();

      heightCtx.fillStyle = 'rgba(40, 40, 40, 0.6)';
      heightCtx.beginPath();
      heightCtx.arc(sx, sy, 1.5, 0, Math.PI * 2);
      heightCtx.fill();
    }
  }
}

function drawCeramicTileV2(
  ctx: CanvasRenderingContext2D,
  heightCtx: CanvasRenderingContext2D,
  w: number,
  h: number,
  appearance: MaterialAppearance,
): void {
  const pattern = appearance.pattern || 'straight';
  const tileW = 128;
  const tileH = 128;

  ctx.fillStyle = appearance.color;
  ctx.fillRect(0, 0, w, h);
  heightCtx.fillStyle = '#c0c0c0';
  heightCtx.fillRect(0, 0, w, h);

  const drawTile = (x: number, y: number, tw: number, th: number, angle: number = 0) => {
    ctx.save();
    ctx.translate(x + tw / 2, y + th / 2);
    ctx.rotate(angle);
    ctx.fillStyle = appearance.color;
    ctx.fillRect(-tw / 2 + 2, -th / 2 + 2, tw - 4, th - 4);
    ctx.strokeStyle = '#999999';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-tw / 2 + 2, -th / 2 + 2, tw - 4, th - 4);
    ctx.restore();

    heightCtx.save();
    heightCtx.translate(x + tw / 2, y + th / 2);
    heightCtx.rotate(angle);
    heightCtx.fillStyle = '#d0d0d0';
    heightCtx.fillRect(-tw / 2 + 2, -th / 2 + 2, tw - 4, th - 4);
    heightCtx.restore();
  };

  if (pattern === 'herringbone') {
    const stepX = tileW * 0.7;
    const stepY = tileH * 0.5;
    for (let row = -2; row < h / stepY + 2; row++) {
      for (let col = -2; col < w / stepX + 2; col++) {
        const x = col * stepX + (row % 2) * stepX * 0.5;
        const y = row * stepY;
        const angle = row % 2 === 0 ? Math.PI / 4 : -Math.PI / 4;
        drawTile(x, y, tileW * 0.7, tileH * 0.5, angle);
      }
    }
  } else if (pattern === 'basket') {
    for (let y = 0; y < h; y += tileH) {
      for (let x = 0; x < w; x += tileW) {
        const blockX = Math.floor(x / tileW);
        const blockY = Math.floor(y / tileH);
        const isHorizontal = (blockX + blockY) % 2 === 0;
        if (isHorizontal) {
          drawTile(x, y, tileW, tileH / 2);
          drawTile(x, y + tileH / 2, tileW / 2, tileH / 2);
          drawTile(x + tileW / 2, y + tileH / 2, tileW / 2, tileH / 2);
        } else {
          drawTile(x, y, tileW / 2, tileH / 2);
          drawTile(x + tileW / 2, y, tileW / 2, tileH / 2);
          drawTile(x, y + tileH / 2, tileW, tileH / 2);
        }
      }
    }
  } else {
    for (let y = 0; y < h; y += tileH) {
      for (let x = 0; x < w; x += tileW) {
        drawTile(x, y, tileW, tileH);
      }
    }
  }

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() - 0.5) * 6;
    data[i] = Math.min(255, Math.max(0, data[i] + noise));
    data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
    data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
  }
  ctx.putImageData(imageData, 0, 0);
}

function drawStone(
  ctx: CanvasRenderingContext2D,
  heightCtx: CanvasRenderingContext2D,
  w: number,
  h: number,
  appearance: MaterialAppearance,
): void {
  const variety = appearance.variety || 'marble';

  if (variety === 'marble') {
    drawMarble(ctx, heightCtx, w, h, appearance);
  } else {
    drawTerrazzo(ctx, heightCtx, w, h, appearance);
  }
}

function drawMarble(
  ctx: CanvasRenderingContext2D,
  heightCtx: CanvasRenderingContext2D,
  w: number,
  h: number,
  appearance: MaterialAppearance,
): void {
  const [r, g, b] = parseHex(appearance.color);

  ctx.fillStyle = appearance.color;
  ctx.fillRect(0, 0, w, h);
  heightCtx.fillStyle = '#808080';
  heightCtx.fillRect(0, 0, w, h);

  const numVeins = 5 + Math.floor(Math.random() * 10);
  for (let v = 0; v < numVeins; v++) {
    const startX = Math.random() * w;
    const startY = Math.random() * h;
    const veinLength = 50 + Math.random() * 200;
    const segments = 20 + Math.floor(Math.random() * 30);

    ctx.strokeStyle = `rgba(${Math.max(0, r - 30)}, ${Math.max(0, g - 25)}, ${Math.max(0, b - 20)}, ${0.15 + Math.random() * 0.3})`;
    ctx.lineWidth = 1 + Math.random() * 3;
    ctx.beginPath();
    ctx.moveTo(startX, startY);

    heightCtx.strokeStyle = `rgba(60, 60, 60, ${0.15 + Math.random() * 0.3})`;
    heightCtx.lineWidth = 1 + Math.random() * 3;
    heightCtx.beginPath();
    heightCtx.moveTo(startX, startY);

    let px = startX;
    let py = startY;
    const angle = Math.random() * Math.PI * 2;
    for (let s = 0; s < segments; s++) {
      const step = veinLength / segments;
      const a = angle + Math.sin(s * 0.5 + startX * 0.01) * 1.5 + (Math.random() - 0.5) * 0.8;
      px += Math.cos(a) * step;
      py += Math.sin(a) * step;
      ctx.lineTo(px, py);
      heightCtx.lineTo(px, py);
    }
    ctx.stroke();
    heightCtx.stroke();

    const branchCount = Math.floor(Math.random() * 3);
    for (let b = 0; b < branchCount; b++) {
      const bSeg = Math.floor(Math.random() * segments);
      const bx = startX + Math.cos(angle + Math.sin(bSeg * 0.5 + startX * 0.01) * 1.5) * (bSeg * veinLength / segments);
      const by = startY + Math.sin(angle + Math.sin(bSeg * 0.5 + startX * 0.01) * 1.5) * (bSeg * veinLength / segments);
      const bAngle = angle + (Math.random() - 0.5) * Math.PI;
      const bLen = 20 + Math.random() * 40;

      ctx.strokeStyle = `rgba(${Math.max(0, r - 25)}, ${Math.max(0, g - 20)}, ${Math.max(0, b - 15)}, 0.2)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      heightCtx.strokeStyle = `rgba(70, 70, 70, 0.2)`;
      heightCtx.lineWidth = 1;
      heightCtx.beginPath();
      heightCtx.moveTo(bx, by);
      for (let bs = 0; bs < 10; bs++) {
        const ba = bAngle + Math.sin(bs * 0.8) * 0.5 + (Math.random() - 0.5) * 0.3;
        ctx.lineTo(bx + Math.cos(ba) * (bs * bLen / 10), by + Math.sin(ba) * (bs * bLen / 10));
        heightCtx.lineTo(bx + Math.cos(ba) * (bs * bLen / 10), by + Math.sin(ba) * (bs * bLen / 10));
      }
      ctx.stroke();
      heightCtx.stroke();
    }
  }
}

function drawTerrazzo(
  ctx: CanvasRenderingContext2D,
  heightCtx: CanvasRenderingContext2D,
  w: number,
  h: number,
  appearance: MaterialAppearance,
): void {
  ctx.fillStyle = appearance.color;
  ctx.fillRect(0, 0, w, h);

  const fleckColors = [
    '#8b7355', '#a0522d', '#696969', '#cd853f',
    '#6b8e23', '#4682b4', '#800020', '#2f4f4f',
  ];

  const numFlecks = 200 + Math.floor(Math.random() * 300);
  for (let f = 0; f < numFlecks; f++) {
    const fx = Math.random() * w;
    const fy = Math.random() * h;
    const size = 1 + Math.random() * 3;
    const color = fleckColors[Math.floor(Math.random() * fleckColors.length)];
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(fx, fy, size, 0, Math.PI * 2);
    ctx.fill();
  }

  const [r, g, b] = parseHex(appearance.color);
  heightCtx.fillStyle = '#909090';
  heightCtx.fillRect(0, 0, w, h);
  for (let f = 0; f < numFlecks; f++) {
    const fx = Math.random() * w;
    const fy = Math.random() * h;
    const size = 1 + Math.random() * 3;
    const brightness = 60 + Math.random() * 80;
    heightCtx.fillStyle = `rgb(${brightness}, ${brightness}, ${brightness})`;
    heightCtx.beginPath();
    heightCtx.arc(fx, fy, size, 0, Math.PI * 2);
    heightCtx.fill();
  }
}

function computeNormalMap(heightCanvas: HTMLCanvasElement): HTMLCanvasElement {
  const w = heightCanvas.width;
  const h = heightCanvas.height;
  const srcCtx = heightCanvas.getContext('2d')!;
  const srcData = srcCtx.getImageData(0, 0, w, h);
  const pixels = srcData.data;

  const outCanvas = document.createElement('canvas');
  outCanvas.width = w;
  outCanvas.height = h;
  const outCtx = outCanvas.getContext('2d')!;
  const outImage = outCtx.createImageData(w, h);
  const outData = outImage.data;

  const strength = 3.0;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = (y * w + x) * 4;
      const idxT = ((y - 1) * w + x) * 4;
      const idxB = ((y + 1) * w + x) * 4;
      const idxL = (y * w + (x - 1)) * 4;
      const idxR = (y * w + (x + 1)) * 4;

      const tl = pixels[((y - 1) * w + (x - 1)) * 4];
      const t = pixels[idxT];
      const tr = pixels[((y - 1) * w + (x + 1)) * 4];
      const l = pixels[idxL];
      const r = pixels[idxR];
      const bl = pixels[((y + 1) * w + (x - 1)) * 4];
      const b = pixels[idxB];
      const br = pixels[((y + 1) * w + (x + 1)) * 4];

      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);
      const dz = 255 / strength;

      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const nx = (dx / len) * 0.5 + 0.5;
      const ny = (dy / len) * 0.5 + 0.5;
      const nz = (dz / len) * 0.5 + 0.5;

      outData[idx] = nx * 255;
      outData[idx + 1] = ny * 255;
      outData[idx + 2] = nz * 255;
      outData[idx + 3] = 255;
    }
  }

  outCtx.putImageData(outImage, 0, 0);
  return outCanvas;
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

// ── wood_plank：物理尺寸条板纹理（直铺/人字拼），PBR 三通道 + 米制 worldSize ──

const PLANK_CANVAS = 1024;

function gcdI(a: number, b: number): number {
  return b === 0 ? a : gcdI(b, a % b);
}

function clamp255(v: number): number {
  return Math.min(255, Math.max(0, Math.round(v)));
}

/**
 * wood_plank 纹理生成。
 * appearance 扩展字段：pattern(straight|herringbone) / plank_mm:[宽,长] / grout_color / grout_mm /
 * finish(soft=柔光 rough0.5 | matte=哑光 rough0.85) / seed（确定性随机，默认 42）。
 * 逐板明度/冷暖/粗糙度抖动是掠射光下"明暗流动"的材质基础；全部随机走 mulberry32(seed)。
 */
function drawWoodPlankTextures(appearance: MaterialAppearance): ProceduralTextures {
  const seed = typeof appearance.seed === 'number' ? appearance.seed : 42;
  const rng = mulberry32(seed);
  const dims = Array.isArray(appearance.plank_mm) ? (appearance.plank_mm as number[]) : [150, 900];
  const wmm = dims[0];
  const lmm = dims[1];
  const pattern = appearance.pattern === 'herringbone' ? 'herringbone' : 'straight';
  const [br0, bg0, bb0] = parseHex(appearance.color);
  // 美缝默认取基色下调 12%（同色系，真实木纹砖美缝做法）；grout_color 可覆盖
  const groutColor = typeof appearance.grout_color === 'string'
    ? appearance.grout_color
    : `rgb(${clamp255(br0 * 0.88)},${clamp255(bg0 * 0.88)},${clamp255(bb0 * 0.88)})`;
  const groutMm = typeof appearance.grout_mm === 'number' ? appearance.grout_mm : 2;
  const baseRough = appearance.finish === 'soft' ? 0.5 : 0.85;
  const [br, bg, bb] = [br0, bg0, bb0] as [number, number, number];

  // 世界边长 S（mm→m）：保证图案在贴图边界无缝 wrap
  let Smm: number;
  if (pattern === 'herringbone') {
    // 人字拼晶格：d=(L+W)/√2 为横向周期与行高；竖向 wrap 要求 m·W ≡ 0 (mod L+W)，取 m=(L+W)/gcd(W,L+W)
    const g = gcdI(wmm, lmm + wmm);
    const m = (lmm + wmm) / g;
    Smm = (m * (lmm + wmm)) / Math.SQRT2;
  } else {
    // 直铺工字错缝：横向周期 L，竖向行数 N=S/W 须为偶数（错缝周期 2 整除 N）
    Smm = lmm * Math.ceil(4000 / lmm);
    while (Smm % wmm !== 0 || (Smm / wmm) % 2 !== 0) Smm += lmm;
  }
  const S = Smm / 1000;
  const PPM = PLANK_CANVAS / S;
  const pl = (lmm / 1000) * PPM;
  const pw = (wmm / 1000) * PPM;
  const g2 = Math.max(0.75, ((groutMm / 1000) * PPM) / 2);

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = PLANK_CANVAS;
  const ctx = canvas.getContext('2d')!;
  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = heightCanvas.height = PLANK_CANVAS;
  const heightCtx = heightCanvas.getContext('2d')!;
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = roughCanvas.height = PLANK_CANVAS;
  const roughCtx = roughCanvas.getContext('2d')!;

  // 底=缝：色=美缝色，高度=下凹，粗糙度=略高于板面
  ctx.fillStyle = groutColor;
  ctx.fillRect(0, 0, PLANK_CANVAS, PLANK_CANVAS);
  heightCtx.fillStyle = '#7c7c7c';
  heightCtx.fillRect(0, 0, PLANK_CANVAS, PLANK_CANVAS);
  const groutRough = clamp255(Math.min(1, baseRough + 0.15) * 255);
  roughCtx.fillStyle = `rgb(${groutRough},${groutRough},${groutRough})`;
  roughCtx.fillRect(0, 0, PLANK_CANVAS, PLANK_CANVAS);

  const drawPlank = (cx: number, cy: number, angle: number) => {
    // 逐板抖动：明度 ±6%、冷暖 ±4、粗糙度 ±0.08（全部 seeded）
    const dl = (rng() - 0.5) * 12;
    const warm = (rng() - 0.5) * 4;
    const rr = clamp255(br + dl + warm);
    const gg = clamp255(bg + dl);
    const bb2 = clamp255(bb + dl - warm);
    const rough = Math.min(1, Math.max(0.05, baseRough + (rng() - 0.5) * 0.16));
    const rv = clamp255(rough * 255);
    const strokes = 1 + Math.floor(rng() * 2);

    for (const c of [ctx, heightCtx, roughCtx]) {
      c.save();
      c.translate(cx, cy);
      c.rotate(angle);
    }
    const ix = -pl / 2 + g2;
    const iy = -pw / 2 + g2;
    const iw = pl - 2 * g2;
    const ih = pw - 2 * g2;

    ctx.fillStyle = `rgb(${rr},${gg},${bb2})`;
    ctx.fillRect(ix, iy, iw, ih);
    // 板内顺纹（沿板长方向，微摆动）
    ctx.strokeStyle = `rgba(${clamp255(rr * 0.78)},${clamp255(gg * 0.78)},${clamp255(bb2 * 0.78)},0.16)`;
    for (let s = 0; s < strokes; s++) {
      const gy = (rng() - 0.5) * ih * 0.6;
      ctx.lineWidth = 0.6 + rng() * 0.8;
      ctx.beginPath();
      ctx.moveTo(ix + 1, gy);
      for (let seg = 1; seg <= 4; seg++) {
        ctx.lineTo(ix + (iw * seg) / 4, gy + (rng() - 0.5) * ih * 0.2);
      }
      ctx.stroke();
    }
    heightCtx.fillStyle = '#969696';
    heightCtx.fillRect(ix, iy, iw, ih);
    roughCtx.fillStyle = `rgb(${rv},${rv},${rv})`;
    roughCtx.fillRect(ix, iy, iw, ih);
    for (const c of [ctx, heightCtx, roughCtx]) c.restore();
  };

  if (pattern === 'herringbone') {
    // 晶格常数 d = (L+W)/√2：同行中心间距 d、±45° 交替；行高 d；行偏移 j·W/√2 (mod d)
    const d = (pl + pw) / Math.SQRT2;
    const rowShift = pw / Math.SQRT2;
    for (let j = -2; j * d < PLANK_CANVAS + 2 * d; j++) {
      const y = j * d;
      const ox = (((j * rowShift) % d) + d) % d;
      for (let k = -2; k * d + ox < PLANK_CANVAS + 2 * d; k++) {
        const angle = ((k % 2) + 2) % 2 === 0 ? Math.PI / 4 : -Math.PI / 4;
        drawPlank(k * d + ox, y, angle);
      }
    }
  } else {
    // 直铺工字错缝：奇偶行错半板
    for (let j = -1; j * pw < PLANK_CANVAS + pw; j++) {
      const y = j * pw + pw / 2;
      const off = (((j % 2) + 2) % 2) * (pl / 2);
      for (let k = -2; k * pl + off - pl / 2 < PLANK_CANVAS + pl; k++) {
        drawPlank(k * pl + off, y, 0);
      }
    }
  }

  const mapTex = new THREE.CanvasTexture(canvas);
  mapTex.wrapS = THREE.RepeatWrapping;
  mapTex.wrapT = THREE.RepeatWrapping;
  mapTex.colorSpace = THREE.SRGBColorSpace;

  const normalTex = new THREE.CanvasTexture(computeNormalMap(heightCanvas));
  normalTex.wrapS = THREE.RepeatWrapping;
  normalTex.wrapT = THREE.RepeatWrapping;

  const roughTex = new THREE.CanvasTexture(roughCanvas);
  roughTex.wrapS = THREE.RepeatWrapping;
  roughTex.wrapT = THREE.RepeatWrapping;

  return { map: mapTex, normalMap: normalTex, roughnessMap: roughTex, worldSize: S };
}
