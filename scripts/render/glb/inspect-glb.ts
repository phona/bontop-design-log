import { readFileSync } from 'node:fs';

interface GltfAccessor {
  min?: number[];
  max?: number[];
  count?: number;
  type?: string;
}

interface GltfMesh {
  name?: string;
  primitives: Array<{ attributes?: Record<string, number> }>;
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

interface GltfScene {
  nodes?: number[];
}

interface GltfJson {
  scenes: GltfScene[];
  scene?: number;
  nodes: GltfNode[];
  meshes?: GltfMesh[];
  accessors?: GltfAccessor[];
}

export interface WorldBbox {
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
}

export interface FixtureRoleRecord {
  nodeName: string;
  part: string;
  role: string;
  prefix: string;
}

export interface GlbSummary {
  schemaVersion: '1.0';
  nodesTotal: number;
  meshNodesTotal: number;
  namedNodesTotal: number;
  unnamedNodeIndexes: number[];
  nodeIds: string[];
  duplicateNodeIds: string[];
  prefixCounts: Record<string, number>;
  fixtureRoles?: FixtureRoleRecord[];
  unknownFixtureRoleTags?: string[];
  duplicateFixtureRoleTags?: string[];
  nodeBboxes?: Record<string, WorldBbox>;
  worldBbox: WorldBbox | null;
}

const FIXTURE_ROLE_RE = /^(.+):part=(.+):role=([^:]+)$/u;

function roleTagCount(name: string, tag: 'part' | 'role'): number {
  return name.match(new RegExp(`:${tag}=`, 'gu'))?.length ?? 0;
}

export interface GlbNodeRecord {
  index: number;
  name?: string;
  parentIndex?: number;
  mesh: boolean;
}

type Mat4 = number[];

function fail(message: string): never {
  throw new Error(`Invalid GLB: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${label} must be a finite number`);
  return value;
}

function index(value: unknown, length: number, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) >= length) {
    fail(`${label} references invalid index ${String(value)}`);
  }
  return value as number;
}

function numberArray(value: unknown, length: number, label: string): number[] {
  if (!Array.isArray(value) || value.length !== length) fail(`${label} must be an array of ${length} finite numbers`);
  return value.map((entry, i) => finiteNumber(entry, `${label}[${i}]`));
}

function parseGltfJson(value: unknown): GltfJson {
  if (!isRecord(value)) fail('JSON root must be an object');
  const scenesRaw = value.scenes;
  const nodesRaw = value.nodes;
  if (!Array.isArray(scenesRaw) || scenesRaw.length === 0) fail('scenes must be a non-empty array');
  if (!Array.isArray(nodesRaw)) fail('nodes must be an array');

  const scenes = scenesRaw.map((scene, sceneIndex) => {
    if (!isRecord(scene)) fail(`scenes[${sceneIndex}] must be an object`);
    if (scene.nodes !== undefined && !Array.isArray(scene.nodes)) fail(`scenes[${sceneIndex}].nodes must be an array`);
    return { nodes: scene.nodes as number[] | undefined };
  });
  const nodes = nodesRaw.map((node, nodeIndex) => {
    if (!isRecord(node)) fail(`nodes[${nodeIndex}] must be an object`);
    if (node.name !== undefined && typeof node.name !== 'string') fail(`nodes[${nodeIndex}].name must be a string`);
    if (node.children !== undefined && !Array.isArray(node.children)) fail(`nodes[${nodeIndex}].children must be an array`);
    if (node.matrix !== undefined) numberArray(node.matrix, 16, `nodes[${nodeIndex}].matrix`);
    if (node.translation !== undefined) numberArray(node.translation, 3, `nodes[${nodeIndex}].translation`);
    if (node.rotation !== undefined) numberArray(node.rotation, 4, `nodes[${nodeIndex}].rotation`);
    if (node.scale !== undefined) numberArray(node.scale, 3, `nodes[${nodeIndex}].scale`);
    return node as GltfNode;
  });
  const meshesRaw = value.meshes ?? [];
  if (!Array.isArray(meshesRaw)) fail('meshes must be an array');
  const meshes = meshesRaw.map((mesh, meshIndex) => {
    if (!isRecord(mesh) || !Array.isArray(mesh.primitives)) fail(`meshes[${meshIndex}].primitives must be an array`);
    return mesh as unknown as GltfMesh;
  });
  const accessorsRaw = value.accessors ?? [];
  if (!Array.isArray(accessorsRaw)) fail('accessors must be an array');
  const accessors = accessorsRaw.map((accessor, accessorIndex) => {
    if (!isRecord(accessor)) fail(`accessors[${accessorIndex}] must be an object`);
    for (const [bound, value] of [['min', accessor.min], ['max', accessor.max]] as const) {
      if (value === undefined) continue;
      if (!Array.isArray(value) || value.length === 0) fail(`accessors[${accessorIndex}].${bound} must be a non-empty array of finite numbers`);
      value.forEach((entry, i) => finiteNumber(entry, `accessors[${accessorIndex}].${bound}[${i}]`));
    }
    return accessor as unknown as GltfAccessor;
  });
  if (value.scene !== undefined) index(value.scene, scenes.length, 'scene');

  for (const [sceneIndex, scene] of scenes.entries()) {
    for (const root of scene.nodes ?? []) index(root, nodes.length, `scenes[${sceneIndex}].nodes`);
  }
  for (const [nodeIndex, node] of nodes.entries()) {
    if (node.mesh !== undefined) index(node.mesh, meshes.length, `nodes[${nodeIndex}].mesh`);
    for (const child of node.children ?? []) index(child, nodes.length, `nodes[${nodeIndex}].children`);
  }
  for (const [meshIndex, mesh] of meshes.entries()) {
    for (const [primitiveIndex, primitive] of mesh.primitives.entries()) {
      if (!isRecord(primitive)) fail(`meshes[${meshIndex}].primitives[${primitiveIndex}] must be an object`);
      if (primitive.attributes !== undefined) {
        if (!isRecord(primitive.attributes)) fail(`meshes[${meshIndex}].primitives[${primitiveIndex}].attributes must be an object`);
        for (const [semantic, accessor] of Object.entries(primitive.attributes)) {
          index(accessor, accessors.length, `meshes[${meshIndex}].primitives[${primitiveIndex}].attributes.${semantic}`);
        }
      }
    }
  }

  return { scenes, scene: value.scene as number | undefined, nodes, meshes, accessors };
}

function parseGlbBuffer(buffer: Buffer): GltfJson {
  if (buffer.length < 20) fail('file is shorter than GLB header and JSON chunk header');
  if (buffer.readUInt32LE(0) !== 0x46546c67) fail('bad magic');
  if (buffer.readUInt32LE(4) !== 2) fail(`unsupported version ${buffer.readUInt32LE(4)} (expected 2)`);
  const declaredLength = buffer.readUInt32LE(8);
  if (declaredLength !== buffer.length) fail(`declared length ${declaredLength} does not match file length ${buffer.length}`);

  let offset = 12;
  let chunkIndex = 0;
  let jsonText: string | undefined;
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) fail(`chunk ${chunkIndex} header exceeds file boundary`);
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    offset += 8;
    if (chunkLength > buffer.length - offset) fail(`chunk ${chunkIndex} exceeds file boundary`);
    if (chunkIndex === 0) {
      if (chunkType !== 0x4e4f534a) fail('first chunk is not JSON');
      jsonText = buffer.subarray(offset, offset + chunkLength).toString('utf8').replace(/\0+$/u, '').trimEnd();
    }
    offset += chunkLength;
    chunkIndex++;
  }
  if (offset !== buffer.length) fail('chunk parsing did not end at file boundary');
  if (jsonText === undefined) fail('missing JSON chunk');
  try {
    return parseGltfJson(JSON.parse(jsonText));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Invalid GLB:')) throw error;
    fail(`JSON parse failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function identity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiply(a: Mat4, b: Mat4): Mat4 {
  const output = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      for (let k = 0; k < 4; k++) output[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
    }
  }
  if (!output.every(Number.isFinite)) fail('world transform contains non-finite values');
  return output;
}

function trsToMatrix(node: GltfNode): Mat4 {
  if (node.matrix) return numberArray(node.matrix, 16, 'node.matrix');
  const [tx, ty, tz] = node.translation ? numberArray(node.translation, 3, 'node.translation') : [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ? numberArray(node.rotation, 4, 'node.rotation') : [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ? numberArray(node.scale, 3, 'node.scale') : [1, 1, 1];
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

function transformPoint(matrix: Mat4, point: [number, number, number]): [number, number, number] {
  const result: [number, number, number] = [
    matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
    matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
    matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
  ];
  if (!result.every(Number.isFinite)) fail('world bbox contains non-finite coordinates');
  return result;
}

export function inspectGlb(path: string): GlbSummary {
  const gltf = parseGlbBuffer(readFileSync(path));
  const nodeIds: string[] = [];
  const unnamedNodeIndexes: number[] = [];
  const prefixCounts = new Map<string, number>();
  const fixtureRoles: FixtureRoleRecord[] = [];
  const unknownFixtureRoleTags = new Set<string>();
  const nodeBboxes: Record<string, WorldBbox> = {};
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let hasBbox = false;
  let meshNodesTotal = 0;
  const visited = new Set<number>();
  const activeScene = gltf.scenes[gltf.scene ?? 0];

  const visit = (nodeIndex: number, parentMatrix: Mat4): void => {
    if (visited.has(nodeIndex)) return;
    visited.add(nodeIndex);
    const node = gltf.nodes[nodeIndex];
    const world = multiply(parentMatrix, trsToMatrix(node));
    if (node.name) {
      nodeIds.push(node.name);
      const prefix = node.name.includes(':') ? node.name.split(':')[0] : '(no-colon)';
      prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
      const partCount = roleTagCount(node.name, 'part');
      const roleCount = roleTagCount(node.name, 'role');
      const roleMatch = FIXTURE_ROLE_RE.exec(node.name);
      // `:part=` is also used by non-fixture render groups (for example
      // curtain_run wall parts); only the combined part+role form is a
      // fixture role contract.
      if (partCount === 1 && roleCount === 1 && roleMatch) {
        fixtureRoles.push({ nodeName: node.name, part: roleMatch[2], role: roleMatch[3], prefix: roleMatch[1].split(':')[0] });
      } else if (roleCount > 0 || partCount > 0) {
        unknownFixtureRoleTags.add(node.name);
      }
    } else {
      unnamedNodeIndexes.push(nodeIndex);
    }
    if (node.mesh !== undefined) {
      meshNodesTotal++;
      const nodeMin = [Infinity, Infinity, Infinity];
      const nodeMax = [-Infinity, -Infinity, -Infinity];
      let nodeHasBbox = false;
      for (const primitive of gltf.meshes![node.mesh].primitives) {
        const positionAccessor = primitive.attributes?.POSITION;
        if (positionAccessor === undefined) continue;
        const accessor = gltf.accessors![positionAccessor];
        if (!accessor.min || !accessor.max) continue;
        const accessorMin = numberArray(accessor.min, 3, `accessors[${positionAccessor}].min`) as [number, number, number];
        const accessorMax = numberArray(accessor.max, 3, `accessors[${positionAccessor}].max`) as [number, number, number];
        for (let cornerIndex = 0; cornerIndex < 8; cornerIndex++) {
          const point: [number, number, number] = [
            cornerIndex & 1 ? accessorMax[0] : accessorMin[0],
            cornerIndex & 2 ? accessorMax[1] : accessorMin[1],
            cornerIndex & 4 ? accessorMax[2] : accessorMin[2],
          ];
          const worldPoint = transformPoint(world, point);
          for (let axis = 0; axis < 3; axis++) {
            min[axis] = Math.min(min[axis], worldPoint[axis]);
            max[axis] = Math.max(max[axis], worldPoint[axis]);
            nodeMin[axis] = Math.min(nodeMin[axis], worldPoint[axis]);
            nodeMax[axis] = Math.max(nodeMax[axis], worldPoint[axis]);
          }
          hasBbox = true;
          nodeHasBbox = true;
        }
      }
      if (node.name && nodeHasBbox) {
        const prior = nodeBboxes[node.name];
        const mergedMin = prior ? [0, 1, 2].map((axis) => Math.min(prior.min[axis], nodeMin[axis])) : nodeMin;
        const mergedMax = prior ? [0, 1, 2].map((axis) => Math.max(prior.max[axis], nodeMax[axis])) : nodeMax;
        nodeBboxes[node.name] = {
          min: mergedMin as [number, number, number],
          max: mergedMax as [number, number, number],
          size: [0, 1, 2].map((axis) => mergedMax[axis] - mergedMin[axis]) as [number, number, number],
        };
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  for (const root of activeScene.nodes ?? []) visit(root, identity());

  const sortedNodeIds = [...nodeIds].sort();
  const duplicateNodeIds = [...new Set(sortedNodeIds.filter((id, index) => index > 0 && id === sortedNodeIds[index - 1]))];
  const sortedFixtureRoles = [...fixtureRoles].sort((a, b) => a.nodeName.localeCompare(b.nodeName) || a.part.localeCompare(b.part) || a.role.localeCompare(b.role));
  const roleKeys = sortedFixtureRoles.map((entry) => `${entry.nodeName}\u0000${entry.part}\u0000${entry.role}`);
  const duplicateFixtureRoleTags = [...new Set(roleKeys.filter((key, index) => index > 0 && key === roleKeys[index - 1]).map((key) => key.split('\u0000')[0]))];
  const worldBbox = hasBbox
    ? {
      min: min as [number, number, number],
      max: max as [number, number, number],
      size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] as [number, number, number],
    }
    : null;
  if (worldBbox && ![...worldBbox.min, ...worldBbox.max, ...worldBbox.size].every(Number.isFinite)) fail('world bbox is not finite');

  return {
    schemaVersion: '1.0',
    nodesTotal: gltf.nodes.length,
    meshNodesTotal,
    namedNodesTotal: nodeIds.length,
    unnamedNodeIndexes: unnamedNodeIndexes.sort((a, b) => a - b),
    nodeIds: sortedNodeIds,
    duplicateNodeIds,
    prefixCounts: Object.fromEntries([...prefixCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
    fixtureRoles: sortedFixtureRoles,
    unknownFixtureRoleTags: [...unknownFixtureRoleTags].sort(),
    duplicateFixtureRoleTags,
    nodeBboxes: Object.fromEntries(Object.entries(nodeBboxes).sort(([a], [b]) => a.localeCompare(b))),
    worldBbox,
  };
}

function printHuman(path: string, summary: GlbSummary): void {
  console.log(`file: ${path}`);
  console.log(`nodes total: ${summary.nodesTotal}, with mesh: ${summary.meshNodesTotal}, named: ${summary.namedNodesTotal}, unnamed: ${summary.unnamedNodeIndexes.length}`);
  console.log('node name prefix counts:');
  for (const [prefix, count] of Object.entries(summary.prefixCounts)) console.log(`  ${prefix}: ${count}`);
  if (!summary.worldBbox) {
    console.log('world bbox: unavailable (no POSITION accessor min/max)');
    return;
  }
  const { min, max, size } = summary.worldBbox;
  console.log(`world bbox min: (${min.map((value) => value.toFixed(2)).join(', ')})`);
  console.log(`world bbox max: (${max.map((value) => value.toFixed(2)).join(', ')})`);
  console.log(`world size:     ${size.map((value) => value.toFixed(2)).join(' x ')} m  (x 东西 / y 高 / z 南北)`);
}

function main(argv: string[]): void {
  const [first, second] = argv;
  const json = first === '--json';
  const path = json ? second : first;
  if (!path || (json && argv.length !== 2) || (!json && argv.length !== 1)) {
    console.error('usage: tsx scripts/render/glb/inspect-glb.ts [--json] <file.glb>');
    process.exitCode = 1;
    return;
  }
  const summary = inspectGlb(path);
  if (json) console.log(JSON.stringify(summary, null, 2));
  else printHuman(path, summary);
}

if (process.argv[1] && /inspect-glb\.(ts|js)$/u.test(process.argv[1])) main(process.argv.slice(2));
