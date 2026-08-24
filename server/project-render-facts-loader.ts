import { watch, type FSWatcher } from 'chokidar';
import { readFileSync } from 'node:fs';
import {
  parseCeilingZones,
  parseElectricalPoints,
  parsePlumbingPoints,
  parseProjectHvacFacts,
  parseRenderLightingOverrides,
  validateProjectHvacFacts,
} from '../shared/project-render-facts-schema.js';
import { buildProjectRenderFactsProjection } from '../shared/project-render-facts-projection.js';
import type { CurrentScheme, ProjectRenderFacts, RenderLightingOverride } from '../shared/types.js';
import type { ConfigStatus, StatusLoader } from './config-loader.js';

export interface ProjectRenderFactsPaths {
  electrical: string;
  plumbing: string;
  ceiling: string;
  hvac: string;
  overrides: string;
}

const DEFAULT_PATHS: ProjectRenderFactsPaths = {
  electrical: 'config/electrical.yaml',
  plumbing: 'config/plumbing.yaml',
  ceiling: 'config/ceiling.yaml',
  hvac: 'config/hvac.yaml',
  overrides: 'config/render/overrides.yaml',
};

export class ProjectRenderFactsLoader implements StatusLoader {
  private facts: ProjectRenderFacts | undefined;
  private overrides: RenderLightingOverride[] | undefined;
  private statuses: Record<keyof ProjectRenderFactsPaths, ConfigStatus>;
  private watchers: FSWatcher[] = [];

  constructor(private readonly paths: ProjectRenderFactsPaths = DEFAULT_PATHS) {
    this.statuses = {
      electrical: { path: paths.electrical, status: 'failed' },
      plumbing: { path: paths.plumbing, status: 'failed' },
      ceiling: { path: paths.ceiling, status: 'failed' },
      hvac: { path: paths.hvac, status: 'failed' },
      overrides: { path: paths.overrides, status: 'failed' },
    };
  }

  load(): void {
    const results: Partial<ProjectRenderFacts> = {};
    let loadedOverrides: RenderLightingOverride[] | undefined;
    let valid = true;
    const readers = {
      electrical: parseElectricalPoints,
      plumbing: parsePlumbingPoints,
      ceiling: parseCeilingZones,
      hvac: parseProjectHvacFacts,
      overrides: parseRenderLightingOverrides,
    };

    for (const key of Object.keys(this.paths) as Array<keyof ProjectRenderFactsPaths>) {
      try {
        const result = readers[key](readFileSync(this.paths[key], 'utf8'));
        if (key === 'overrides') loadedOverrides = result as RenderLightingOverride[];
        else results[key] = result as never;
        this.statuses[key] = { path: this.paths[key], status: 'ok' };
      } catch (err) {
        valid = false;
        const error = err instanceof Error ? err.message : String(err);
        console.error(`[project-render-facts-loader] Failed to load ${this.paths[key]}:`, err);
        this.statuses[key] = { path: this.paths[key], status: 'failed', error };
      }
    }

    if (valid && loadedOverrides) {
      const loadedFacts = results as ProjectRenderFacts;
      try {
        validateProjectHvacFacts(loadedFacts.hvac, loadedFacts);
        buildProjectRenderFactsProjection(
          loadedFacts,
          loadedOverrides,
          { updatedAt: '', selections: {} } as CurrentScheme,
        );
        this.facts = loadedFacts;
        this.overrides = loadedOverrides;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        console.error('[project-render-facts-loader] Failed to validate render overrides:', err);
        this.statuses.overrides = { path: this.paths.overrides, status: 'failed', error };
      }
    }
  }

  startWatching(): void {
    if (this.watchers.length > 0) return;
    for (const path of Object.values(this.paths)) {
      const watcher = watch(path, { persistent: true, ignoreInitial: true });
      watcher.on('change', () => this.load());
      watcher.on('add', () => this.load());
      watcher.on('error', (err: unknown) => {
        console.error(`[project-render-facts-loader] Watcher error for ${path}:`, err);
      });
      this.watchers.push(watcher);
    }
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

  getStatuses(): ConfigStatus[] {
    return Object.values(this.statuses);
  }
}
