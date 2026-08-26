import * as THREE from 'three';

interface FixturePart {
  shape: 'box' | 'cylinder';
  size: [number, number, number];
  position?: [number, number, number];
  rotation?: [number, number, number];
  color: string;
  metalness?: number;
  roughness?: number;
}

interface FixtureRecipe {
  type: string;
  parts: FixturePart[];
}

// 洞洞板孔阵：9 列 × 8 行、间距 0.12m 的深色小凸点，在浅色板面上读出孔洞感。
function pegboardHoles(z: number): FixturePart[] {
  const parts: FixturePart[] = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 9; col++) {
      parts.push({
        shape: 'box',
        size: [0.028, 0.028, 0.008],
        position: [-0.48 + col * 0.12, 0.94 + row * 0.12, z],
        color: '#4a463f',
        roughness: 0.9,
      });
    }
  }
  return parts;
}

export interface KitchenCabinetRunSpec {
  length: number;
  depth: number;
  cabinetHeight?: number;
  countertopThickness?: number;
}

export interface BathSideCabinetRunSpec {
  length: number;
  depth: number;
  cabinetHeight?: number;
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
    // 2026-08-26：定制衣柜 = 柜体 + 顶封板（同材质薄板封到目标高度，见 buildWardrobe180）。
    // 默认 2.50m：柜体 2.40 + 封板 0.10，抵边吊底（父母房/儿童房）；原顶房间用 cabinetHeight: 2.8 覆盖。
    type: 'wardrobe_180',
    parts: [
      { shape: 'box', size: [1.8, 2.40, 0.6], position: [0, 1.20, 0], color: '#8B7355' },
      { shape: 'box', size: [1.8, 0.10, 0.6], position: [0, 2.45, 0], color: '#8B7355' },
    ],
  },
  {
    // DEC-023：2.4m 衣柜拆两段——西段（-x 侧）加深 0.8m 放被褥/行李箱，东段标准 0.6m 靠门侧；背面对齐（北缘 -0.4）
    // 2026-08-26 主卧空调方案：西段降 1.1m 作被褥矮柜（上方空调盒朝南越顶送风），东段保持 2.7m 通顶挂衣
    type: 'wardrobe_240_split',
    parts: [
      { shape: 'box', size: [1.2, 1.1, 0.8], position: [-0.6, 0.55, 0], color: '#7d6647' },
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
    // 2026-08-25 洗漱+梳妆一体台（DEC-043，主卫台盆外移条带）：1.10m 满墙台面（墙段 x[0,1.15] 留 0.05 收边缝），
    // 台盆 0.5 居西、梳妆位尽量宽；收纳并入台下柜+镜柜（bath_entry_shelf/vanity_tall_cabinet 均已删除）。
    // 局部 -z 为靠墙侧，front 朝 +z。
    type: 'vanity_dresser',
    parts: [
      // 台下柜（台盆半，西侧）
      { shape: 'box', size: [0.46, 0.72, 0.42], position: [-0.29, 0.36, 0], color: '#d7d9db', roughness: 0.45 },
      { shape: 'box', size: [0.44, 0.66, 0.02], position: [-0.29, 0.40, 0.22], color: '#eef0f1', roughness: 0.35 },
      // 梳妆位（东侧）留膝部空间，仅一组吊抽屉
      { shape: 'box', size: [0.40, 0.16, 0.38], position: [0.27, 0.62, 0], color: '#d7d9db', roughness: 0.45 },
      // 通长台面
      { shape: 'box', size: [1.14, 0.04, 0.50], position: [0, 0.79, 0], color: '#e8e6e0', roughness: 0.3 },
      // 台上盆 + 龙头（西半）
      { shape: 'box', size: [0.46, 0.12, 0.32], position: [-0.29, 0.87, 0], color: '#ffffff', roughness: 0.3 },
      { shape: 'box', size: [0.05, 0.22, 0.05], position: [-0.29, 0.92, -0.16], color: '#c8ccd0', metalness: 0.6, roughness: 0.35 },
      // 镜柜（台盆上方）+ 平板镜（梳妆位上方，加宽）
      { shape: 'box', size: [0.50, 0.75, 0.14], position: [-0.29, 1.45, -0.20], color: '#bcd2d8', roughness: 0.1, metalness: 0.6 },
      { shape: 'box', size: [0.48, 0.75, 0.03], position: [0.27, 1.45, -0.235], color: '#bcd2d8', roughness: 0.1, metalness: 0.6 },
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
      { shape: 'box', size: [0.03, 0.43, 0.03], position: [-0.19, 0.215, -0.19], color: '#444444', metalness: 0.8, roughness: 0.4 },
      { shape: 'box', size: [0.03, 0.43, 0.03], position: [0.19, 0.215, -0.19], color: '#444444', metalness: 0.8, roughness: 0.4 },
      { shape: 'box', size: [0.03, 0.43, 0.03], position: [-0.19, 0.215, 0.19], color: '#444444', metalness: 0.8, roughness: 0.4 },
      { shape: 'box', size: [0.03, 0.43, 0.03], position: [0.19, 0.215, 0.19], color: '#444444', metalness: 0.8, roughness: 0.4 },
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
      { shape: 'box', size: [0.70, 0.04, 0.40], position: [0, 0.92, 0], color: '#222222', roughness: 0.3 },
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
      { shape: 'box', size: [0.56, 0.16, 0.42], position: [0, 0.84, 0], color: '#f0f0f0', roughness: 0.3 },
    ],
  },
  {
    type: 'vanity',
    parts: [
      { shape: 'box', size: [0.8, 0.75, 0.4], position: [0, 0.375, 0], color: '#f0f0f0', roughness: 0.4 },
      { shape: 'box', size: [0.5, 0.12, 0.3], position: [0, 0.81, 0], color: '#ffffff', roughness: 0.3 },
      // 台面 + 镜柜（靠墙侧=-z），2026-08-21 贴近成品洗漱台效果
      { shape: 'box', size: [0.84, 0.04, 0.5], position: [0, 0.77, 0], color: '#d8d2c6', roughness: 0.3 },
      { shape: 'box', size: [0.7, 0.9, 0.03], position: [0, 1.55, -0.24], color: '#bcd2d8', roughness: 0.1, metalness: 0.6 },
    ],
  },
  {
    // 卫浴侧柜：封闭高柜 h2.0，门板朝+z（2026-08-21 主卫干区柜带）
    type: 'bath_side_cabinet',
    parts: [
      { shape: 'box', size: [0.45, 2.0, 0.5], position: [0, 1.0, 0], color: '#e8e4dc', roughness: 0.5 },
      { shape: 'box', size: [0.41, 0.96, 0.02], position: [0, 0.5, 0.26], color: '#ded8cc', roughness: 0.5 },
      { shape: 'box', size: [0.41, 0.96, 0.02], position: [0, 1.5, 0.26], color: '#ded8cc', roughness: 0.5 },
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
    // 西墙实体墙北段通顶收纳柜：浅色平板门 + 一格胡桃开放格。
    // 电视不嵌入柜体，保持暖白乳胶漆墙面的留白。
    type: 'wall_cabinet_tall',
    parts: [
      // 落地柜体由内缩 80mm 踢脚承重；电视低柜采用带细腿落地形式。
      { shape: 'box', size: [1.22, 0.08, 0.27], position: [0, 0.04, 0.04], color: '#d5cec2' },
      { shape: 'box', size: [1.35, 0.97, 0.35], position: [0, 0.565, 0], color: '#f2ede2' },
      { shape: 'box', size: [1.35, 1.14, 0.35], position: [0, 2.145, 0], color: '#f2ede2' },
      // 无拉手柜门的分缝，避免渲染成一整块白色盒子。
      { shape: 'box', size: [0.012, 0.88, 0.012], position: [0, 0.565, -0.181], color: '#d5cec2' },
      { shape: 'box', size: [0.012, 1.05, 0.012], position: [0, 2.145, -0.181], color: '#d5cec2' },
      // 中部一格开放格：深胡桃背板和暖光只服务收纳柜，不构成电视背景墙。
      { shape: 'box', size: [1.19, 0.48, 0.025], position: [0, 1.32, -0.164], color: '#503e2e' },
      { shape: 'box', size: [1.19, 0.018, 0.03], position: [0, 1.55, -0.185], color: '#d7a461', metalness: 0.05, roughness: 0.35 },
    ],
  },
  {
    // 西墙电视区：挂墙电视 + 带细腿低柜；不做木饰面/背板电视墙。
    type: 'tv_wall_low',
    parts: [
      { shape: 'box', size: [2.1, 0.32, 0.40], position: [0, 0.31, 0], color: '#503e2e' },
      { shape: 'box', size: [2.10, 0.035, 0.43], position: [0, 0.4875, 0], color: '#654b37' },
      // 三扇无拉手柜门的阴影缝；低柜以细腿落地，保留轻盈感但不依赖墙挂。
      { shape: 'box', size: [0.012, 0.25, 0.012], position: [-0.35, 0.31, -0.206], color: '#382b22' },
      { shape: 'box', size: [0.012, 0.25, 0.012], position: [0.35, 0.31, -0.206], color: '#382b22' },
      { shape: 'cylinder', size: [0.018, 0.15, 0.018], position: [-0.92, 0.075, -0.16], color: '#2f2822', metalness: 0.35, roughness: 0.5 },
      { shape: 'cylinder', size: [0.018, 0.15, 0.018], position: [0.92, 0.075, -0.16], color: '#2f2822', metalness: 0.35, roughness: 0.5 },
      { shape: 'cylinder', size: [0.018, 0.15, 0.018], position: [-0.92, 0.075, 0.16], color: '#2f2822', metalness: 0.35, roughness: 0.5 },
      { shape: 'cylinder', size: [0.018, 0.15, 0.018], position: [0.92, 0.075, 0.16], color: '#2f2822', metalness: 0.35, roughness: 0.5 },
      { shape: 'cylinder', size: [0.018, 0.15, 0.018], position: [0, 0.075, 0.16], color: '#2f2822', metalness: 0.35, roughness: 0.5 },
    ],
  },
  {
    // 65 寸挂墙电视。独立于低柜和收纳柜，明确表达“无电视背景墙”方案。
    type: 'tv_65',
    parts: [
      { shape: 'box', size: [1.45, 0.84, 0.07], position: [0, 1.52, 0], color: '#141414', metalness: 0.15, roughness: 0.25 },
      { shape: 'box', size: [1.37, 0.77, 0.012], position: [0, 1.52, -0.041], color: '#202b32', metalness: 0.05, roughness: 0.18 },
    ],
  },
  {
    // 电视柜南侧的琴叶榕：落地软装，柔化柜体与玻璃幕墙之间的转角。
    type: 'plant_fiddle',
    parts: [
      { shape: 'cylinder', size: [0.20, 0.36, 0.20], position: [0, 0.18, 0], color: '#b8794e', roughness: 0.75 },
      { shape: 'cylinder', size: [0.035, 1.10, 0.035], position: [0, 0.91, 0], color: '#79543a', roughness: 0.85 },
      { shape: 'box', size: [0.52, 0.18, 0.10], position: [-0.16, 1.25, 0], color: '#4c6b45', roughness: 0.9 },
      { shape: 'box', size: [0.58, 0.18, 0.10], position: [0.17, 1.47, 0], color: '#58784d', roughness: 0.9 },
      { shape: 'box', size: [0.48, 0.18, 0.10], position: [-0.10, 1.68, 0], color: '#46653f', roughness: 0.9 },
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
    // 入户花园可移动换鞋站：三门矮鞋柜（柜脚抬高 + 门板缝 + 暗拉手）+ 自立浅色洞洞板（孔阵），不依赖墙体固定。
    type: 'garden_entry_station',
    parts: [
      // 柜脚（柜体抬高 8cm，读出"成品柜"而非落地墩）
      { shape: 'box', size: [0.05, 0.08, 0.05], position: [-0.48, 0.04, 0.12], color: '#503e2e' },
      { shape: 'box', size: [0.05, 0.08, 0.05], position: [0.48, 0.04, 0.12], color: '#503e2e' },
      { shape: 'box', size: [0.05, 0.08, 0.05], position: [-0.48, 0.04, -0.12], color: '#503e2e' },
      { shape: 'box', size: [0.05, 0.08, 0.05], position: [0.48, 0.04, -0.12], color: '#503e2e' },
      // 柜体
      { shape: 'box', size: [1.1, 0.72, 0.34], position: [0, 0.44, 0], color: '#d9c5a5' },
      // 三扇门板（12mm 缝，微凸出柜体前脸）
      { shape: 'box', size: [0.348, 0.64, 0.018], position: [-0.36, 0.45, 0.172], color: '#e2d2b6' },
      { shape: 'box', size: [0.348, 0.64, 0.018], position: [0, 0.45, 0.172], color: '#e2d2b6' },
      { shape: 'box', size: [0.348, 0.64, 0.018], position: [0.36, 0.45, 0.172], color: '#e2d2b6' },
      // 门板顶部暗拉手
      { shape: 'box', size: [0.09, 0.02, 0.015], position: [-0.36, 0.72, 0.185], color: '#503e2e' },
      { shape: 'box', size: [0.09, 0.02, 0.015], position: [0, 0.72, 0.185], color: '#503e2e' },
      { shape: 'box', size: [0.09, 0.02, 0.015], position: [0.36, 0.72, 0.185], color: '#503e2e' },
      // 台面
      { shape: 'box', size: [1.16, 0.04, 0.38], position: [0, 0.82, 0], color: '#503e2e' },
      // 浅色洞洞板 + 孔阵
      { shape: 'box', size: [1.1, 1.0, 0.025], position: [0, 1.34, -0.155], color: '#e8e2d6', roughness: 0.75 },
      ...pegboardHoles(-0.138),
      // 自立立柱
      { shape: 'box', size: [0.05, 1.85, 0.05], position: [-0.5, 0.925, -0.155], color: '#292725', metalness: 0.55, roughness: 0.45 },
      { shape: 'box', size: [0.05, 1.85, 0.05], position: [0.5, 0.925, -0.155], color: '#292725', metalness: 0.55, roughness: 0.45 },
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
      { shape: 'box', size: [0.08, 0.08, 0.02], position: [0, 0, 0], color: '#3f4650', roughness: 0.6 },
    ],
  },
  {
    type: 'switch_2way',
    parts: [
      { shape: 'box', size: [0.08, 0.08, 0.02], position: [0, 0, 0], color: '#3f4650', roughness: 0.6 },
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
  {
    // Developer-reserved recessed strong-power box: body sits in the wall; door and frame are flush/slightly proud.
    type: 'strong_panel',
    parts: [
      { shape: 'box', size: [0.60, 1.00, 0.12], position: [0, 0.50, -0.02], color: '#d9dde0', metalness: 0.15, roughness: 0.45 },
      { shape: 'box', size: [0.54, 0.90, 0.025], position: [0, 0.50, 0.052], color: '#eef0f1', metalness: 0.1, roughness: 0.35 },
      { shape: 'box', size: [0.025, 0.96, 0.025], position: [-0.31, 0.50, 0.05], color: '#727a80', metalness: 0.55, roughness: 0.35 },
      { shape: 'box', size: [0.025, 0.96, 0.025], position: [0.31, 0.50, 0.05], color: '#727a80', metalness: 0.55, roughness: 0.35 },
      { shape: 'box', size: [0.46, 0.018, 0.012], position: [0, 0.22, 0.07], color: '#8e969c', metalness: 0.45, roughness: 0.4 },
      { shape: 'box', size: [0.46, 0.018, 0.012], position: [0, 0.78, 0.07], color: '#8e969c', metalness: 0.45, roughness: 0.4 },
      { shape: 'cylinder', size: [0.018, 0.018, 0.018], position: [0.18, 0.86, 0.075], color: '#d94b45', metalness: 0.2, roughness: 0.35 },
    ],
  },
  {
    // Developer-reserved recessed weak-power/network box: body sits in the wall; door and frame are flush/slightly proud.
    type: 'weak_panel',
    parts: [
      { shape: 'box', size: [0.45, 0.75, 0.10], position: [0, 0.375, -0.02], color: '#c9d2da', metalness: 0.15, roughness: 0.5 },
      { shape: 'box', size: [0.39, 0.65, 0.025], position: [0, 0.375, 0.052], color: '#e3e8ec', metalness: 0.1, roughness: 0.38 },
      { shape: 'box', size: [0.025, 0.71, 0.025], position: [-0.235, 0.375, 0.05], color: '#66727c', metalness: 0.5, roughness: 0.38 },
      { shape: 'box', size: [0.025, 0.71, 0.025], position: [0.235, 0.375, 0.05], color: '#66727c', metalness: 0.5, roughness: 0.38 },
      { shape: 'box', size: [0.30, 0.015, 0.012], position: [0, 0.18, 0.07], color: '#74818b', metalness: 0.4, roughness: 0.45 },
      { shape: 'box', size: [0.30, 0.015, 0.012], position: [0, 0.24, 0.07], color: '#74818b', metalness: 0.4, roughness: 0.45 },
      { shape: 'cylinder', size: [0.016, 0.016, 0.016], position: [0.13, 0.66, 0.075], color: '#4c9bd8', metalness: 0.2, roughness: 0.35 },
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
      // Wall escutcheon and short horizontal spout; local +z points away from the wall.
      { shape: 'cylinder', size: [0.035, 0.04, 0.035], position: [0, 0.02, 0], rotation: [Math.PI / 2, 0, 0], color: '#c0c0c0', metalness: 0.6, roughness: 0.2 },
      { shape: 'cylinder', size: [0.018, 0.12, 0.018], position: [0, 0.08, 0.06], rotation: [Math.PI / 2, 0, 0], color: '#c0c0c0', metalness: 0.6, roughness: 0.2 },
      { shape: 'cylinder', size: [0.022, 0.04, 0.022], position: [0, 0.08, 0.13], rotation: [Math.PI / 2, 0, 0], color: '#c0c0c0', metalness: 0.6, roughness: 0.2 },
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
      // Low-profile round floor drain: rim, recessed grate, and four radial bars.
      { shape: 'cylinder', size: [0.075, 0.012, 0.075], position: [0, 0.006, 0], color: '#555b60', metalness: 0.65, roughness: 0.45 },
      { shape: 'cylinder', size: [0.058, 0.014, 0.058], position: [0, 0.014, 0], color: '#262a2d', metalness: 0.45, roughness: 0.55 },
      { shape: 'box', size: [0.10, 0.006, 0.012], position: [0, 0.024, 0], color: '#8a9094', metalness: 0.7, roughness: 0.4 },
      { shape: 'box', size: [0.012, 0.006, 0.10], position: [0, 0.024, 0], color: '#8a9094', metalness: 0.7, roughness: 0.4 },
      { shape: 'box', size: [0.07, 0.006, 0.012], position: [0, 0.024, 0.035], color: '#8a9094', metalness: 0.7, roughness: 0.4 },
      { shape: 'box', size: [0.07, 0.006, 0.012], position: [0, 0.024, -0.035], color: '#8a9094', metalness: 0.7, roughness: 0.4 },
    ],
  },
  {
    type: 'washer',
    parts: [
      { shape: 'box', size: [0.60, 0.85, 0.60], position: [0, 0.425, 0], color: '#eeeeee', roughness: 0.4 },
    ],
  },
  // ── 电器（house.yaml furnishings，2026-08-23 补缺员）──
  {
    // 热泵烘干机：专用支架叠放于洗衣机上方（y 0.88 起，总高 ≈1.73m）
    type: 'dryer',
    parts: [
      { shape: 'box', size: [0.60, 0.85, 0.60], position: [0, 1.305, 0], color: '#f0f0f0', roughness: 0.4 },
      { shape: 'box', size: [0.48, 0.48, 0.03], position: [0, 1.33, 0.29], color: '#222226', roughness: 0.15 },
    ],
  },
  {
    type: 'dishwasher',
    parts: [
      { shape: 'box', size: [0.60, 0.82, 0.58], position: [0, 0.41, 0], color: '#c8ccd0', metalness: 0.6, roughness: 0.35 },
      { shape: 'box', size: [0.58, 0.68, 0.02], position: [0, 0.44, 0.29], color: '#222226', roughness: 0.15 },
    ],
  },
  {
    // 燃气壁挂炉（⚠️暂定位，pending-site-data #26 未定案）：挂墙底 1.4 顶 1.9
    type: 'water_heater',
    parts: [
      { shape: 'box', size: [0.36, 0.55, 0.16], position: [0, 1.65, 0], color: '#f5f5f5', roughness: 0.3 },
      { shape: 'box', size: [0.05, 0.30, 0.05], position: [0, 1.22, 0], color: '#c8ccd0', metalness: 0.6, roughness: 0.35 },
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
    if (part.rotation) {
      mesh.rotation.x = part.rotation[0];
      mesh.rotation.y = part.rotation[1];
      mesh.rotation.z = part.rotation[2];
    }
    group.add(mesh);
  }

  return group;
}

/** 定制 1.8m 衣柜：柜体 + 顶封板封到 totalHeight（默认 2.50 抵边吊底；原顶房间传 2.80）。 */
export function buildWardrobe180(totalHeight = 2.5): THREE.Group {
  const filler = 0.1;
  const bodyHeight = totalHeight - filler;
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#8B7355', metalness: 0.1, roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, bodyHeight, 0.6), mat);
  body.position.set(0, bodyHeight / 2, 0);
  const topFiller = new THREE.Mesh(new THREE.BoxGeometry(1.8, filler, 0.6), mat);
  topFiller.position.set(0, bodyHeight + filler / 2, 0);
  group.add(body, topFiller);
  return group;
}

/** Builds a configurable continuous bathroom-side tall-cabinet run. */
export function buildBathSideCabinetRun(spec: BathSideCabinetRunSpec): THREE.Group {
  const cabinetHeight = spec.cabinetHeight ?? 2.0;
  const group = new THREE.Group();
  const addBox = (size: [number, number, number], position: [number, number, number], color: string) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(...size),
      new THREE.MeshStandardMaterial({ color, roughness: 0.5 }),
    );
    mesh.position.set(...position);
    group.add(mesh);
  };

  addBox([spec.length, cabinetHeight, spec.depth], [0, cabinetHeight / 2, 0], '#e8e4dc');
  addBox([Math.max(0.1, spec.length - 0.04), cabinetHeight - 0.08, 0.02], [0, cabinetHeight / 2, spec.depth / 2 + 0.01], '#ded8cc');
  for (let x = -spec.length / 2 + 0.6; x < spec.length / 2 - 0.05; x += 0.6) {
    addBox([0.012, cabinetHeight - 0.18, 0.012], [x, cabinetHeight / 2, spec.depth / 2 + 0.022], '#b8afa2');
  }
  return group;
}

/** Builds a configurable straight run; L-shaped kitchens declare one run per wall. */
export function buildKitchenCabinetRun(spec: KitchenCabinetRunSpec): THREE.Group {
  const cabinetHeight = spec.cabinetHeight ?? 0.86;
  const countertopThickness = spec.countertopThickness ?? 0.03;
  const group = new THREE.Group();
  const addBox = (
    size: [number, number, number],
    position: [number, number, number],
    color: string,
    surface?: 'countertop',
  ) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(...size),
      new THREE.MeshStandardMaterial({ color, roughness: surface ? 0.28 : 0.55 }),
    );
    mesh.position.set(...position);
    if (surface) mesh.userData.surface = surface;
    group.add(mesh);
  };

  addBox([Math.max(0.1, spec.length - 0.08), 0.08, Math.max(0.1, spec.depth - 0.06)], [0, 0.04, 0], '#4c4237');
  addBox([spec.length, cabinetHeight - 0.08, spec.depth], [0, (cabinetHeight + 0.08) / 2, 0], '#b79e7c');
  addBox([spec.length + 0.04, countertopThickness, spec.depth + 0.04], [0, cabinetHeight + countertopThickness / 2, 0], '#e8e6e0', 'countertop');

  // Subtle door seams make the run read as cabinets rather than a solid block.
  for (let x = -spec.length / 2 + 0.6; x < spec.length / 2 - 0.05; x += 0.6) {
    addBox([0.012, cabinetHeight - 0.18, 0.012], [x, cabinetHeight / 2, -spec.depth / 2 - 0.006], '#8d775b');
  }
  return group;
}

export function getRecipeTypes(): string[] {
  return FIXTURE_RECIPES.map((r) => r.type);
}
