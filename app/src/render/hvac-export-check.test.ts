import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { collectHvacExportContents, checkHvacExport } from './hvac-export-check.js';

describe('hvac-export-check', () => {
  it('从普通树收集 hvac 实体', () => {
    const root = new THREE.Group();
    const equipment = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    equipment.userData = { type: 'hvac_equipment', objectId: 'hvac:A2:anchor:indoor_living' };
    root.add(equipment);

    const contents = collectHvacExportContents(root);
    expect(contents.equipment).toContain('hvac:A2:anchor:indoor_living');
  });

  it('合批后的实体从 batchUserData 收集（mesh 已摘出场景）', () => {
    const root = new THREE.Group();
    const batch = new THREE.Group();
    batch.userData.isSceneBatch = true;
    batch.userData.batchUserData = new Map([
      [0, { type: 'hvac_equipment', objectId: 'hvac:A2:anchor:indoor_living' }],
      [1, { type: 'hvac_terminal', objectId: 'hvac:A2:terminal:living' }],
      [2, { type: 'electrical', objectId: 'electrical:sock_x' }],
    ]);
    root.add(batch);

    const contents = collectHvacExportContents(root);
    expect(contents.equipment).toContain('hvac:A2:anchor:indoor_living');
    expect(contents.terminals).toContain('hvac:A2:terminal:living');
    expect(contents.equipment).not.toContain('electrical:sock_x');

    const check = checkHvacExport(root, ['hvac:A2:anchor:indoor_living', 'hvac:A2:terminal:living', 'hvac:A2:anchor:missing']);
    expect(check.missing).toEqual(['hvac:A2:anchor:missing']);
    expect(check.terminalCount).toBe(1);
  });
});
