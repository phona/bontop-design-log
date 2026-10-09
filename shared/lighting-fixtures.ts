import type {
  ElectricalPoint,
  RenderLightingFixture,
  RenderLightingOverride,
} from './types.js';

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
