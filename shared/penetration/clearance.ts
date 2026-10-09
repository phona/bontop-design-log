import type { ResolvedWall } from '../../shared/types.js';
import { resolveFurnitureProfile, type ResolvedFurnitureProfile } from '../furniture-profile.js';
import { FURNITURE_DIMS } from '../../shared/types.js';
import { requiredClearance, type SpatialIssue, type SpatialToleranceProfile } from '../spatial-validation.js';
import type { BoxEntry, SpatialConfig } from './scene.js';

/**
 * 净距类穿透规则：定制家具对宿主墙完成面的退让、端部收口净距。
 *
 * 判据是「两块实体该离多远」，交付给施工方时和穿透深度是同一个动作，因此归
 * 穿透层；`site_trim`（现场裁切）语义随 evidence 一起带出，不在这里丢。
 *
 * 代码自 `scripts/verify/spatial/verify-spatial.ts` 的 `validateScene` 机械搬迁。
 * `furniture_profile_unregistered` 不在这里：那是声明登记表的所有权问题，由
 * verify:spatial 单一负责（未登记时 verify:all 已红，穿透层静默跳过该类型的净距
 * 不会造成漏报），避免两个 CLI 对同一份 override 各判一半。
 */

const EPS = 0.001;

export type ProfileOverride = ResolvedFurnitureProfile;

export function profileFor(type: string, config: SpatialConfig): ProfileOverride | undefined {
  return resolveFurnitureProfile(type, config);
}

export function declaredDims(item: Record<string, unknown>, type: string): { width: number; depth: number } | undefined {
  const width = typeof item.width === 'number' ? item.width : typeof item.length === 'number' ? item.length : undefined;
  const depth = typeof item.depth === 'number' ? item.depth : undefined;
  if (width !== undefined && depth !== undefined) return { width, depth };
  return FURNITURE_DIMS[type];
}

export function hostWallClearance(box: BoxEntry['box'], wallEntries: BoxEntry[], side: string): number | undefined {
  const direction: Record<string, { x: number; z: number }> = {
    north: { x: 0, z: -1 },
    south: { x: 0, z: 1 },
    west: { x: -1, z: 0 },
    east: { x: 1, z: 0 },
  };
  const outward = direction[side];
  if (!outward) return undefined;
  const corners = [
    [box.minX, box.minZ], [box.minX, box.maxZ], [box.maxX, box.minZ], [box.maxX, box.maxZ],
  ];
  let best: number | undefined;
  for (const entry of wallEntries) {
    if (!entry.segment || entry.thickness === undefined) continue;
    const segment = entry.segment;
    const length = Math.hypot(segment.x2 - segment.x1, segment.z2 - segment.z1);
    if (length <= EPS) continue;
    const tx = (segment.x2 - segment.x1) / length;
    const tz = (segment.z2 - segment.z1) / length;
    const nx = -tz;
    const nz = tx;
    const wallMid = { x: (segment.x1 + segment.x2) / 2, z: (segment.z1 + segment.z2) / 2 };
    const sideSign = nx * outward.x + nz * outward.z >= 0 ? 1 : -1;
    const normalX = nx * sideSign;
    const normalZ = nz * sideSign;
    const tangentValues = corners.map(([x, z]) => (x - segment.x1) * tx + (z - segment.z1) * tz);
    if (Math.max(...tangentValues) < -EPS || Math.min(...tangentValues) > length + EPS) continue;
    const surface = entry.thickness / 2;
    const distances = corners.map(([x, z]) => (x - wallMid.x) * normalX + (z - wallMid.z) * normalZ);
    const clearance = Math.min(...distances) - surface;
    best = best === undefined ? clearance : Math.min(best, clearance);
  }
  return best;
}

export interface FurnitureClearanceInput {
  entry: BoxEntry;
  type: string;
  /** 已解析且非 undefined 的 profile override（未登记由调用方单独 fail-closed）。 */
  override: ProfileOverride;
  profile: SpatialToleranceProfile;
  wallEntries: BoxEntry[];
  wallMap: Map<string, ResolvedWall>;
  source: string;
}

/**
 * 单件家具的宿主墙净距 / 端部净距。返回的 issue 只含净距族 code：
 * `furniture_wall_collision` / `furniture_clearance_insufficient` /
 * `furniture_host_unknown` / `furniture_host_runtime_missing` /
 * `furniture_endpoint_clearance_insufficient`。
 */
export function validateFurnitureClearance(input: FurnitureClearanceInput): SpatialIssue[] {
  const { entry, type, override, profile, wallEntries, wallMap, source } = input;
  const issues: SpatialIssue[] = [];
  if (override.wall && override.wall_side) {
    const wall = wallMap.get(override.wall);
    if (!wall) {
      issues.push({ level: 'error', code: 'furniture_host_unknown', entity: entry.entity, source, message: `furniture ${type} references unknown wall ${override.wall}`, evidence: { wall: override.wall } });
    } else {
      const hostEntries = wallEntries.filter((wallEntry) => wallEntry.wallId === override.wall && wallEntry.segment);
      const available = hostWallClearance(entry.box, hostEntries, override.wall_side);
      const required = override.required_wall_clearance ?? requiredClearance(profile);
      if (available === undefined) issues.push({ level: 'error', code: 'furniture_host_runtime_missing', entity: entry.entity, source, message: `furniture ${type} host wall ${wall.id} has no runtime wall segment to measure against`, evidence: { wall: wall.id, wall_side: override.wall_side, host_entries: hostEntries.map((item) => item.entity) } });
      else if (available < -EPS) issues.push({ level: 'error', code: 'furniture_wall_collision', entity: entry.entity, source, message: `furniture ${type} enters host wall ${wall.id} by ${(-available).toFixed(3)}m`, evidence: { wall: wall.id, wall_side: override.wall_side, available_clearance_m: available, required_clearance_m: required, box: entry.box } });
      else if (available < required - EPS) issues.push({ level: 'error', code: 'furniture_clearance_insufficient', entity: entry.entity, source, message: `furniture ${type} has ${available.toFixed(3)}m host clearance; ${required.toFixed(3)}m is required`, evidence: { wall: wall.id, wall_side: override.wall_side, available_clearance_m: available, required_clearance_m: required, site_trim: override.site_trim === true } });
    }
  }
  if (override.required_endpoint_clearance !== undefined && type.startsWith('mb_vanity')) {
    const boundary = 2.92;
    const available = entry.box.minZ - boundary;
    if (available < override.required_endpoint_clearance - EPS) issues.push({ level: 'error', code: 'furniture_endpoint_clearance_insufficient', entity: entry.entity, source, message: `furniture ${type} north end has ${available.toFixed(3)}m clearance; ${override.required_endpoint_clearance.toFixed(3)}m is required`, evidence: { boundary_z: boundary, available_clearance_m: available, required_clearance_m: override.required_endpoint_clearance, site_trim: override.site_trim === true } });
  }
  return issues;
}
