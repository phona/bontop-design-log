import * as THREE from 'three';
import type { RoomObject } from '@shared/types';

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

export interface FurnishingItems {
  [roomId: string]: Record<string, number>;
}

export function placeFurnishings(
  scene: THREE.Scene,
  furnishings: FurnishingItems,
  rooms: Record<string, RoomObject>
): void {
  for (const [roomId, items] of Object.entries(furnishings)) {
    const room = rooms[roomId];
    if (!room) continue;

    for (const [type, count] of Object.entries(items)) {
      if (!count || count <= 0) continue;
      if (['ceiling_light', 'curtain_set', 'switch', 'power_outlet', 'network',
           'sink', 'toilet', 'shower_set', 'vanity', 'faucet', 'exhaust_fan',
           'range_hood', 'gas_stove', 'shoe_cabinet', 'cabinet_base', 'cabinet_wall',
           'countertop_quartz', 'bookshelf'].includes(type)) continue;

      const model = createFurniture(type);
      if (!model) continue;

      model.position.set(room.x, 0, room.z);
      model.userData = { objectId: `furniture:${roomId}:${type}`, hoverable: false, type: 'furniture' };
      scene.add(model);
    }
  }
}
