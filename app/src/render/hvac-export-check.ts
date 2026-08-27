import * as THREE from 'three';

export interface HvacExportContents {
  equipment: string[];
  terminals: string[];
}

export interface HvacExportCheck extends HvacExportContents {
  included: string[];
  missing: string[];
  terminalCount: number;
}

export function collectHvacExportContents(root: THREE.Object3D): HvacExportContents {
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
  visit(root);
  return { equipment: [...equipment], terminals: [...terminals] };
}

export function checkHvacExport(root: THREE.Object3D, expected: Iterable<string>): HvacExportCheck {
  const { equipment, terminals } = collectHvacExportContents(root);
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
