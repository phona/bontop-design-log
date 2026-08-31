import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { MepCoordinationRenderer } from './MepCoordinationRenderer';
import type { MepCoordination } from '@shared/mep-hvac-coordination-schema';

describe('MepCoordinationRenderer', () => {
  it('uses diameter as diameter, full via points for physical routes, and preserves state opacity', () => {
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
        { id: 'via', layer: 'strong_power', status: 'inferred', route_kind: 'physical', diameter: 0.2, from: { x: 0, z: 0 }, via: [{ x: 1, z: 0 }], to: { x: 0, z: 0 } },
      ],
    } as unknown as MepCoordination;
    renderer.render(config, { electrical: [], plumbing: [], ceiling: [], hvacAnchors: [], hvacTerminals: [], outdoor: [] });
    const route = renderer.getRouteObject('via')!;
    expect(route.userData.physicalRoute).toBe(true);
    const segment = route.children.find((child) => child instanceof THREE.Mesh) as THREE.Mesh;
    expect((segment.geometry as THREE.CylinderGeometry).parameters.radiusTop).toBe(0.1);
    renderer.dispose();
  });

  it('keeps confirmed, inferred, and pending opacity distinct under a neutral multiplier', () => {
    const renderer = new MepCoordinationRenderer(new THREE.Scene());
    const layers = Object.fromEntries(['strong_power', 'weak_power', 'water_supply', 'drainage', 'refrigerant', 'condensate', 'supply_air', 'return_air'].map((layer) => [layer, { label: layer, color: '#f00', height: 2 }]));
    renderer.render({ version: '1', status: 'preliminary', layers, routes: [
      { id: 'confirmed-opacity', layer: 'strong_power', status: 'confirmed', from: { x: 0, z: 0 }, to: { x: 1, z: 0 }, via: [] },
      { id: 'inferred-opacity', layer: 'strong_power', status: 'inferred', from: { x: 0, z: 1 }, to: { x: 1, z: 1 }, via: [] },
      { id: 'pending-opacity', layer: 'strong_power', status: 'pending', from: { x: 0, z: 2 }, to: { x: 1, z: 2 }, via: [] },
    ] } as unknown as MepCoordination, { electrical: [], plumbing: [], ceiling: [], hvacAnchors: [], hvacTerminals: [], outdoor: [] });
    const opacity = (id: string) => ((renderer.getRouteObject(id)!.children[0] as THREE.Mesh).material as THREE.Material).opacity;
    expect(opacity('confirmed-opacity')).toBe(0.88);
    expect(opacity('inferred-opacity')).toBe(0.58);
    expect(opacity('pending-opacity')).toBe(0.32);
    expect(renderer.getRouteObject('inferred-opacity')?.userData.visualStyle).toBe('dashed-marker');
    expect(renderer.getRouteObject('pending-opacity')?.userData.visualStyle).toBe('low-opacity-dashed');
    expect(renderer.getRouteObject('inferred-opacity')?.getObjectByName('visual-line-overlay')).toBeInstanceOf(THREE.Line);
    renderer.setOpacityMultiplier(1);
    expect(opacity('confirmed-opacity')).toBe(0.88);
    expect(opacity('pending-opacity')).toBe(0.32);
    renderer.dispose();
  });

  it('keeps status summary distinct and indexes multiple routes per endpoint', () => {
    const renderer = new MepCoordinationRenderer(new THREE.Scene());
    const config = {
      version: '1', status: 'preliminary',
      layers: Object.fromEntries(['strong_power', 'weak_power', 'water_supply', 'drainage', 'refrigerant', 'condensate', 'supply_air', 'return_air'].map((layer) => [layer, { label: layer, color: '#f00', height: 2 }])),
      routes: [
        { id: 'confirmed', layer: 'strong_power', status: 'confirmed', from: 'shared', to: { x: 1, z: 0 }, via: [] },
        { id: 'requirement', layer: 'strong_power', status: 'pending', route_kind: 'requirement', from: 'shared', to: { x: 2, z: 0 }, via: [] },
        { id: 'candidate', layer: 'strong_power', status: 'inferred', route_kind: 'candidate', from: 'shared', to: { x: 3, z: 0 }, via: [] },
      ],
    } as unknown as MepCoordination;
    renderer.render(config, { electrical: [{ id: 'shared', room: 'living', wall: 'north', type: 'socket', x: 0, z: 0, height: 1 }], plumbing: [], ceiling: [], hvacAnchors: [], hvacTerminals: [], outdoor: [] });
    expect(renderer.getRouteStatusSummary()).toEqual({ confirmed: 1, inferred: 0, pending: 0, requirement: 2 });
    expect(renderer.getRouteObject('requirement')?.userData.visualMode).toBe('requirement');
    expect(renderer.getRouteObject('candidate')?.userData.visualMode).toBe('candidate');
    expect(renderer.getRouteObject('requirement')?.userData.status).toBe('pending');
    expect(renderer.getRouteObject('candidate')?.userData.status).toBe('inferred');
    const visualObject = (id: string) => renderer.getRouteObject(id)!.getObjectByName('visual-line-overlay') as THREE.Line;
    expect((renderer.getRouteObject('confirmed')!.children[0] as THREE.Mesh).material).toMatchObject({ wireframe: false });
    expect((renderer.getRouteObject('requirement')!.children[0] as THREE.Mesh).material).toMatchObject({ wireframe: true });
    expect(visualObject('requirement').userData).toMatchObject({ visualStyle: 'wireframe-dashed', interactive: false });
    expect(visualObject('candidate').userData).toMatchObject({ visualStyle: 'wireframe-dashed', interactive: false });
    expect(visualObject('requirement').material).toBeInstanceOf(THREE.LineDashedMaterial);
    expect(visualObject('requirement').raycast).not.toBe(THREE.Line.prototype.raycast);
    expect(renderer.getEndpointRoute('shared')?.userData.routeId).toBe('confirmed');
    renderer.highlightRoute('requirement');
    renderer.dispose();
  });

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
      electrical: [], plumbing: [], ceiling: [],
      hvacAnchors: [{ id: 'anchor', status: 'inferred', system: 'refrigerant', ref: { source: 'outdoor', id: 'outdoor' } }],
      hvacTerminals: [],
      outdoor: [{ id: 'outdoor', platform: 'p', x: 4, z: 5, direction: 'south', width: 1, depth: 1, height: 1, model: 'test' }],
    });
    expect(renderer.getRenderReport()).toEqual({ total: 3, resolved: 2, skipped: 1, skippedRoutes: ['skipped'] });
    expect(renderer.group.children.map((child) => child.name)).toEqual(['mep:route:direct', 'mep:route:hvac']);
    expect(renderer.getRouteObject('direct')?.userData.physicalRoute).toBe(true);
    renderer.setOpacityMultiplier(0.5);
    expect(renderer.getOpacityMultiplier()).toBe(0.5);
    renderer.setLayerVisible('strong_power', false);
    expect(renderer.getRouteObject('direct')?.visible).toBe(false);
    expect(warn).toHaveBeenCalledWith('[mep] skipped unresolved route skipped');
    warn.mockRestore();
    renderer.dispose();
  });
});