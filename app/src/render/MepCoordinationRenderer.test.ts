import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { MepCoordinationRenderer } from './MepCoordinationRenderer';
import type { MepCoordination } from '@shared/mep-hvac-coordination-schema';

describe('MepCoordinationRenderer', () => {
  it('reports resolved and skipped route groups without changing route geometry', () => {
    const scene = new THREE.Scene();
    const renderer = new MepCoordinationRenderer(scene);
    const config = {
      version: '1', status: 'preliminary',
      layers: {
        strong_power: { label: 'strong_power', color: '#f00', height: 2 }, weak_power: { label: 'weak_power', color: '#f00', height: 2 },
        water_supply: { label: 'water_supply', color: '#f00', height: 2 }, drainage: { label: 'drainage', color: '#f00', height: 2 },
        refrigerant: { label: 'refrigerant', color: '#f00', height: 2 }, condensate: { label: 'condensate', color: '#f00', height: 2 },
        supply_air: { label: 'supply_air', color: '#f00', height: 2 }, return_air: { label: 'return_air', color: '#f00', height: 2 },
      },
      routes: [
        { id: 'direct', layer: 'strong_power', status: 'inferred', from: { x: 0, z: 0 }, to: { x: 1, z: 0 }, via: [] },
        { id: 'hvac', layer: 'strong_power', status: 'inferred', from: 'anchor', to: { x: 2, z: 0 }, via: [] },
        { id: 'skipped', layer: 'strong_power', status: 'inferred', from: 'missing', to: { x: 3, z: 0 }, via: [] },
      ],
    } as unknown as MepCoordination;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    renderer.render(config, {
      electrical: [], plumbing: [],
      hvacAnchors: [{ id: 'anchor', status: 'inferred', system: 'refrigerant', ref: { source: 'outdoor', id: 'outdoor' } }],
      hvacTerminals: [],
      outdoor: [{ id: 'outdoor', platform: 'p', x: 4, z: 5, direction: 'south', width: 1, depth: 1, height: 1, model: 'test' }],
    });
    expect(renderer.getRenderReport()).toEqual({ total: 3, resolved: 2, skipped: 1, skippedRoutes: ['skipped'] });
    expect(renderer.group.children.map((child) => child.name)).toEqual(['mep:route:direct', 'mep:route:hvac']);
    expect(warn).toHaveBeenCalledWith('[mep] skipped unresolved route skipped');
    warn.mockRestore();
    renderer.dispose();
  });
});