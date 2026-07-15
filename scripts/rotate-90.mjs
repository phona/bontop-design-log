import { load, dump } from 'js-yaml';
import { readFileSync, writeFileSync } from 'fs';

function rotatePoint(p) {
  return { x: p.z, z: p.x };
}

function rotateRoom(r) {
  return { ...r, x: r.z, z: r.x, width: r.depth, depth: r.width };
}

function rotateWall(w) {
  return { x1: w.z1, z1: w.x1, x2: w.z2, z2: w.x2 };
}

function rotateSuppress(s) {
  return {
    ...s,
    region: { x1: s.region.z1, z1: s.region.x1, x2: s.region.z2, z2: s.region.x2 },
  };
}

function rotateElement(e) {
  const out = { ...e };
  if (e.points) out.points = e.points.map(rotatePoint);
  return out;
}

// model-geometry.yaml
const modelRaw = readFileSync('config/layout/model-geometry.yaml', 'utf8');
const model = load(modelRaw);
model.rooms = model.rooms.map(rotateRoom);
if (model.platform) model.platform = rotateRoom(model.platform);
model.walls = model.walls.map(rotateWall);
writeFileSync('config/layout/model-geometry.yaml', dump(model, { lineWidth: -1 }));

// overlay.yaml
const overlayRaw = readFileSync('config/layout/overlay.yaml', 'utf8');
const overlay = load(overlayRaw);
if (overlay.suppress) overlay.suppress = overlay.suppress.map(rotateSuppress);
if (overlay.elements) overlay.elements = overlay.elements.map(rotateElement);
writeFileSync('config/layout/overlay.yaml', dump(overlay, { lineWidth: -1 }));

console.log('Rotation done');
console.log('New bounds: x in [0, 12.8], z in [0, 16.4]');
