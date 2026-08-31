import * as fs from 'fs';
import { parseProjectRenderFactsProjection } from '../../shared/project-render-facts-schema.js';
import type { ProjectRenderFactsProjection } from '../../shared/types.js';

// 生成 dress_scene.py 的输入配置：共享 render projection 灯光点位 + 固定场景常量 + 机位
// 场景固定为两个决策工况（蓝调时刻 / 夜晚），sun_direction 为预计算常量（Blender 坐标系，
// 指向太阳方向：+X 东 / +Y 北 / +Z 上）。视频等"任意时刻"需求后续再引入时间轴，当前决策渲染不需要。
//
// ⚠️ 本文件必须与 render-config.json 保持一致：2026-08-23 前 JSON 曾被手工改漂移
// （曝光/机位/日光参数），重新生成会回退 v17→v32 的机位修复。改机位/工况请改这里再重新生成，
// 或直接改 JSON 后把改动同步回本文件。

export function buildRenderConfig(projection: ProjectRenderFactsProjection) {
const lights = projection.lightingFixtures.map((fixture) => ({
  id: fixture.id,
  room: fixture.room,
  type: fixture.type,
  x: fixture.position.x,
  z: fixture.position.z,
  height: fixture.position.y,
  temp: fixture.temperatureK,
  ...(fixture.circuit !== undefined ? { circuit: fixture.circuit } : {}),
  ...(fixture.heads !== undefined ? { heads: fixture.heads } : {}),
  ...(fixture.recessed !== undefined ? { recessed: fixture.recessed } : {}),
  ...(fixture.type === 'track_light' && projection.lighting ? { track: projection.lighting.fixtures.find((config) => config.id === fixture.id) } : {}),
}));

// 场景固定常量：蓝调时刻/夜晚。太阳已落 → sun_direction=null（不打太阳光）；
// 天光用自定义背景色（蓝调=深蓝、夜晚=近黑蓝），保证玻璃透出可见天色而非 HOSEK_WILKIE 的黑暗天际。
// 视频等"任意时刻"需求后续再引入时间轴，当前决策渲染不需要。
// 渲染行为全部配置化（施工说明：Blender 端零手工状态）：
//   exposure: AgX 曝光；sheer_opacity: 纱帘布料权重（窗帘显隐由 facts.presentation.curtains
//   快照 + GLB active-only 节点决定，scenario 不再携带 sheer_state/blackout_state）
const scenarios = [
  {
    id: 'blue_hour',
    label: '蓝调时刻（窗外 HDRi 海边日落外景、室内暖灯）',
    sun_direction: null,
    world_hdri: 'hdri/the_sky_is_on_fire_1k.hdr',
    // 只冷却窗外可见背景；室内 world/background 与 3200K 暖灯保持独立。
    world_hdri_lighting: true,
    world_hdri_camera_strength: 1.0,
    world_hdri_camera_tint: { color: '#5a8fd0', strength: 0.6 },
    // 室内环境填充改为暖中性；窗外冷色仍由 camera HDRI tint 独立控制。
    world_color: '#8a7868',
    world_strength: 0.65,
    lights_on: true,
    light_temp: 2800,
    view_transform: 'AgX',
    look: 'None',
    exposure: 0.75,
    sheer_opacity: 0.35,
  },
  {
    id: 'night',
    label: '夜晚（窗外 HDRi 星夜+城市灯光、室内灯为主光）',
    sun_direction: null,
    world_hdri: 'hdri/kloppenheim_02_1k.hdr',
    world_color: '#060a14',
    world_strength: 0.15,
    lights_on: true,
    view_transform: 'AgX',
    look: 'None',
    exposure: 0.5,
    sheer_opacity: 0.35,
  },
  // 材质评审工况（material-review-mode spec）：无调色、中性白光——决策色号/拼法用。
  // 2026-08-23：实体色板机制废弃（西墙色板被电视柜墙挡死），选色改用 dress_scene --mat-override
  // 循环渲染整场景对比。
  {
    id: 'material_review',
    label: '材质评审（Standard 无调色、6500K 中性白；2026-08-23 色板机制废弃，选色改 --mat-override 循环渲染）',
    sun_direction: null,
    world_color: '#808080',
    world_strength: 0.3,
    lights_on: true,
    light_temp: 6500,
    view_transform: 'Standard',
    look: 'None',
    // Standard/6500K 评审统一降 1 EV，避免白色硬装裁剪。
    exposure: 0.5,
    sheer_opacity: 0.35,
  },
  // 硬装裸房验收：material_review 同款光照（Standard/6500K 中性白），但 dress_scene 按
  // scenario id 隐藏一切可移动家具/软装；窗帘经 curtainPolicy=hidden_for_bare_shell 隐藏，
  // 只留墙地顶/定制柜/门窗/灯具/洁具/橱柜。
  {
    id: 'hvac_coordination',
    label: 'HVAC 协调审阅（仅此场景显示事实图路线）',
    sun_direction: null,
    world_color: '#808080',
    world_strength: 0.3,
    lights_on: true,
    light_temp: 6500,
    view_transform: 'Standard',
    look: 'None',
    exposure: 1.0,
    hvac_coordination: true,
  },
  {
    id: 'bare_shell',
    label: '硬装裸房验收（material_review 光照参数，隐藏可移动家具/软装/窗帘）',
    sun_direction: null,
    world_color: '#808080',
    world_strength: 0.3,
    lights_on: true,
    light_temp: 6500,
    view_transform: 'Standard',
    look: 'None',
    // 裸房与材质评审共用校准后的中性曝光，避免厨房白色硬装过曝。
    exposure: 0.5,
    sheer_opacity: 0.35,
    curtainPolicy: 'hidden_for_bare_shell',
  },
  // 白天自然光工况：对照真实照片（手机白天拍摄=高漫反射环境光、不开灯、柔光地板反光）
  // 外景=真 HDR（kloofendal 白天多云，仅相机/透射光线可见，照明仍用中性 world_color 防染色）；
  // 太阳=西南向午后直射（Blender 坐标：-X 西 / -Y 南 / +Z 上），阳光入射南玻璃幕墙在地板投光斑
  {
    id: 'daylight',
    label: '白天自然光（HDRi 白天外景+西南向太阳直射、不开灯、对照实景照片）',
    sun_direction: [-0.3, -0.6, 0.7],
    // HDRI 负责环境天光，Sun 只保留方向性日照；不再叠加 window_portal。
    sun_energy: 4,
    sun_temp: 4500,
    world_hdri: 'hdri/kloofendal_48d_partly_cloudy_1k.hdr',
    world_hdri_lighting: true,
    world_hdri_camera_strength: 1.0,
    world_color: '#c8c8c8',
    world_strength: 0.55,
    lights_on: false,
    light_temp: 6500,
    view_transform: 'AgX',
    look: 'None',
    // 客餐厅正式审美图：保留窗外层次，同时抬升深色家具与地面暗部可读性。
    exposure: -0.5,
    sheer_opacity: 0.25,
    glass_ior: 1.02, // daylight 室内很亮，Low-E 玻璃 IOR 1.5 会变镜子盖住外景；≈1.02 近零反射只留透射
  },
  // 超白玻对比工况：daylight 全部参数不动，仅 glass_tint 中性近无色（#e8f0ee），
  // 与 daylight（浮法/Low-E 青绿 #c8e0dc）同机位对比玻璃色相。glass_tint 由 dress_scene 应用。
  {
    id: 'daylight_clear',
    label: '白天自然光·超白玻（daylight 参数 + 玻璃中性 #e8f0ee，对比浮法绿）',
    sun_direction: [-0.3, -0.6, 0.7],
    sun_energy: 4,
    sun_temp: 4500,
    world_hdri: 'hdri/kloofendal_48d_partly_cloudy_1k.hdr',
    world_hdri_lighting: true,
    world_hdri_camera_strength: 1.0,
    world_color: '#c8c8c8',
    world_strength: 0.55,
    lights_on: false,
    light_temp: 6500,
    view_transform: 'AgX',
    look: 'None',
    exposure: -0.5,
    sheer_opacity: 0.25,
    glass_ior: 1.02,
    glass_tint: '#e8f0ee',
  },
];

const cameras = [
  {
    id: 'living_sofa_glass',
    label: '客厅餐桌侧南望沙发+玻璃幕（全景）',
    position: [10.3, 1.55, 2.9],
    target: [9.6, 1.2, 8.6],
    scenarios: ['material_review', 'blue_hour', 'daylight', 'daylight_clear', 'bare_shell', 'hvac_coordination'],
    // 仅抬升客厅两种正式体验图的室内中间调，避免窗外高光与 Low-E 透景被曝光牵连。
    scenario_overrides: {
      daylight: { fill_light: 180, fill_from_camera: true },
      blue_hour: { fill_light: 95, fill_from_camera: true },
    },
  },
  {
    id: 'master_bed_looking_glass',
    // daylight/daylight_clear 用于 Low-E/超白玻璃 A/B，对比主卧自然光下的玻璃透景与色相；中心线对准主卧南窗纱帘中部。
    label: '主卧西侧看床+南窗（2026-08-22 随条带归主卧；避条带柜/衣柜背板；Low-E/超白玻璃 A/B）',
    position: [0.2, 1.8, 5.0],
    target: [2.5, 1.0, 8.95],
    scenarios: ['material_review', 'daylight', 'daylight_clear', 'bare_shell'],
    fill_light: 160,
    exposure: -1.0,
    scenario_overrides: {
      daylight_clear: { sheer_opacity: 0.40 },
    },
  },
  // 材质评审特写机位（35mm，只出 material_review 工况）
  {
    id: 'living_floor_closeup',
    label: '客厅地板 45° 特写（拼法/色号）',
    position: [9.9, 1.4, 6.1],
    target: [9.3, 0.0, 7.4],
    lens: 35,
    scenarios: ['material_review'],
  },
  {
    // 2026-08-23：原"西墙+地板交界"机位改拍电视墙——西墙漆色板被柜墙挡死（D4），
    // 且 65 寸电视无任何正对机位（E3）。一机位解两条。
    id: 'living_west_wall',
    label: '客厅电视墙正视（柜墙+65寸电视+灯带；2026-08-23 由西墙色板机位改，色板机制废弃见 E3/D4）',
    position: [10.5, 1.5, 8.0],
    target: [7.2, 1.1, 8.0],
    lens: 28,
    scenarios: ['material_review', 'blue_hour'],
    // Render-only A/B：blue_hour 平均亮度 0.223；40W 相机同轴区域补光只提亮本机位电视墙，
    // 不改全局工况，也不影响其他机位。
    scenario_overrides: {
      blue_hour: { fill_light: 40, fill_from_camera: true },
    },
  },
  {
    id: 'bedroom_floor_closeup',
    label: '主卧地板特写（床西侧空地）',
    position: [1, 1.4, 6.6],
    target: [1.7, 0.0, 7.9],
    lens: 35,
    scenarios: ['material_review'],
    fill_light: 80,
    // Cloud A/B（32 samples）压过曝：高亮 80.8% → 3.9%，保留材质暗部细节。
    exposure: 0.0,
  },
  {
    id: 'bedroom_west_wall',
    label: '主卧西墙+地板交界（墙面色号；2026-08-22 东移避窗帘布料）',
    position: [3.6, 1.7, 6.4],
    target: [0.2, 1.3, 7.6],
    lens: 35,
    scenarios: ['material_review'],
    fill_light: 80,
    // Cloud A/B（32 samples）压过曝：高亮 49.1% → 9.9%。
    exposure: 0.0,
  },
  // 厨房南侧开放区唯一首选斜向东北机位：将冰箱压到右侧边缘，并保持 L 型工作区同框。
  {
    id: 'kitchen_l_overview',
    label: '厨房 L 型全景（北墙水槽+东墙灶台+冰箱）',
    position: [7.85, 1.55, 5.35],
    target: [9.15, 1.05, 1.20],
    lens: 24,
    scenarios: ['material_review', 'blue_hour', 'bare_shell'],
  },
  {
    id: 'kitchen_counter_closeup',
    label: '厨房台面+地柜门特写（台面/柜门选材）',
    position: [8.15, 1.65, 2.05],
    target: [9.55, 0.9, 0.72],
    lens: 40,
    fill_light: 500,
    exposure: 0.8,
    scenarios: ['material_review'],
  },
  {
    id: 'kitchen_function_overview',
    label: '厨房功能关系审查（无遮挡 L 型工作区）',
    position: [7.10, 1.65, 4.20],
    target: [9.85, 0.95, 1.10],
    lens: 24,
    fill_light: 420,
    exposure: 0.0,
    scenarios: ['material_review'],
  },
  {
    id: 'kitchen_cooktop_closeup',
    label: '厨房灶台+东墙台面特写（炉圈/旋钮/台面收口）',
    position: [9.15, 1.55, 1.05],
    target: [10.50, 0.92, 1.18],
    lens: 50,
    fill_light: 300,
    exposure: 0.5,
    scenarios: ['material_review'],
  },
  // 全屋巡览机位（每房一张）
  {
    id: 'dining_overview',
    label: '餐厅全景（餐桌椅）',
    position: [10.6, 1.5, 4.6],
    target: [8.3, 0.9, 3.2],
    lens: 24,
    scenarios: ['material_review', 'blue_hour', 'daylight_clear', 'bare_shell'],
    scenario_overrides: {
      daylight_clear: { exposure: 0.0, fill_light: 180 },
    },
  },
  {
    id: 'study_overview',
    label: '父母房全景',
    position: [6.9, 1.5, 9.5],
    target: [4.6, 0.9, 6.0],
    lens: 24,
    scenarios: ['material_review', 'bare_shell'],
    // Cloud A/B 二次验证：高亮降至 4–5%，父母房仍保持可读。
    exposure: -0.5,
  },
  {
    id: 'bedroom_se_overview',
    label: '书房全景（南望飘窗+书桌；v27 改向：北墙视角有未解阴影异常，南向采光面更适合作全景）',
    position: [14.20, 1.8, 5.85],
    target: [15.0, 1.0, 7.55],
    lens: 18,
    scenarios: ['material_review', 'bare_shell'],
    fill_light: 160,
    // Cloud A/B：书房南侧采光仍过强，降低 material_review 高光以恢复墙地边界。
    exposure: -1.0,
  },
  {
    id: 'study_work_detail',
    label: '书房工作区辅助视角（桌面/椅子/低柜）',
    position: [13.65, 1.35, 8.35],
    target: [15.30, 0.85, 8.05],
    lens: 28,
    scenarios: ['material_review'],
    fill_light: 180,
    exposure: -0.5,
  },
  {
    id: 'bedroom_nw_overview',
    label: '儿童房全景',
    position: [5.3, 1.5, 4.0],
    target: [2.9, 0.9, 1.4],
    lens: 24,
    scenarios: ['material_review', 'bare_shell'],
    // Cloud A/B（32 samples）压过曝：material_review 高亮 67.7% → 16.9%。
    exposure: 0.0,
  },
  {
    id: 'master_bath_overview',
    label: '主卫干湿分离（正南平视朝北，右台盆左淋浴）',
    position: [1.75, 1.45, 2.00],
    target: [2.15, 0.85, 1.55],
    lens: 16,
    scenarios: ['material_review', 'bare_shell'],
    fill_light: 120,
  },
  {
    id: 'master_bath_floor_detail',
    label: '主卫干湿区辅助视角（地面/隔断/洁具关系）',
    position: [1.05, 1.35, 2.20],
    target: [1.85, 0.75, 1.45],
    lens: 24,
    scenarios: ['material_review'],
    fill_light: 150,
    exposure: 0.0,
  },
  {
    id: 'master_bath_high_view',
    label: '主卫高位辅助视角（地面/淋浴隔断/马桶）',
    position: [1.55, 2.55, 3.25],
    target: [1.65, 0.0, 1.70],
    lens: 20,
    scenarios: ['material_review'],
    fill_light: 180,
    exposure: 0.0,
  },
  {
    id: 'guest_bath_overview',
    label: '客卫全景（门外斜视，南墙外置洗漱台）',
    position: [5.98, 1.55, 4.08],
    target: [6.68, 0.75, 3.18],
    lens: 16,
    scenarios: ['material_review', 'bare_shell'],
    fill_light: 60,
    // 门外斜视方案：从客卫门外取景，兼顾淋浴区与南墙外置洗漱台。
    exposure: -1.5,
  },
  {
    id: 'guest_bath_vanity_detail',
    label: '客卫洗漱台辅助视角（柜体/台面/龙头）',
    position: [6.25, 1.45, 4.10],
    target: [6.85, 0.90, 3.90],
    lens: 35,
    scenarios: ['material_review'],
    fill_light: 140,
    exposure: -0.5,
  },
  {
    // 从厨房东侧后移取景，露出阳台设备墙
    id: 'balcony_overview',
    label: '生活阳台俯视（1.6×1.2m 极小阳台+玻璃门隔断，高位俯视）',
    position: [9.20, 1.70, 2.05],
    target: [6.45, 0.90, 1.35],
    lens: 18,
    scenarios: ['material_review'],
    fill_light: 80,
    // Render-only A/B：material_review 高亮 47.4%（fill_light 80）；仅本机位降曝光以保留阳台材质细节。
    scenario_overrides: {
      material_review: { exposure: -0.5 },
    },
  },
  {
    id: 'entry_overview',
    label: '入户花园/玄关（2026-08-22 改向东北看望换鞋站+栏杆）',
    position: [11.1, 1.6, 2.4],
    target: [14.8, 0.8, 0.9],
    lens: 24,
    scenarios: ['material_review', 'bare_shell'],
  },
  // 客厅多视角/距离 + 过道（地板现方案 veneer_matched 验证）
  {
    id: 'living_from_entry',
    label: '入户门口望客厅全景（远距离东北→西南）',
    position: [12.2, 1.65, 4.3],
    target: [8.6, 0.9, 8.0],
    lens: 20,
    scenarios: ['material_review', 'daylight', 'bare_shell'],
  },
  {
    id: 'living_from_sw',
    label: '客厅西南角回望餐厅+厨房（远距离反向）',
    position: [7.7, 1.6, 8.95],
    target: [11.5, 0.9, 3.0],
    lens: 20,
    scenarios: ['material_review', 'daylight'],
  },
  {
    id: 'living_floor_mid',
    label: '客厅中距地板延展（站高 1.2m 看通铺）',
    position: [10.3, 1.2, 6.2],
    target: [10.3, 0.0, 3.4],
    lens: 24,
    scenarios: ['material_review', 'daylight'],
  },
  {
    id: 'corridor_view',
    label: '过道西望（走廊口→主卧/父母房门方向）',
    position: [7.45, 1.55, 5.25],
    target: [4.4, 0.9, 4.6],
    lens: 20,
    scenarios: ['material_review', 'bare_shell'],
    fill_light: 80,
  },
];

return {
  sun: scenarios[0].sun_direction,
  lights,
  facts: projection,
  scenarios,
  cameras,
};
}

export function serializeRenderConfig(projection: ProjectRenderFactsProjection): string {
  return `${JSON.stringify(buildRenderConfig(projection), null, 2)}\n`;
}

function main(): void {
  const projection = parseProjectRenderFactsProjection(
    JSON.parse(fs.readFileSync('scripts/blender/project-render-facts.json', 'utf8')),
  );
  const config = buildRenderConfig(projection);
  fs.writeFileSync('scripts/blender/render-config.json', `${JSON.stringify(config, null, 2)}\n`);
  console.log(`render-config.json: ${config.lights.length} lights, ${projection.plumbing.length} plumbing, ${projection.ceiling.length} ceiling zones, ${config.scenarios.length} scenarios, ${config.cameras.length} cameras`);
}

if (process.argv[1] && /gen-render-config\.(ts|js)$/u.test(process.argv[1])) main();
