import * as THREE from 'three';

interface FixturePart {
  shape: 'box' | 'cylinder';
  size: [number, number, number];
  position?: [number, number, number];
  color: string;
  metalness?: number;
  roughness?: number;
}

interface FixtureRecipe {
  type: string;
  parts: FixturePart[];
}

const FIXTURE_RECIPES: FixtureRecipe[] = [
  // ── Furniture ──
  {
    type: 'bed_180',
    parts: [
      { shape: 'box', size: [1.8, 0.4, 2.0], position: [0, 0.2, 0], color: '#888888' },
      { shape: 'box', size: [1.8, 0.6, 0.1], position: [0, 0.5, -0.95], color: '#666666' },
    ],
  },
  {
    type: 'bed_150',
    parts: [
      { shape: 'box', size: [1.5, 0.4, 2.0], position: [0, 0.2, 0], color: '#888888' },
      { shape: 'box', size: [1.5, 0.6, 0.1], position: [0, 0.5, -0.95], color: '#666666' },
    ],
  },
  {
    type: 'wardrobe_240',
    parts: [
      { shape: 'box', size: [2.4, 2.7, 0.6], position: [0, 1.35, 0], color: '#8B7355' },
    ],
  },
  {
    type: 'wardrobe_180',
    parts: [
      { shape: 'box', size: [1.8, 2.7, 0.6], position: [0, 1.35, 0], color: '#8B7355' },
    ],
  },
  {
    type: 'sofa_3seat',
    parts: [
      { shape: 'box', size: [2.8, 0.4, 0.9], position: [0, 0.2, 0], color: '#6B8E9B' },
      { shape: 'box', size: [2.8, 0.5, 0.15], position: [0, 0.55, -0.38], color: '#5A7D8A' },
      { shape: 'box', size: [0.15, 0.4, 0.9], position: [-1.4, 0.4, 0], color: '#5A7D8A' },
      { shape: 'box', size: [0.15, 0.4, 0.9], position: [1.4, 0.4, 0], color: '#5A7D8A' },
    ],
  },
  {
    type: 'dining_table',
    parts: [
      { shape: 'box', size: [1.4, 0.04, 0.8], position: [0, 0.75, 0], color: '#A0846B' },
      { shape: 'box', size: [0.04, 0.73, 0.04], position: [-0.6, 0.365, -0.3], color: '#444444', metalness: 0.8, roughness: 0.4 },
      { shape: 'box', size: [0.04, 0.73, 0.04], position: [0.6, 0.365, -0.3], color: '#444444', metalness: 0.8, roughness: 0.4 },
      { shape: 'box', size: [0.04, 0.73, 0.04], position: [-0.6, 0.365, 0.3], color: '#444444', metalness: 0.8, roughness: 0.4 },
      { shape: 'box', size: [0.04, 0.73, 0.04], position: [0.6, 0.365, 0.3], color: '#444444', metalness: 0.8, roughness: 0.4 },
    ],
  },
  {
    type: 'dining_chair',
    parts: [
      { shape: 'box', size: [0.45, 0.04, 0.45], position: [0, 0.45, 0], color: '#888888' },
      { shape: 'box', size: [0.45, 0.4, 0.04], position: [0, 0.65, -0.2], color: '#666666' },
    ],
  },
  {
    type: 'tv_stand',
    parts: [
      { shape: 'box', size: [1.8, 0.4, 0.4], position: [0, 0.2, 0], color: '#5A4A3A' },
    ],
  },
  {
    type: 'desk',
    parts: [
      { shape: 'box', size: [1.2, 0.03, 0.6], position: [0, 0.75, 0], color: '#A0846B' },
      { shape: 'box', size: [0.03, 0.735, 0.03], position: [-0.5, 0.368, -0.25], color: '#444444', metalness: 0.8, roughness: 0.4 },
      { shape: 'box', size: [0.03, 0.735, 0.03], position: [0.5, 0.368, -0.25], color: '#444444', metalness: 0.8, roughness: 0.4 },
      { shape: 'box', size: [0.03, 0.735, 0.03], position: [-0.5, 0.368, 0.25], color: '#444444', metalness: 0.8, roughness: 0.4 },
      { shape: 'box', size: [0.03, 0.735, 0.03], position: [0.5, 0.368, 0.25], color: '#444444', metalness: 0.8, roughness: 0.4 },
    ],
  },
  {
    type: 'bookshelf',
    parts: [
      { shape: 'box', size: [0.8, 1.8, 0.3], position: [0, 0.9, 0], color: '#8B7355' },
    ],
  },
  {
    type: 'chair',
    parts: [
      { shape: 'box', size: [0.5, 0.44, 0.5], position: [0, 0.22, 0], color: '#888888' },
      { shape: 'box', size: [0.5, 0.4, 0.04], position: [0, 0.62, -0.23], color: '#666666' },
    ],
  },
  // ── Electrical ──
  {
    type: 'socket',
    parts: [
      { shape: 'box', size: [0.12, 0.08, 0.02], position: [0, 0, 0], color: '#f0f0f0', roughness: 0.6 },
    ],
  },
  {
    type: 'switch',
    parts: [
      { shape: 'box', size: [0.08, 0.08, 0.02], position: [0, 0, 0], color: '#ffffff', roughness: 0.6 },
    ],
  },
  {
    type: 'switch_2way',
    parts: [
      { shape: 'box', size: [0.08, 0.08, 0.02], position: [0, 0, 0], color: '#ffffff', roughness: 0.6 },
    ],
  },
  {
    type: 'network',
    parts: [
      { shape: 'box', size: [0.08, 0.08, 0.02], position: [0, 0, 0], color: '#4488ff', roughness: 0.6 },
    ],
  },
  {
    type: 'usb',
    parts: [
      { shape: 'box', size: [0.10, 0.06, 0.02], position: [0, 0, 0], color: '#e0e0e0', roughness: 0.6 },
    ],
  },
  {
    type: 'floor_socket',
    parts: [
      { shape: 'cylinder', size: [0.06, 0.02, 0.06], position: [0, 0, 0], color: '#888888', roughness: 0.8 },
    ],
  },
  // ── Plumbing ──
  {
    type: 'toilet',
    parts: [
      { shape: 'box', size: [0.40, 0.10, 0.40], position: [0, 0.05, 0], color: '#ffffff', roughness: 0.3 },
      { shape: 'box', size: [0.35, 0.40, 0.35], position: [0, 0.30, 0.05], color: '#ffffff', roughness: 0.3 },
      { shape: 'box', size: [0.40, 0.50, 0.15], position: [0, 0.35, -0.25], color: '#f0f0f0', roughness: 0.3 },
    ],
  },
  {
    type: 'faucet',
    parts: [
      { shape: 'cylinder', size: [0.02, 0.12, 0.02], position: [0, 0.06, 0], color: '#c0c0c0', metalness: 0.6, roughness: 0.2 },
      { shape: 'cylinder', size: [0.02, 0.10, 0.02], position: [0, 0.17, -0.06], color: '#c0c0c0', metalness: 0.6, roughness: 0.2 },
    ],
  },
  {
    type: 'faucet_outdoor',
    parts: [
      { shape: 'cylinder', size: [0.02, 0.12, 0.02], position: [0, 0.06, 0], color: '#888888', metalness: 0.4, roughness: 0.4 },
      { shape: 'cylinder', size: [0.02, 0.10, 0.02], position: [0, 0.17, -0.06], color: '#888888', metalness: 0.4, roughness: 0.4 },
    ],
  },
  {
    type: 'shower',
    parts: [
      { shape: 'cylinder', size: [0.015, 1.2, 0.015], position: [0, 0.6, 0], color: '#c0c0c0', metalness: 0.6, roughness: 0.2 },
      { shape: 'cylinder', size: [0.10, 0.02, 0.10], position: [0, 1.2, 0], color: '#c0c0c0', metalness: 0.6, roughness: 0.2 },
    ],
  },
  {
    type: 'drain',
    parts: [
      { shape: 'cylinder', size: [0.04, 0.01, 0.04], position: [0, 0, 0], color: '#666666', roughness: 0.8 },
    ],
  },
  {
    type: 'washer',
    parts: [
      { shape: 'box', size: [0.60, 0.85, 0.60], position: [0, 0.425, 0], color: '#eeeeee', roughness: 0.4 },
    ],
  },
];

export function buildFixture(type: string): THREE.Group | null {
  const recipe = FIXTURE_RECIPES.find((r) => r.type === type);
  if (!recipe) return null;

  const group = new THREE.Group();

  for (const part of recipe.parts) {
    let geo: THREE.BufferGeometry;
    if (part.shape === 'cylinder') {
      geo = new THREE.CylinderGeometry(part.size[0], part.size[0], part.size[1], 12);
    } else {
      geo = new THREE.BoxGeometry(part.size[0], part.size[1], part.size[2]);
    }

    const mat = new THREE.MeshStandardMaterial({
      color: part.color,
      metalness: part.metalness ?? 0.1,
      roughness: part.roughness ?? 0.6,
    });

    const mesh = new THREE.Mesh(geo, mat);
    if (part.position) {
      mesh.position.set(part.position[0], part.position[1], part.position[2]);
    }
    group.add(mesh);
  }

  return group;
}

export function getRecipeTypes(): string[] {
  return FIXTURE_RECIPES.map((r) => r.type);
}
