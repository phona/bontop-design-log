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
    // DEC-023：2.4m 衣柜拆两段——西段（-x 侧）加深 0.8m 放被褥/行李箱，东段标准 0.6m 靠门侧；背面对齐（北缘 -0.4）
    type: 'wardrobe_240_split',
    parts: [
      { shape: 'box', size: [1.2, 2.7, 0.8], position: [-0.6, 1.35, 0], color: '#7d6647' },
      { shape: 'box', size: [1.2, 2.7, 0.6], position: [0.6, 1.35, -0.1], color: '#8B7355' },
    ],
  },
  {
    // DEC-023：置物架（开架，低摩擦收纳；两侧板+背板+4 层横板）
    type: 'shelf',
    parts: [
      { shape: 'box', size: [0.04, 2.0, 0.4], position: [-0.38, 1.0, 0], color: '#8B7355' },
      { shape: 'box', size: [0.04, 2.0, 0.4], position: [0.38, 1.0, 0], color: '#8B7355' },
      { shape: 'box', size: [0.8, 2.0, 0.02], position: [0, 1.0, -0.19], color: '#7d6647' },
      { shape: 'box', size: [0.72, 0.03, 0.36], position: [0, 0.3, 0], color: '#8B7355' },
      { shape: 'box', size: [0.72, 0.03, 0.36], position: [0, 0.8, 0], color: '#8B7355' },
      { shape: 'box', size: [0.72, 0.03, 0.36], position: [0, 1.3, 0], color: '#8B7355' },
      { shape: 'box', size: [0.72, 0.03, 0.36], position: [0, 1.8, 0], color: '#8B7355' },
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
  {
    type: 'fridge',
    parts: [
      { shape: 'box', size: [0.7, 1.8, 0.7], position: [0, 0.9, 0], color: '#c0c0c0', metalness: 0.6, roughness: 0.3 },
    ],
  },
  {
    type: 'gas_stove',
    parts: [
      { shape: 'box', size: [0.75, 0.75, 0.6], position: [0, 0.375, 0], color: '#888888' },
      { shape: 'box', size: [0.7, 0.02, 0.4], position: [0, 0.76, 0], color: '#222222', roughness: 0.3 },
    ],
  },
  {
    type: 'range_hood',
    parts: [
      { shape: 'box', size: [0.9, 0.3, 0.5], position: [0, 1.5, 0], color: '#c0c0c0', metalness: 0.6, roughness: 0.3 },
      { shape: 'box', size: [0.3, 0.9, 0.3], position: [0, 2.1, 0], color: '#c0c0c0', metalness: 0.6, roughness: 0.3 },
    ],
  },
  {
    type: 'sink',
    parts: [
      { shape: 'box', size: [0.8, 0.8, 0.6], position: [0, 0.4, 0], color: '#8B7355' },
      { shape: 'box', size: [0.5, 0.15, 0.4], position: [0, 0.85, 0], color: '#f0f0f0', roughness: 0.3 },
    ],
  },
  {
    type: 'vanity',
    parts: [
      { shape: 'box', size: [0.8, 0.75, 0.4], position: [0, 0.375, 0], color: '#f0f0f0', roughness: 0.4 },
      { shape: 'box', size: [0.5, 0.12, 0.3], position: [0, 0.81, 0], color: '#ffffff', roughness: 0.3 },
    ],
  },
  {
    type: 'exhaust_fan',
    parts: [
      { shape: 'box', size: [0.3, 0.15, 0.3], position: [0, 2.5, 0], color: '#dddddd', roughness: 0.5 },
    ],
  },
  {
    type: 'coffee_table',
    parts: [
      { shape: 'box', size: [0.7, 0.04, 0.7], position: [0, 0.4, 0], color: '#3a2f26' },
      { shape: 'box', size: [0.5, 0.38, 0.5], position: [0, 0.19, 0], color: '#222222', metalness: 0.7, roughness: 0.4 },
    ],
  },
  {
    // 西墙实体墙北段通顶柜（z=5.55–6.90，不进入餐厅/门厅过道）
    type: 'wall_cabinet_tall',
    parts: [
      { shape: 'box', size: [1.35, 1.1, 0.35], position: [0, 0.55, 0], color: '#f2ede2' },
      { shape: 'box', size: [1.35, 0.5, 0.03], position: [0, 1.35, -0.16], color: '#503e2e' },
      { shape: 'box', size: [1.35, 1.3, 0.35], position: [0, 2.25, 0], color: '#f2ede2' },
    ],
  },
  {
    // 西墙 TV 区（z=6.90–9.00，悬空低柜 + 深胡桃背板）
    type: 'tv_wall_low',
    parts: [
      { shape: 'box', size: [2.1, 0.35, 0.4], position: [0, 0.325, 0], color: '#503e2e' },
      { shape: 'box', size: [2.1, 1.6, 0.05], position: [0, 1.3, -0.17], color: '#503e2e' },
    ],
  },
  {
    // 玄关餐边一体柜：通顶三段式（底架空 0.15 + 浅门下柜 + 深胡桃开放格 + 浅门上柜）
    type: 'shoe_cabinet',
    parts: [
      { shape: 'box', size: [1.5, 0.75, 0.35], position: [0, 0.525, 0], color: '#f2ede2' },
      { shape: 'box', size: [1.5, 0.5, 0.03], position: [0, 1.15, -0.16], color: '#503e2e' },
      { shape: 'box', size: [1.5, 1.0, 0.35], position: [0, 1.9, 0], color: '#f2ede2' },
    ],
  },
  {
    // 入户花园可移动换鞋站：成品矮鞋柜 + 自立洞洞板，不依赖墙体固定。
    type: 'garden_entry_station',
    parts: [
      { shape: 'box', size: [1.1, 0.78, 0.34], position: [0, 0.42, 0], color: '#d9c5a5' },
      { shape: 'box', size: [1.14, 0.04, 0.38], position: [0, 0.83, 0], color: '#503e2e' },
      { shape: 'box', size: [1.1, 1.05, 0.04], position: [0, 1.38, -0.15], color: '#292725', metalness: 0.35, roughness: 0.65 },
      { shape: 'box', size: [0.05, 1.85, 0.05], position: [-0.5, 0.925, -0.15], color: '#292725', metalness: 0.55, roughness: 0.45 },
      { shape: 'box', size: [0.05, 1.85, 0.05], position: [0.5, 0.925, -0.15], color: '#292725', metalness: 0.55, roughness: 0.45 },
    ],
  },
  {
    // 门内右手的定制半高柜：向客厅延伸，玄关侧封闭、餐厅侧开放，柜顶以上保持视线通透。
    type: 'entry_half_height_cabinet',
    parts: [
      { shape: 'box', size: [2.0, 0.88, 0.35], position: [0, 0.44, 0], color: '#f2ede2' },
      { shape: 'box', size: [2.04, 0.04, 0.39], position: [0, 0.90, 0], color: '#503e2e' },
      { shape: 'box', size: [0.08, 0.56, 0.35], position: [-0.96, 1.18, 0], color: '#f2ede2' },
      { shape: 'box', size: [0.08, 0.56, 0.35], position: [0.96, 1.18, 0], color: '#f2ede2' },
      { shape: 'box', size: [1.76, 0.08, 0.35], position: [0, 1.46, 0], color: '#f2ede2' },
      { shape: 'box', size: [1.76, 0.50, 0.025], position: [0, 1.18, 0.162], color: '#503e2e' },
      { shape: 'box', size: [1.76, 0.04, 0.31], position: [0, 1.00, 0.0], color: '#503e2e' },
      { shape: 'box', size: [1.76, 0.50, 0.02], position: [0, 1.18, 0.186], color: '#f2ede2' },
    ],
  },
  // ── Electrical ─
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
