import * as fs from 'fs';

interface GltfAccessor {
  min?: number[];
  max?: number[];
  count: number;
  type: string;
}

interface GltfMesh {
  name?: string;
  primitives: Array<{ attributes: Record<string, number> }>;
}

interface GltfNode {
  name?: string;
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}

interface GltfJson {
  scenes: Array<{ nodes: number[] }>;
  scene?: number;
  nodes: GltfNode[];
  meshes: GltfMesh[];
  accessors: GltfAccessor[];
}

function parseGlb(path: string): GltfJson {
  const buf = fs.readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB (bad magic)');
  const jsonLen = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== 0x4e4f534a) throw new Error('first chunk not JSON');
  return JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as GltfJson;
}

type Mat4 = number[];

function identity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      for (let k = 0; k < 4; k++) {
        out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
      }
    }
  }
  return out;
}

function trsToMatrix(node: GltfNode): Mat4 {
  if (node.matrix) return node.matrix;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function transformPoint(m: Mat4, p: [number, number, number]): [number, number, number] {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

function main(): void {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: tsx scripts/inspect-glb.ts <file.glb>');
    process.exit(1);
  }
  const gltf = parseGlb(path);

  const nodeNames: string[] = [];
  const missingName: number[] = [];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let meshNodeCount = 0;

  const visit = (idx: number, parentMat: Mat4) => {
    const node = gltf.nodes[idx];
    const world = multiply(parentMat, trsToMatrix(node));
    if (node.name) nodeNames.push(node.name);
    else missingName.push(idx);
    if (node.mesh !== undefined) {
      meshNodeCount++;
      for (const prim of gltf.meshes[node.mesh].primitives) {
        const posIdx = prim.attributes.POSITION;
        if (posIdx === undefined) continue;
        const acc = gltf.accessors[posIdx];
        if (!acc.min || !acc.max) continue;
        for (let i = 0; i < 8; i++) {
          const corner: [number, number, number] = [
            i & 1 ? acc.max[0] : acc.min[0],
            i & 2 ? acc.max[1] : acc.min[1],
            i & 4 ? acc.max[2] : acc.min[2],
          ];
          const w = transformPoint(world, corner);
          for (let a = 0; a < 3; a++) {
            min[a] = Math.min(min[a], w[a]);
            max[a] = Math.max(max[a], w[a]);
          }
        }
      }
    }
    for (const c of node.children ?? []) visit(c, world);
  };

  const sceneIdx = gltf.scene ?? 0;
  for (const root of gltf.scenes[sceneIdx].nodes) visit(root, identity());

  const prefixes = new Map<string, number>();
  for (const n of nodeNames) {
    const prefix = n.includes(':') ? n.split(':')[0] : '(no-colon)';
    prefixes.set(prefix, (prefixes.get(prefix) ?? 0) + 1);
  }

  console.log(`file: ${path}`);
  console.log(`nodes total: ${gltf.nodes.length}, with mesh: ${meshNodeCount}, named: ${nodeNames.length}, unnamed: ${missingName.length}`);
  console.log('node name prefix counts:');
  for (const [p, n] of [...prefixes.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${p}: ${n}`);
  }
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  console.log(`world bbox min: (${min.map((v) => v.toFixed(2)).join(', ')})`);
  console.log(`world bbox max: (${max.map((v) => v.toFixed(2)).join(', ')})`);
  console.log(`world size:     ${size.map((v) => v.toFixed(2)).join(' x ')} m  (x 东西 / y 高 / z 南北)`);
}

main();
