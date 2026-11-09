import type { FSWatcher } from 'chokidar';
import { readFileSync } from 'node:fs';
import {
  parseCeilingZones,
  parseElectricalPoints,
  parsePlumbingPoints,
  parseProjectHvacFacts,
  parseRenderLightingOverrides,
  parseLightingRenderConfig,
  validateProjectHvacFacts,
} from '../shared/project-render-facts-schema.js';
import { buildProjectRenderFactsProjection } from '../shared/project-render-facts-projection.js';
import type { ProjectRenderFactsProjection } from '../shared/types.js';
import { buildPlacementIndexes } from '../shared/placement-indexes.js';
import type { PointMountHost } from '../shared/point-placement.js';
import { resolveLayout } from './layout-resolver.js';
import { load as parseYaml } from 'js-yaml';
import type { CurrentScheme, FurnishingsYaml, ProjectRenderFacts, RenderLightingOverride } from '../shared/types.js';
import { watchConfigFiles, type ConfigStatus, type StatusLoader } from './config-loader.js';

export interface ProjectRenderFactsPaths {
  electrical: string;
  plumbing: string;
  ceiling: string;
  hvac: string;
  overrides: string;
  lighting?: string;
}

const DEFAULT_PATHS: ProjectRenderFactsPaths = {
  electrical: 'config/electrical.yaml',
  plumbing: 'config/plumbing.yaml',
  ceiling: 'config/model/envelope/ceiling.yaml',
  hvac: 'config/hvac.yaml',
  overrides: 'config/render/overrides.yaml',
  lighting: 'config/render/lighting.yaml',
};

export class ProjectRenderFactsLoader implements StatusLoader {
  private facts: ProjectRenderFacts | undefined;
  private overrides: RenderLightingOverride[] | undefined;
  private lighting: import('../shared/types.js').LightingRenderConfig | undefined;
  /** mount 挂载点位的家具宿主索引（issue #98 S2）：与 house.yaml 同步加载。 */
  private mountHosts: ReadonlyMap<string, PointMountHost> = new Map();
  private readonly paths: ProjectRenderFactsPaths;
  private statuses: Partial<Record<keyof ProjectRenderFactsPaths, ConfigStatus>>;
  private watchers: FSWatcher[] = [];

  constructor(paths: ProjectRenderFactsPaths = DEFAULT_PATHS) {
    this.paths = paths === DEFAULT_PATHS ? DEFAULT_PATHS : paths;
    this.statuses = {
      electrical: { path: this.paths.electrical, status: 'failed' },
      plumbing: { path: this.paths.plumbing, status: 'failed' },
      ceiling: { path: this.paths.ceiling, status: 'failed' },
      hvac: { path: this.paths.hvac, status: 'failed' },
      overrides: { path: this.paths.overrides, status: 'failed' },
      ...(this.paths.lighting ? { lighting: { path: this.paths.lighting, status: 'failed' } } : {}),
    };
  }

  load(): void {
    const results: Partial<ProjectRenderFacts> = {};
    let loadedOverrides: RenderLightingOverride[] | undefined;
    let loadedLighting: import('../shared/types.js').LightingRenderConfig | undefined;
    // mount 挂载灯（issue #98 S2 起夜灯）的位置由宿主家具解出：house.yaml 是第五份输入，
    // 读不到时宿主索引置空、由 buildRenderLightingFixtures 的 fail-closed 抛错显形。
    let loadedFurnishings: FurnishingsYaml | undefined;
    try {
      const house = parseYaml(readFileSync('config/house.yaml', 'utf8')) as { furnishings?: FurnishingsYaml };
      loadedFurnishings = house.furnishings;
    } catch (err) {
      console.error('[project-render-facts-loader] Failed to load config/house.yaml for mount hosts:', err);
    }
    // 挂墙起夜灯（issue #98 S3）的宿主墙索引：model-geometry 第六份输入，与 3D/DXF/MEP 同一构造。
    let loadedLayout: ReturnType<typeof resolveLayout> | undefined;
    try {
      const geometry = parseYaml(readFileSync('config/layout/model-geometry.yaml', 'utf-8')) as Parameters<typeof resolveLayout>[0];
      loadedLayout = resolveLayout(geometry);
    } catch (err) {
      console.error('[project-render-facts-loader] Failed to load config/layout/model-geometry.yaml for point walls:', err);
    }
    // 两个索引一次产出（issue #98 疗法② / shared/placement-indexes.ts 单一产地）：
    // pointWalls 取 layout.walls，mountHosts 取 house.yaml 的**全量** furnishings（不按阶段过滤）。
    const { pointWalls, mountHosts } = buildPlacementIndexes({
      geometry: loadedLayout,
      furnishings: loadedFurnishings,
    });
    // 读不到 house.yaml 时保留「空表而非 undefined」的既有语义：挂载灯由 fail-closed 抛错显形。
    this.mountHosts = mountHosts ?? new Map();
    let valid = true;
    const readers = {
      electrical: parseElectricalPoints,
      plumbing: parsePlumbingPoints,
      ceiling: parseCeilingZones,
      hvac: parseProjectHvacFacts,
      overrides: parseRenderLightingOverrides,
      lighting: parseLightingRenderConfig,
    };

    for (const key of Object.keys(this.paths) as Array<keyof ProjectRenderFactsPaths>) {
      const inputPath = this.paths[key];
      if (!inputPath) continue;
      try {
        const result = readers[key](readFileSync(inputPath, 'utf8'));
        if (key === 'overrides') loadedOverrides = result as RenderLightingOverride[];
        else if (key === 'lighting') loadedLighting = result as import('../shared/types.js').LightingRenderConfig;
        else results[key] = result as never;
        this.statuses[key] = { path: inputPath, status: 'ok' };
      } catch (err) {
        valid = false;
        const error = err instanceof Error ? err.message : String(err);
        console.error(`[project-render-facts-loader] Failed to load ${inputPath}:`, err);
        this.statuses[key] = { path: inputPath, status: 'failed', error };
      }
    }

    if (valid && loadedOverrides && (loadedLighting || !this.paths.lighting)) {
      const loadedFacts = results as ProjectRenderFacts;
      try {
        validateProjectHvacFacts(loadedFacts.hvac, loadedFacts);
        // 2026-11-09 修 Codex blocking：原这里调 buildProjectRenderFactsProjection 只为
        // 验算（结果丢弃），而 ProjectData.renderFactsProjection 全仓无赋值、/api/project
        // 也不返回它 → HouseScene 的 hvacSources 恒为 undefined → SceneBuilder 解不出
        // indoor_master 锚点 → 三件冷凝链家具带诊断跳过、页面持续缺件。
        // 改为把投影存下来并由 /api/project 下发（见 server/routes.ts）。
        this.projection = buildProjectRenderFactsProjection(
          loadedFacts,
          loadedOverrides,
          { updatedAt: '', selections: {} } as CurrentScheme,
          { elements: [] },
          { default: 'open', roomOverrides: {}, updatedAt: '' },
          loadedLighting,
          this.mountHosts,
          pointWalls,
        );
        this.facts = loadedFacts;
        this.overrides = loadedOverrides;
        this.lighting = loadedLighting;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        console.error('[project-render-facts-loader] Failed to validate render overrides:', err);
        this.statuses.overrides = { path: this.paths.overrides, status: 'failed', error };
      }
    }
  }

  startWatching(): void {
    if (this.watchers.length > 0) return;
    // 2026-11-09 修 Codex major：house.yaml 与 model-geometry.yaml 是本加载器的**真实依赖**
    // （mountHosts / pointWalls 从它们构建，灯具定位校验要用），但原只监听 this.paths 里的
    // 五份 render 配置——若加载时因家具宿主或墙体暂时无效把状态置 failed，随后只修家具或
    // 墙体不会触发重载，失败状态一直保留，页面继续报配置错误、DXF 排除相关图层。
    // 两份真实依赖纳入监听。
    this.watchers = watchConfigFiles(
      [...Object.values(this.paths), 'config/house.yaml', 'config/layout/model-geometry.yaml']
        .filter((p): p is string => Boolean(p)),
      () => this.load()
    );
  }

  async stopWatching(): Promise<void> {
    await Promise.all(this.watchers.map((watcher) => watcher.close()));
    this.watchers = [];
  }

  private projection: ProjectRenderFactsProjection | undefined;

  /** 2026-11-09：/api/project 下发它，供浏览器建场解 HVAC/冷凝链锚点（原字段全仓无赋值）。 */
  getProjection(): ProjectRenderFactsProjection | undefined {
    return this.projection;
  }

  getFacts(): ProjectRenderFacts | undefined {
    return this.facts;
  }

  getOverrides(): RenderLightingOverride[] | undefined {
    return this.overrides;
  }

  getLighting(): import('../shared/types.js').LightingRenderConfig | undefined {
    return this.lighting;
  }

  getStatuses(): ConfigStatus[] {
    return Object.values(this.statuses);
  }
}
