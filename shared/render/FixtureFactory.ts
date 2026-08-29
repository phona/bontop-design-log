import * as THREE from 'three';
import type { FurnishingCutout } from '../types.js';

interface FixturePart {
  shape: 'box' | 'cylinder';
  size: [number, number, number];
  position?: [number, number, number];
  rotation?: [number, number, number];
  color: string;
  metalness?: number;
  roughness?: number;
  name?: string;
  part?: string;
  materialRole?: string;
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
  cutouts?: FurnishingCutout[];
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
    // 2026-08-26 主卧空调方案：西段降 1.1m 作被褥矮柜（上方檐口朝南越顶送风）；v2 利用率调整：矮柜收窄 0.8m（x[1.8,2.6]），挂衣高柜西延至 1.6m（x[2.6,4.2]）
    type: 'wardrobe_240_split',
    parts: [
      { shape: 'box', size: [0.8, 1.1, 0.8], position: [-0.8, 0.55, 0], color: '#7d6647' },
      { shape: 'box', size: [1.6, 2.7, 0.6], position: [0.4, 1.35, -0.1], color: '#8B7355' },
    ],
  },
  {
    // DEC-045：主卧条带东北角通顶储物柜（家政/linen/换季），嵌主卫东墙×儿童房南墙转角，朝西开门；
    // 背板与侧板夹 0.1×0.1 管井角藏冷凝水管（包保温棉防结露，全程明管开柜即修）
    type: 'utility_cabinet_tall',
    parts: [
      { shape: 'box', size: [0.55, 2.7, 1.3], position: [0, 1.35, 0], color: '#8B7355' },
      { shape: 'box', size: [0.02, 1.28, 0.58], position: [-0.28, 0.68, -0.31], color: '#7d6647' },
      { shape: 'box', size: [0.02, 1.28, 0.58], position: [-0.28, 2.02, -0.31], color: '#7d6647' },
      { shape: 'box', size: [0.02, 1.28, 0.58], position: [-0.28, 0.68, 0.31], color: '#7d6647' },
      { shape: 'box', size: [0.02, 1.28, 0.58], position: [-0.28, 2.02, 0.31], color: '#7d6647' },
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
      { shape: 'box', size: [0.46, 0.72, 0.42], position: [-0.29, 0.36, 0], color: '#d7d9db', roughness: 0.45, part: 'vanity-carcass', materialRole: 'cabinet_body' },
      { shape: 'box', size: [0.44, 0.66, 0.02], position: [-0.29, 0.40, 0.22], color: '#eef0f1', roughness: 0.35, part: 'vanity-door', materialRole: 'door_front' },
      // 梳妆位（东侧）留膝部空间，仅一组吊抽屉
      { shape: 'box', size: [0.40, 0.16, 0.38], position: [0.27, 0.62, 0], color: '#d7d9db', roughness: 0.45, part: 'dresser-drawer', materialRole: 'drawer_front' },
      // 通长台面
      { shape: 'box', size: [1.14, 0.04, 0.50], position: [0, 0.79, 0], color: '#e8e6e0', roughness: 0.3, part: 'countertop', materialRole: 'countertop' },
      // 台上盆 + 龙头（西半）
      { shape: 'box', size: [0.46, 0.12, 0.32], position: [-0.29, 0.87, 0], color: '#ffffff', roughness: 0.3, part: 'basin', materialRole: 'ceramic' },
      { shape: 'box', size: [0.05, 0.22, 0.05], position: [-0.29, 0.92, -0.16], color: '#c8ccd0', metalness: 0.6, roughness: 0.35, part: 'faucet', materialRole: 'hardware' },
      // 镜柜（台盆上方）+ 平板镜（梳妆位上方，加宽）
      { shape: 'box', size: [0.50, 0.75, 0.14], position: [-0.29, 1.45, -0.20], color: '#bcd2d8', roughness: 0.1, metalness: 0.6, part: 'mirror-cabinet', materialRole: 'cabinet_body' },
      { shape: 'box', size: [0.48, 0.75, 0.03], position: [0.27, 1.45, -0.235], color: '#bcd2d8', roughness: 0.1, metalness: 0.6, part: 'mirror', materialRole: 'mirror' },
    ],
  },
  {
    type: 'towel_set',
    parts: [
      { shape: 'box', size: [0.03, 0.03, 0.45], position: [0, 1.25, 0], color: '#c0c0c0', metalness: 0.6, roughness: 0.2, part: 'towel-bar', materialRole: 'hardware' },
      { shape: 'box', size: [0.06, 0.45, 0.28], position: [-0.03, 1.05, 0], color: '#e8e1d6', roughness: 0.9, part: 'towel', materialRole: 'fabric' },
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
    // 开放式书架：北墙书墙使用，正面朝 +z；保留 0.8×1.8×0.3m 外轮廓。
    type: 'bookshelf',
    parts: [
      { shape: 'box', size: [0.04, 1.8, 0.3], position: [-0.38, 0.9, 0], color: '#8B7355', part: 'side-left', materialRole: 'cabinet_body' },
      { shape: 'box', size: [0.04, 1.8, 0.3], position: [0.38, 0.9, 0], color: '#8B7355', part: 'side-right', materialRole: 'cabinet_body' },
      { shape: 'box', size: [0.72, 1.72, 0.02], position: [0, 0.90, -0.14], color: '#7d6647', part: 'back-panel', materialRole: 'back_panel' },
      { shape: 'box', size: [0.72, 0.04, 0.26], position: [0, 0.02, 0], color: '#8B7355', part: 'bottom-panel', materialRole: 'cabinet_body' },
      { shape: 'box', size: [0.72, 0.04, 0.26], position: [0, 1.78, 0], color: '#8B7355', part: 'top-panel', materialRole: 'cabinet_body' },
      { shape: 'box', size: [0.72, 0.03, 0.26], position: [0, 0.42, 0], color: '#a48763', part: 'shelf-01', materialRole: 'shelf' },
      { shape: 'box', size: [0.72, 0.03, 0.26], position: [0, 0.82, 0], color: '#a48763', part: 'shelf-02', materialRole: 'shelf' },
      { shape: 'box', size: [0.72, 0.03, 0.26], position: [0, 1.22, 0], color: '#a48763', part: 'shelf-03', materialRole: 'shelf' },
      { shape: 'box', size: [0.72, 0.03, 0.26], position: [0, 1.62, 0], color: '#a48763', part: 'shelf-04', materialRole: 'shelf' },
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
      { shape: 'box', size: [0.8, 0.75, 0.4], position: [0, 0.375, 0], color: '#f0f0f0', roughness: 0.4, part: 'vanity-carcass', materialRole: 'cabinet_body' },
      { shape: 'box', size: [0.5, 0.12, 0.3], position: [0, 0.81, 0], color: '#ffffff', roughness: 0.3, part: 'basin', materialRole: 'ceramic' },
      // 台面 + 镜柜（靠墙侧=-z），2026-08-21 贴近成品洗漱台效果
      { shape: 'box', size: [0.84, 0.04, 0.5], position: [0, 0.77, 0], color: '#d8d2c6', roughness: 0.3, part: 'countertop', materialRole: 'countertop' },
      { shape: 'box', size: [0.7, 0.9, 0.03], position: [0, 1.55, -0.24], color: '#bcd2d8', roughness: 0.1, metalness: 0.6, part: 'mirror', materialRole: 'mirror' },
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
      { shape: 'box', size: [1.22, 0.08, 0.27], position: [0, 0.04, 0.04], color: '#d5cec2', part: 'plinth', materialRole: 'plinth' },
      { shape: 'box', size: [1.35, 0.97, 0.35], position: [0, 0.565, 0], color: '#f2ede2', part: 'lower-carcass', materialRole: 'cabinet_body' },
      { shape: 'box', size: [1.35, 1.14, 0.35], position: [0, 2.145, 0], color: '#f2ede2', part: 'upper-carcass', materialRole: 'cabinet_body' },
      { shape: 'box', size: [0.64, 0.84, 0.018], position: [-0.34, 0.565, -0.181], color: '#e5dfd4', part: 'lower-door-left', materialRole: 'door_front' },
      { shape: 'box', size: [0.64, 0.84, 0.018], position: [0.34, 0.565, -0.181], color: '#e5dfd4', part: 'lower-door-right', materialRole: 'door_front' },
      { shape: 'box', size: [0.64, 1.01, 0.018], position: [-0.34, 2.145, -0.181], color: '#e5dfd4', part: 'upper-door-left', materialRole: 'door_front' },
      { shape: 'box', size: [0.64, 1.01, 0.018], position: [0.34, 2.145, -0.181], color: '#e5dfd4', part: 'upper-door-right', materialRole: 'door_front' },
      { shape: 'box', size: [0.012, 0.88, 0.012], position: [0, 0.565, -0.192], color: '#b9afa2', part: 'lower-door-seam', materialRole: 'door_seam' },
      { shape: 'box', size: [0.012, 1.05, 0.012], position: [0, 2.145, -0.192], color: '#b9afa2', part: 'upper-door-seam', materialRole: 'door_seam' },
      { shape: 'box', size: [1.19, 0.48, 0.025], position: [0, 1.32, -0.164], color: '#503e2e', part: 'open-niche-back', materialRole: 'back_panel' },
      { shape: 'box', size: [1.19, 0.025, 0.30], position: [0, 1.08, 0], color: '#6a503b', part: 'open-niche-shelf', materialRole: 'shelf' },
      { shape: 'box', size: [1.19, 0.018, 0.03], position: [0, 1.55, -0.185], color: '#d7a461', metalness: 0.05, roughness: 0.35, part: 'niche-light', materialRole: 'hardware' },
      { shape: 'box', size: [0.025, 2.58, 0.35], position: [-0.6625, 1.35, 0], color: '#e5dfd4', part: 'end-panel-left', materialRole: 'end_panel' },
      { shape: 'box', size: [0.025, 2.58, 0.35], position: [0.6625, 1.35, 0], color: '#e5dfd4', part: 'end-panel-right', materialRole: 'end_panel' },
    ],
  },
  {
    // 西墙电视区：挂墙电视 + 带细腿低柜；不做木饰面/背板电视墙。
    type: 'tv_wall_low',
    parts: [
      { shape: 'box', size: [2.1, 0.32, 0.40], position: [0, 0.31, 0], color: '#503e2e', part: 'carcass', materialRole: 'cabinet_body' },
      { shape: 'box', size: [2.04, 0.25, 0.018], position: [0, 0.31, -0.206], color: '#634a36', part: 'door-front-base', materialRole: 'door_front' },
      { shape: 'box', size: [0.012, 0.25, 0.012], position: [-0.35, 0.31, -0.218], color: '#382b22', part: 'door-seam-left', materialRole: 'door_seam' },
      { shape: 'box', size: [0.012, 0.25, 0.012], position: [0.35, 0.31, -0.218], color: '#382b22', part: 'door-seam-right', materialRole: 'door_seam' },
      { shape: 'box', size: [0.012, 0.27, 0.38], position: [-1.044, 0.31, 0], color: '#634a36', part: 'end-panel-left', materialRole: 'end_panel' },
      { shape: 'box', size: [0.012, 0.27, 0.38], position: [1.044, 0.31, 0], color: '#634a36', part: 'end-panel-right', materialRole: 'end_panel' },
      { shape: 'box', size: [2.10, 0.035, 0.43], position: [0, 0.4875, 0], color: '#654b37', part: 'countertop', materialRole: 'countertop' },
      { shape: 'box', size: [1.96, 0.02, 0.28], position: [0, 0.08, 0.02], color: '#382b22', part: 'lower-rail', materialRole: 'cabinet_support' },
      { shape: 'box', size: [0.08, 0.018, 0.012], position: [-0.72, 0.34, -0.222], color: '#9a7958', metalness: 0.6, roughness: 0.35, part: 'handle-left', materialRole: 'hardware' },
      { shape: 'box', size: [0.08, 0.018, 0.012], position: [0, 0.34, -0.222], color: '#9a7958', metalness: 0.6, roughness: 0.35, part: 'handle-center', materialRole: 'hardware' },
      { shape: 'box', size: [0.08, 0.018, 0.012], position: [0.72, 0.34, -0.222], color: '#9a7958', metalness: 0.6, roughness: 0.35, part: 'handle-right', materialRole: 'hardware' },
      { shape: 'cylinder', size: [0.018, 0.15, 0.018], position: [-0.92, 0.075, -0.16], color: '#2f2822', metalness: 0.35, roughness: 0.5, part: 'leg-front-left', materialRole: 'cabinet_foot' },
      { shape: 'cylinder', size: [0.018, 0.15, 0.018], position: [0.92, 0.075, -0.16], color: '#2f2822', metalness: 0.35, roughness: 0.5, part: 'leg-front-right', materialRole: 'cabinet_foot' },
      { shape: 'cylinder', size: [0.018, 0.15, 0.018], position: [-0.92, 0.075, 0.16], color: '#2f2822', metalness: 0.35, roughness: 0.5, part: 'leg-back-left', materialRole: 'cabinet_foot' },
      { shape: 'cylinder', size: [0.018, 0.15, 0.018], position: [0.92, 0.075, 0.16], color: '#2f2822', metalness: 0.35, roughness: 0.5, part: 'leg-back-right', materialRole: 'cabinet_foot' },
      { shape: 'cylinder', size: [0.018, 0.15, 0.018], position: [0, 0.075, 0.16], color: '#2f2822', metalness: 0.35, roughness: 0.5, part: 'leg-back-center', materialRole: 'cabinet_foot' },
    ],
  },
  {
    // 65 寸挂墙电视。独立于低柜和收纳柜，明确表达“无电视背景墙”方案。
    type: 'tv_65',
    parts: [
      { shape: 'box', size: [1.45, 0.84, 0.07], position: [0, 1.52, 0], color: '#141414', metalness: 0.15, roughness: 0.25, part: 'frame', materialRole: 'tv_frame' },
      { shape: 'box', size: [1.37, 0.77, 0.012], position: [0, 1.52, -0.041], color: '#202b32', metalness: 0.05, roughness: 0.18, part: 'screen', materialRole: 'tv_screen' },
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
      { shape: 'box', size: [1.38, 0.08, 0.28], position: [0, 0.14, 0], color: '#503e2e', part: 'plinth', materialRole: 'plinth' },
      { shape: 'box', size: [1.5, 0.75, 0.35], position: [0, 0.525, 0], color: '#f2ede2', part: 'lower-carcass', materialRole: 'cabinet_body' },
      { shape: 'box', size: [0.72, 0.62, 0.018], position: [-0.375, 0.53, 0.15], color: '#e5dfd4', part: 'lower-door-left', materialRole: 'door_front' },
      { shape: 'box', size: [0.72, 0.62, 0.018], position: [0.375, 0.53, 0.15], color: '#e5dfd4', part: 'lower-door-right', materialRole: 'door_front' },
      { shape: 'box', size: [0.012, 0.64, 0.012], position: [0, 0.53, 0.161], color: '#b9afa2', part: 'lower-door-seam', materialRole: 'door_seam' },
      { shape: 'box', size: [1.5, 0.5, 0.03], position: [0, 1.15, -0.16], color: '#503e2e', part: 'open-niche-back', materialRole: 'back_panel' },
      { shape: 'box', size: [1.42, 0.025, 0.28], position: [0, 0.90, 0], color: '#6a503b', part: 'open-niche-shelf', materialRole: 'shelf' },
      { shape: 'box', size: [1.5, 1.0, 0.35], position: [0, 1.9, 0], color: '#f2ede2', part: 'upper-carcass', materialRole: 'cabinet_body' },
      { shape: 'box', size: [0.72, 0.86, 0.018], position: [-0.375, 1.9, 0.15], color: '#e5dfd4', part: 'upper-door-left', materialRole: 'door_front' },
      { shape: 'box', size: [0.72, 0.86, 0.018], position: [0.375, 1.9, 0.15], color: '#e5dfd4', part: 'upper-door-right', materialRole: 'door_front' },
      { shape: 'box', size: [0.012, 0.88, 0.012], position: [0, 1.9, 0.161], color: '#b9afa2', part: 'upper-door-seam', materialRole: 'door_seam' },
      { shape: 'box', size: [0.025, 1.82, 0.35], position: [-0.7375, 1.08, 0], color: '#e5dfd4', part: 'end-panel-left', materialRole: 'end_panel' },
      { shape: 'box', size: [0.025, 1.82, 0.35], position: [0.7375, 1.08, 0], color: '#e5dfd4', part: 'end-panel-right', materialRole: 'end_panel' },
      { shape: 'box', size: [0.08, 0.018, 0.012], position: [-0.62, 0.72, 0.15], color: '#9a7958', metalness: 0.6, roughness: 0.35, part: 'lower-handle-left', materialRole: 'hardware' },
      { shape: 'box', size: [0.08, 0.018, 0.012], position: [0.62, 0.72, 0.15], color: '#9a7958', metalness: 0.6, roughness: 0.35, part: 'lower-handle-right', materialRole: 'hardware' },
    ],
  },
  {
    // 入户花园可移动换鞋站：三门矮鞋柜（柜脚抬高 + 门板缝 + 暗拉手）+ 自立浅色洞洞板（孔阵），不依赖墙体固定。
    type: 'garden_entry_station',
    parts: [
      { shape: 'box', size: [0.05, 0.08, 0.05], position: [-0.48, 0.04, 0.12], color: '#503e2e', part: 'foot-front-left', materialRole: 'cabinet_foot' },
      { shape: 'box', size: [0.05, 0.08, 0.05], position: [0.48, 0.04, 0.12], color: '#503e2e', part: 'foot-front-right', materialRole: 'cabinet_foot' },
      { shape: 'box', size: [0.05, 0.08, 0.05], position: [-0.48, 0.04, -0.12], color: '#503e2e', part: 'foot-back-left', materialRole: 'cabinet_foot' },
      { shape: 'box', size: [0.05, 0.08, 0.05], position: [0.48, 0.04, -0.12], color: '#503e2e', part: 'foot-back-right', materialRole: 'cabinet_foot' },
      { shape: 'box', size: [1.1, 0.72, 0.34], position: [0, 0.44, 0], color: '#d9c5a5', part: 'carcass', materialRole: 'cabinet_body' },
      { shape: 'box', size: [0.348, 0.64, 0.018], position: [-0.36, 0.45, 0.172], color: '#e2d2b6', part: 'door-panel-left', materialRole: 'door_front' },
      { shape: 'box', size: [0.348, 0.64, 0.018], position: [0, 0.45, 0.172], color: '#e2d2b6', part: 'door-panel-center', materialRole: 'door_front' },
      { shape: 'box', size: [0.348, 0.64, 0.018], position: [0.36, 0.45, 0.172], color: '#e2d2b6', part: 'door-panel-right', materialRole: 'door_front' },
      { shape: 'box', size: [0.012, 0.64, 0.012], position: [-0.18, 0.45, 0.185], color: '#b29b7b', part: 'door-seam-left', materialRole: 'door_seam' },
      { shape: 'box', size: [0.012, 0.64, 0.012], position: [0.18, 0.45, 0.185], color: '#b29b7b', part: 'door-seam-right', materialRole: 'door_seam' },
      { shape: 'box', size: [0.09, 0.02, 0.015], position: [-0.36, 0.72, 0.185], color: '#503e2e', part: 'handle-left', materialRole: 'hardware' },
      { shape: 'box', size: [0.09, 0.02, 0.015], position: [0, 0.72, 0.185], color: '#503e2e', part: 'handle-center', materialRole: 'hardware' },
      { shape: 'box', size: [0.09, 0.02, 0.015], position: [0.36, 0.72, 0.185], color: '#503e2e', part: 'handle-right', materialRole: 'hardware' },
      { shape: 'box', size: [1.16, 0.04, 0.38], position: [0, 0.82, 0], color: '#503e2e', part: 'countertop', materialRole: 'countertop' },
      { shape: 'box', size: [1.04, 0.025, 0.28], position: [0, 0.16, -0.02], color: '#8d6e4e', part: 'lower-shelf', materialRole: 'shelf' },
      { shape: 'box', size: [1.1, 1.0, 0.025], position: [0, 1.34, -0.155], color: '#e8e2d6', roughness: 0.75, part: 'pegboard-back', materialRole: 'back_panel' },
      ...pegboardHoles(-0.138),
      { shape: 'box', size: [0.05, 1.85, 0.05], position: [-0.5, 0.925, -0.155], color: '#292725', metalness: 0.55, roughness: 0.45, part: 'frame-left', materialRole: 'end_panel' },
      { shape: 'box', size: [0.05, 1.85, 0.05], position: [0.5, 0.925, -0.155], color: '#292725', metalness: 0.55, roughness: 0.45, part: 'frame-right', materialRole: 'end_panel' },
    ],
  },
  {
    // 门内右手的定制半高柜：向客厅延伸，玄关侧封闭、餐厅侧开放，柜顶以上保持视线通透。
    type: 'entry_half_height_cabinet',
    parts: [
      { shape: 'box', size: [1.84, 0.08, 0.28], position: [0, 0.04, 0], color: '#503e2e', part: 'plinth', materialRole: 'plinth' },
      { shape: 'box', size: [2.0, 0.88, 0.35], position: [0, 0.44, 0], color: '#f2ede2', part: 'lower-carcass', materialRole: 'cabinet_body' },
      { shape: 'box', size: [0.86, 0.72, 0.018], position: [-0.46, 0.46, 0.181], color: '#e5dfd4', part: 'lower-door-left', materialRole: 'door_front' },
      { shape: 'box', size: [0.86, 0.72, 0.018], position: [0.46, 0.46, 0.181], color: '#e5dfd4', part: 'lower-door-right', materialRole: 'door_front' },
      { shape: 'box', size: [0.012, 0.74, 0.012], position: [0, 0.46, 0.192], color: '#b9afa2', part: 'lower-door-seam', materialRole: 'door_seam' },
      { shape: 'box', size: [2.04, 0.04, 0.39], position: [0, 0.90, 0], color: '#503e2e', part: 'countertop', materialRole: 'countertop' },
      { shape: 'box', size: [0.08, 0.56, 0.35], position: [-0.96, 1.18, 0], color: '#f2ede2', part: 'open-end-left', materialRole: 'end_panel' },
      { shape: 'box', size: [0.08, 0.56, 0.35], position: [0.96, 1.18, 0], color: '#f2ede2', part: 'open-end-right', materialRole: 'end_panel' },
      { shape: 'box', size: [1.76, 0.08, 0.35], position: [0, 1.46, 0], color: '#f2ede2', part: 'open-top-rail', materialRole: 'end_panel' },
      { shape: 'box', size: [1.76, 0.50, 0.025], position: [0, 1.18, 0.162], color: '#503e2e', part: 'open-back', materialRole: 'back_panel' },
      { shape: 'box', size: [1.76, 0.04, 0.31], position: [0, 1.00, 0.0], color: '#503e2e', part: 'open-shelf', materialRole: 'shelf' },
      { shape: 'box', size: [1.76, 0.50, 0.02], position: [0, 1.18, 0.186], color: '#f2ede2', part: 'open-front-lip', materialRole: 'door_front' },
      { shape: 'box', size: [0.08, 0.018, 0.012], position: [-0.46, 0.70, 0.18], color: '#9a7958', metalness: 0.6, roughness: 0.35, part: 'handle-left', materialRole: 'hardware' },
      { shape: 'box', size: [0.08, 0.018, 0.012], position: [0.46, 0.70, 0.18], color: '#9a7958', metalness: 0.6, roughness: 0.35, part: 'handle-right', materialRole: 'hardware' },
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
      { shape: 'box', size: [0.40, 0.10, 0.40], position: [0, 0.05, 0], color: '#ffffff', roughness: 0.3, part: 'toilet-base', materialRole: 'ceramic' },
      { shape: 'box', size: [0.35, 0.40, 0.35], position: [0, 0.30, 0.05], color: '#ffffff', roughness: 0.3, part: 'toilet-bowl', materialRole: 'ceramic' },
      { shape: 'box', size: [0.40, 0.50, 0.15], position: [0, 0.35, -0.25], color: '#f0f0f0', roughness: 0.3, part: 'toilet-tank', materialRole: 'ceramic' },
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
  // ── Training area: freestanding, modular low-poly fixtures ──
  {
    type: 'squat_rack',
    parts: [
      { shape: 'box', size: [0.10, 2.25, 0.10], position: [-0.54, 1.125, -0.38], color: '#25282b', metalness: 0.75, roughness: 0.3, part: 'upright-left', materialRole: 'frame' },
      { shape: 'box', size: [0.10, 2.25, 0.10], position: [0.54, 1.125, -0.38], color: '#25282b', metalness: 0.75, roughness: 0.3, part: 'upright-right', materialRole: 'frame' },
      { shape: 'box', size: [1.18, 0.10, 0.95], position: [0, 0.05, 0], color: '#25282b', metalness: 0.75, roughness: 0.3, part: 'base', materialRole: 'frame' },
      { shape: 'box', size: [1.08, 0.08, 0.08], position: [0, 2.18, -0.38], color: '#25282b', metalness: 0.75, roughness: 0.3, part: 'top-crossbar', materialRole: 'frame' },
      // Safety arms sit on the left/right uprights and project forward from the rack.
      // The reversed local +Z front maps to world +X with house.yaml rotation=90;
      // they are not a crossbar between the uprights.
      { shape: 'box', size: [0.07, 0.07, 0.98], position: [-0.54, 0.82, 0.11], color: '#d05a35', metalness: 0.5, roughness: 0.35, part: 'safety-bar-lower', materialRole: 'safety_bar' },
      { shape: 'box', size: [0.07, 0.07, 0.98], position: [0.54, 0.98, 0.11], color: '#d05a35', metalness: 0.5, roughness: 0.35, part: 'safety-bar-upper', materialRole: 'safety_bar' },
      // Visible plates are stored on side pegs, not as a separate floor pile.
      { shape: 'cylinder', size: [0.21, 0.035, 0.21], position: [-0.64, 0.52, -0.38], rotation: [0, 0, Math.PI / 2], color: '#1f2326', metalness: 0.35, roughness: 0.65, part: 'rack-plate-left-large', materialRole: 'weight_plate' },
      { shape: 'cylinder', size: [0.16, 0.04, 0.16], position: [-0.69, 0.52, -0.38], rotation: [0, 0, Math.PI / 2], color: '#343a40', metalness: 0.35, roughness: 0.65, part: 'rack-plate-left-medium', materialRole: 'weight_plate' },
      { shape: 'cylinder', size: [0.10, 0.045, 0.10], position: [-0.735, 0.52, -0.38], rotation: [0, 0, Math.PI / 2], color: '#d05a35', metalness: 0.2, roughness: 0.7, part: 'rack-plate-left-small', materialRole: 'weight_plate' },
      { shape: 'cylinder', size: [0.21, 0.035, 0.21], position: [0.64, 0.52, -0.38], rotation: [0, 0, Math.PI / 2], color: '#1f2326', metalness: 0.35, roughness: 0.65, part: 'rack-plate-right-large', materialRole: 'weight_plate' },
      { shape: 'cylinder', size: [0.16, 0.04, 0.16], position: [0.69, 0.52, -0.38], rotation: [0, 0, Math.PI / 2], color: '#343a40', metalness: 0.35, roughness: 0.65, part: 'rack-plate-right-medium', materialRole: 'weight_plate' },
      { shape: 'cylinder', size: [0.10, 0.045, 0.10], position: [0.735, 0.52, -0.38], rotation: [0, 0, Math.PI / 2], color: '#d05a35', metalness: 0.2, roughness: 0.7, part: 'rack-plate-right-small', materialRole: 'weight_plate' },
    ],
  },
  {
    type: 'barbell_olympic',
    parts: [
      { shape: 'cylinder', size: [0.025, 2.20, 0.025], position: [0, 0.12, 0], rotation: [0, 0, Math.PI / 2], color: '#9ba1a6', metalness: 0.85, roughness: 0.25, part: 'bar-shaft', materialRole: 'hardware' },
      { shape: 'cylinder', size: [0.055, 0.16, 0.055], position: [-0.78, 0.12, 0], rotation: [0, 0, Math.PI / 2], color: '#3b3f43', metalness: 0.7, roughness: 0.3, part: 'sleeve-left', materialRole: 'hardware' },
      { shape: 'cylinder', size: [0.055, 0.16, 0.055], position: [0.78, 0.12, 0], rotation: [0, 0, Math.PI / 2], color: '#3b3f43', metalness: 0.7, roughness: 0.3, part: 'sleeve-right', materialRole: 'hardware' },
      { shape: 'box', size: [0.04, 0.05, 0.04], position: [-0.48, 0.12, 0], color: '#d05a35', roughness: 0.45, part: 'knurl-mark-left', materialRole: 'hardware' },
      { shape: 'box', size: [0.04, 0.05, 0.04], position: [0.48, 0.12, 0], color: '#d05a35', roughness: 0.45, part: 'knurl-mark-right', materialRole: 'hardware' },
    ],
  },
  {
    type: 'weight_plate_set',
    parts: [
      { shape: 'cylinder', size: [0.21, 0.035, 0.21], position: [-0.13, 0.035, 0], color: '#1f2326', metalness: 0.35, roughness: 0.65, part: 'plate-large', materialRole: 'weight_plate' },
      { shape: 'cylinder', size: [0.16, 0.04, 0.16], position: [0.13, 0.04, 0], color: '#343a40', metalness: 0.35, roughness: 0.65, part: 'plate-medium', materialRole: 'weight_plate' },
      { shape: 'cylinder', size: [0.10, 0.045, 0.10], position: [0, 0.082, 0], color: '#d05a35', metalness: 0.2, roughness: 0.7, part: 'plate-small', materialRole: 'weight_plate' },
    ],
  },
  {
    type: 'bench_adjustable',
    parts: [
      { shape: 'box', size: [0.72, 0.12, 0.46], position: [0.26, 0.58, 0], color: '#33383d', roughness: 0.75, part: 'back-pad', materialRole: 'upholstery' },
      { shape: 'box', size: [0.52, 0.12, 0.46], position: [-0.36, 0.48, 0], color: '#33383d', roughness: 0.75, part: 'seat-pad', materialRole: 'upholstery' },
      { shape: 'box', size: [0.44, 0.08, 0.08], position: [0.28, 0.22, 0], color: '#25282b', metalness: 0.7, roughness: 0.35, part: 'back-support', materialRole: 'frame' },
      { shape: 'box', size: [0.42, 0.08, 0.08], position: [-0.36, 0.21, 0], color: '#25282b', metalness: 0.7, roughness: 0.35, part: 'seat-support', materialRole: 'frame' },
      { shape: 'box', size: [0.48, 0.06, 0.55], position: [0.28, 0.04, 0], color: '#25282b', metalness: 0.7, roughness: 0.35, part: 'rear-foot', materialRole: 'frame' },
      { shape: 'box', size: [0.42, 0.06, 0.55], position: [-0.36, 0.04, 0], color: '#25282b', metalness: 0.7, roughness: 0.35, part: 'front-foot', materialRole: 'frame' },
      { shape: 'box', size: [0.10, 0.28, 0.10], position: [0.28, 0.18, 0], color: '#25282b', metalness: 0.7, roughness: 0.35, part: 'rear-leg', materialRole: 'frame' },
      { shape: 'box', size: [0.10, 0.28, 0.10], position: [-0.36, 0.18, 0], color: '#25282b', metalness: 0.7, roughness: 0.35, part: 'front-leg', materialRole: 'frame' },
      { shape: 'box', size: [0.56, 0.06, 0.10], position: [0.28, 0.08, 0], color: '#25282b', metalness: 0.7, roughness: 0.35, part: 'rear-base', materialRole: 'frame' },
      { shape: 'box', size: [0.50, 0.06, 0.10], position: [-0.36, 0.08, 0], color: '#25282b', metalness: 0.7, roughness: 0.35, part: 'front-base', materialRole: 'frame' },
    ],
  },
  {
    type: 'rubber_training_mat',
    parts: [
      { shape: 'box', size: [1.80, 0.035, 1.60], position: [0, 0.0175, 0], color: '#292b2e', roughness: 0.92, part: 'rubber-surface', materialRole: 'floor_protection' },
      { shape: 'box', size: [1.72, 0.012, 1.52], position: [0, 0.041, 0], color: '#3a3d40', roughness: 0.95, part: 'inner-texture', materialRole: 'floor_protection' },
    ],
  },
  {
    type: 'low_weight_storage',
    parts: [
      { shape: 'box', size: [0.95, 0.08, 0.42], position: [0, 0.04, 0], color: '#25282b', metalness: 0.65, roughness: 0.4, part: 'base', materialRole: 'frame' },
      { shape: 'box', size: [0.08, 0.62, 0.08], position: [-0.40, 0.35, 0], color: '#25282b', metalness: 0.65, roughness: 0.4, part: 'upright-left', materialRole: 'frame' },
      { shape: 'box', size: [0.08, 0.62, 0.08], position: [0.40, 0.35, 0], color: '#25282b', metalness: 0.65, roughness: 0.4, part: 'upright-right', materialRole: 'frame' },
      { shape: 'box', size: [0.86, 0.06, 0.34], position: [0, 0.28, 0], color: '#383d42', metalness: 0.45, roughness: 0.55, part: 'lower-tray', materialRole: 'shelf' },
      { shape: 'box', size: [0.86, 0.06, 0.34], position: [0, 0.64, 0], color: '#383d42', metalness: 0.45, roughness: 0.55, part: 'upper-tray', materialRole: 'shelf' },
      { shape: 'cylinder', size: [0.025, 0.38, 0.025], position: [0, 0.78, 0], rotation: [0, 0, Math.PI / 2], color: '#9ba1a6', metalness: 0.8, roughness: 0.3, part: 'storage-rod', materialRole: 'hardware' },
    ],
  },
  {
    // 普通书房低矮收纳柜：1.20×0.40×0.80m，局部 -X 为正面/柜门；沿东墙南北向摆放时 rotation=0°，柜门朝西、背面朝东。
    // 浅木色封闭柜体，含双抽屉、双柜门、台面和踢脚，独立落地，不承载训练器材。
    type: 'low_room_cabinet',
    parts: [
      { shape: 'box', size: [0.36, 0.08, 1.16], position: [0, 0.04, 0], color: '#72583f', part: 'plinth', materialRole: 'plinth' },
      { shape: 'box', size: [0.36, 0.68, 1.16], position: [0, 0.42, 0], color: '#c9aa7d', roughness: 0.55, part: 'carcass', materialRole: 'cabinet_body' },
      { shape: 'box', size: [0.40, 0.04, 1.20], position: [0, 0.78, 0], color: '#a98258', roughness: 0.4, part: 'countertop', materialRole: 'countertop' },
      { shape: 'box', size: [0.018, 0.14, 0.56], position: [-0.186, 0.68, -0.29], color: '#d8bd91', roughness: 0.5, part: 'drawer-front-left', materialRole: 'drawer_front' },
      { shape: 'box', size: [0.018, 0.14, 0.56], position: [-0.186, 0.68, 0.29], color: '#d8bd91', roughness: 0.5, part: 'drawer-front-right', materialRole: 'drawer_front' },
      { shape: 'box', size: [0.018, 0.44, 0.56], position: [-0.186, 0.38, -0.29], color: '#d8bd91', roughness: 0.5, part: 'door-panel-left', materialRole: 'door_front' },
      { shape: 'box', size: [0.018, 0.44, 0.56], position: [-0.186, 0.38, 0.29], color: '#d8bd91', roughness: 0.5, part: 'door-panel-right', materialRole: 'door_front' },
      { shape: 'box', size: [0.012, 0.012, 0.02], position: [-0.198, 0.68, 0], color: '#8f704e', part: 'drawer-seam', materialRole: 'door_seam' },
      { shape: 'box', size: [0.012, 0.012, 0.02], position: [-0.198, 0.38, 0], color: '#8f704e', part: 'door-seam', materialRole: 'door_seam' },
      { shape: 'box', size: [0.008, 0.07, 0.012], position: [-0.201, 0.68, -0.29], color: '#6a5540', metalness: 0.35, roughness: 0.4, part: 'drawer-handle-left', materialRole: 'hardware' },
      { shape: 'box', size: [0.008, 0.07, 0.012], position: [-0.201, 0.68, 0.29], color: '#6a5540', metalness: 0.35, roughness: 0.4, part: 'drawer-handle-right', materialRole: 'hardware' },
      { shape: 'box', size: [0.008, 0.07, 0.012], position: [-0.201, 0.38, -0.29], color: '#6a5540', metalness: 0.35, roughness: 0.4, part: 'door-handle-left', materialRole: 'hardware' },
      { shape: 'box', size: [0.008, 0.07, 0.012], position: [-0.201, 0.38, 0.29], color: '#6a5540', metalness: 0.35, roughness: 0.35, part: 'door-handle-right', materialRole: 'hardware' },
    ],
  },
];

function addPart(
  group: THREE.Group,
  fixtureType: string,
  index: number,
  part: FixturePart,
  surface?: string,
): THREE.Mesh {
  const geo = part.shape === 'cylinder'
    ? new THREE.CylinderGeometry(part.size[0], part.size[0], part.size[1], 12)
    : new THREE.BoxGeometry(...part.size);
  const materialRole = part.materialRole ?? (surface ?? 'body');
  const isOverlaySurface = materialRole === 'door_front'
    || materialRole === 'drawer_front'
    || materialRole === 'door_seam'
    || materialRole === 'hardware';
  const mat = new THREE.MeshStandardMaterial({
    color: part.color,
    metalness: part.metalness ?? 0.1,
    roughness: part.roughness ?? 0.6,
    // Cabinet fronts sit against the carcass front plane. Bias only the
    // decorative overlay surfaces toward the camera to prevent z-fighting.
    polygonOffset: isOverlaySurface,
    polygonOffsetFactor: isOverlaySurface ? -1 : 0,
    polygonOffsetUnits: isOverlaySurface ? -1 : 0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  if (part.position) mesh.position.set(...part.position);
  if (part.rotation) {
    mesh.rotation.x = part.rotation[0];
    mesh.rotation.y = part.rotation[1];
    mesh.rotation.z = part.rotation[2];
  }
  const partId = part.part ?? part.name ?? `part-${index}`;
  const baseName = part.name ?? `${fixtureType}:part:${index}`;
  // Keep legacy recipe names unchanged unless the part carries stable metadata;
  // tagged fixture parts remain discoverable after userData is stripped.
  mesh.name = part.part || part.name || part.materialRole || surface
    ? `${baseName}:part=${partId}:role=${materialRole}`
    : baseName;
  mesh.userData.part = partId;
  mesh.userData.materialRole = materialRole;
  if (surface) mesh.userData.surface = surface;
  group.add(mesh);
  return mesh;
}

function addBox(group: THREE.Group, fixtureType: string, index: number, size: [number, number, number], position: [number, number, number], color: string, options: Partial<FixturePart> = {}, surface?: string): THREE.Mesh {
  return addPart(group, fixtureType, index, { shape: 'box', size, position, color, ...options }, surface);
}

export function buildFixture(type: string): THREE.Group | null {
  const recipe = FIXTURE_RECIPES.find((r) => r.type === type);
  if (!recipe) return null;
  const group = new THREE.Group();
  recipe.parts.forEach((part, index) => addPart(group, type, index, part));
  return group;
}

/** 定制 1.8m 衣柜：保持 1.8×0.6 外轮廓，补足门板、踢脚、顶封板与内部层板。 */
export function buildWardrobe180(totalHeight = 2.5): THREE.Group {
  const filler = 0.1;
  const bodyHeight = totalHeight - filler;
  const group = new THREE.Group();
  let i = 0;
  addBox(group, 'wardrobe_180', i++, [1.8, bodyHeight, 0.6], [0, bodyHeight / 2, 0], '#8B7355', { part: 'carcass', materialRole: 'cabinet_body' });
  addBox(group, 'wardrobe_180', i++, [1.8, filler, 0.6], [0, bodyHeight + filler / 2, 0], '#8B7355', { part: 'top-filler', materialRole: 'top_filler' });
  // Default front is -z; the northwest bedroom wardrobe faces north into the room.
  addBox(group, 'wardrobe_180', i++, [1.72, 0.08, 0.02], [0, 0.04, -0.29], '#604b38', { part: 'plinth', materialRole: 'plinth' });
  for (const [index, x] of [-0.6, 0, 0.6].entries()) {
    addBox(group, 'wardrobe_180', i++, [0.586, bodyHeight - 0.14, 0.018], [x, (bodyHeight + 0.08) / 2, -0.291], '#967b5a', { part: `door-panel-${index + 1}`, materialRole: 'door_front' });
  }
  addBox(group, 'wardrobe_180', i++, [0.012, bodyHeight - 0.16, 0.012], [0, (bodyHeight + 0.08) / 2, -0.294], '#604b38', { part: 'door-seam-center', materialRole: 'door_seam' });
  addBox(group, 'wardrobe_180', i++, [1.68, 0.025, 0.52], [0, 1.05, 0], '#a48763', { part: 'interior-shelf', materialRole: 'shelf' });
  addPart(group, 'wardrobe_180', i++, { shape: 'cylinder', size: [0.018, 0.5, 0.018], position: [0, Math.min(bodyHeight - 0.18, 1.75), 0], rotation: [0, 0, Math.PI / 2], color: '#504b46', metalness: 0.7, roughness: 0.35, part: 'hanging-rod', materialRole: 'hardware' });
  return group;
}

/** 主卧 2.4m 分体衣柜：0.8m 矮柜 + 1.6m 高柜，保持 2.4×0.8 外轮廓。 */
export function buildWardrobeSplit(): THREE.Group {
  const group = new THREE.Group();
  let i = 0;
  addBox(group, 'wardrobe_240_split', i++, [0.8, 1.1, 0.8], [-0.8, 0.55, 0], '#7d6647', { part: 'low-carcass', materialRole: 'cabinet_body' });
  addBox(group, 'wardrobe_240_split', i++, [1.6, 2.7, 0.6], [0.4, 1.35, -0.1], '#8B7355', { part: 'tall-carcass', materialRole: 'cabinet_body' });
  addBox(group, 'wardrobe_240_split', i++, [0.76, 0.06, 0.018], [-0.8, 1.07, 0.391], '#a48763', { part: 'low-top-panel', materialRole: 'top_filler' });
  addBox(group, 'wardrobe_240_split', i++, [0.78, 0.82, 0.018], [-0.8, 0.54, 0.391], '#967b5a', { part: 'low-door-panel', materialRole: 'door_front' });
  for (const [index, x] of [0, 0.8].entries()) {
    addBox(group, 'wardrobe_240_split', i++, [0.786, 2.5, 0.018], [x, 1.35, 0.201], '#967b5a', { part: `tall-door-panel-${index + 1}`, materialRole: 'door_front' });
  }
  addBox(group, 'wardrobe_240_split', i++, [0.012, 2.5, 0.012], [0, 1.35, 0.192], '#604b38', { part: 'tall-door-seam', materialRole: 'door_seam' });
  addBox(group, 'wardrobe_240_split', i++, [0.72, 0.025, 0.72], [-0.8, 0.7, 0], '#a48763', { part: 'low-interior-shelf', materialRole: 'shelf' });
  addBox(group, 'wardrobe_240_split', i++, [1.48, 0.025, 0.52], [0.4, 1.02, -0.1], '#a48763', { part: 'tall-interior-shelf', materialRole: 'shelf' });
  addPart(group, 'wardrobe_240_split', i++, { shape: 'cylinder', size: [0.018, 1.45, 0.018], position: [0.4, 1.85, -0.1], color: '#504b46', metalness: 0.7, roughness: 0.35, part: 'tall-hanging-rod', materialRole: 'hardware' });
  return group;
}

/** Builds a configurable continuous bathroom-side tall-cabinet run. */
export function buildBathSideCabinetRun(spec: BathSideCabinetRunSpec): THREE.Group {
  const cabinetHeight = spec.cabinetHeight ?? 2.0;
  const group = new THREE.Group();
  let i = 0;
  addBox(group, 'bath_side_cabinet', i++, [spec.length, cabinetHeight, spec.depth], [0, cabinetHeight / 2, 0], '#e8e4dc', { part: 'carcass', materialRole: 'cabinet_body' });
  addBox(group, 'bath_side_cabinet', i++, [Math.max(0.1, spec.length - 0.04), 0.08, Math.max(0.1, spec.depth - 0.04)], [0, 0.04, 0], '#c9c0b2', { part: 'plinth', materialRole: 'plinth' });
  addBox(group, 'bath_side_cabinet', i++, [0.012, cabinetHeight - 0.08, spec.depth], [-spec.length / 2 + 0.006, cabinetHeight / 2, 0], '#ded8cc', { part: 'end-panel-left', materialRole: 'end_panel' });
  addBox(group, 'bath_side_cabinet', i++, [0.012, cabinetHeight - 0.08, spec.depth], [spec.length / 2 - 0.006, cabinetHeight / 2, 0], '#ded8cc', { part: 'end-panel-right', materialRole: 'end_panel' });

  const panelCount = Math.max(2, Math.ceil(spec.length / 0.6));
  const panelWidth = spec.length / panelCount;
  for (let panel = 0; panel < panelCount; panel++) {
    const x = -spec.length / 2 + panelWidth * (panel + 0.5);
    addBox(group, 'bath_side_cabinet', i++, [Math.max(0.05, panelWidth - 0.018), cabinetHeight - 0.18, 0.02], [x, cabinetHeight / 2, spec.depth / 2 + 0.01], '#ded8cc', { part: `door-panel-${panel + 1}`, materialRole: 'door_front' });
    if (panel < panelCount - 1) {
      addBox(group, 'bath_side_cabinet', i++, [0.012, cabinetHeight - 0.18, 0.012], [x + panelWidth / 2, cabinetHeight / 2, spec.depth / 2 + 0.022], '#b8afa2', { part: `door-seam-${panel + 1}`, materialRole: 'door_seam' });
    }
    addBox(group, 'bath_side_cabinet', i++, [0.07, 0.012, 0.006], [x, cabinetHeight * 0.56, spec.depth / 2 + 0.017], '#756957', { part: `handle-${panel + 1}`, materialRole: 'hardware' });
  }
  addBox(group, 'bath_side_cabinet', i++, [Math.max(0.1, spec.length - 0.10), 0.025, Math.max(0.1, spec.depth - 0.04)], [0, cabinetHeight * 0.52, -0.01], '#c7b49a', { part: 'interior-shelf', materialRole: 'shelf' });
  return group;
}

/** Builds an explicit countertop-only bridge; it never creates cabinet geometry. */
export function buildKitchenCountertopBridge(spec: { length: number; depth: number; countertopThickness: number }): THREE.Group {
  const group = new THREE.Group();
  addBox(group, 'kitchen_countertop_bridge', 0, [spec.length, spec.countertopThickness, spec.depth], [0, 0.86 + spec.countertopThickness / 2, 0], '#e8e6e0', {
    part: 'countertop-bridge',
    materialRole: 'countertop',
  }, 'countertop');
  return group;
}

/** Builds a configurable straight run; L-shaped kitchens declare one run per wall. */
export function buildKitchenCabinetRun(spec: KitchenCabinetRunSpec): THREE.Group {
  const cabinetHeight = spec.cabinetHeight ?? 0.86;
  const countertopThickness = spec.countertopThickness ?? 0.03;
  const group = new THREE.Group();
  let i = 0;
  addBox(group, 'kitchen_cabinet_run', i++, [Math.max(0.1, spec.length - 0.08), 0.08, Math.max(0.1, spec.depth - 0.06)], [0, 0.04, 0], '#4c4237', { part: 'plinth', materialRole: 'plinth' });
  addBox(group, 'kitchen_cabinet_run', i++, [spec.length, cabinetHeight - 0.08, spec.depth], [0, (cabinetHeight + 0.08) / 2, 0], '#b79e7c', { part: 'carcass', materialRole: 'cabinet_body' });
  const countertopWidth = spec.length + 0.04;
  const countertopDepth = spec.depth + 0.04;
  const cutouts = (spec.cutouts ?? []).map((cutout) => {
    const [cx, cz] = cutout.center ?? cutout.offset ?? [0, 0];
    const [width, depth] = cutout.size;
    return { id: cutout.id, kind: cutout.kind, minX: cx - width / 2, maxX: cx + width / 2, minZ: cz - depth / 2, maxZ: cz + depth / 2 };
  }).filter((cutout) => cutout.maxX > -countertopWidth / 2 && cutout.minX < countertopWidth / 2 && cutout.maxZ > -countertopDepth / 2 && cutout.minZ < countertopDepth / 2);
  if (cutouts.length === 0) {
    addBox(group, 'kitchen_cabinet_run', i++, [countertopWidth, countertopThickness, countertopDepth], [0, cabinetHeight + countertopThickness / 2, 0], '#e8e6e0', { part: 'countertop', materialRole: 'countertop' }, 'countertop');
  } else {
    const xEdges = [...new Set([-countertopWidth / 2, countertopWidth / 2, ...cutouts.flatMap((cutout) => [Math.max(-countertopWidth / 2, cutout.minX), Math.min(countertopWidth / 2, cutout.maxX)])])].sort((a, b) => a - b);
    const zEdges = [...new Set([-countertopDepth / 2, countertopDepth / 2, ...cutouts.flatMap((cutout) => [Math.max(-countertopDepth / 2, cutout.minZ), Math.min(countertopDepth / 2, cutout.maxZ)])])].sort((a, b) => a - b);
    let piece = 0;
    for (let x = 0; x < xEdges.length - 1; x++) {
      for (let z = 0; z < zEdges.length - 1; z++) {
        const minX = xEdges[x]; const maxX = xEdges[x + 1];
        const minZ = zEdges[z]; const maxZ = zEdges[z + 1];
        const centerX = (minX + maxX) / 2; const centerZ = (minZ + maxZ) / 2;
        if (cutouts.some((cutout) => centerX > cutout.minX && centerX < cutout.maxX && centerZ > cutout.minZ && centerZ < cutout.maxZ)) continue;
        addBox(group, 'kitchen_cabinet_run', i++, [maxX - minX, countertopThickness, maxZ - minZ], [centerX, cabinetHeight + countertopThickness / 2, centerZ], '#e8e6e0', { part: `countertop-${++piece}`, materialRole: 'countertop' }, 'countertop');
      }
    }
  }
  const bayWidth = Math.min(0.6, spec.length);
  const bayCount = Math.max(1, Math.ceil(spec.length / bayWidth));
  const drawerHeight = Math.min(0.16, Math.max(0.08, cabinetHeight - 0.28));
  for (let bay = 0; bay < bayCount; bay++) {
    const width = spec.length / bayCount;
    const x = -spec.length / 2 + width * (bay + 0.5);
    const frontZ = -spec.depth / 2 - 0.006;
    if (bay === 0) {
      addBox(group, 'kitchen_cabinet_run', i++, [width - 0.018, drawerHeight, 0.012], [x, cabinetHeight - 0.08 - drawerHeight / 2, frontZ], '#b18f68', { part: 'drawer-front-1', materialRole: 'drawer_front' });
      addBox(group, 'kitchen_cabinet_run', i++, [Math.max(0.08, width - 0.018), cabinetHeight - 0.28 - drawerHeight, 0.012], [x, 0.08 + (cabinetHeight - 0.28 - drawerHeight) / 2, frontZ], '#c3a986', { part: 'door-panel-1', materialRole: 'door_front' });
      addBox(group, 'kitchen_cabinet_run', i++, [Math.min(width - 0.08, 0.28), 0.012, 0.006], [x, cabinetHeight - 0.08 - drawerHeight / 2, -spec.depth / 2 - 0.017], '#5a4a3d', { part: 'drawer-handle-1', materialRole: 'hardware' });
    } else {
      addBox(group, 'kitchen_cabinet_run', i++, [width - 0.018, cabinetHeight - 0.18, 0.012], [x, cabinetHeight / 2, frontZ], '#c3a986', { part: `door-panel-${bay + 1}`, materialRole: 'door_front' });
    }
  }
  for (let bay = 1; bay < bayCount; bay++) {
    const x = -spec.length / 2 + (spec.length / bayCount) * bay;
    addBox(group, 'kitchen_cabinet_run', i++, [0.012, cabinetHeight - 0.18, 0.012], [x, cabinetHeight / 2, -spec.depth / 2 - 0.012], '#8d775b', { part: `door-seam-${bay}`, materialRole: 'door_seam' });
  }
  addBox(group, 'kitchen_cabinet_run', i++, [0.012, cabinetHeight - 0.08, spec.depth], [-spec.length / 2 + 0.006, (cabinetHeight + 0.08) / 2, 0], '#b79e7c', { part: 'end-panel-left', materialRole: 'end_panel' });
  addBox(group, 'kitchen_cabinet_run', i++, [0.012, cabinetHeight - 0.08, spec.depth], [spec.length / 2 - 0.006, (cabinetHeight + 0.08) / 2, 0], '#b79e7c', { part: 'end-panel-right', materialRole: 'end_panel' });
  return group;
}

export function getRecipeTypes(): string[] {
  return FIXTURE_RECIPES.map((r) => r.type);
}
