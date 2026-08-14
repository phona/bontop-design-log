import * as THREE from 'three';

// PlaneGeometry 的 UV 是 0..1 归一化；wood_plank 等米制贴图（repeat=1/worldSize）要求 UV=米坐标。
// 矩形房间在 layout-resolver 被优化为 points=undefined → createRoom 走 PlaneGeometry 分支，必须重标定。
export function scalePlaneUvToMeters(geometry: THREE.PlaneGeometry, width: number, depth: number): void {
  scaleUv(geometry, width, depth);
}

// BoxGeometry 每个面 UV 都是 0..1；对主视觉面尺寸 (width×height) 统一缩放。
// 窄端面（如 20mm 裙板端头）会随主面拉伸，视觉上可忽略；需要精确分面标定时再扩展。
export function scaleBoxUvToMeters(geometry: THREE.BoxGeometry, width: number, height: number): void {
  scaleUv(geometry, width, height);
}

function scaleUv(geometry: THREE.BufferGeometry, scaleU: number, scaleV: number): void {
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * scaleU, uv.getY(i) * scaleV);
  }
  uv.needsUpdate = true;
}
