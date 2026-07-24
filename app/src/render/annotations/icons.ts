import * as THREE from 'three';

export function createSocketIcon(): THREE.Group {
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(0.08, 0.02, 0.12);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x4488ff, emissiveIntensity: 0.3 });
  group.add(new THREE.Mesh(geo, mat));
  const dotMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
  [-0.02, 0.02].forEach(x => {
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.008, 8), dotMat);
    dot.position.set(x, 0.01, 0.04);
    group.add(dot);
  });
  return group;
}

export function createSwitchIcon(): THREE.Group {
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(0.06, 0.02, 0.06);
  const mat = new THREE.MeshStandardMaterial({ color: 0xeeeeee });
  group.add(new THREE.Mesh(geo, mat));
  return group;
}

export function createFaucetIcon(): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x4488ff, emissive: 0x2244aa, emissiveIntensity: 0.2 });
  group.add(new THREE.Mesh(new THREE.CircleGeometry(0.04, 16), mat));
  return group;
}

export function createDrainIcon(): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x888888 });
  const ring = new THREE.RingGeometry(0.03, 0.05, 16);
  group.add(new THREE.Mesh(ring, mat));
  return group;
}

export function createCeilingZoneIndicator(width: number, depth: number): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(width, depth);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x8888ff,
    transparent: true,
    opacity: 0.12,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  return new THREE.Mesh(geo, mat);
}

export function createACIndoorIcon(): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.05, 0.3),
    new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.5 })
  );
  group.add(body);
  const slotMat = new THREE.MeshBasicMaterial({ color: 0x666666 });
  for (let i = -0.3; i <= 0.3; i += 0.15) {
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.01, 0.2), slotMat);
    slot.position.set(i, 0.03, 0);
    group.add(slot);
  }
  return group;
}
