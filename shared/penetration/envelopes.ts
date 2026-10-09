import * as THREE from 'three';
import type { ResolvedWall, ResolvedRoom, ResolvedOpening, SceneElement } from '../../shared/types.js';
import type { Aabb3 } from '../spatial-validation.js';
import type { BoxEntry } from './scene.js';
import { obbFromObject, satOverlap, type Obb } from './obb.js';
import type { EnvelopeConfig, EnvelopeKind, FurnitureEnvelopeSpec, WorldFace } from './types.js';

/**
 * 活动包络（envelope）——**shadow-only**。
 *
 * 现行穿透规则只验默认静态状态；「用起来才穿模」（门扇开启占位、推拉门开启态、
 * 冰箱/洗碗机/洗衣机门、抽屉/拉篮、椅子拉出、衣柜平开门 vs 床）完全不可见。本模块
 * 把这些活动态建模为「扫掠体/平移体」，用 obb.ts 的 SAT 做窄相位，结论**只进
 * report.shadow.envelopes，不计入 errors/warnings、不影响退出码**。
 *
 * ## 铁律：不许猜几何
 * 每个包络都从**已声明数据**推导：
 * - 门扇开启弧：从 model-geometry 的 openings（width/height/swing/hinge）+ 墙段方向，
 *   完全复刻 SceneBuilder 的合页与开门向约定（addWallElement 的 door 分支）。
 * - 推拉门开启态：从 overlay 的 sliding_door_run（open:true/panels/points）复刻
 *   SceneBuilder 开启态面板位置公式（buildSlidingDoor 的 `along` 分支）。
 * - 家具包络：每个类型的活动包络必须在 config/anti-penetration.yaml 的 envelopes.furniture
 *   显式申报（kind + 方向/行程 + declared_basis）。**未申报的类型不生成包络**，并在
 *   shadow 汇总里显形为 envelope_undeclared——「未申报 → 显形，不猜」。
 *
 * ## 近似与口径（info-only，可评审）
 * - 门扇 90° 扫掠用 K 个有向盒近似扇形（见 doorSwingObbs 注释）：只过冲、不漏，保守。
 * - 家具目标用其 runtime OBB（旋转体精确）；无 geometry 的 target 退化为 AABB→OBB。
 * - 门扇扫掠**不碰墙**：合页贴在墙段上，与墙 slab 固有接触（representation contact），
 *   且 OBB-vs-墙 slab 等于换中心线口径重判（见 docs/penetration-lint.md）；因此只对照
 *   家具/玻璃/吊顶。墙被门扇挡住属另一类显形债务，本轮不并入门扇包络。
 */

const DEFAULT_WEDGES = 3;
const DEFAULT_SWING_M = 0.55; // 厂家安装净空常识值：电器/抽屉开门净空约 0.5m（信息级，非施工依据）
const DEFAULT_PULLOUT_M = 0.45;

export type { EnvelopeKind };

export interface EnvelopeOverlap {
  entity: string;
  depth_m: number;
  mtv?: [number, number, number];
}

export interface EnvelopeHit {
  envelope_id: string;
  /** [envelope_id, 包络宿主实体]（宿主 = placed 家具 / 门洞 / 推拉门 element）。 */
  pair: [string, string];
  envelope_kind: EnvelopeKind;
  /** 配置里那条申报的 id（门扇=洞 id，推拉门=element id，家具=envelope spec id）。 */
  enabled_by: string;
  /** 依据出处（配置申报的 declared_basis，或门洞/推拉门的声明来源）。 */
  declared_basis: string;
  /** 与之相交的实体 id 与穿透深度（SAT/MTV）。 */
  overlaps: EnvelopeOverlap[];
  level: 'info';
}

export interface EnvelopeUndeclared {
  type: string;
  /** 该类型的 placed runtime id（去重前列出，便于定位）。 */
  instances: string[];
  note: string;
}

export interface EnvelopeReport {
  summary: {
    /** 生成了活动包络的宿主数量（门扇 + 推拉门 + 已申报家具）。 */
    envelopes: number;
    /** 其中至少与一个静体相交的包络数量。 */
    hits: number;
    /** 全部相交对数量（一个包络可撞多个静体）。 */
    hit_pairs: number;
    /** 无活动包络申报的 placed 类型数量（不含 mep 协调构件）。 */
    undeclared_types: number;
  };
  hits: EnvelopeHit[];
  undeclared: EnvelopeUndeclared[];
}

export interface EnvelopeTarget {
  entity: string;
  type: string;
  box: Aabb3;
  object?: THREE.Object3D;
}

export interface EnvelopeInput {
  walls: ResolvedWall[];
  rooms: ResolvedRoom[];
  /** overlay 元素（sliding_door_run 等）。 */
  elements: SceneElement[];
  /** placed 家具 runtime 条目（家具包络来源 + 未申报显形）。 */
  furniture: BoxEntry[];
  /** 静体目标：家具 + 玻璃/窗帘/栏杆 + 吊顶。 */
  targets: EnvelopeTarget[];
  config: EnvelopeConfig;
  mepTypes?: string[];
  source?: string;
}

// ── 几何基元 ────────────────────────────────────────────────────────────────

const BASIS: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
];

function obbFromBox(box: Aabb3): Obb {
  return {
    center: new THREE.Vector3((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, (box.minZ + box.maxZ) / 2),
    axes: [BASIS[0].clone(), BASIS[1].clone(), BASIS[2].clone()],
    half: [(box.maxX - box.minX) / 2, (box.maxY - box.minY) / 2, (box.maxZ - box.minZ) / 2],
  };
}

/** 目标 OBB：有 geometry 用 runtime OBB（旋转体精确），否则退化为 AABB→OBB。 */
function targetObb(target: EnvelopeTarget): Obb | null {
  if (target.object) {
    const obb = obbFromObject(target.object);
    if (obb) return obb;
  }
  return obbFromBox(target.box);
}

const FACE_DIR: Record<WorldFace, { x: number; z: number }> = {
  north: { x: 0, z: -1 },
  south: { x: 0, z: 1 },
  west: { x: -1, z: 0 },
  east: { x: 1, z: 0 },
};

/** placed 家具的 local +z 在世界 x-z 平面的朝向（从 matrixWorld，含 placed rotation）。 */
function objectPlanZ(object: THREE.Object3D | undefined): { x: number; z: number } | undefined {
  if (!object) return undefined;
  object.updateWorldMatrix(true, false);
  const e = object.matrixWorld.elements;
  const x = e[8];
  const z = e[10];
  const len = Math.hypot(x, z);
  if (len <= 1e-9) return undefined;
  return { x: x / len, z: z / len };
}

/**  wardrobe_door：门扇正面世界象限。优先按 door_face_axis（模型门板局部轴）按 rotation 推导，否则用 open_face。 */
function wardrobeFrontFace(entry: BoxEntry, spec: FurnitureEnvelopeSpec): WorldFace {
  if (spec.door_face_axis) {
    const z = objectPlanZ(entry.object);
    if (z) {
      const dx = spec.door_face_axis === 'local+z' ? z.x : -z.x;
      const dz = spec.door_face_axis === 'local+z' ? z.z : -z.z;
      if (Math.abs(dz) >= Math.abs(dx)) return dz > 0 ? 'south' : 'north';
      return dx > 0 ? 'east' : 'west';
    }
  }
  return spec.open_face ?? 'south';
}

// ── 门扇开启弧（door_swing）────────────────────────────────────────────────

/** 复刻 SceneBuilder.doorInwardNormal：朝 opening.room 一侧的墙法向。 */
function doorInwardNormal(source: { x1: number; z1: number; x2: number; z2: number }, opening: ResolvedOpening, rooms: ResolvedRoom[]): { x: number; z: number } {
  const dx = source.x2 - source.x1;
  const dz = source.z2 - source.z1;
  const length = Math.hypot(dx, dz) || 1;
  const left = { x: -dz / length, z: dx / length };
  const room = opening.room ? rooms.find((candidate) => candidate.id === opening.room) : undefined;
  if (room) {
    const wallCenter = { x: (source.x1 + source.x2) / 2, z: (source.z1 + source.z2) / 2 };
    const side = (room.x - wallCenter.x) * left.x + (room.z - wallCenter.z) * left.z;
    if (Math.abs(side) > 1e-6) return side > 0 ? left : { x: -left.x, z: -left.z };
  }
  return { x: -left.x, z: -left.z };
}

export interface DoorSwingGeometry {
  openingId: string;
  hinge: { x: number; z: number };
  /** 关闭态门叶径向（从合页指向另一梃）。 */
  closedDir: { x: number; z: number };
  /** 开启 90° 态门叶径向（开门向）。 */
  openDir: { x: number; z: number };
  /** 门叶长度 = 净洞宽（SceneBuilder 用 opening.width 作叶长）。 */
  leafLength: number;
  sill: number;
  height: number;
}

/** 从已声明的 opening + 墙向推导门扇铰点、关闭/开启径向与叶长。与 SceneBuilder 逐字一致。 */
export function doorSwingGeometry(wall: ResolvedWall, opening: ResolvedOpening, rooms: ResolvedRoom[]): DoorSwingGeometry | null {
  if (opening.type !== 'door') return null;
  const dx = wall.x2 - wall.x1;
  const dz = wall.z2 - wall.z1;
  const len = Math.hypot(dx, dz);
  if (len < 0.001) return null;
  const ux = dx / len;
  const uz = dz / len;
  const t = (opening.x - wall.x1) * ux + (opening.z - wall.z1) * uz;
  const half = opening.width / 2;
  const inward = opening.swing === 'inward';
  const outward = opening.swing === 'outward';
  if (!inward && !outward) return null; // 未申报 swing：不猜开门向
  const hingeAtEnd = opening.hinge === 'end';
  if (opening.hinge !== 'start' && opening.hinge !== 'end') return null; // 未申报 hinge：不猜铰侧
  const hingeOffset = inward || outward ? (hingeAtEnd ? half : -half) : -half;
  const hinge = { x: wall.x1 + ux * (t + hingeOffset), z: wall.z1 + uz * (t + hingeOffset) };
  const inwardNormal = doorInwardNormal(wall, opening, rooms);
  const panelDir = inward ? inwardNormal : { x: -uz, z: ux };
  const closedDir = hingeAtEnd ? { x: -ux, z: -uz } : { x: ux, z: uz };
  return {
    openingId: opening.id,
    hinge,
    closedDir,
    openDir: panelDir,
    leafLength: opening.width,
    sill: opening.sill ?? 0,
    height: opening.height,
  };
}

/**
 * 把 90° 扫掠扇形近似为 K 个有向盒。
 *
 * 每个角楔 [θa,θb]（张角 Δθ）用一个盒子覆盖：径向半长 = L/2（盒心在合页+径向*L/2，
 * 覆盖半径 [0,L]），切向半宽 = L·sin(Δθ/2)（覆盖外弧的角向展开）。轴 = [径向, 上, 切向]。
 *
 * 近似误差：盒子是扇形的**保守外包**——只过冲、不漏：
 *   ① 内三角被盒子填满（靠近合页的薄楔被矩形覆盖）→ 只会多报、不会漏报；
 *   ② 外弧两角超出半径 L，超冲因子 1/cos(Δθ/2)：K=3（Δθ=30°）时角点超冲约 3.5%·L。
 * 因结论 info-only，保守方向安全；K 可配（wedges）权衡精度与盒数。
 */
export function doorSwingObbs(geo: DoorSwingGeometry, wedges: number): Obb[] {
  const K = Math.max(1, Math.floor(wedges));
  const L = geo.leafLength;
  const a0 = Math.atan2(geo.closedDir.z, geo.closedDir.x);
  const a1 = Math.atan2(geo.openDir.z, geo.openDir.x);
  let delta = a1 - a0;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  const dtheta = Math.abs(delta) / K;
  const halfWidth = L * Math.sin(dtheta / 2);
  const boxes: Obb[] = [];
  for (let k = 0; k < K; k++) {
    const thetaM = a0 + delta * ((k + 0.5) / K);
    const radial = new THREE.Vector3(Math.cos(thetaM), 0, Math.sin(thetaM));
    const tang = new THREE.Vector3(Math.cos(thetaM + Math.PI / 2), 0, Math.sin(thetaM + Math.PI / 2));
    const center = new THREE.Vector3(
      geo.hinge.x + radial.x * (L / 2),
      geo.sill + geo.height / 2,
      geo.hinge.z + radial.z * (L / 2),
    );
    boxes.push({ center, axes: [radial, BASIS[1].clone(), tang], half: [L / 2, geo.height / 2, halfWidth] });
  }
  return boxes;
}

// ── 推拉门开启态（sliding_open）─────────────────────────────────────────────

interface SlidingDoorLike {
  id: string;
  points: Array<{ x: number; z: number }>;
  panels?: number;
  open?: boolean;
  height: number;
}

/**
 * 复刻 SceneBuilder.buildSlidingDoor 的**开启态**面板位置（`element.open !== false` 分支）：
 * 面板叠收在 b 端，沿墙每片错 0.08m、法向每片错 0.05m（平行轨道）。只对 open:true 建模；
 * 关闭态（open:false）不生成包络（静态已由 SlidingDoorElement 表达，且不参与穿透采集）。
 */
export function slidingOpenObbs(element: SlidingDoorLike): Obb[] {
  const [a, b] = element.points;
  if (!a || !b) return [];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  if (length < 0.001) return [];
  const ux = dx / length;
  const uz = dz / length;
  const nx = -dz / length;
  const nz = dx / length;
  const angle = Math.atan2(dz, dx);
  const panels = element.panels ?? 3;
  const panelWidth = length / panels;
  const depth = 0.04; // 与 SceneBuilder 一致的门扇厚
  const boxes: Obb[] = [];
  for (let i = 0; i < panels; i++) {
    const along = length - panelWidth / 2 - (panels - 1 - i) * 0.08;
    const track = i * 0.05 - 0.05;
    const cx = a.x + ux * along + nx * track;
    const cz = a.z + uz * along + nz * track;
    const axisU = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const axisN = new THREE.Vector3(Math.cos(angle + Math.PI / 2), 0, Math.sin(angle + Math.PI / 2));
    boxes.push({
      center: new THREE.Vector3(cx, element.height / 2, cz),
      axes: [axisU, BASIS[1].clone(), axisN],
      half: [panelWidth / 2, element.height / 2, depth / 2 + 0.05],
    });
  }
  return boxes;
}

// ── 家具包络（appliance_door / drawer / chair_pullout / wardrobe_door）────────

/** appliance_door / drawer：从 placed AABB 的 open_face 面，沿该向探出 span 米的薄板（只含门前空间，不含家电自体）。 */
function faceExtrudeBox(entry: BoxEntry, face: WorldFace, span: number): Aabb3 {
  const b = entry.box;
  const box: Aabb3 = { minX: 0, maxX: 0, minY: b.minY, maxY: b.maxY, minZ: 0, maxZ: 0 };
  if (face === 'west') { box.minX = b.minX - span; box.maxX = b.minX; box.minZ = b.minZ; box.maxZ = b.maxZ; }
  else if (face === 'east') { box.minX = b.maxX; box.maxX = b.maxX + span; box.minZ = b.minZ; box.maxZ = b.maxZ; }
  else if (face === 'north') { box.minZ = b.minZ - span; box.maxZ = b.minZ; box.minX = b.minX; box.maxX = b.maxX; }
  else { box.minZ = b.maxZ; box.maxZ = b.maxZ + span; box.minX = b.minX; box.maxX = b.maxX; } // south
  return box;
}

/** chair_pullout：椅子拉出方向。backrest = local -z 按 placed rotation 旋转；否则用 open_face。 */
function chairPulloutDir(entry: BoxEntry, spec: FurnitureEnvelopeSpec): { x: number; z: number } {
  if (spec.pullout_axis === 'backrest') {
    const z = objectPlanZ(entry.object);
    if (z) return { x: -z.x, z: -z.z };
  }
  if (spec.open_face) return FACE_DIR[spec.open_face];
  return { x: 0, z: -1 };
}

/** chair_pullout：椅子拉出（in-use）落位盒 = placed AABB 沿拉出向平移 pull_m（只建落位，不扫路径；靠背 local -z 定向）。 */
function chairPulloutBox(entry: BoxEntry, spec: FurnitureEnvelopeSpec): Aabb3 {
  const pull = spec.pullout_m ?? DEFAULT_PULLOUT_M;
  const dir = chairPulloutDir(entry, spec);
  const b = entry.box;
  const tx = dir.x * pull;
  const tz = dir.z * pull;
  return { minX: b.minX + tx, maxX: b.maxX + tx, minY: b.minY, maxY: b.maxY, minZ: b.minZ + tz, maxZ: b.maxZ + tz };
}

/** wardrobe_door 平开：复用户扇开启弧——以柜正面为「墙」、单扇宽为叶长、朝正面探出薄板。 */
function wardrobeDoorBoxes(entry: BoxEntry, spec: FurnitureEnvelopeSpec): Aabb3[] {
  const face = wardrobeFrontFace(entry, spec);
  const b = entry.box;
  const dir = FACE_DIR[face];
  const alongIsX = Math.abs(dir.x) > 0.5; // open_face 沿 x（west/east）→ 柜门面沿 z 展开
  if (spec.sliding) {
    // 推拉扇贴面滑移，开启态包络≈静态正面 + 扇厚（近似无外探）。
    const thick = spec.panel_thickness_m ?? 0.04;
    return [faceExtrudeBox(entry, face, thick)];
  }
  const leafWidth = spec.leaf_width_m ?? 0.3;
  const count = spec.leaf_count ?? 1;
  const span = leafWidth;
  const total = count * leafWidth;
  const lo = alongIsX ? b.minZ : b.minX;
  const hi = alongIsX ? b.maxZ : b.maxX;
  const center = (lo + hi) / 2;
  const start = center - total / 2;
  const boxes: Aabb3[] = [];
  for (let i = 0; i < count; i++) {
    const segLo = start + i * leafWidth;
    const segHi = segLo + leafWidth;
    const cLo = Math.max(lo, segLo);
    const cHi = Math.min(hi, segHi);
    // 正面薄板：从柜正面（open_face 侧）沿 open_face 探出 span，切向取该扇段、高度取柜高。
    const box: Aabb3 = { minX: 0, maxX: 0, minY: b.minY, maxY: b.maxY, minZ: 0, maxZ: 0 };
    if (alongIsX) {
      box.minZ = cLo; box.maxZ = cHi;
      if (face === 'west') { box.minX = b.minX - span; box.maxX = b.minX; } else { box.minX = b.maxX; box.maxX = b.maxX + span; }
    } else {
      box.minX = cLo; box.maxX = cHi;
      if (face === 'north') { box.minZ = b.minZ - span; box.maxZ = b.minZ; } else { box.minZ = b.maxZ; box.maxZ = b.maxZ + span; }
    }
    boxes.push(box);
  }
  return boxes;
}

// ── 汇总：枚举包络 → SAT 窄相位 → 命中/未申报 ────────────────────────────────

interface PendingEnvelope {
  envelope_id: string;
  owner: string;
  kind: EnvelopeKind;
  enabled_by: string;
  declared_basis: string;
  boxes: Obb[];
}

const round = (n: number): number => Number(n.toFixed(4));

function narrowPhase(boxes: Obb[], targets: Array<{ target: EnvelopeTarget; obb: Obb }>, owner: string): EnvelopeOverlap[] {
  const overlaps: EnvelopeOverlap[] = [];
  for (const { target, obb } of targets) {
    if (target.entity === owner) continue; // 包络与自体相邻是固有（门在墙上、椅在桌下…），不算命中
    let best = 0;
    let bestMtv: [number, number, number] | undefined;
    for (const box of boxes) {
      const hit = satOverlap(box, obb);
      if (hit && hit.depth > best) {
        best = hit.depth;
        bestMtv = [round(hit.mtv.x), round(hit.mtv.y), round(hit.mtv.z)];
      }
    }
    if (best > 1e-6) {
      overlaps.push({ entity: target.entity, depth_m: round(best), ...(bestMtv ? { mtv: bestMtv } : {}) });
    }
  }
  return overlaps.sort((a, b) => b.depth_m - a.depth_m);
}

export function computeEnvelopeShadow(input: EnvelopeInput): EnvelopeReport {
  const cfg = input.config ?? {};
  const mep = new Set(input.mepTypes ?? []);
  // 目标去重（同一 entity 只留一条，避免多 mesh 双计）并排除 mep 协调构件（预留区/管井非实体，
  // 其重叠口径未裁定，见 docs/penetration-lint.md）——与 shadow 的 mep 排除一致。
  const seenTarget = new Set<string>();
  const targetObjs: Array<{ target: EnvelopeTarget; obb: Obb }> = [];
  for (const target of input.targets) {
    if (mep.has(target.type)) continue;
    if (seenTarget.has(target.entity)) continue;
    seenTarget.add(target.entity);
    const obb = targetObb(target);
    if (obb) targetObjs.push({ target, obb });
  }
  const pending: PendingEnvelope[] = [];

  // ① 门扇开启弧
  if (cfg.door_swing?.enabled !== false) {
    const wedges = cfg.door_swing?.wedges ?? DEFAULT_WEDGES;
    for (const wall of input.walls) {
      for (const opening of wall.openings ?? []) {
        const geo = doorSwingGeometry(wall, opening, input.rooms);
        if (!geo) continue;
        pending.push({
          envelope_id: `envelope:door_swing:${opening.id}`,
          owner: `opening:${opening.id}`,
          kind: 'door_swing',
          enabled_by: opening.id,
          declared_basis: `config/layout/model-geometry.yaml 开口 ${opening.id}（type=door swing=${opening.swing} hinge=${opening.hinge} width=${opening.width}）+ 墙段方向；扫掠用 ${wedges} 盒近似扇形`,
          boxes: doorSwingObbs(geo, wedges),
        });
      }
    }
  }

  // ② 推拉门开启态
  if (cfg.sliding_open?.enabled !== false) {
    for (const element of input.elements) {
      if (element.type !== 'sliding_door_run') continue;
      const value = element as unknown as SlidingDoorLike;
      if (value.open !== true) continue; // 只对 open:true 建模
      pending.push({
        envelope_id: `envelope:sliding_open:${element.id}`,
        owner: `sliding_door:${element.id}`,
        kind: 'sliding_open',
        enabled_by: element.id,
        declared_basis: `config/layout/overlay.yaml ${element.id}（sliding_door_run open:true panels=${value.panels ?? 3}）；开启态面板位置复刻 SceneBuilder 叠收公式`,
        boxes: slidingOpenObbs(value),
      });
    }
  }

  // ③ 家具活动包络（按已申报类型）
  const declaredTypes = new Set((cfg.furniture ?? []).map((spec) => spec.type));
  const specByType = new Map<string, FurnitureEnvelopeSpec[]>();
  for (const spec of cfg.furniture ?? []) {
    const list = specByType.get(spec.type) ?? [];
    list.push(spec);
    specByType.set(spec.type, list);
  }
  for (const entry of input.furniture) {
    const specs = specByType.get(entry.type);
    if (!specs) continue;
    for (const spec of specs) {
      let boxes: Obb[] = [];
      if (spec.kind === 'appliance_door') {
        const face = spec.open_face ?? 'south';
        boxes = [obbFromBox(faceExtrudeBox(entry, face, spec.swing_m ?? DEFAULT_SWING_M))];
      } else if (spec.kind === 'drawer') {
        const face = spec.open_face ?? 'south';
        boxes = [obbFromBox(faceExtrudeBox(entry, face, spec.extend_m ?? DEFAULT_SWING_M))];
      } else if (spec.kind === 'chair_pullout') {
        boxes = [obbFromBox(chairPulloutBox(entry, spec))];
      } else if (spec.kind === 'wardrobe_door') {
        boxes = wardrobeDoorBoxes(entry, spec).map((box) => obbFromBox(box));
      } else {
        continue; // door_swing/sliding_open 不按家具类型申报
      }
      if (boxes.length === 0) continue;
      pending.push({
        envelope_id: `envelope:${spec.id}:${entry.entity}`,
        owner: entry.entity,
        kind: spec.kind,
        enabled_by: spec.id,
        declared_basis: spec.declared_basis,
        boxes,
      });
    }
  }

  // 窄相位：命中的包络才进 hits（每条一个包络，overlaps[] 列全部相交静体）。
  const hits: EnvelopeHit[] = [];
  let hitPairs = 0;
  for (const env of pending) {
    const overlaps = narrowPhase(env.boxes, targetObjs, env.owner);
    if (overlaps.length === 0) continue;
    hitPairs += overlaps.length;
    hits.push({
      envelope_id: env.envelope_id,
      pair: [env.envelope_id, env.owner],
      envelope_kind: env.kind,
      enabled_by: env.enabled_by,
      declared_basis: env.declared_basis,
      overlaps,
      level: 'info',
    });
  }
  hits.sort((a, b) => a.envelope_id.localeCompare(b.envelope_id));

  // ④ 未申报显形：每个 placed 非 mep 类型若无家具包络申报 → envelope_undeclared（info）。
  const byType = new Map<string, string[]>();
  for (const entry of input.furniture) {
    if (mep.has(entry.type)) continue;
    const list = byType.get(entry.type) ?? [];
    list.push(entry.entity);
    byType.set(entry.type, list);
  }
  const undeclared: EnvelopeUndeclared[] = [];
  for (const [type, instances] of byType) {
    if (declaredTypes.has(type)) continue;
    undeclared.push({
      type,
      instances: instances.sort(),
      note: `placed 类型 ${type} 无活动包络申报，静态包络外不可判（未申报 → 显形，不猜）`,
    });
  }
  undeclared.sort((a, b) => a.type.localeCompare(b.type));

  return {
    summary: {
      envelopes: pending.length,
      hits: hits.length,
      hit_pairs: hitPairs,
      undeclared_types: undeclared.length,
    },
    hits,
    undeclared,
  };
}
