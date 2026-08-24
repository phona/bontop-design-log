import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

export const EXPORT_INCLUDE_TYPES: ReadonlySet<string> = new Set([
  'floor',
  'ceiling',
  'ceiling_zone',
  'ceiling_zone_solid',
  'wall',
  'curtain_run',
  'curtain',
  'glass_infill',
  'shower_screen',
  'bay_sill',
  'railing_run',
  'sliding_door_run',
  'sliding_door',
  'door',
  'floor_region',
  'furniture',
  'hvac_equipment',
  'hvac_terminal',
]);

export const EXPORT_EXCLUDE_TYPES: ReadonlySet<string> = new Set([
  'annotation',
  'electrical',
  'plumbing',
  'platform',
  'highlight_object',
  'hvac_diagram',
  'hvac_reference_constraint',
]);

export interface HvacExportContents {
  equipment: string[];
  terminals: string[];
}

export interface HvacExportCheck extends HvacExportContents {
  included: string[];
  missing: string[];
  terminalCount: number;
}

export function collectExportSet(root: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const visit = (obj: THREE.Object3D) => {
    const type = obj.userData?.type as string | undefined;
    if (type === 'hvac_diagram') return;
    if (type && EXPORT_INCLUDE_TYPES.has(type)) {
      out.push(obj);
      return;
    }
    for (const child of obj.children) visit(child);
  };
  visit(root);
  return out;
}

/**
 * Reads HVAC entities from the exact object roots passed to GLTFExporter.
 * This descends into included parent groups, so export-set early returns cannot
 * hide a HVAC child; coordination diagram routes are excluded unconditionally.
 */
export function collectHvacExportContents(exportSet: Iterable<THREE.Object3D>): HvacExportContents {
  const equipment = new Set<string>();
  const terminals = new Set<string>();

  const visit = (object: THREE.Object3D): void => {
    const type = object.userData?.type as string | undefined;
    if (type === 'hvac_diagram') return;
    const objectId = object.userData?.objectId;
    if (typeof objectId === 'string') {
      if (type === 'hvac_equipment') equipment.add(objectId);
      if (type === 'hvac_terminal') terminals.add(objectId);
    }
    for (const child of object.children) visit(child);
  };

  for (const object of exportSet) visit(object);
  return { equipment: [...equipment], terminals: [...terminals] };
}

export function checkHvacExportSet(exportSet: Iterable<THREE.Object3D>, expected: Iterable<string>): HvacExportCheck {
  const { equipment, terminals } = collectHvacExportContents(exportSet);
  const included = [...equipment, ...terminals];
  const includedSet = new Set(included);
  return {
    equipment,
    terminals,
    included,
    missing: [...new Set(expected)].filter((objectId) => !includedSet.has(objectId)),
    terminalCount: terminals.length,
  };
}

export async function exportSceneToGlb(scene: THREE.Scene): Promise<Blob> {
  scene.updateMatrixWorld(true);
  const exportSet = collectExportSet(scene);
  const exportRoot = new THREE.Group();
  exportRoot.name = 'house';
  const savedNames = new Map<THREE.Object3D, string>();
  const savedVisible = new Map<THREE.Object3D, boolean>();
  const savedParents = new Map<THREE.Object3D, THREE.Object3D | null>();

  for (const obj of exportSet) {
    savedNames.set(obj, obj.name);
    savedVisible.set(obj, obj.visible);
    savedParents.set(obj, obj.parent);
    const exportName = (obj.userData?.exportName ?? obj.userData?.objectId) as string | undefined;
    if (exportName) obj.name = String(exportName);
    obj.visible = true;
    exportRoot.attach(obj);
  }
  exportRoot.updateMatrixWorld(true);

  try {
    const exporter = new GLTFExporter();
    const result = await exporter.parseAsync(exportRoot, { binary: true, embedImages: true });
    if (result instanceof ArrayBuffer) {
      return new Blob([result], { type: 'model/gltf-binary' });
    }
    return new Blob([JSON.stringify(result)], { type: 'model/gltf+json' });
  } finally {
    for (const obj of exportSet) {
      savedParents.get(obj)?.attach(obj);
      obj.name = savedNames.get(obj) ?? '';
      obj.visible = savedVisible.get(obj) ?? true;
    }
  }
}
