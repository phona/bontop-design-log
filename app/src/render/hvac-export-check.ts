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
    // 合批 mesh 已从树上摘下，实体元数据在批次的 batchUserData 里（导出前 restoreStaticBatches 会挂回）
    const batchUserData = object.userData?.isSceneBatch
      ? (object.userData.batchUserData as Map<number, Record<string, unknown>> | undefined)
      : undefined;
    if (batchUserData) {
      for (const data of batchUserData.values()) {
        const batchedType = data.type as string | undefined;
        const batchedObjectId = data.objectId;
        if (typeof batchedObjectId !== 'string') continue;
        if (batchedType === 'hvac_equipment') equipment.add(batchedObjectId);
        if (batchedType === 'hvac_terminal') terminals.add(batchedObjectId);
      }
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
