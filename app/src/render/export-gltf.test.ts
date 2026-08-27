import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { exportObjectTreeToGlb, exportSceneToGlb } from './export-gltf.js';
import { checkHvacExport, collectHvacExportContents } from './hvac-export-check.js';
// 契约对照源：shared/curtain-projection.ts 的 expectedVisibleCurtainNodes（blender/web 共同契约）
import { expectedVisibleCurtainNodes } from '@shared/curtain-projection';
import type { CurtainState } from '@shared/types';

function mesh(type: string | undefined, objectId?: string): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  if (type !== undefined) m.userData = { type, ...(objectId ? { objectId } : {}) };
  return m;
}

describe('HVAC export check', () => {
  it('finds HVAC entities below the supplied root only', () => {
    const root = new THREE.Group();
    const coordination = new THREE.Group();
    coordination.userData = { type: 'hvac_diagram' };
    coordination.add(mesh('hvac_terminal', 'hvac:route:must_not_count'));
    root.add(mesh('hvac_equipment', 'hvac:A2:anchor:outdoor'), mesh('hvac_terminal', 'hvac:A2:terminal:supply_living'), coordination);
    const outside = new THREE.Group();
    outside.add(mesh('hvac_terminal', 'hvac:outside'));
    const contents = collectHvacExportContents(root);
    expect(contents).toEqual({ equipment: ['hvac:A2:anchor:outdoor'], terminals: ['hvac:A2:terminal:supply_living'] });
    expect(collectHvacExportContents(outside).terminals).toEqual(['hvac:outside']);
  });

  it('reports missing expected HVAC IDs from the supplied root', () => {
    const root = new THREE.Group();
    root.add(mesh('hvac_equipment', 'hvac:A2:anchor:outdoor'));
    const checked = checkHvacExport(root, ['hvac:A2:anchor:outdoor', 'hvac:A2:terminal:supply_living']);
    expect(checked.included).toEqual(['hvac:A2:anchor:outdoor']);
    expect(checked.missing).toEqual(['hvac:A2:terminal:supply_living']);
    expect(checked.terminalCount).toBe(0);
  });
});

// 按 HouseScene.renderCurtain 的命名契约构造一组窗帘 mesh（contract: shared/curtain-projection.ts）
function curtainMeshesFor(id: string, kind: 'sheer_blackout' | 'blinds', state: CurtainState): THREE.Mesh[] {
  const make = (objectId: string, visible: boolean) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    m.userData = { type: 'curtain', objectId, curtainId: id };
    m.name = objectId;
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
  return (json.nodes ?? []).map((n: { name?: string }) => n.name).filter((name: string | undefined): name is string => typeof name === 'string');
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

describe('exportObjectTreeToGlb root contract', () => {
  it('exports every object in the supplied root, including types outside the legacy whitelist', async () => {
    const root = new THREE.Group();
    root.name = 'HOUSE_EXPORT';
    const object = mesh('annotation', 'annotation:kept');
    object.name = 'annotation:kept';
    root.add(object);
    const names = await glbNodeNames(await exportObjectTreeToGlb(root));
    expect(names).toContain('annotation:kept');
  });

  it('does not export objects outside the supplied root', async () => {
    const root = new THREE.Group();
    const viewOnly = new THREE.Group();
    viewOnly.name = 'HOUSE_VIEW_ONLY';
    viewOnly.add(mesh('annotation', 'annotation:view-only'));
    const scene = new THREE.Scene();
    scene.add(root, viewOnly);
    const names = await glbNodeNames(await exportObjectTreeToGlb(root));
    expect(names).not.toContain('annotation:view-only');
  });

  it('does not mutate parent, name, or visibility', async () => {
    const root = new THREE.Group();
    const object = mesh('annotation', 'annotation:stable');
    object.name = 'authored-name';
    object.visible = false;
    root.add(object);
    const before = { parent: object.parent, name: object.name, visible: object.visible };
    await exportObjectTreeToGlb(root);
    expect(object.parent).toBe(before.parent);
    expect(object.name).toBe(before.name);
    expect(object.visible).toBe(before.visible);
  });
});
