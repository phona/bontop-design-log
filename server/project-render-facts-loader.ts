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
import { pointMountHostIndex, pointWallIndexFromElements, type PointMountHost, type PointWall } from '../shared/point-placement.js';
import { resolveLayout } from './layout-resolver.js';
import { load as parseYaml } from 'js-yaml';
import type { CurrentScheme, ProjectRenderFacts, RenderLightingOverride } from '../shared/types.js';
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
    // 读不到时 mountHosts 置空、由 buildRenderLightingFixtures 的 fail-closed 抛错显形。
    try {
      const house = parseYaml(readFileSync('config/house.yaml', 'utf8')) as { furnishings?: Record<string, Array<Record<string, unknown>>> };
      this.mountHosts = pointMountHostIndex(Object.values(house.furnishings ?? {}).flat() as never);
    } catch (err) {
      this.mountHosts = new Map();
      console.error('[project-render-facts-loader] Failed to load config/house.yaml for mount hosts:', err);
    }
    // 挂墙起夜灯（issue #98 S3）的宿主墙索引：model-geometry 第六份输入，与 3D/DXF/MEP 同一构造。
    let pointWalls: ReadonlyMap<string, PointWall> | undefined;
    try {
      const geometry = parseYaml(readFileSync('config/layout/model-geometry.yaml', 'utf-8')) as Parameters<typeof resolveLayout>[0];
      pointWalls = pointWallIndexFromElements(resolveLayout(geometry).walls);
    } catch (err) {
      pointWalls = undefined;
      console.error('[project-render-facts-loader] Failed to load config/layout/model-geometry.yaml for point walls:', err);
    }
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
        buildProjectRenderFactsProjection(
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
    this.watchers = watchConfigFiles(
      Object.values(this.paths).filter((p): p is string => Boolean(p)),
      () => this.load()
    );
  }

  async stopWatching(): Promise<void> {
    await Promise.all(this.watchers.map((watcher) => watcher.close()));
    this.watchers = [];
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
