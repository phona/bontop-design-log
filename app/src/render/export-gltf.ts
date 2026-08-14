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
  'bay_sill',
  'railing_run',
  'sliding_door_run',
  'sliding_door',
  'door',
  'floor_region',
  'furniture',
]);

export const EXPORT_EXCLUDE_TYPES: ReadonlySet<string> = new Set([
  'annotation',
  'electrical',
  'plumbing',
  'platform',
  'highlight_object',
]);

export function collectExportSet(root: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const visit = (obj: THREE.Object3D) => {
    const type = obj.userData?.type as string | undefined;
    if (type && EXPORT_INCLUDE_TYPES.has(type)) {
      out.push(obj);
      return;
    }
    for (const child of obj.children) visit(child);
  };
  visit(root);
  return out;
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
    if (obj.userData?.objectId) obj.name = String(obj.userData.objectId);
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
