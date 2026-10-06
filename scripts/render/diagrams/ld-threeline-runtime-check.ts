import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { buildHvacGeometry } from '../../../shared/render/HvacGeometryBuilder.js';
import { buildHvacBuilderSources } from '../../../shared/render/HvacBuilder.js';

const projection = JSON.parse(readFileSync('data/project-render-facts.json', 'utf8'));
const root = new THREE.Group();
const { index } = buildHvacGeometry(root, projection, buildHvacBuilderSources({ projection }));
const rows: Record<string, unknown> = {};
for (const [id, object] of index.terminals) {
  if (!/ld-deco|supply_living|supply_dining|return_living|return_dining|living_bottom|dining_bottom/i.test(id)) continue;
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  rows[id] = {
    position: object.position.toArray().map((v) => Number(v.toFixed(3))),
    render_style: object.userData.render_style,
    decorative: object.userData.decorative,
    size: [size.x, size.y, size.z].map((v) => Number(v.toFixed(3))),
  };
}
console.log(JSON.stringify({ hvacTerminals: index.terminals.size, livingDining: rows }));
