import type {
  CeilingZone,
  ElectricalPoint,
  RenderLightingFixture,
  RenderLightingOverride,
  ResolvedRoom,
} from './types.js';
import { ceilingFootprint, ceilingSurfaceY, isSolidCeilingZone, pointInFootprint } from './mep-hvac-lint.js';

/**
 * 灯具渲染派生：**唯一实现**。
 *
 * 权威投影 `shared/project-render-facts-projection.ts`（喂 app/GLB 的
 * `data/project-render-facts.json`）与防穿模/声明层 linter
 * （`shared/penetration/scene.ts` 的 runtime 场景）都调用这里的同一个函数，
 * 因此「渲染看到的灯」与「linter 校验的灯」在定义上就是同一个点位：
 * offset 平移、锚点派生、宿主墙透传、fail-closed 口径只有一份，不可能各自漂移。
 *
 * 派生规则（改这里等于同时改渲染与校验，必须连带更新测试）：
 * - 平面位置 = electrical.x/z + overrides.offsetX/offsetZ（缺省 0，`renderCoordinate` 取 6 位小数）；
 * - 渲染锚点 y = electrical.height（施工安装完成面，唯一事实源）+ overrides.anchorY_offset；
 * - 缺 override、缺 electrical.height、非 night_light 挂 furniture-face mount_anchor → throw（fail-closed）；
 * - wall/wallSide/mountAnchor 原样透传，漏传会让靠墙/靠家具的灯在建场期抛错。
 */

/** 参与渲染/校验的电气灯具类型。与 ElectricalPointSchema 的灯具枚举保持一致。 */
const LIGHT_TYPES = new Set<ElectricalPoint['type']>([
  'night_light',
  'ceiling_light',
  'pendant',
  'dome',
  'wall_lamp',
  'downlight',
  'led_strip',
  'track_light',
]);

/** 是否灯具类型。linter 侧按同一判定取点位，避免两处各写一份类型清单。 */
export function isLightingFixtureType(type: ElectricalPoint['type']): boolean {
  return LIGHT_TYPES.has(type);
}

function renderCoordinate(value: number): number {
  return Number(value.toFixed(6));
}

/**
 * 渲染锚点唯一派生式：electrical.height（施工安装完成面）+ anchorY_offset（渲染侧相对偏移）。
 * overrides.yaml 不再重复书写高度绝对值，从结构上消灭双写。
 */
function deriveAnchorY(height: number, override: RenderLightingOverride): number {
  return height + override.anchorY_offset;
}

/**
 * 由权威配置派生全部灯具的渲染实体。行为与权威投影内的实现逐字节等价
 * （同一份代码被投影调用），fail-closed：配置缺一项就抛，不猜位置、不兜底高度。
 */
export function buildRenderLightingFixtures(
  electrical: ElectricalPoint[],
  overrides: RenderLightingOverride[],
): RenderLightingFixture[] {
  const fixtures = electrical.filter((point) => LIGHT_TYPES.has(point.type));
  const fixtureIds = new Set(fixtures.map((fixture) => fixture.id));
  const overrideById = new Map<string, RenderLightingOverride>();

  for (const override of overrides) {
    if (!fixtureIds.has(override.id)) {
      const point = electrical.find((candidate) => candidate.id === override.id);
      throw new Error(point
        ? `Render override ${override.id} does not reference a lighting fixture`
        : `Render override ${override.id} references an unknown electrical id`);
    }
    if (overrideById.has(override.id)) {
      throw new Error(`Duplicate render override for lighting fixture ${override.id}`);
    }
    overrideById.set(override.id, override);
  }

  return fixtures.map((fixture) => {
    const override = overrideById.get(fixture.id);
    if (!override) throw new Error(`Missing render override for lighting fixture ${fixture.id}`);
    if (fixture.height === undefined) {
      throw new Error(`Lighting fixture ${fixture.id} has no electrical.height: render anchor must derive from the single source of truth`);
    }
    if (fixture.mountAnchor && fixture.type !== 'night_light') {
      throw new Error(`Furniture-face mount_anchor is only supported for night_light fixtures: ${fixture.id}`);
    }
    return {
      id: fixture.id,
      room: fixture.room,
      type: fixture.type,
      position: {
        x: renderCoordinate(fixture.x + (override.offsetX ?? 0)),
        // 渲染锚点在**此处**派生：electrical.height（施工安装完成面，唯一事实源）
        // + overrides.anchorY_offset（渲染侧相对偏移）。overrides.yaml 不再重复
        // 书写高度绝对值，从结构上消灭双写。
        y: renderCoordinate(deriveAnchorY(fixture.height, override)),
        z: renderCoordinate(fixture.z + (override.offsetZ ?? 0)),
      },
      temperatureK: fixture.temp ?? 3000,
      enabled: true,
      ...(fixture.circuit !== undefined ? { circuit: fixture.circuit } : {}),
      ...(fixture.heads !== undefined ? { heads: fixture.heads } : {}),
      ...(fixture.recessed !== undefined ? { recessed: fixture.recessed } : {}),
      ...(fixture.wall !== undefined ? { wallId: fixture.wall } : {}),
      ...(fixture.wallSide !== undefined ? { wallSide: fixture.wallSide } : {}),
      ...(fixture.mountAnchor !== undefined ? { mountAnchor: fixture.mountAnchor } : {}),
    };
  });
}

/**
 * 期望锚点高度表（声明层校验用：顶装灯是否落在吊顶完成面/房间竖向包络内）。
 *
 * 与 `buildRenderLightingFixtures` 共用同一条派生式 `deriveAnchorY`，不另写一套算式；
 * 区别只在**入口强度**：这里是声明层体检，缺 `electrical.height` 或未登记 override 的
 * 点位不入表，由调用方按声明兜底（`point.height ?? room.height`）显形为 issue，
 * 绝不静默造一个渲染锚点。渲染/runtime 那条路（`buildRenderLightingFixtures`）是 fail-closed 的。
 */
export function buildRenderLightingFixtureHeights(
  electrical: ElectricalPoint[],
  overrides: RenderLightingOverride[],
): Map<string, number> {
  const byId = new Map(electrical.map((point) => [point.id, point]));
  const heights = new Map<string, number>();
  for (const override of overrides) {
    const point = byId.get(override.id);
    if (!point || point.height === undefined) continue;
    heights.set(override.id, deriveAnchorY(point.height, override));
  }
  return heights;
}

/**
 * 吸顶类灯具（渲染实体顶部应贴宿主吊顶完成面）的类型集。
 * wall_lamp / night_light / led_strip 不在此列——它们不挂顶。
 */
export const CEILING_MOUNTED_LIGHT_TYPES = new Set<ElectricalPoint['type']>([
  'ceiling_light',
  'pendant',
  'dome',
  'downlight',
  'track_light',
]);

/**
 * 吸顶类灯具可见实体顶部相对宿主完成面的允许落差（米）。
 * downlight/track 的渲染器把可见灯体放在电气安装面之下（明装筒灯/轨道灯固有落差），
 * 其余类型（含 dome/ceiling_light）按 DEC-2026-10-17-R12 口径：锚点即安装完成面，
 * 灯体贴顶，只留几何公差。
 */
export function ceilingMountGapTolerance(point: ElectricalPoint): number {
  if (point.type === 'downlight') return point.recessed ? 0.02 : 0.055;
  if (point.type === 'track_light') return 0.05;
  return 0.02;
}

export interface CeilingHost {
  zone: CeilingZone;
  surfaceY: number;
}

/**
 * 点位平面所落的最低**实心**吊顶完成面（可见宿主面）；无分区覆盖时返回 undefined，
 * 调用方回退房间原顶。吊顶分区可以登记在邻室名下却横跨本点平面位置（门厅跨
 * entry_garden/living_dining 过渡带），所以按与渲染吊顶同一份圆角 footprint 判定，
 * 并取最低覆盖面——那是看得见的宿主面。
 */
export function selectCeilingHost(
  point: { x: number; z: number },
  ceilingZones: CeilingZone[],
  rooms: ResolvedRoom[],
): CeilingHost | undefined {
  const ceilingHosts = ceilingZones.flatMap<CeilingHost>((candidate) => {
    if (!isSolidCeilingZone(candidate)) return [];
    const footprint = ceilingFootprint(candidate);
    if (!footprint || !pointInFootprint({ x: point.x, z: point.z }, footprint)) return [];
    const hostRoom = rooms.find((candidateRoom) => candidateRoom.id === candidate.room);
    if (!hostRoom) return [];
    const surfaceY = ceilingSurfaceY(candidate, hostRoom.height);
    return surfaceY === undefined ? [] : [{ zone: candidate, surfaceY }];
  });
  return ceilingHosts.reduce<CeilingHost | undefined>(
    (lowest, candidate) => !lowest || candidate.surfaceY < lowest.surfaceY ? candidate : lowest,
    undefined,
  );
}
