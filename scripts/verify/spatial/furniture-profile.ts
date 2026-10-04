// 家具角色（profile）的显式查表内核，供 verify:spatial CLI 与单测共用。
//
// 设计意图（对应 config/spatial-validation.yaml 中 furniture_profiles 的注释）：
// 每种 placed 家具类型都必须**显式登记**角色，禁止由代码按字符串名推断。
// 查表顺序（均为显式配置，无启发式）：
//   1. furniture_profile_overrides —— 逐类型特化，可带 wall/wall_side/净距约束；
//   2. furniture_profiles —— 类型 → profile 角色登记表；
//   3. mep_coordination_types —— 机电协调构件清单。
// 三者全未命中 → 返回 undefined，由调用方 fail-closed（error）上报「未登记类型」。
export interface FurnitureProfileRegistryEntry {
  profile: string;
  role?: string;
  site_trim?: boolean;
}

export interface FurnitureProfileOverride {
  types: string[];
  profile: string;
  wall?: string;
  wall_side?: string;
  required_wall_clearance?: number;
  required_endpoint_clearance?: number;
  site_trim?: boolean;
}

export interface FurnitureProfileConfig {
  furniture_profile_overrides?: FurnitureProfileOverride[];
  furniture_profiles?: Record<string, FurnitureProfileRegistryEntry>;
  mep_coordination_types?: string[];
}

export interface ResolvedFurnitureProfile {
  profile: string;
  wall?: string;
  wall_side?: string;
  required_wall_clearance?: number;
  required_endpoint_clearance?: number;
  site_trim?: boolean;
}

/** 显式查表：override → furniture_profiles → mep_coordination_types；全部未登记返回 undefined（fail-closed 信号）。 */
export function resolveFurnitureProfile(type: string, config: FurnitureProfileConfig): ResolvedFurnitureProfile | undefined {
  const override = config.furniture_profile_overrides?.find((entry) => entry.types.includes(type));
  if (override) {
    const resolved: ResolvedFurnitureProfile = { profile: override.profile };
    if (override.wall !== undefined) resolved.wall = override.wall;
    if (override.wall_side !== undefined) resolved.wall_side = override.wall_side;
    if (override.required_wall_clearance !== undefined) resolved.required_wall_clearance = override.required_wall_clearance;
    if (override.required_endpoint_clearance !== undefined) resolved.required_endpoint_clearance = override.required_endpoint_clearance;
    if (override.site_trim !== undefined) resolved.site_trim = override.site_trim;
    return resolved;
  }
  const registered = config.furniture_profiles?.[type];
  if (registered?.profile) return { profile: registered.profile, ...(registered.site_trim ? { site_trim: true } : {}) };
  if (config.mep_coordination_types?.includes(type)) return { profile: 'mep_coordination' };
  return undefined;
}

/** 该 placed 类型是否已在任一显式来源登记。 */
export function isFurnitureProfileRegistered(type: string, config: FurnitureProfileConfig): boolean {
  return resolveFurnitureProfile(type, config) !== undefined;
}
