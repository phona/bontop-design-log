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
  inspectionLayer?: string;
  inspectionOpacity?: number;
  inspectionVisibleOnly?: boolean;
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
    // R3：中浅胡桃细框架 + 暖米灰软包床头，床头板最高 0.80m。
    type: 'bed_180',
    parts: [
      { shape: 'box', size: [1.8, 0.12, 2.0], position: [0, 0.06, 0], color: '#9b7650', roughness: 0.55, part: 'walnut-bed-frame', materialRole: 'frame' },
      { shape: 'box', size: [1.68, 0.34, 1.86], position: [0, 0.29, 0], color: '#b9a99b', roughness: 0.9, part: 'warm-greige-mattress', materialRole: 'upholstery' },
      { shape: 'box', size: [1.8, 0.68, 0.08], position: [0, 0.46, -0.96], color: '#b9a99b', roughness: 0.9, part: 'warm-greige-headboard', materialRole: 'upholstery' },
      { shape: 'box', size: [1.86, 0.10, 1.92], position: [0, 0.13, 0], color: '#8a6545', roughness: 0.6, part: 'walnut-bed-rail', materialRole: 'frame' },
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
    // Floor lamp is a placed object in the living/dining plan. Keep a real
    // three-part fixture so spatial verification can inspect its complete
    // footprint instead of accepting a silently skipped type.
    type: 'floor_lamp',
    parts: [
      { shape: 'box', size: [0.30, 0.025, 0.30], position: [0, 0.0125, 0], color: '#4b4035', metalness: 0.45, roughness: 0.5, part: 'base', materialRole: 'fixture_metal' },
      { shape: 'box', size: [0.025, 1.38, 0.025], position: [0, 0.70, 0], color: '#6f6255', metalness: 0.65, roughness: 0.35, part: 'stem', materialRole: 'fixture_metal' },
      { shape: 'box', size: [0.26, 0.24, 0.26], position: [0, 1.48, 0], color: '#e8dfcf', roughness: 0.8, part: 'shade', materialRole: 'fixture_diffuser' },
    ],
  },
  {
    // R3 北侧床头柜：240W×300D×500H，局部 +z 为柜前；rotation=270 后朝西。
    type: 'master_bedside_cabinet_north',
    parts: [
      { shape: 'box', size: [0.24, 0.46, 0.30], position: [0, 0.27, 0], color: '#9b7650', roughness: 0.55, part: 'walnut-carcass', materialRole: 'cabinet_body' },
      { shape: 'box', size: [0.21, 0.018, 0.27], position: [0, 0.46, 0.156], color: '#a98258', roughness: 0.5, part: 'thin-drawer-front', materialRole: 'drawer_front' },
      { shape: 'box', size: [0.035, 0.018, 0.018], position: [0, 0.46, 0.172], color: '#765334', metalness: 0.75, roughness: 0.3, part: 'brushed-bronze-pull', materialRole: 'hardware' },
      { shape: 'box', size: [0.20, 0.025, 0.26], position: [0, 0.505, 0], color: '#a98258', roughness: 0.5, part: 'top-panel', materialRole: 'cabinet_body' },
      { shape: 'box', size: [0.04, 0.04, 0.04], position: [-0.08, 0.02, -0.10], color: '#765334', metalness: 0.5, roughness: 0.4, part: 'hidden-support-left', materialRole: 'cabinet_support' },
      { shape: 'box', size: [0.04, 0.04, 0.04], position: [0.08, 0.02, -0.10], color: '#765334', metalness: 0.5, roughness: 0.4, part: 'hidden-support-right', materialRole: 'cabinet_support' },
    ],
  },
  {
    // R3 南侧床架集成轻托盘：200W×260D，收起态与使用态均由床内侧表达，不向窗帘墙索取支撑。
    type: 'master_bedside_tray_south',
    parts: [
      { shape: 'box', size: [0.20, 0.025, 0.26], position: [0, 0.52, 0], color: '#a98258', roughness: 0.5, part: 'walnut-tray-surface', materialRole: 'shelf' },
      { shape: 'box', size: [0.20, 0.035, 0.018], position: [0, 0.55, 0.12], color: '#9b7650', roughness: 0.55, part: 'tray-retaining-edge', materialRole: 'frame' },
      { shape: 'box', size: [0.025, 0.42, 0.025], position: [0, 0.29, -0.09], color: '#765334', metalness: 0.75, roughness: 0.3, part: 'concealed-metal-bracket', materialRole: 'hardware' },
      { shape: 'box', size: [0.16, 0.018, 0.20], position: [0, 0.27, 0], color: '#8a6545', roughness: 0.6, part: 'fold-away-tray-leaf', materialRole: 'frame' },
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
    // 主卧修正版高柜：2.4×0.6×2.7m，局部 -z 为朝北柜门，rotation=0 时东西向摆放。
    type: 'master_wardrobe_tall_240',
    parts: [
      { shape: 'box', size: [2.4, 2.7, 0.6], position: [0, 1.35, 0], color: '#8B7355', part: 'carcass', materialRole: 'cabinet_body' },
      { shape: 'box', size: [2.34, 2.52, 0.018], position: [0, 1.35, -0.311], color: '#967b5a', part: 'door-panel', materialRole: 'door_front' },
      { shape: 'box', size: [0.012, 2.52, 0.012], position: [0, 1.35, -0.322], color: '#604b38', part: 'door-seam-center', materialRole: 'door_seam' },
      { shape: 'box', size: [2.28, 0.025, 0.52], position: [0, 1.05, 0], color: '#a48763', part: 'interior-shelf', materialRole: 'shelf' },
      { shape: 'cylinder', size: [0.018, 1.35, 0.018], position: [0, 1.85, 0], rotation: [0, 0, Math.PI / 2], color: '#504b46', metalness: 0.7, roughness: 0.35, part: 'hanging-rod', materialRole: 'hardware' },
    ],
  },
  {
    // R6：主卧北墙 600W×580D×2050H，双约 300mm 平开门，关闭态柜门朝南（局部 +z）。
    // 门板/拉手/铰链由 buildNorthWallWardrobeFixture 挂到独立 hinge pivot。
    type: 'master_north_wall_wardrobe_600',
    parts: [
      { shape: 'box', size: [0.60, 2.05, 0.58], position: [0, 1.025, 0], color: '#9b7650', roughness: 0.55, part: 'north-wardrobe-carcass', materialRole: 'cabinet_body' },
      { shape: 'box', size: [0.56, 2.05, 0.02], position: [0, 1.025, -0.28], color: '#a98258', roughness: 0.5, part: 'north-wardrobe-back-panel', materialRole: 'back_panel' },
      { shape: 'box', size: [0.54, 0.025, 0.54], position: [0, 0.04, 0], color: '#8a6545', roughness: 0.6, part: 'north-wardrobe-plinth', materialRole: 'plinth' },
      ...([-0.24, 0.24].flatMap((x) => [-0.22, 0.22].map((z, index) => ({ shape: 'box' as const, size: [0.07, 0.14, 0.07] as [number, number, number], position: [x, 0.07, z] as [number, number, number], color: '#765334', roughness: 0.6, part: `north-wardrobe-leg-${index + 1}-${x < 0 ? 'l' : 'r'}`, materialRole: 'cabinet_foot' })))),
    ],
  },
  {
    // R8：历史650 recipe保留；active恢复950 recipe（见下方），两者均为北墙一体木饰面候选。
    type: 'master_north_wall_wardrobe_650',
    parts: [
      { shape: 'box', size: [0.65, 2.45, 0.58], position: [0, 1.225, 0], color: '#9b7650', roughness: 0.55, part: 'north-wardrobe-650-carcass', materialRole: 'cabinet_body' },
      { shape: 'box', size: [0.61, 2.45, 0.02], position: [0, 1.225, -0.28], color: '#a98258', roughness: 0.5, part: 'north-wardrobe-650-back-panel', materialRole: 'back_panel' },
      { shape: 'box', size: [0.61, 0.09, 0.54], position: [0, 0.045, 0], color: '#8a6545', roughness: 0.6, part: 'north-wardrobe-650-plinth', materialRole: 'plinth' },
      { shape: 'box', size: [0.59, 0.025, 0.52], position: [0, 1.05, 0], color: '#a48763', roughness: 0.6, part: 'north-wardrobe-650-shelf', materialRole: 'shelf' },
      { shape: 'cylinder', size: [0.018, 0.57, 0.018], position: [0, 1.85, 0], rotation: [0, 0, Math.PI / 2], color: '#504b46', metalness: 0.7, roughness: 0.35, part: 'north-wardrobe-650-hanging-rod', materialRole: 'hardware' },
    ],
  },
  {
    // 通顶衣柜顶部的薄收口（不承担 HVAC 责任）；主体固定顶板已由衣柜 recipe 表达。
    type: 'master_wardrobe_top_pelmet',
    parts: [
      { shape: 'box', size: [0.95, 0.01, 0.58], position: [0, 2.795, 0], color: '#a98258', roughness: 0.5, part: 'pelmet-top-filler', materialRole: 'top_filler' },
      { shape: 'box', size: [0.015, 0.01, 0.33], position: [0.4675, 2.795, 0.125], color: '#a98258', roughness: 0.5, part: 'pelmet-east-filler', materialRole: 'end_panel' },
    ],
  },
  {
    // 950 三扇门 recipe；位置与方案约束由 config/house.yaml 和家具校验器负责。
    type: 'master_north_wall_wardrobe_950',
    parts: [
      { shape: 'box', size: [0.95, 2.80, 0.58], position: [0, 1.40, 0], color: '#9b7650', roughness: 0.55, part: 'north-wardrobe-950-carcass', materialRole: 'cabinet_body', inspectionLayer: 'pipe-chase', inspectionOpacity: 0.18 },
      { shape: 'box', size: [0.91, 2.80, 0.02], position: [0, 1.40, -0.28], color: '#a98258', roughness: 0.5, part: 'north-wardrobe-950-back-panel', materialRole: 'back_panel', inspectionLayer: 'pipe-chase', inspectionOpacity: 0.18 },
      { shape: 'box', size: [0.91, 0.30, 0.02], position: [0, 2.65, -0.27], color: '#a98258', roughness: 0.5, part: 'north-wardrobe-950-concealed-pipe-chase', materialRole: 'back_panel', inspectionLayer: 'pipe-chase', inspectionOpacity: 0.18 },
      { shape: 'box', size: [0.91, 0.02, 0.58], position: [0, 2.79, 0], color: '#a98258', roughness: 0.5, part: 'north-wardrobe-950-fixed-top-panel', materialRole: 'top_filler', inspectionLayer: 'pipe-chase', inspectionOpacity: 0.18 },
      { shape: 'box', size: [0.91, 0.09, 0.54], position: [0, 0.045, 0], color: '#8a6545', roughness: 0.6, part: 'north-wardrobe-950-plinth', materialRole: 'plinth' },
      { shape: 'box', size: [0.89, 0.025, 0.52], position: [0, 1.05, 0], color: '#a48763', roughness: 0.6, part: 'north-wardrobe-950-shelf', materialRole: 'shelf' },
      { shape: 'cylinder', size: [0.018, 0.87, 0.018], position: [0, 1.85, 0], rotation: [0, 0, Math.PI / 2], color: '#504b46', metalness: 0.7, roughness: 0.35, part: 'north-wardrobe-950-hanging-rod', materialRole: 'hardware' },
    ],
  },
  {
    // 2026-09-04 R3：中浅胡桃双平板门、拉丝古铜拉手、四条 140–160mm 腿；总高 2.25m，平面不扩大。
    type: 'master_freestanding_wardrobe_062',
    parts: [
      { shape: 'box', size: [0.56, 0.08, 0.54], position: [0, 0.04, 0], color: '#8a6545', roughness: 0.6, part: 'lower-shadow-rail', materialRole: 'cabinet_foot' },
      { shape: 'box', size: [0.62, 2.10, 0.60], position: [0, 1.21, 0], color: '#9b7650', roughness: 0.55, part: 'walnut-carcass', materialRole: 'cabinet_body' },
      { shape: 'box', size: [0.295, 1.98, 0.018], position: [-0.155, 1.21, 0.311], color: '#a98258', roughness: 0.5, part: 'walnut-door-left', materialRole: 'door_front' },
      { shape: 'box', size: [0.295, 1.98, 0.018], position: [0.155, 1.21, 0.311], color: '#a98258', roughness: 0.5, part: 'walnut-door-right', materialRole: 'door_front' },
      { shape: 'box', size: [0.012, 1.98, 0.012], position: [0, 1.21, 0.322], color: '#6f5036', roughness: 0.6, part: 'door-seam-center', materialRole: 'door_seam' },
      { shape: 'box', size: [0.012, 0.16, 0.02], position: [-0.03, 1.21, 0.326], color: '#765334', metalness: 0.75, roughness: 0.3, part: 'brushed-bronze-handle-left', materialRole: 'hardware' },
      { shape: 'box', size: [0.012, 0.16, 0.02], position: [0.03, 1.21, 0.326], color: '#765334', metalness: 0.75, roughness: 0.3, part: 'brushed-bronze-handle-right', materialRole: 'hardware' },
      { shape: 'box', size: [0.56, 0.025, 0.52], position: [0, 1.05, 0], color: '#a98258', roughness: 0.55, part: 'interior-shelf', materialRole: 'shelf' },
      { shape: 'cylinder', size: [0.016, 0.52, 0.016], position: [0, 1.78, 0], rotation: [0, 0, Math.PI / 2], color: '#765334', metalness: 0.75, roughness: 0.3, part: 'hanging-rod', materialRole: 'hardware' },
      ...([-0.24, 0.24].flatMap((x) => [-0.22, 0.22].map((z, index) => ({ shape: 'box' as const, size: [0.07, 0.15, 0.07] as [number, number, number], position: [x, 0.075, z] as [number, number, number], color: '#8a6545', roughness: 0.6, part: `walnut-leg-${index + 1}-${x < 0 ? 'l' : 'r'}`, materialRole: 'cabinet_foot' })))),
    ],
  },
  {
    // R5 横向隔断衣柜：完整 mesh 严格收口于 1.60W×0.60D×2.15H；关闭态南脸，门向 +z 开启。
    type: 'master_partition_wardrobe_1600',
    parts: [
      { shape: 'box', size: [1.60, 2.15, 0.60], position: [0, 1.075, 0], color: '#b8aa99', roughness: 0.62, part: 'partition-carcass', materialRole: 'cabinet_body' },
      { shape: 'box', size: [1.52, 2.05, 0.018], position: [0, 1.075, -0.291], color: '#cbbda9', roughness: 0.55, part: 'furniture-back-panel', materialRole: 'back_panel' },
      { shape: 'box', size: [1.52, 0.08, 0.54], position: [0, 0.04, 0], color: '#8f7b65', roughness: 0.65, part: 'partition-plinth', materialRole: 'plinth' },
      { shape: 'box', size: [1.48, 0.025, 0.52], position: [0, 1.04, 0], color: '#c9b49a', roughness: 0.5, part: 'partition-interior-shelf', materialRole: 'shelf' },
      { shape: 'cylinder', size: [0.018, 1.30, 0.018], position: [0, 1.72, 0], rotation: [0, 0, Math.PI / 2], color: '#5c5147', metalness: 0.7, roughness: 0.35, part: 'partition-hanging-rod', materialRole: 'hardware' },

    ],
  },
  {
    // R6：380W×350D×500H 候选，薄抽+下部开放层，四条细腿；runtime 最高 0.505m。
    type: 'master_bedside_cabinet_350_north',
    parts: [
      { shape: 'box', size: [0.38, 0.30, 0.35], position: [0, 0.25, 0], color: '#a98258', roughness: 0.55, part: 'bedside-350-open-carcass', materialRole: 'cabinet_body' },
      { shape: 'box', size: [0.34, 0.018, 0.012], position: [0, 0.39, 0.160], color: '#b08d5e', roughness: 0.5, part: 'bedside-350-thin-drawer-front', materialRole: 'drawer_front' },
      { shape: 'box', size: [0.34, 0.025, 0.31], position: [0, 0.4925, 0], color: '#b08d5e', roughness: 0.5, part: 'bedside-350-top', materialRole: 'countertop' },
      { shape: 'box', size: [0.07, 0.018, 0.014], position: [0, 0.39, 0.168], color: '#765334', metalness: 0.75, roughness: 0.3, part: 'bedside-350-pull', materialRole: 'hardware' },
      ...([-0.14, 0.14].flatMap((x) => [-0.13, 0.13].map((z, index) => ({ shape: 'box' as const, size: [0.035, 0.19, 0.035] as [number, number, number], position: [x, 0.095, z] as [number, number, number], color: '#765334', roughness: 0.6, part: `bedside-350-leg-${index + 1}-${x < 0 ? 'l' : 'r'}`, materialRole: 'cabinet_foot' })))),
    ],
  },
  {
    type: 'master_bedside_cabinet_350_south',
    parts: [
      { shape: 'box', size: [0.38, 0.30, 0.35], position: [0, 0.25, 0], color: '#a98258', roughness: 0.55, part: 'bedside-350-open-carcass', materialRole: 'cabinet_body' },
      { shape: 'box', size: [0.34, 0.018, 0.012], position: [0, 0.39, 0.160], color: '#b08d5e', roughness: 0.5, part: 'bedside-350-thin-drawer-front', materialRole: 'drawer_front' },
      { shape: 'box', size: [0.34, 0.025, 0.31], position: [0, 0.4925, 0], color: '#b08d5e', roughness: 0.5, part: 'bedside-350-top', materialRole: 'countertop' },
      { shape: 'box', size: [0.07, 0.018, 0.014], position: [0, 0.39, 0.168], color: '#765334', metalness: 0.75, roughness: 0.3, part: 'bedside-350-pull', materialRole: 'hardware' },
      ...([-0.14, 0.14].flatMap((x) => [-0.13, 0.13].map((z, index) => ({ shape: 'box' as const, size: [0.035, 0.19, 0.035] as [number, number, number], position: [x, 0.095, z] as [number, number, number], color: '#765334', roughness: 0.6, part: `bedside-350-leg-${index + 1}-${x < 0 ? 'l' : 'r'}`, materialRole: 'cabinet_foot' })))),
    ],
  },
  {
    // R5 独立连接收纳段：declared 700W×400D 与真实 mesh 同口径；不承担 DEC-045/HVAC/地插固定责任，检修边界仍 site_pending。
    type: 'master_dressing_connection_storage',
    parts: [
      { shape: 'box', size: [0.70, 0.82, 0.40], position: [0, 0.41, 0], color: '#c2b3a2', roughness: 0.58, part: 'connection-storage-carcass', materialRole: 'cabinet_body' },
      { shape: 'box', size: [0.66, 0.025, 0.36], position: [0, 0.43, -0.02], color: '#d0c1ae', roughness: 0.52, part: 'connection-storage-door', materialRole: 'door_front' },
      { shape: 'box', size: [0.62, 0.025, 0.34], position: [0, 0.12, 0], color: '#9a8772', roughness: 0.65, part: 'connection-storage-plinth', materialRole: 'plinth' },
      { shape: 'box', size: [0.64, 0.025, 0.34], position: [0, 0.70, 0], color: '#cdb89d', roughness: 0.5, part: 'connection-storage-shelf', materialRole: 'shelf' },
      { shape: 'box', size: [0.07, 0.018, 0.014], position: [0, 0.43, -0.193], color: '#765334', metalness: 0.75, roughness: 0.3, part: 'connection-storage-handle', materialRole: 'hardware' },
    ],
  },
  // DEC-045：主卫东墙收纳拆成四个独立 furnishing object；每个 recipe 的局部原点都是自身包围盒中心。
  // local x 是沿墙宽度、local y 是世界竖向高度、local z 是进深；rotation=270 后 local x 沿世界 z，local z 正向朝 west。
  // 柜体与两块板共享墙面中心 z=3.61，以 y 形成紧凑的柜体—板件层次；PVC 包边独立沿冷凝管路线定位。
  {
    type: 'mb_vanity_base_cabinet',
    parts: [
      // Total depth is 565mm, matching the two floating boards.  The local
      // +z face is the west/front face after rotation=270; keep every front
      // detail flush with that new 282.5mm half-depth.
      { shape: 'box', size: [1.38, 0.62, 0.565], position: [0, 0.31, 0], color: '#c9c1b5', roughness: 0.5, part: 'base-cabinet', materialRole: 'cabinet_body' },
      { shape: 'box', size: [1.30, 0.025, 0.025], position: [0, 0.03, 0.2700], color: '#8f877d', roughness: 0.7, part: 'base-plinth', materialRole: 'cabinet_body' },
      { shape: 'box', size: [1.30, 0.025, 0.018], position: [0, 0.32, 0.2735], color: '#e7e0d6', roughness: 0.45, part: 'base-front-reveal', materialRole: 'door_front' },
      { shape: 'box', size: [0.012, 0.42, 0.018], position: [0, 0.34, 0.2735], color: '#8f877d', roughness: 0.7, part: 'base-door-seam', materialRole: 'door_seam' },
    ],
  },
  {
    type: 'mb_vanity_lower_board',
    parts: [
      { shape: 'box', size: [1.38, 0.07, 0.565], position: [0, 1.00, 0], color: '#c9b29a', roughness: 0.45, part: 'lower-board', materialRole: 'shelf' },
    ],
  },
  {
    type: 'mb_vanity_main_board',
    parts: [
      { shape: 'box', size: [1.38, 0.07, 0.565], position: [0, 1.55, 0], color: '#c9b29a', roughness: 0.45, part: 'main-board', materialRole: 'shelf' },
    ],
  },
  {
    // Coordination schematic only: the manufacturer condensate spigot inside ac_master is site_pending.
    type: 'condensate_pipe_ac_outlet',
    parts: [
      // ac_master (3.80, 5.10) -> the west finish of w_mb_east (4.10, 5.10).
      { shape: 'cylinder', size: [0.0125, 0.30, 0.0125], position: [0.15, 2.65, 0], rotation: [0, 0, Math.PI / 2], color: '#06b6d4', roughness: 0.45, part: 'condensate-pipe-ac-outlet-to-wall', materialRole: 'hvac_coordination_cover', inspectionLayer: 'pipe-chase', inspectionVisibleOnly: true },
      // Continue inside the extended white HVAC head-box to the wardrobe-top service band.
      { shape: 'cylinder', size: [0.0125, 0.48, 0.0125], position: [0.30, 2.65, -0.24], rotation: [Math.PI / 2, 0, 0], color: '#06b6d4', roughness: 0.45, part: 'condensate-pipe-ac-box-to-wardrobe-top', materialRole: 'hvac_coordination_cover', inspectionLayer: 'pipe-chase', inspectionVisibleOnly: true },
    ],
  },
  {
    type: 'mb_vanity_pvc_box',
    parts: [
      // The pipe stays 40mm clear of the w_mbath_east west finish (x=2.54),
      // while the white trim terminates at that finish and remains visible in normal mode.
      { shape: 'box', size: [1.20, 0.08, 0.08], position: [0, 2.65, 0], color: '#f5f5f5', roughness: 0.9, part: 'condensate-wall-trim', materialRole: 'hvac_coordination_cover', inspectionLayer: 'pipe-chase', inspectionOpacity: 0.18 },
      { shape: 'cylinder', size: [0.0125, 1.20, 0.0125], position: [0, 2.65, 0], rotation: [0, 0, Math.PI / 2], color: '#06b6d4', roughness: 0.45, part: 'condensate-pipe-wall-run', materialRole: 'hvac_coordination_cover', inspectionLayer: 'pipe-chase', inspectionVisibleOnly: true },
    ],
  },
  {
    type: 'mb_vanity_pvc_wardrobe_entry',
    parts: [
      // Extended head-box/wardrobe top endpoint (4.10, 4.62) -> wardrobe east edge (2.925, 4.62).
      { shape: 'cylinder', size: [0.0125, 1.175, 0.0125], position: [-0.5875, 2.65, 0], rotation: [0, 0, Math.PI / 2], color: '#06b6d4', roughness: 0.45, part: 'condensate-pipe-wall-to-wardrobe-top', materialRole: 'hvac_coordination_cover', inspectionLayer: 'pipe-chase', inspectionVisibleOnly: true },
    ],
  },
  {
    type: 'mb_vanity_pvc_service_chase',
    parts: [
      // Wardrobe-top service band (2.925, 4.62) -> wall-side pipe center (2.50, 4.62) -> (2.50, 4.30).
      { shape: 'cylinder', size: [0.0125, 0.425, 0.0125], position: [-0.2125, 2.65, 0], rotation: [0, 0, Math.PI / 2], color: '#06b6d4', roughness: 0.45, part: 'condensate-pipe-wardrobe-top-to-wall', materialRole: 'hvac_coordination_cover', inspectionLayer: 'pipe-chase', inspectionVisibleOnly: true },
      { shape: 'cylinder', size: [0.0125, 0.32, 0.0125], position: [-0.425, 2.65, -0.16], rotation: [Math.PI / 2, 0, 0], color: '#06b6d4', roughness: 0.45, part: 'condensate-pipe-wardrobe-drop-to-wall', materialRole: 'hvac_coordination_cover', inspectionLayer: 'pipe-chase', inspectionVisibleOnly: true },
      // Minimal short fold near w_mbath_south: turn west at z=3.10, then cross the wall at x=2.30.
      // Two simple white cover pieces close the exposed turn to the south-wall
      // finished face (z=2.92 on the bedroom side) without changing the pipe
      // centerline or the declared penetration.
      { shape: 'box', size: [0.28, 0.08, 0.08], position: [-0.525, 2.65, -1.52], color: '#f5f5f5', roughness: 0.9, part: 'condensate-wall-trim-short-fold', materialRole: 'hvac_coordination_cover', inspectionLayer: 'pipe-chase', inspectionOpacity: 0.18 },
      { shape: 'box', size: [0.08, 0.08, 0.18], position: [-0.625, 2.65, -1.61], color: '#f5f5f5', roughness: 0.9, part: 'condensate-wall-trim-to-south-wall', materialRole: 'hvac_coordination_cover', inspectionLayer: 'pipe-chase', inspectionOpacity: 0.18 },
      { shape: 'cylinder', size: [0.0125, 0.20, 0.0125], position: [-0.525, 2.65, -1.52], rotation: [0, 0, Math.PI / 2], color: '#06b6d4', roughness: 0.45, part: 'condensate-pipe-wall-to-penetration', materialRole: 'hvac_coordination_cover', inspectionLayer: 'pipe-chase', inspectionVisibleOnly: true },
      { shape: 'cylinder', size: [0.0125, 0.60, 0.0125], position: [-0.625, 2.65, -1.82], rotation: [Math.PI / 2, 0, 0], color: '#06b6d4', roughness: 0.45, part: 'condensate-pipe-penetration-to-bath-ceiling', materialRole: 'hvac_coordination_cover', inspectionLayer: 'pipe-chase', inspectionVisibleOnly: true },
      { shape: 'cylinder', size: [0.0125, 0.30, 0.0125], position: [-0.775, 2.65, -2.12], rotation: [0, 0, Math.PI / 2], color: '#06b6d4', roughness: 0.45, part: 'condensate-pipe-bath-ceiling-to-candidate', materialRole: 'hvac_coordination_cover', inspectionLayer: 'pipe-chase', inspectionVisibleOnly: true },
      { shape: 'cylinder', size: [0.0125, 2.55, 0.0125], position: [-0.925, 1.375, -2.12], rotation: [0, 0, 0], color: '#06b6d4', roughness: 0.45, part: 'condensate-pipe-at-master-bath-candidate', materialRole: 'hvac_coordination_cover', inspectionLayer: 'pipe-chase', inspectionVisibleOnly: true },
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
    // 2026-09-02 初版（迭代 mb-washbasin-curtain-20260901，假定玻璃通高，待量房终核）：
    // 收宽 1.10→1.05（西让 5cm 百叶升降缝、东留 5cm 门套缝），盆/龙头/镜对柜体居中。
    // 2026-09-01 主卫外纯洗手柜：取消梳妆膝位与椅子，东侧完整封闭抽屉收纳。
    // 局部 -z 为靠墙侧，front 朝 +z。
    type: 'mb_washbasin_cabinet',
    parts: [
      // 两段柜体各 0.525m 宽、在 x=0 处拼缝；盆跨缝居中（实际柜体深化时台下走 U 形抽屉避让排水）。
      // 柜体顶面 y=0.77 与台面底面齐平，不留空缝。
      { shape: 'box', size: [0.525, 0.77, 0.42], position: [-0.2625, 0.385, 0], color: '#d7d9db', roughness: 0.45, part: 'basin-carcass', materialRole: 'cabinet_body' },
      { shape: 'box', size: [0.50, 0.68, 0.02], position: [-0.2625, 0.41, 0.22], color: '#eef0f1', roughness: 0.35, part: 'basin-door', materialRole: 'door_front' },
      { shape: 'box', size: [0.525, 0.77, 0.42], position: [0.2625, 0.385, 0], color: '#d7d9db', roughness: 0.45, part: 'east-storage-carcass', materialRole: 'cabinet_body' },
      { shape: 'box', size: [0.50, 0.22, 0.02], position: [0.2625, 0.62, 0.22], color: '#eef0f1', roughness: 0.35, part: 'east-drawer-upper', materialRole: 'drawer_front' },
      { shape: 'box', size: [0.50, 0.44, 0.02], position: [0.2625, 0.29, 0.22], color: '#eef0f1', roughness: 0.35, part: 'east-drawer-lower', materialRole: 'drawer_front' },
      { shape: 'box', size: [1.05, 0.04, 0.50], position: [0, 0.79, 0], color: '#e8e6e0', roughness: 0.3, part: 'countertop', materialRole: 'countertop' },
      { shape: 'box', size: [0.46, 0.12, 0.32], position: [0, 0.87, 0], color: '#ffffff', roughness: 0.3, part: 'basin', materialRole: 'ceramic' },
      { shape: 'box', size: [0.05, 0.22, 0.05], position: [0, 0.92, -0.16], color: '#c8ccd0', metalness: 0.6, roughness: 0.35, part: 'faucet', materialRole: 'hardware' },
      { shape: 'box', size: [0.72, 0.72, 0.03], position: [0, 1.43, -0.235], color: '#bcd2d8', roughness: 0.1, metalness: 0.6, part: 'wash-mirror', materialRole: 'mirror' },
    ],
  },

  {
    // 2026-09-03 改：900W×450D×750H 四腿开放式独立梳妆桌（候选未冻结），迁至主卧西侧北段，不再贴东墙。
    // 局部 x 为 0.90m 长边，局部 z 为 0.45m 深度，局部 +z 为正面（薄抽屉/座位侧）；
    // house.yaml rotation=90 后长边沿世界 z、正面朝东（+x），使用者坐东侧面向西玻璃；
    // 桌面镜/桌灯在局部 -z（世界西）侧，桌下局部后侧为地插服务域（桌腿落点见 legs，避开 ≥0.10m）。
    type: 'master_dressing_table',
    parts: [
      { shape: 'box', size: [0.90, 0.045, 0.45], position: [0, 0.7275, 0], color: '#b08d5e', roughness: 0.42, part: 'rounded-top', materialRole: 'countertop' },
      { shape: 'cylinder', size: [0.065, 0.705, 0.065], position: [-0.39, 0.3525, -0.16], color: '#7b5d3f', roughness: 0.5, part: 'leg-south-rear', materialRole: 'cabinet_body' },
      { shape: 'cylinder', size: [0.065, 0.705, 0.065], position: [0.39, 0.3525, -0.16], color: '#7b5d3f', roughness: 0.5, part: 'leg-north-rear', materialRole: 'cabinet_body' },
      { shape: 'cylinder', size: [0.065, 0.705, 0.065], position: [-0.39, 0.3525, 0.16], color: '#7b5d3f', roughness: 0.5, part: 'leg-south-front', materialRole: 'cabinet_body' },
      { shape: 'cylinder', size: [0.065, 0.705, 0.065], position: [0.39, 0.3525, 0.16], color: '#7b5d3f', roughness: 0.5, part: 'leg-north-front', materialRole: 'cabinet_body' },
      { shape: 'box', size: [0.80, 0.10, 0.36], position: [0, 0.65, 0.02], color: '#a47c52', roughness: 0.42, part: 'thin-drawer', materialRole: 'drawer_front' },
      { shape: 'box', size: [0.54, 0.54, 0.025], position: [0, 1.04, -0.15], color: '#bcd2d8', roughness: 0.1, metalness: 0.55, part: 'tabletop-mirror', materialRole: 'mirror' },
      { shape: 'box', size: [0.38, 0.025, 0.10], position: [0, 0.765, -0.14], color: '#7b5d3f', roughness: 0.5, part: 'mirror-stand', materialRole: 'cabinet_body' },
      { shape: 'cylinder', size: [0.025, 0.48, 0.025], position: [0.33, 0.99, -0.15], color: '#c9a86a', metalness: 0.55, roughness: 0.3, part: 'plug-in-light', materialRole: 'lighting_fixture' },
    ],
  },
  {
    type: 'dressing_stool',
    parts: [
      { shape: 'box', size: [0.42, 0.07, 0.40], position: [0, 0.415, 0], color: '#d8c7b8', roughness: 0.8, part: 'seat', materialRole: 'upholstery' },
      { shape: 'box', size: [0.035, 0.38, 0.035], position: [-0.17, 0.19, -0.16], color: '#7b5d3f', roughness: 0.5, part: 'leg-1', materialRole: 'cabinet_body' },
      { shape: 'box', size: [0.035, 0.38, 0.035], position: [0.17, 0.19, -0.16], color: '#7b5d3f', roughness: 0.5, part: 'leg-2', materialRole: 'cabinet_body' },
      { shape: 'box', size: [0.035, 0.38, 0.035], position: [-0.17, 0.19, 0.16], color: '#7b5d3f', roughness: 0.5, part: 'leg-3', materialRole: 'cabinet_body' },
      { shape: 'box', size: [0.035, 0.38, 0.035], position: [0.17, 0.19, 0.16], color: '#7b5d3f', roughness: 0.5, part: 'leg-4', materialRole: 'cabinet_body' },
    ],
  },
  {
    // 2026-09-04 R1 主卧南侧窗带轻中古矮柜（候选未冻结）：1400W×480D×850H，六抽屉、细腿，木色与 master_dressing_table 同族。
    // 局部 x 为 1.40m 长边，局部 z 为 0.48m 进深，局部 +z 为正面（抽屉侧）；
    // house.yaml rotation=180 后正面转朝北（世界 -z）对着房间，背面贴南侧窗带下墙（柜高 0.85 < sill 2.07 不挡窗）。
    type: 'master_hot_season_low_dresser',
    parts: [
      { shape: 'cylinder', size: [0.02, 0.20, 0.02], position: [-0.62, 0.10, -0.17], color: '#7b5d3f', roughness: 0.5, part: 'leg-nw', materialRole: 'cabinet_foot' },
      { shape: 'cylinder', size: [0.02, 0.20, 0.02], position: [0.62, 0.10, -0.17], color: '#7b5d3f', roughness: 0.5, part: 'leg-ne', materialRole: 'cabinet_foot' },
      { shape: 'cylinder', size: [0.02, 0.20, 0.02], position: [-0.62, 0.10, 0.17], color: '#7b5d3f', roughness: 0.5, part: 'leg-sw', materialRole: 'cabinet_foot' },
      { shape: 'cylinder', size: [0.02, 0.20, 0.02], position: [0.62, 0.10, 0.17], color: '#7b5d3f', roughness: 0.5, part: 'leg-se', materialRole: 'cabinet_foot' },
      { shape: 'box', size: [1.36, 0.60, 0.44], position: [0, 0.50, 0], color: '#b08d5e', roughness: 0.45, part: 'carcass', materialRole: 'cabinet_body' },
      { shape: 'box', size: [1.40, 0.04, 0.48], position: [0, 0.83, 0], color: '#a47c52', roughness: 0.42, part: 'top-panel', materialRole: 'countertop' },
      { shape: 'box', size: [0.42, 0.26, 0.018], position: [-0.44, 0.365, 0.229], color: '#a98258', roughness: 0.45, part: 'drawer-front-1', materialRole: 'drawer_front' },
      { shape: 'box', size: [0.42, 0.26, 0.018], position: [0, 0.365, 0.229], color: '#a98258', roughness: 0.45, part: 'drawer-front-2', materialRole: 'drawer_front' },
      { shape: 'box', size: [0.42, 0.26, 0.018], position: [0.44, 0.365, 0.229], color: '#a98258', roughness: 0.45, part: 'drawer-front-3', materialRole: 'drawer_front' },
      { shape: 'box', size: [0.42, 0.26, 0.018], position: [-0.44, 0.635, 0.229], color: '#a98258', roughness: 0.45, part: 'drawer-front-4', materialRole: 'drawer_front' },
      { shape: 'box', size: [0.42, 0.26, 0.018], position: [0, 0.635, 0.229], color: '#a98258', roughness: 0.45, part: 'drawer-front-5', materialRole: 'drawer_front' },
      { shape: 'box', size: [0.42, 0.26, 0.018], position: [0.44, 0.635, 0.229], color: '#a98258', roughness: 0.45, part: 'drawer-front-6', materialRole: 'drawer_front' },
      { shape: 'box', size: [0.012, 0.56, 0.012], position: [-0.22, 0.50, 0.241], color: '#7b5d3f', roughness: 0.5, part: 'drawer-seam-v1', materialRole: 'door_seam' },
      { shape: 'box', size: [0.012, 0.56, 0.012], position: [0.22, 0.50, 0.241], color: '#7b5d3f', roughness: 0.5, part: 'drawer-seam-v2', materialRole: 'door_seam' },
      { shape: 'box', size: [1.32, 0.012, 0.012], position: [0, 0.50, 0.241], color: '#7b5d3f', roughness: 0.5, part: 'drawer-seam-h', materialRole: 'door_seam' },
      { shape: 'box', size: [0.09, 0.018, 0.014], position: [-0.44, 0.46, 0.247], color: '#503e2e', metalness: 0.5, roughness: 0.4, part: 'drawer-handle-1', materialRole: 'hardware' },
      { shape: 'box', size: [0.09, 0.018, 0.014], position: [0, 0.46, 0.247], color: '#503e2e', metalness: 0.5, roughness: 0.4, part: 'drawer-handle-2', materialRole: 'hardware' },
      { shape: 'box', size: [0.09, 0.018, 0.014], position: [0.44, 0.46, 0.247], color: '#503e2e', metalness: 0.5, roughness: 0.4, part: 'drawer-handle-3', materialRole: 'hardware' },
      { shape: 'box', size: [0.09, 0.018, 0.014], position: [-0.44, 0.73, 0.247], color: '#503e2e', metalness: 0.5, roughness: 0.4, part: 'drawer-handle-4', materialRole: 'hardware' },
      { shape: 'box', size: [0.09, 0.018, 0.014], position: [0, 0.73, 0.247], color: '#503e2e', metalness: 0.5, roughness: 0.4, part: 'drawer-handle-5', materialRole: 'hardware' },
      { shape: 'box', size: [0.09, 0.018, 0.014], position: [0.44, 0.73, 0.247], color: '#503e2e', metalness: 0.5, roughness: 0.4, part: 'drawer-handle-6', materialRole: 'hardware' },
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
      // Flush embedded support: countertop top is y=0.88, so only the glass face remains visible above the opening.
      { shape: 'box', size: [0.66, 0.004, 0.36], position: [0, 0.878, 0], color: '#222222', roughness: 0.3, part: 'cooktop-base', materialRole: 'fixture_metal' },
      // Recessed glass insert sits 1mm proud of the countertop; the front edge is no longer a thick black wall.
      { shape: 'box', size: [0.64, 0.004, 0.34], position: [0, 0.881, 0], color: '#1b2024', roughness: 0.18, part: 'cooktop-surface', materialRole: 'cooktop_surface' },
      // Narrow recessed shadow line: visible at the cutout, but not a raised perimeter frame.
      { shape: 'box', size: [0.66, 0.001, 0.006], position: [0, 0.879, -0.177], color: '#171a1d', roughness: 0.28, part: 'cooktop-edge-north', materialRole: 'cooktop_surface' },
      { shape: 'box', size: [0.66, 0.001, 0.006], position: [0, 0.879, 0.177], color: '#171a1d', roughness: 0.28, part: 'cooktop-edge-south', materialRole: 'cooktop_surface' },
      { shape: 'box', size: [0.006, 0.001, 0.348], position: [-0.327, 0.879, 0], color: '#171a1d', roughness: 0.28, part: 'cooktop-edge-west', materialRole: 'cooktop_surface' },
      { shape: 'box', size: [0.006, 0.001, 0.348], position: [0.327, 0.879, 0], color: '#171a1d', roughness: 0.28, part: 'cooktop-edge-east', materialRole: 'cooktop_surface' },
      // Three stepped low-poly cylinders per burner read as a concentric outer ring, inner ring, and center cap.
      { shape: 'cylinder', size: [0.045, 0.008, 0.045], position: [-0.14, 0.925, -0.06], color: '#171717', metalness: 0.35, roughness: 0.45, part: 'burner-fl-outer-ring', materialRole: 'cooktop_burner' },
      { shape: 'cylinder', size: [0.032, 0.014, 0.032], position: [-0.14, 0.930, -0.06], color: '#171717', metalness: 0.35, roughness: 0.45, part: 'burner-fl-inner-ring', materialRole: 'cooktop_burner' },
      { shape: 'cylinder', size: [0.018, 0.020, 0.018], position: [-0.14, 0.935, -0.06], color: '#171717', metalness: 0.35, roughness: 0.45, part: 'burner-fl-center-cap', materialRole: 'cooktop_burner' },
      { shape: 'cylinder', size: [0.045, 0.008, 0.045], position: [0.14, 0.925, -0.06], color: '#171717', metalness: 0.35, roughness: 0.45, part: 'burner-fr-outer-ring', materialRole: 'cooktop_burner' },
      { shape: 'cylinder', size: [0.032, 0.014, 0.032], position: [0.14, 0.930, -0.06], color: '#171717', metalness: 0.35, roughness: 0.45, part: 'burner-fr-inner-ring', materialRole: 'cooktop_burner' },
      { shape: 'cylinder', size: [0.018, 0.020, 0.018], position: [0.14, 0.935, -0.06], color: '#171717', metalness: 0.35, roughness: 0.45, part: 'burner-fr-center-cap', materialRole: 'cooktop_burner' },
      { shape: 'cylinder', size: [0.045, 0.008, 0.045], position: [-0.14, 0.925, 0.06], color: '#171717', metalness: 0.35, roughness: 0.45, part: 'burner-rl-outer-ring', materialRole: 'cooktop_burner' },
      { shape: 'cylinder', size: [0.032, 0.014, 0.032], position: [-0.14, 0.930, 0.06], color: '#171717', metalness: 0.35, roughness: 0.45, part: 'burner-rl-inner-ring', materialRole: 'cooktop_burner' },
      { shape: 'cylinder', size: [0.018, 0.020, 0.018], position: [-0.14, 0.935, 0.06], color: '#171717', metalness: 0.35, roughness: 0.45, part: 'burner-rl-center-cap', materialRole: 'cooktop_burner' },
      { shape: 'cylinder', size: [0.045, 0.008, 0.045], position: [0.14, 0.925, 0.06], color: '#171717', metalness: 0.35, roughness: 0.45, part: 'burner-rr-outer-ring', materialRole: 'cooktop_burner' },
      { shape: 'cylinder', size: [0.032, 0.014, 0.032], position: [0.14, 0.930, 0.06], color: '#171717', metalness: 0.35, roughness: 0.45, part: 'burner-rr-inner-ring', materialRole: 'cooktop_burner' },
      { shape: 'cylinder', size: [0.018, 0.020, 0.018], position: [0.14, 0.935, 0.06], color: '#171717', metalness: 0.35, roughness: 0.45, part: 'burner-rr-center-cap', materialRole: 'cooktop_burner' },
      // Four small hardware knobs sit visibly above the front control strip.
      { shape: 'cylinder', size: [0.025, 0.018, 0.025], position: [-0.15, 0.935, 0.16], color: '#9b9b9b', metalness: 0.7, roughness: 0.3, part: 'knob-left-outer', materialRole: 'hardware' },
      { shape: 'cylinder', size: [0.025, 0.018, 0.025], position: [-0.05, 0.935, 0.16], color: '#9b9b9b', metalness: 0.7, roughness: 0.3, part: 'knob-left-inner', materialRole: 'hardware' },
      { shape: 'cylinder', size: [0.025, 0.018, 0.025], position: [0.05, 0.935, 0.16], color: '#9b9b9b', metalness: 0.7, roughness: 0.3, part: 'knob-right-inner', materialRole: 'hardware' },
      { shape: 'cylinder', size: [0.025, 0.018, 0.025], position: [0.15, 0.935, 0.16], color: '#9b9b9b', metalness: 0.7, roughness: 0.3, part: 'knob-right-outer', materialRole: 'hardware' },
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
      // Thin perimeter rim keeps the original 0.56 × 0.42 footprint while reading as a countertop edge.
      { shape: 'box', size: [0.56, 0.02, 0.05], position: [0, 0.91, -0.185], color: '#f0f0f0', roughness: 0.3, part: 'basin-rim-north', materialRole: 'ceramic' },
      { shape: 'box', size: [0.56, 0.02, 0.05], position: [0, 0.91, 0.185], color: '#f0f0f0', roughness: 0.3, part: 'basin-rim-south', materialRole: 'ceramic' },
      { shape: 'box', size: [0.05, 0.02, 0.32], position: [-0.255, 0.91, 0], color: '#f0f0f0', roughness: 0.3, part: 'basin-rim-west', materialRole: 'ceramic' },
      { shape: 'box', size: [0.05, 0.02, 0.32], position: [0.255, 0.91, 0], color: '#f0f0f0', roughness: 0.3, part: 'basin-rim-east', materialRole: 'ceramic' },
      // Recessed basin walls leave a clearly visible opening beneath the raised rim.
      { shape: 'box', size: [0.50, 0.14, 0.035], position: [0, 0.83, -0.1625], color: '#e4e6e7', roughness: 0.35, part: 'basin-body-north', materialRole: 'ceramic' },
      { shape: 'box', size: [0.50, 0.14, 0.035], position: [0, 0.83, 0.1625], color: '#e4e6e7', roughness: 0.35, part: 'basin-body-south', materialRole: 'ceramic' },
      { shape: 'box', size: [0.035, 0.14, 0.29], position: [-0.2325, 0.83, 0], color: '#e4e6e7', roughness: 0.35, part: 'basin-body-west', materialRole: 'ceramic' },
      { shape: 'box', size: [0.035, 0.14, 0.29], position: [0.2325, 0.83, 0], color: '#e4e6e7', roughness: 0.35, part: 'basin-body-east', materialRole: 'ceramic' },
      { shape: 'box', size: [0.43, 0.02, 0.29], position: [0, 0.77, 0], color: '#c7ced0', roughness: 0.45, part: 'basin-interior', materialRole: 'ceramic' },
    ],
  },
  {
    type: 'vanity',
    parts: [
      { shape: 'box', size: [0.70, 0.75, 0.38], position: [0, 0.375, 0], color: '#f0f0f0', roughness: 0.4, part: 'vanity-carcass', materialRole: 'cabinet_body' },
      { shape: 'box', size: [0.42, 0.12, 0.28], position: [0, 0.81, 0], color: '#ffffff', roughness: 0.3, part: 'basin', materialRole: 'ceramic' },
      // 台面 + 标准墙面龙头；龙头由 guest_bath plumbing 点位统一生成。
      // DEC-2026-09-09-R2：内置平镜移出，镜面由 mirror_cabinet_gbath 镜柜承担（避免双镜）。
      { shape: 'box', size: [0.72, 0.04, 0.40], position: [0, 0.77, 0], color: '#d8d2c6', roughness: 0.3, part: 'countertop', materialRole: 'countertop' },
    ],
  },
  {
    // DEC-2026-09-09-R2 客卫镜柜（候选未冻结）：0.70宽×0.90高×0.14深，底缘 y=1.10、顶缘 y=2.00，
    // 贴 w_gbath_east_open_vanity 西完成面，下沿避台盆双联插座（h=1.0）；rotation=270 后 width 沿墙 z、depth 朝 west（房间侧）。
    type: 'mirror_cabinet_gbath',
    parts: [
      { shape: 'box', size: [0.70, 0.90, 0.14], position: [0, 1.55, 0], color: '#f0ede6', roughness: 0.4, part: 'carcass', materialRole: 'cabinet_body' },
      { shape: 'box', size: [0.66, 0.84, 0.012], position: [0, 1.55, 0.076], color: '#bcd2d8', roughness: 0.08, metalness: 0.45, part: 'mirror-door', materialRole: 'mirror' },
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
    // Formal wall socket placeholder: a readable faceplate, recessed box, and
    // two dark receptacle openings. The local +z face is projected toward the
    // authored wall side by InfrastructureBuilder; dimensions stay conservative
    // while remaining legible in the 3D export without annotation icons.
    type: 'socket',
    parts: [
      { shape: 'box', size: [0.080, 0.080, 0.012], position: [0, 0, -0.008], color: '#dfe3e5', roughness: 0.52, part: 'socket-box', materialRole: 'fixture_body' },
      { shape: 'box', size: [0.086, 0.086, 0.018], position: [0, 0, 0], color: '#f7f8f8', roughness: 0.38, part: 'socket-faceplate', materialRole: 'faceplate' },
      { shape: 'box', size: [0.032, 0.010, 0.006], position: [-0.018, 0.005, 0.013], color: '#4b5358', roughness: 0.72, part: 'socket-five-hole-left', materialRole: 'receptacle' },
      { shape: 'box', size: [0.032, 0.010, 0.006], position: [0.018, 0.005, 0.013], color: '#4b5358', roughness: 0.72, part: 'socket-five-hole-right', materialRole: 'receptacle' },
      { shape: 'box', size: [0.010, 0.032, 0.006], position: [0, -0.014, 0.013], color: '#4b5358', roughness: 0.72, part: 'socket-five-hole-ground', materialRole: 'receptacle' },
      { shape: 'box', size: [0.008, 0.070, 0.004], position: [-0.039, 0, 0.013], color: '#aab1b5', roughness: 0.48, part: 'socket-border-left', materialRole: 'faceplate_edge' },
      { shape: 'box', size: [0.008, 0.070, 0.004], position: [0.039, 0, 0.013], color: '#aab1b5', roughness: 0.48, part: 'socket-border-right', materialRole: 'faceplate_edge' },
      { shape: 'box', size: [0.070, 0.008, 0.004], position: [0, -0.039, 0.013], color: '#aab1b5', roughness: 0.48, part: 'socket-border-bottom', materialRole: 'faceplate_edge' },
      { shape: 'box', size: [0.070, 0.008, 0.004], position: [0, 0.039, 0.013], color: '#aab1b5', roughness: 0.48, part: 'socket-border-top', materialRole: 'faceplate_edge' },
      { shape: 'box', size: [0.018, 0.008, 0.006], position: [0, 0.029, 0.013], color: '#25282b', roughness: 0.72, part: 'socket-usbc', materialRole: 'usb_c' },
    ],
  },
  {
    type: 'switch',
    parts: [
      { shape: 'box', size: [0.086, 0.086, 0.018], position: [0, 0, 0], color: '#f7f8f8', roughness: 0.38, part: 'switch-faceplate', materialRole: 'faceplate' },
      { shape: 'box', size: [0.048, 0.055, 0.008], position: [0, 0, 0.014], color: '#3f4650', roughness: 0.6, part: 'switch-rocker', materialRole: 'rocker' },
    ],
  },
  {
    type: 'switch_2way',
    parts: [
      { shape: 'box', size: [0.086, 0.086, 0.018], position: [0, 0, 0], color: '#f7f8f8', roughness: 0.38, part: 'switch-2way-faceplate', materialRole: 'faceplate' },
      { shape: 'box', size: [0.048, 0.055, 0.008], position: [0, 0, 0.014], color: '#3f4650', roughness: 0.6, part: 'switch-2way-rocker', materialRole: 'rocker' },
    ],
  },
  {
    // VRF 线控器：86 面板 + 深色小屏 + 三枚细键；仅表达底盒/面板位，信号线规格属厂商深化。
    type: 'ac_controller',
    parts: [
      { shape: 'box', size: [0.086, 0.086, 0.018], position: [0, 0, 0], color: '#f7f8f8', roughness: 0.38, part: 'ac-controller-faceplate', materialRole: 'faceplate' },
      { shape: 'box', size: [0.052, 0.030, 0.004], position: [0, 0.014, 0.013], color: '#1d2a33', roughness: 0.25, metalness: 0.35, part: 'ac-controller-screen', materialRole: 'screen' },
      { shape: 'box', size: [0.014, 0.010, 0.004], position: [-0.024, -0.022, 0.013], color: '#8a9298', roughness: 0.5, part: 'ac-controller-key-l', materialRole: 'button' },
      { shape: 'box', size: [0.014, 0.010, 0.004], position: [0, -0.022, 0.013], color: '#8a9298', roughness: 0.5, part: 'ac-controller-key-c', materialRole: 'button' },
      { shape: 'box', size: [0.014, 0.010, 0.004], position: [0.024, -0.022, 0.013], color: '#8a9298', roughness: 0.5, part: 'ac-controller-key-r', materialRole: 'button' },
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
      { shape: 'box', size: [0.60, 0.85, 0.60], position: [0, 0.4775, 0], color: '#eeeeee', roughness: 0.4 },
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
      { shape: 'box', size: [0.58, 0.68, 0.02], position: [0, 0.44, 0.29], color: '#222226', roughness: 0.15, materialRole: 'fixture_metal' },
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
  {
    // 2026-09-03 书房东墙季节后台柜（候选未冻结）：1.70×0.55×2.40m 非通顶模块化柜。
    // 局部 x 为 1.70m 沿墙长边，局部 z 为 0.55m 进深，局部 +z 为正面/柜门；
    // house.yaml rotation=270 后长边沿世界 z、柜门朝西（-x）、背板朝东墙；
    // 浅色平板门；柜顶 2.40m 与边吊底 2.50m 间约 0.10m 灰缝（non-blocking 评审项）。
    type: 'study_seasonal_wardrobe_wall',
    parts: [
      { shape: 'box', size: [1.64, 0.08, 0.49], position: [0, 0.04, 0], color: '#c9c4ba', roughness: 0.6, part: 'plinth', materialRole: 'plinth' },
      { shape: 'box', size: [1.70, 2.40, 0.55], position: [0, 1.20, 0], color: '#e8e4dc', roughness: 0.55, part: 'carcass', materialRole: 'cabinet_body' },
      { shape: 'box', size: [0.55, 2.28, 0.018], position: [-0.565, 1.20, 0.286], color: '#efece4', roughness: 0.5, part: 'door-left', materialRole: 'door_front' },
      { shape: 'box', size: [0.55, 2.28, 0.018], position: [0, 1.20, 0.286], color: '#efece4', roughness: 0.5, part: 'door-center', materialRole: 'door_front' },
      { shape: 'box', size: [0.55, 2.28, 0.018], position: [0.565, 1.20, 0.286], color: '#efece4', roughness: 0.5, part: 'door-right', materialRole: 'door_front' },
      { shape: 'box', size: [0.012, 2.28, 0.012], position: [-0.2825, 1.20, 0.297], color: '#b9b4aa', roughness: 0.6, part: 'door-seam-left', materialRole: 'door_seam' },
      { shape: 'box', size: [0.012, 2.28, 0.012], position: [0.2825, 1.20, 0.297], color: '#b9b4aa', roughness: 0.6, part: 'door-seam-right', materialRole: 'door_seam' },
      { shape: 'box', size: [1.62, 0.025, 0.47], position: [0, 1.05, 0], color: '#dcd8ce', roughness: 0.55, part: 'interior-shelf', materialRole: 'shelf' },
      { shape: 'cylinder', size: [0.016, 1.60, 0.016], position: [0, 1.85, 0], rotation: [0, 0, Math.PI / 2], color: '#504b46', metalness: 0.7, roughness: 0.35, part: 'hanging-rod', materialRole: 'hardware' },
    ],
  },
  {
    // 2026-09-03 可调哑铃对（含底座，收纳态）：0.55×0.45m 包络；双铃并排放置在底座托盘上。
    // 局部 x 为 0.55m 宽（哑铃杆方向），局部 z 为 0.45m 深；渲染用，预算走 home_fitness 单套口径。
    type: 'adjustable_dumbbell_pair',
    parts: [
      { shape: 'box', size: [0.55, 0.06, 0.45], position: [0, 0.03, 0], color: '#25282b', metalness: 0.65, roughness: 0.4, part: 'base-tray', materialRole: 'frame' },
      { shape: 'cylinder', size: [0.02, 0.30, 0.02], position: [0, 0.14, -0.11], rotation: [0, 0, Math.PI / 2], color: '#9ba1a6', metalness: 0.85, roughness: 0.25, part: 'handle-left', materialRole: 'hardware' },
      { shape: 'box', size: [0.07, 0.14, 0.14], position: [-0.18, 0.14, -0.11], color: '#1f2326', metalness: 0.35, roughness: 0.65, part: 'head-left-a', materialRole: 'weight_plate' },
      { shape: 'box', size: [0.07, 0.14, 0.14], position: [0.18, 0.14, -0.11], color: '#1f2326', metalness: 0.35, roughness: 0.65, part: 'head-left-b', materialRole: 'weight_plate' },
      { shape: 'cylinder', size: [0.02, 0.30, 0.02], position: [0, 0.14, 0.11], rotation: [0, 0, Math.PI / 2], color: '#9ba1a6', metalness: 0.85, roughness: 0.25, part: 'handle-right', materialRole: 'hardware' },
      { shape: 'box', size: [0.07, 0.14, 0.14], position: [-0.18, 0.14, 0.11], color: '#1f2326', metalness: 0.35, roughness: 0.65, part: 'head-right-a', materialRole: 'weight_plate' },
      { shape: 'box', size: [0.07, 0.14, 0.14], position: [0.18, 0.14, 0.11], color: '#1f2326', metalness: 0.35, roughness: 0.65, part: 'head-right-b', materialRole: 'weight_plate' },
    ],
  },
  {
    // 2026-09-03 可卷训练垫（收纳态）：卷起圆筒立放，footprint 0.25×0.25m；渲染用，不单独计价。
    // 圆筒沿局部 y 竖立（高约 1.5m），配一道捆扎带；使用时展开为使用态 AABB（专项测试验证）。
    type: 'rollable_training_mat',
    parts: [
      { shape: 'cylinder', size: [0.125, 1.50, 0.125], position: [0, 0.75, 0], color: '#3a3d40', roughness: 0.9, part: 'rolled-mat', materialRole: 'floor_protection' },
      { shape: 'cylinder', size: [0.128, 0.06, 0.128], position: [0, 0.60, 0], color: '#6b6f73', roughness: 0.7, part: 'strap', materialRole: 'fabric' },
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
  if (part.inspectionLayer) mesh.userData.inspectionLayer = part.inspectionLayer;
  if (part.inspectionOpacity !== undefined) mesh.userData.inspectionOpacity = part.inspectionOpacity;
  if (part.inspectionVisibleOnly !== undefined) {
    mesh.userData.inspectionVisibleOnly = part.inspectionVisibleOnly;
    mesh.visible = !part.inspectionVisibleOnly;
  }
  if (surface) mesh.userData.surface = surface;
  group.add(mesh);
  return mesh;
}

function addBox(group: THREE.Group, fixtureType: string, index: number, size: [number, number, number], position: [number, number, number], color: string, options: Partial<FixturePart> = {}, surface?: string): THREE.Mesh {
  return addPart(group, fixtureType, index, { shape: 'box', size, position, color, ...options }, surface);
}

export type PartitionWardrobeDoorState = 'closed' | 'open';
export type NorthWallWardrobeDoorState = 'closed' | 'open';
export type NorthWallWardrobeDoorConfiguration = 'closed' | 'left_open' | 'right_open' | 'both_open';
export type NorthWallWardrobe950DoorState = 'closed' | 'open';
/** R7 三门 950 衣柜门态矩阵：closed + 3 单开 + 3 组合 + 全开。 */
export type NorthWallWardrobe950DoorConfiguration =
  | 'closed'
  | 'left_open'
  | 'middle_open'
  | 'right_open'
  | 'left_middle_open'
  | 'left_right_open'
  | 'middle_right_open'
  | 'all_open';
export type NorthWallWardrobe650DoorState = 'closed' | 'open';
/** R7 收窄版 650 双门衣柜门态矩阵：closed + 单开 ×2 + 全开。 */
export type NorthWallWardrobe650DoorConfiguration = 'closed' | 'left_open' | 'right_open' | 'both_open';

const PARTITION_WARDROBE_DOOR_OPEN_LIMIT_DEG = 95;
const NORTH_WALL_WARDROBE_DOOR_OPEN_LIMIT_DEG = 95;
const NORTH_WALL_WARDROBE_950_DOOR_OPEN_LIMIT_DEG = 95;
const NORTH_WALL_WARDROBE_650_DOOR_OPEN_LIMIT_DEG = 95;

const NORTH_WALL_WARDROBE_950_CONFIGURATION_OPEN: Record<NorthWallWardrobe950DoorConfiguration, [boolean, boolean, boolean]> = {
  closed: [false, false, false],
  left_open: [true, false, false],
  middle_open: [false, true, false],
  right_open: [false, false, true],
  left_middle_open: [true, true, false],
  left_right_open: [true, false, true],
  middle_right_open: [false, true, true],
  all_open: [true, true, true],
};

/** Set one or all R5 door roots, including the actual runtime hinge rotation. */
export function setPartitionWardrobeDoorState(rootOrGroup: THREE.Object3D, state: PartitionWardrobeDoorState, doorIndex?: number): void {
  rootOrGroup.traverse((object) => {
    const index = object.userData.doorIndex as number | undefined;
    if (index === undefined || (doorIndex !== undefined && index !== doorIndex)) return;
    const hingeSide = object.userData.hingeSide as 'left' | 'right';
    const angle = state === 'open'
      ? (hingeSide === 'left' ? -PARTITION_WARDROBE_DOOR_OPEN_LIMIT_DEG : PARTITION_WARDROBE_DOOR_OPEN_LIMIT_DEG)
      : 0;
    object.rotation.set(0, THREE.MathUtils.degToRad(angle), 0);
    object.userData.state = state;
    object.userData.rotationAxis = 'y';
    object.userData.rotationDeg = angle;
    const leaf = object.children.find((child) => child.userData.doorLeaf === true);
    if (leaf) leaf.rotation.y = THREE.MathUtils.degToRad(state === 'open' ? (hingeSide === 'left' ? 5 : -5) : 0);
  });
}

export function setNorthWallWardrobeDoorState(rootOrGroup: THREE.Object3D, state: NorthWallWardrobeDoorState, doorIndex?: number): void {
  rootOrGroup.traverse((object) => {
    const index = object.userData.doorIndex as number | undefined;
    if (index === undefined || (doorIndex !== undefined && doorIndex !== index)) return;
    const hingeSide = object.userData.hingeSide as 'left' | 'right';
    const angle = state === 'open'
      ? (hingeSide === 'left' ? -NORTH_WALL_WARDROBE_DOOR_OPEN_LIMIT_DEG : NORTH_WALL_WARDROBE_DOOR_OPEN_LIMIT_DEG)
      : 0;
    object.rotation.set(0, THREE.MathUtils.degToRad(angle), 0);
    object.userData.state = state;
    object.userData.rotationAxis = 'y';
    object.userData.rotationDeg = angle;
  });
}

export function setNorthWallWardrobeDoorConfiguration(root: THREE.Object3D, configuration: NorthWallWardrobeDoorConfiguration): void {
  const leftOpen = configuration === 'left_open' || configuration === 'both_open';
  const rightOpen = configuration === 'right_open' || configuration === 'both_open';
  setNorthWallWardrobeDoorState(root, leftOpen ? 'open' : 'closed', 0);
  setNorthWallWardrobeDoorState(root, rightOpen ? 'open' : 'closed', 1);
}

export function getNorthWallWardrobeDoorAabb(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(root);
}

export function setNorthWallWardrobe950DoorState(rootOrGroup: THREE.Object3D, state: NorthWallWardrobe950DoorState, doorIndex?: number): void {
  rootOrGroup.traverse((object) => {
    const index = object.userData.doorIndex as number | undefined;
    if (index === undefined || (doorIndex !== undefined && doorIndex !== index)) return;
    const hingeSide = object.userData.hingeSide as 'left' | 'right';
    const angle = state === 'open'
      ? (hingeSide === 'left' ? -NORTH_WALL_WARDROBE_950_DOOR_OPEN_LIMIT_DEG : NORTH_WALL_WARDROBE_950_DOOR_OPEN_LIMIT_DEG)
      : 0;
    object.rotation.set(0, THREE.MathUtils.degToRad(angle), 0);
    object.userData.state = state;
    object.userData.rotationAxis = 'y';
    object.userData.rotationDeg = angle;
  });
}

export function setNorthWallWardrobe950DoorConfiguration(root: THREE.Object3D, configuration: NorthWallWardrobe950DoorConfiguration): void {
  const open = NORTH_WALL_WARDROBE_950_CONFIGURATION_OPEN[configuration];
  open.forEach((isOpen, index) => setNorthWallWardrobe950DoorState(root, isOpen ? 'open' : 'closed', index));
}

export function getNorthWallWardrobe950DoorAabb(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(root);
}

export function setNorthWallWardrobe650DoorState(rootOrGroup: THREE.Object3D, state: NorthWallWardrobe650DoorState, doorIndex?: number): void {
  rootOrGroup.traverse((object) => {
    const index = object.userData.doorIndex as number | undefined;
    if (index === undefined || (doorIndex !== undefined && doorIndex !== index)) return;
    const hingeSide = object.userData.hingeSide as 'left' | 'right';
    const angle = state === 'open'
      ? (hingeSide === 'left' ? -NORTH_WALL_WARDROBE_650_DOOR_OPEN_LIMIT_DEG : NORTH_WALL_WARDROBE_650_DOOR_OPEN_LIMIT_DEG)
      : 0;
    object.rotation.set(0, THREE.MathUtils.degToRad(angle), 0);
    object.userData.state = state;
    object.userData.rotationAxis = 'y';
    object.userData.rotationDeg = angle;
  });
}

export function setNorthWallWardrobe650DoorConfiguration(root: THREE.Object3D, configuration: NorthWallWardrobe650DoorConfiguration): void {
  const leftOpen = configuration === 'left_open' || configuration === 'both_open';
  const rightOpen = configuration === 'right_open' || configuration === 'both_open';
  setNorthWallWardrobe650DoorState(root, leftOpen ? 'open' : 'closed', 0);
  setNorthWallWardrobe650DoorState(root, rightOpen ? 'open' : 'closed', 1);
}

export function getNorthWallWardrobe650DoorAabb(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(root);
}

function buildNorthWallWardrobe650Fixture(): THREE.Group {
  const group = new THREE.Group();
  group.userData.fixtureType = 'master_north_wall_wardrobe_650';
  group.userData.defaultDoorState = 'closed';
  const recipe = FIXTURE_RECIPES.find((entry) => entry.type === 'master_north_wall_wardrobe_650');
  recipe?.parts.forEach((part, index) => addPart(group, 'master_north_wall_wardrobe_650', index, part));
  const doorWidth = 0.30;
  // 两扇约 300mm 窄平开门，铰链 [left,right]；±95° 扫掠不互碰，东缘退至 x=3.25 避 d_mb 门扇带。
  const hingeSides: Array<'left' | 'right'> = ['left', 'right'];
  [-0.155, 0.155].forEach((centerX, index) => {
    const hingeSide = hingeSides[index];
    const hingeX = centerX + (hingeSide === 'left' ? -doorWidth / 2 : doorWidth / 2);
    const pivot = new THREE.Group();
    pivot.name = `master_north_wall_wardrobe_650:door:${index + 1}`;
    pivot.position.set(hingeX, 0, 0.281);
    pivot.userData = { doorId: `master_north_wall_wardrobe_650:door:${index + 1}`, part: `north-wardrobe-650-door-root-${index}`, materialRole: 'door_root', doorIndex: index, hingeSide, state: 'closed', openLimitDeg: 95, rotationAxis: 'y', rotationDeg: 0 };
    const leaf = new THREE.Group();
    leaf.name = `master_north_wall_wardrobe_650:door-leaf:${index + 1}`;
    leaf.userData.doorLeaf = true;
    pivot.add(leaf);
    const panel = addBox(leaf, 'master_north_wall_wardrobe_650', index, [doorWidth, 2.36, 0.018], [hingeSide === 'left' ? doorWidth / 2 : -doorWidth / 2, 1.21, 0], '#a98258', { part: `north-wardrobe-650-door-${index}`, materialRole: 'door_front' });
    panel.userData.objectId = `master_north_wall_wardrobe_650:door:${index}:panel`;
    const handle = addBox(leaf, 'master_north_wall_wardrobe_650', index + 10, [0.018, 0.16, 0.018], [hingeSide === 'left' ? doorWidth - 0.055 : -doorWidth + 0.055, 1.05, 0], '#765334', { part: `north-wardrobe-650-handle-${index}`, materialRole: 'hardware', metalness: 0.75, roughness: 0.3 });
    handle.userData.objectId = `master_north_wall_wardrobe_650:door:${index}:handle`;
    const hinge = addBox(pivot, 'master_north_wall_wardrobe_650', index + 20, [0.018, 2.32, 0.018], [hingeSide === 'left' ? 0.01 : -0.01, 1.21, -0.002], '#765334', { part: `north-wardrobe-650-hinge-${index}`, materialRole: 'hardware', metalness: 0.65, roughness: 0.35 });
    hinge.userData.objectId = `master_north_wall_wardrobe_650:door:${index}:hinge`;
    group.add(pivot);
  });
  return group;
}

function buildNorthWallWardrobe950Fixture(): THREE.Group {
  const group = new THREE.Group();
  group.userData.fixtureType = 'master_north_wall_wardrobe_950';
  group.userData.defaultDoorState = 'closed';
  const recipe = FIXTURE_RECIPES.find((entry) => entry.type === 'master_north_wall_wardrobe_950');
  recipe?.parts.forEach((part, index) => addPart(group, 'master_north_wall_wardrobe_950', index, part));
  const doorWidth = 0.29;
  // 门扇间留 40mm 缝 + 铰链 [left, right, right]：±95° 开启时铰链侧扫掠回摆约 0.036m < 门缝 0.04m，
  // 任意组合开启（含单开中间门）AABB 包络互不干涉。
  const hingeSides: Array<'left' | 'right'> = ['left', 'right', 'right'];
  [-0.33, 0, 0.33].forEach((centerX, index) => {
    const hingeSide = hingeSides[index];
    const hingeX = centerX + (hingeSide === 'left' ? -doorWidth / 2 : doorWidth / 2);
    const pivot = new THREE.Group();
    pivot.name = `master_north_wall_wardrobe_950:door:${index + 1}`;
    pivot.position.set(hingeX, 0, 0.281);
    pivot.userData = { doorId: `master_north_wall_wardrobe_950:door:${index + 1}`, part: `north-wardrobe-950-door-root-${index}`, materialRole: 'door_root', doorIndex: index, hingeSide, state: 'closed', openLimitDeg: 95, rotationAxis: 'y', rotationDeg: 0 };
    const leaf = new THREE.Group();
    leaf.name = `master_north_wall_wardrobe_950:door-leaf:${index + 1}`;
    leaf.userData.doorLeaf = true;
    pivot.add(leaf);
    const panel = addBox(leaf, 'master_north_wall_wardrobe_950', index, [doorWidth, 2.41, 0.018], [hingeSide === 'left' ? doorWidth / 2 : -doorWidth / 2, 1.235, 0], '#a98258', { part: `north-wardrobe-950-door-${index}`, materialRole: 'door_front' });
    panel.userData.objectId = `master_north_wall_wardrobe_950:door:${index}:panel`;
    const handle = addBox(leaf, 'master_north_wall_wardrobe_950', index + 10, [0.018, 0.16, 0.018], [hingeSide === 'left' ? doorWidth - 0.055 : -doorWidth + 0.055, 1.075, 0], '#765334', { part: `north-wardrobe-950-handle-${index}`, materialRole: 'hardware', metalness: 0.75, roughness: 0.3 });
    handle.userData.objectId = `master_north_wall_wardrobe_950:door:${index}:handle`;
    const hinge = addBox(pivot, 'master_north_wall_wardrobe_950', index + 20, [0.018, 2.32, 0.018], [hingeSide === 'left' ? 0.01 : -0.01, 1.21, -0.002], '#765334', { part: `north-wardrobe-950-hinge-${index}`, materialRole: 'hardware', metalness: 0.65, roughness: 0.35 });
    hinge.userData.objectId = `master_north_wall_wardrobe_950:door:${index}:hinge`;
    group.add(pivot);
  });
  return group;
}

function buildNorthWallWardrobeFixture(): THREE.Group {
  const group = new THREE.Group();
  group.userData.fixtureType = 'master_north_wall_wardrobe_600';
  group.userData.defaultDoorState = 'closed';
  const recipe = FIXTURE_RECIPES.find((entry) => entry.type === 'master_north_wall_wardrobe_600');
  recipe?.parts.forEach((part, index) => addPart(group, 'master_north_wall_wardrobe_600', index, part));
  const doorWidth = 0.295;
  [-0.15, 0.15].forEach((centerX, index) => {
    const hingeSide = index === 0 ? 'left' : 'right' as const;
    const hingeX = centerX + (hingeSide === 'left' ? -doorWidth / 2 : doorWidth / 2);
    const pivot = new THREE.Group();
    pivot.name = `master_north_wall_wardrobe_600:door:${index + 1}`;
    pivot.position.set(hingeX, 0, 0.276);
    pivot.userData = { doorId: `master_north_wall_wardrobe_600:door:${index + 1}`, part: `north-wardrobe-door-root-${index}`, materialRole: 'door_root', doorIndex: index, hingeSide, state: 'closed', openLimitDeg: 95, rotationAxis: 'y', rotationDeg: 0 };
    const leaf = new THREE.Group();
    leaf.name = `master_north_wall_wardrobe_600:door-leaf:${index + 1}`;
    leaf.userData.doorLeaf = true;
    pivot.add(leaf);
    const panel = addBox(leaf, 'master_north_wall_wardrobe_600', index, [doorWidth, 1.95, 0.018], [hingeSide === 'left' ? doorWidth / 2 : -doorWidth / 2, 1.025, 0], '#a98258', { part: `north-wardrobe-door-${index}`, materialRole: 'door_front' });
    panel.userData.objectId = `master_north_wall_wardrobe_600:door:${index}:panel`;
    const handle = addBox(leaf, 'master_north_wall_wardrobe_600', index + 10, [0.018, 0.16, 0.018], [hingeSide === 'left' ? doorWidth - 0.055 : -doorWidth + 0.055, 1.025, 0], '#765334', { part: `north-wardrobe-handle-${index}`, materialRole: 'hardware', metalness: 0.75, roughness: 0.3 });
    handle.userData.objectId = `master_north_wall_wardrobe_600:door:${index}:handle`;
    const hinge = addBox(pivot, 'master_north_wall_wardrobe_600', index + 20, [0.018, 1.92, 0.018], [hingeSide === 'left' ? 0.01 : -0.01, 1.025, 0.005], '#765334', { part: `north-wardrobe-hinge-${index}`, materialRole: 'hardware', metalness: 0.65, roughness: 0.35 });
    hinge.userData.objectId = `master_north_wall_wardrobe_600:door:${index}:hinge`;
    group.add(pivot);
  });
  return group;
}

function buildPartitionWardrobeFixture(): THREE.Group {
  const group = new THREE.Group();
  group.userData.fixtureType = 'master_partition_wardrobe_1600';
  group.userData.defaultDoorState = 'closed';
  const recipe = FIXTURE_RECIPES.find((entry) => entry.type === 'master_partition_wardrobe_1600');
  recipe?.parts.forEach((part, index) => addPart(group, 'master_partition_wardrobe_1600', index, part));
  const doorWidth = 0.36;
  const doorCenters = [-0.60, -0.20, 0.20, 0.60];
  doorCenters.forEach((centerX, index) => {
    const hingeSide = index % 2 === 0 ? 'left' : 'right' as const;
    const hingeX = centerX + (hingeSide === 'left' ? -doorWidth / 2 : doorWidth / 2);
    const pivot = new THREE.Group();
    pivot.name = `master_partition_wardrobe_1600:door:${index + 1}`;
    pivot.userData = {
      objectId: `master_partition_wardrobe_1600:door:${index + 1}`,
      part: `partition-door-root-${index + 1}`,
      materialRole: 'door_root',
      doorIndex: index,
      hingeSide,
      state: 'closed',
      openLimitDeg: 95,
    };
    pivot.position.set(hingeX, 0, 0.281);
    const leaf = new THREE.Group();
    leaf.name = `master_partition_wardrobe_1600:door-leaf:${index + 1}`;
    leaf.userData.doorLeaf = true;
    pivot.add(leaf);
    const panel = addBox(leaf, 'master_partition_wardrobe_1600', index, [doorWidth, 2.02, 0.018], [hingeSide === 'left' ? doorWidth / 2 : -doorWidth / 2, 1.075, 0], '#c4b39e', { part: `partition-door-${index + 1}`, materialRole: 'door_front' });
    panel.userData.objectId = `master_partition_wardrobe_1600:door:${index + 1}:panel`;
    const handle = addBox(leaf, 'master_partition_wardrobe_1600', index + 10, [0.018, 0.16, 0.018], [hingeSide === 'left' ? doorWidth - 0.055 : -doorWidth + 0.055, 1.075, 0], '#765334', { part: `partition-handle-${index + 1}`, materialRole: 'hardware', metalness: 0.75, roughness: 0.3 });
    handle.userData.objectId = `master_partition_wardrobe_1600:door:${index + 1}:handle`;
    const seam = addBox(leaf, 'master_partition_wardrobe_1600', index + 20, [0.012, 2.02, 0.012], [hingeSide === 'left' ? doorWidth - 0.01 : -doorWidth + 0.01, 1.075, 0], '#806c57', { part: `partition-door-seam-${index + 1}`, materialRole: 'door_seam' });
    seam.userData.objectId = `master_partition_wardrobe_1600:door:${index + 1}:seam`;
    const hinge = addBox(pivot, 'master_partition_wardrobe_1600', index + 30, [0.018, 2.00, 0.018], [hingeSide === 'left' ? 0.01 : -0.01, 1.075, 0.005], '#765334', { part: `partition-hinge-${index + 1}`, materialRole: 'hardware', metalness: 0.65, roughness: 0.35 });
    hinge.userData.objectId = `master_partition_wardrobe_1600:door:${index + 1}:hinge`;
    group.add(pivot);
  });
  return group;
}

export function buildFixture(type: string): THREE.Group | null {
  if (type === 'master_partition_wardrobe_1600') return buildPartitionWardrobeFixture();
  if (type === 'master_north_wall_wardrobe_600') return buildNorthWallWardrobeFixture();
  if (type === 'master_north_wall_wardrobe_950') return buildNorthWallWardrobe950Fixture();
  if (type === 'master_north_wall_wardrobe_650') return buildNorthWallWardrobe650Fixture();
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
