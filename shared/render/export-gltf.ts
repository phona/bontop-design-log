import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

export type ExportSceneToGlbData = ArrayBuffer | Uint8Array;

function toExportData(result: ArrayBuffer | object): ExportSceneToGlbData {
  if (result instanceof ArrayBuffer) return result;
  return new TextEncoder().encode(JSON.stringify(result));
}

export async function exportObjectTreeToGlbData(root: THREE.Object3D): Promise<ExportSceneToGlbData> {
  root.updateMatrixWorld(true);
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(root, { binary: true, embedImages: true });
  return toExportData(result);
}

export async function exportObjectTreeToGlb(root: THREE.Object3D): Promise<Blob> {
  const data = await exportObjectTreeToGlbData(root);
  const buffer = data instanceof ArrayBuffer ? data : data.slice().buffer;
  return new Blob([buffer], {
    type: data instanceof ArrayBuffer ? 'model/gltf-binary' : 'model/gltf+json',
  });
}

export async function exportSceneToGlbData(root: THREE.Object3D): Promise<ExportSceneToGlbData> {
  return exportObjectTreeToGlbData(root);
}

export async function exportSceneToGlb(root: THREE.Object3D): Promise<Blob> {
  return exportObjectTreeToGlb(root);
}
