import * as THREE from 'three';
import type { FurnishingsYaml } from '@shared/types';

export function createFurniture(type: string): THREE.Group | null {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.6 });

  switch (type) {
    case 'bed_180': {
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.4, 2.0), mat);
      base.position.y = 0.2;
      group.add(base);
      const headboard = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 0.1), mat);
      headboard.position.set(0, 0.5, -0.95);
      group.add(headboard);
      return group;
    }
    case 'bed_150': {
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.4, 2.0), mat);
      base.position.y = 0.2;
      group.add(base);
      const headboard = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.6, 0.1), mat);
      headboard.position.set(0, 0.5, -0.95);
      group.add(headboard);
      return group;
    }
    case 'wardrobe_240': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.7, 0.6), mat);
      body.position.y = 1.35;
      group.add(body);
      return group;
    }
    case 'sofa_3seat': {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.4, 0.9), mat);
      seat.position.y = 0.2;
      group.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.5, 0.15), mat);
      back.position.set(0, 0.55, -0.38);
      group.add(back);
      const armL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.4, 0.9), mat);
      armL.position.set(-1.4, 0.4, 0);
      group.add(armL);
      const armR = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.4, 0.9), mat);
      armR.position.set(1.4, 0.4, 0);
      group.add(armR);
      return group;
    }
    case 'dining_table': {
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.04, 0.8), mat);
      top.position.y = 0.75;
      group.add(top);
      const legMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.4, metalness: 0.8 });
      for (const [lx, lz] of [[-0.6, -0.3], [0.6, -0.3], [-0.6, 0.3], [0.6, 0.3]]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.73, 0.04), legMat);
        leg.position.set(lx, 0.365, lz);
        group.add(leg);
      }
      return group;
    }
    case 'dining_chair': {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.04, 0.45), mat);
      seat.position.y = 0.45;
      group.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.4, 0.04), mat);
      back.position.set(0, 0.65, -0.2);
      group.add(back);
      return group;
    }
    case 'tv_stand': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.4, 0.4), mat);
      body.position.y = 0.2;
      group.add(body);
      return group;
    }
    case 'desk': {
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.03, 0.6), mat);
      top.position.y = 0.75;
      group.add(top);
      const legMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.4, metalness: 0.8 });
      for (const [lx, lz] of [[-0.5, -0.25], [0.5, -0.25], [-0.5, 0.25], [0.5, 0.25]]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.735, 0.03), legMat);
        leg.position.set(lx, 0.368, lz);
        group.add(leg);
      }
      return group;
    }
    default:
      return null;
  }
}

export function placeFurnishings(
  scene: THREE.Scene,
  furnishings: FurnishingsYaml
): THREE.Group[] {
  const placed: THREE.Group[] = [];
  for (const [roomId, items] of Object.entries(furnishings)) {
    let index = 0;
    for (const item of items) {
      if (item.x === undefined || item.z === undefined) continue;

      const model = createFurniture(item.type);
      if (!model) continue;

      model.position.set(item.x, 0, item.z);
      model.rotation.y = THREE.MathUtils.degToRad(item.rotation ?? 0);
      model.userData = { objectId: `furniture:${roomId}:${item.type}:${index}`, hoverable: false, type: 'furniture' };
      scene.add(model);
      placed.push(model);
      index++;
    }
  }
  return placed;
}
