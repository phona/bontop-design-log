import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { checkHvacExportSet, collectExportSet, collectHvacExportContents, exportSceneToGlb, EXPORT_INCLUDE_TYPES, EXPORT_EXCLUDE_TYPES } from './export-gltf.js';
// 契约对照源：shared/curtain-projection.ts 的 expectedVisibleCurtainNodes（blender/web 共同契约）
import { expectedVisibleCurtainNodes } from '@shared/curtain-projection';
import type { CurtainState } from '@shared/types';

function mesh(type: string | undefined, objectId?: string): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  if (type !== undefined) m.userData = { type, ...(objectId ? { objectId } : {}) };
  return m;
}

describe('collectExportSet', () => {
  it('includes geometry, doors, ceiling zones, curtains and furniture groups', () => {
    const scene = new THREE.Scene();
    const floor = mesh('floor', 'floor:living_dining');
    const ceiling = mesh('ceiling', 'ceiling:living_dining');
    const ceilingZone = new THREE.Group();
    ceilingZone.userData = { type: 'ceiling_zone', objectId: 'cz:living' };
    ceilingZone.add(mesh('ceiling_zone_solid', 'cz:living:solid'));
    const wall = mesh('wall', 'wall:living_dining:N');
    const door = mesh('door', 'opening:entry');
    const slidingDoor = mesh('sliding_door', 'sliding_door:balcony');
    const curtainRun = mesh('curtain_run', 'curtain:living');
    const curtainSheer = mesh('curtain', 'curtain:living:sheer');
    const glass = mesh('glass_infill', 'glass:bay1');
    const sill = mesh('bay_sill', 'sill:bay1');
    const railing = mesh('railing_run', 'rail:balcony');
    const slidingRun = mesh('sliding_door_run', 'sdr:balcony');
    const region = mesh('floor_region', 'region:kitchen');
    const furniture = new THREE.Group();
    furniture.userData = { type: 'furniture', objectId: 'furniture:living:sofa_3seat:0' };
    furniture.add(mesh(undefined));
    const hvacEquipment = mesh('hvac_equipment', 'hvac:A2:anchor:indoor_living');
    const hvacTerminal = mesh('hvac_terminal', 'hvac:A2:terminal:supply_living');
    scene.add(floor, ceiling, ceilingZone, wall, door, slidingDoor, curtainRun, curtainSheer, glass, sill, railing, slidingRun, region, furniture, hvacEquipment, hvacTerminal);

    const set = collectExportSet(scene);
    expect(set).toContain(floor);
    expect(set).toContain(ceiling);
    expect(set).toContain(ceilingZone);
    expect(set).toContain(wall);
    expect(set).toContain(door);
    expect(set).toContain(slidingDoor);
    expect(set).toContain(curtainRun);
    expect(set).toContain(curtainSheer);
    expect(set).toContain(glass);
    expect(set).toContain(sill);
    expect(set).toContain(railing);
    expect(set).toContain(slidingRun);
    expect(set).toContain(region);
    expect(set).toContain(furniture);
    expect(set).toContain(hvacEquipment);
    expect(set).toContain(hvacTerminal);
  });

  it('excludes annotations, electrical/plumbing markers, platform boundary and untyped helpers', () => {
    const scene = new THREE.Scene();
    const annotation = mesh('annotation', 'electrical:p1');
    const electrical = mesh('electrical', 'electrical:p1');
    const plumbing = mesh('plumbing', 'plumbing:p2');
    const platform = mesh('platform', 'platform_boundary');
    const highlight = mesh('highlight_object');
    const hvacDiagram = mesh('hvac_diagram', 'hvac:A2:route:trunk');
    const grid = new THREE.GridHelper();
    const untyped = mesh(undefined);
    scene.add(annotation, electrical, plumbing, platform, highlight, hvacDiagram, grid, untyped);

    const set = collectExportSet(scene);
    expect(set).toHaveLength(0);
  });

  it('does not export curtains in the open state', () => {
    const scene = new THREE.Scene();
    const deployed = mesh('curtain', 'curtain:living:sheer:deployed');
    deployed.visible = false;
    deployed.userData = { ...deployed.userData, curtainId: 'curtain:living', layer: 'sheer', state: 'open', variant: 'deployed' };
    const gathered = mesh('curtain', 'curtain:living:sheer:gathered');
    gathered.visible = false;
    gathered.userData = { ...gathered.userData, curtainId: 'curtain:living', layer: 'sheer', state: 'open', variant: 'gathered' };
    scene.add(deployed, gathered);
    expect(collectExportSet(scene)).toEqual([]);
  });

  it('exports visible privacy and blackout curtain variants', () => {
    const scene = new THREE.Scene();
    const privacy = mesh('curtain', 'curtain:living:sheer:deployed');
    privacy.userData = { ...privacy.userData, curtainId: 'curtain:living', layer: 'sheer', state: 'privacy', variant: 'deployed' };
    const blackout = mesh('curtain', 'curtain:living:blackout:deployed');
    blackout.userData = { ...blackout.userData, curtainId: 'curtain:living', layer: 'blackout', state: 'blackout', variant: 'deployed' };
    scene.add(privacy, blackout);
    expect(collectExportSet(scene)).toEqual([privacy, blackout]);
  });

  it('does not double-collect children of an included group', () => {
    const scene = new THREE.Scene();
    const furniture = new THREE.Group();
    furniture.userData = { type: 'furniture', objectId: 'furniture:bed:bed_180:0' };
    const inner = mesh('furniture');
    furniture.add(inner);
    scene.add(furniture);

    const set = collectExportSet(scene);
    expect(set).toEqual([furniture]);
  });

  it('collects HVAC children below an included parent and excludes coordination routes', () => {
    const scene = new THREE.Scene();
    const container = new THREE.Group();
    container.userData = { type: 'furniture', objectId: 'furniture:utility:0' };
    container.add(
      mesh('hvac_equipment', 'hvac:A2:anchor:outdoor'),
      mesh('hvac_terminal', 'hvac:A2:terminal:supply_living'),
    );
    const coordination = new THREE.Group();
    coordination.userData = { type: 'hvac_diagram', objectId: 'hvac:A2:route:trunk' };
    coordination.add(mesh('hvac_condensate_candidate', 'hvac:A2:terminal:must_not_export'));
    coordination.add(mesh('hvac_terminal', 'hvac:A2:terminal:must_not_export'));
    scene.add(container, coordination);

    const contents = collectHvacExportContents(collectExportSet(scene));
    expect(contents.equipment).toEqual(['hvac:A2:anchor:outdoor']);
    expect(contents.terminals).toEqual(['hvac:A2:terminal:supply_living']);
  });

  it('reports missing expected HVAC IDs from the exporter object set', () => {
    const scene = new THREE.Scene();
    scene.add(mesh('hvac_equipment', 'hvac:A2:anchor:outdoor'));

    const checked = checkHvacExportSet(collectExportSet(scene), [
      'hvac:A2:anchor:outdoor',
      'hvac:A2:anchor:indoor_living',
      'hvac:A2:terminal:supply_living',
    ]);
    expect(checked.included).toEqual(['hvac:A2:anchor:outdoor']);
    expect(checked.missing).toEqual([
      'hvac:A2:anchor:indoor_living',
      'hvac:A2:terminal:supply_living',
    ]);
    expect(checked.terminalCount).toBe(0);
  });

  it('keeps include and exclude sets disjoint', () => {
    for (const t of EXPORT_INCLUDE_TYPES) {
      expect(EXPORT_EXCLUDE_TYPES.has(t)).toBe(false);
    }
  });
});

// 按 HouseScene.renderCurtain 的命名契约构造一组窗帘 mesh（contract: shared/curtain-projection.ts）
function curtainMeshesFor(id: string, kind: 'sheer_blackout' | 'blinds', state: CurtainState): THREE.Mesh[] {
  const make = (objectId: string, visible: boolean) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    m.userData = { type: 'curtain', objectId, curtainId: id };
    m.visible = visible;
    return m;
  };
  const expected = new Set(expectedVisibleCurtainNodes(id, kind, state));
  const all =
    kind === 'blinds'
      ? [`${id}:blinds:deployed`, `${id}:blinds:gathered`]
      : [
          `${id}:sheer:deployed`,
          `${id}:sheer:gathered:left`,
          `${id}:sheer:gathered:right`,
          `${id}:blackout:deployed`,
          `${id}:blackout:gathered:left`,
          `${id}:blackout:gathered:right`,
        ];
  return all.map((objectId) => make(objectId, expected.has(objectId)));
}

async function glbNodeNames(blob: Blob): Promise<string[]> {
  const buf = await blob.arrayBuffer();
  const view = new DataView(buf);
  expect(view.getUint32(0, true)).toBe(0x46546c67); // 'glTF'
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLength)));
  return (json.nodes ?? []).map((n: { name?: string }) => n.name);
}

describe('exportSceneToGlb curtain contract', () => {
  it('privacy state exports exactly expectedVisibleCurtainNodes with unique names and restores web visibility', async () => {
    const scene = new THREE.Scene();
    const curtains = curtainMeshesFor('curtain_a', 'sheer_blackout', 'privacy');
    scene.add(...curtains);
    const before = curtains.map((m) => ({ visible: m.visible, name: m.name }));

    const names = await glbNodeNames(await exportSceneToGlb(scene));
    const exportedCurtains = names.filter((n) => n.startsWith('curtain_a:'));
    expect(exportedCurtains.sort())
      .toEqual([...expectedVisibleCurtainNodes('curtain_a', 'sheer_blackout', 'privacy')].sort());
    expect(new Set(exportedCurtains).size).toBe(exportedCurtains.length);

    // 导出后 Web 场景 visibility/name 不变
    expect(curtains.map((m) => ({ visible: m.visible, name: m.name }))).toEqual(before);
  });

  it('open state exports no curtain nodes into the GLB', async () => {
    const scene = new THREE.Scene();
    scene.add(...curtainMeshesFor('curtain_a', 'sheer_blackout', 'open'));
    const names = await glbNodeNames(await exportSceneToGlb(scene));
    expect(names.filter((n) => n.startsWith('curtain_a:'))).toEqual([]);
  });

  it('blinds privacy exports only the deployed node; gathered stays hidden and unexported', async () => {
    const scene = new THREE.Scene();
    scene.add(...curtainMeshesFor('blind_a', 'blinds', 'privacy'));
    const names = await glbNodeNames(await exportSceneToGlb(scene));
    expect(names.filter((n) => n.startsWith('blind_a:')))
      .toEqual(expectedVisibleCurtainNodes('blind_a', 'blinds', 'privacy'));
  });
});
