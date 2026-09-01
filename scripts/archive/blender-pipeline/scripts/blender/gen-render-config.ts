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

type CameraPurpose = 'overview' | 'relationship' | 'detail' | 'auxiliary';

const cameraMetadata: Record<string, {
  room: string;
  purpose: CameraPurpose;
  decisionQuestions: string[];
}> = {
  living_sofa_glass: {
    room: 'living_dining',
    purpose: 'relationship',
    decisionQuestions: ['沙发与玻璃幕墙的尺度关系是否协调？', '窗帘与室内采光、隐私是否满足？'],
  },
  master_bed_looking_glass: {
    room: 'master_bedroom',
    purpose: 'relationship',
    decisionQuestions: ['床、窗帘与南窗的关系是否协调？', 'Low-E 与超白玻璃色相哪一版更合适？'],
  },
  master_bedroom_entry_context: {
    room: 'master_bedroom',
    purpose: 'relationship',
    decisionQuestions: ['从入口看床、窗帘与玻璃的整体关系是否协调？', '床侧活动区与入口通道是否保持顺畅？'],
  },
  master_bedroom_relationship_overview: {
    room: 'master_bedroom',
    purpose: 'relationship',
    decisionQuestions: ['床与衣柜的尺度、位置及使用关系是否协调？', '西侧玻璃/窗帘与床侧通道的采光、隐私和通行关系是否合理？'],
  },
  master_bedroom_window_context: {
    room: 'master_bedroom',
    purpose: 'relationship',
    decisionQuestions: ['南侧窗帘与玻璃的完整关系是否清晰？', '床体、床侧通道与衣柜之间的尺度和通行关系是否合理？'],
  },
  living_floor_closeup: {
    room: 'living_dining',
    purpose: 'detail',
    decisionQuestions: ['地板拼法是否连续自然？', '色号与墙面、家具是否协调？'],
  },
  living_west_wall: {
    room: 'living_dining',
    purpose: 'detail',
    decisionQuestions: ['电视、柜体与灯带比例是否合适？', '墙面材质在暖光下是否稳定？'],
  },
  bedroom_floor_closeup: {
    room: 'master_bedroom',
    purpose: 'detail',
    decisionQuestions: ['地板暗部细节是否可读？', '铺装方向与床区关系是否合适？'],
  },
  bedroom_west_wall: {
    room: 'master_bedroom',
    purpose: 'detail',
    decisionQuestions: ['墙地交界是否清晰利落？', '墙面色号与地板是否协调？'],
  },
  kitchen_l_overview: {
    room: 'kitchen',
    purpose: 'overview',
    decisionQuestions: ['水槽、灶台与冰箱动线是否清晰？', 'L 型柜体与开放空间是否协调？'],
  },
  kitchen_counter_closeup: {
    room: 'kitchen',
    purpose: 'detail',
    decisionQuestions: ['台面与柜门色材是否协调？', '门板收口与操作尺度是否合适？'],
  },
  kitchen_function_overview: {
    room: 'kitchen',
    purpose: 'relationship',
    decisionQuestions: ['主要备餐动线是否顺畅？', '操作区是否存在遮挡或拥挤？'],
  },
  kitchen_function_reverse_se: {
    room: 'kitchen',
    purpose: 'relationship',
    decisionQuestions: ['水槽—灶台—冰箱三角动线是否清晰？', 'L 型柜体的转角、连续性与操作区关系是否协调？'],
  },
  kitchen_cooktop_closeup: {
    room: 'kitchen',
    purpose: 'detail',
    decisionQuestions: ['灶台与墙面收口是否完整？', '炉圈、旋钮与台面细节是否清晰？'],
  },
  dining_overview: {
    room: 'living_dining',
    purpose: 'overview',
    decisionQuestions: ['餐桌椅尺度与通行空间是否合适？', '餐区与客厅的视觉层次是否清晰？'],
  },
  study_overview: {
    room: 'study',
    purpose: 'overview',
    decisionQuestions: ['床、衣柜与通行空间是否合适？', '未来客房/书房转换是否保留？'],
  },
  bedroom_se_overview: {
    room: 'bedroom_se',
    purpose: 'overview',
    decisionQuestions: ['书桌、椅子与飘窗采光是否匹配？', '通顶柜与工作区是否压迫？'],
  },
  bedroom_se_entry_context: {
    room: 'bedroom_se',
    purpose: 'relationship',
    decisionQuestions: ['从入口看桌椅、训练区、低柜与南侧飘窗/玻璃的关系是否清晰？', '入口通道与桌椅、训练区、低柜之间的通行关系是否顺畅？'],
  },
  bedroom_se_relationship_overview: {
    room: 'bedroom_se',
    purpose: 'relationship',
    decisionQuestions: ['书桌、椅子与东墙低柜的尺度、位置及使用关系是否协调？', '南侧飘窗/玻璃、训练区边界与入口通道的关系是否清晰、顺畅？'],
  },
  study_work_detail: {
    room: 'bedroom_se',
    purpose: 'detail',
    decisionQuestions: ['桌椅与低柜的尺度、位置及使用关系是否协调？', '桌前使用尺度与活动空间是否满足日常工作？'],
  },
  bedroom_nw_overview: {
    room: 'bedroom_nw',
    purpose: 'overview',
    decisionQuestions: ['床、衣柜与活动空间是否合适？', '北窗采光与家具布置是否协调？'],
  },
  bedroom_nw_relationship: {
    room: 'bedroom_nw',
    purpose: 'relationship',
    decisionQuestions: ['床、衣柜与书桌椅的尺度、位置及使用关系是否协调？', '北窗采光与入口通道是否清晰、顺畅？'],
  },
  master_bath_overview: {
    room: 'master_bath',
    purpose: 'overview',
    decisionQuestions: ['淋浴、马桶与通行距离是否合理？', '玻璃隔断是否有效区分干湿区？'],
  },
  master_bath_door_relationship: {
    room: 'master_bath',
    purpose: 'relationship',
    decisionQuestions: ['门洞与门扇开启范围是否清晰？', '门洞、门扇与马桶、淋浴及玻璃隔断的关系是否合理？'],
  },
  master_bath_floor_detail: {
    room: 'master_bath',
    purpose: 'detail',
    decisionQuestions: ['地面排水与干湿边界是否清楚？', '洁具与隔断收口是否完整？'],
  },
  master_bath_high_view: {
    room: 'master_bath',
    purpose: 'auxiliary',
    decisionQuestions: ['高位视角下干湿分区是否清晰？', '马桶与淋浴区是否存在视觉或使用冲突？'],
  },
  guest_bath_overview: {
    room: 'guest_bath',
    purpose: 'overview',
    decisionQuestions: ['门洞、马桶与淋浴动线是否顺畅？', '外置洗漱台与过道是否冲突？'],
  },
  guest_bath_fixture_reverse: {
    room: 'guest_bath',
    purpose: 'relationship',
    decisionQuestions: ['马桶、淋浴与玻璃隔断的尺度、位置及干湿分区关系是否合理？', '门洞、外置洗手台与通道的开启、使用和通行关系是否顺畅？'],
  },
  guest_bath_door_relationship: {
    room: 'guest_bath',
    purpose: 'relationship',
    decisionQuestions: ['门洞与门扇开启范围是否清晰？', '门洞、门扇与洁具、外置洗手台及过道的关系是否合理？'],
  },
  guest_bath_vanity_detail: {
    room: 'guest_bath',
    purpose: 'detail',
    decisionQuestions: ['台面、柜体与龙头比例是否协调？', '靠墙安装与检修空间是否明确？'],
  },
  balcony_overview: {
    room: 'balcony',
    purpose: 'overview',
    decisionQuestions: ['小阳台设备与通行空间是否冲突？', '玻璃门隔断与厨房关系是否清晰？'],
  },
  balcony_utility_wall: {
    room: 'balcony',
    purpose: 'relationship',
    decisionQuestions: ['洗衣机与烘干机叠放后，设备前通道是否满足使用与检修？', '玻璃门开启范围与洗烘设备墙之间的关系是否合理？'],
  },
  entry_overview: {
    room: 'entry_garden',
    purpose: 'overview',
    decisionQuestions: ['换鞋站是否便于入户动线？', '栏杆、柜体与消防通道是否冲突？'],
  },
  living_from_entry: {
    room: 'living_dining',
    purpose: 'relationship',
    decisionQuestions: ['入户后的视线层次是否自然？', '客厅通行与家具布置是否顺畅？'],
  },
  living_from_sw: {
    room: 'living_dining',
    purpose: 'relationship',
    decisionQuestions: ['客餐厨之间的空间联系是否清晰？', '家具与主要通道是否互不干扰？'],
  },
  living_floor_mid: {
    room: 'living_dining',
    purpose: 'detail',
    decisionQuestions: ['地板铺装方向是否拉伸空间？', '客厅至餐厨的地面连续性是否自然？'],
  },
  corridor_view: {
    room: 'living_dining',
    purpose: 'relationship',
    decisionQuestions: ['走廊净宽与开门关系是否合理？', '卧室入口的视线与私密性是否合适？'],
  },
};

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
    position: [1.2, 2.2, 3.7],
    target: [3.0, 1.05, 8.55],
    scenarios: ['material_review', 'daylight', 'daylight_clear', 'bare_shell'],
    fill_light: 160,
    exposure: -1.0,
    scenario_overrides: {
      daylight_clear: { sheer_opacity: 0.40 },
    },
  },
  {
    id: 'master_bedroom_entry_context',
    label: '主卧入口斜看床+南窗玻璃+床侧通道',
    position: [1.45, 1.65, 6.55],
    target: [2.85, 1.05, 8.75],
    lens: 24,
    scenarios: ['daylight_clear', 'material_review'],
  },
  {
    id: 'master_bedroom_relationship_overview',
    label: '主卧西侧通道看床+衣柜+西侧玻璃/窗帘关系总览',
    position: [0.70, 1.60, 6.85],
    target: [2.65, 1.05, 8.15],
    lens: 20,
    scenarios: ['material_review', 'daylight_clear'],
  },
  {
    id: 'master_bedroom_window_context',
    label: '主卧北侧入口向南窗看床体+床侧通道+衣柜',
    position: [0.75, 1.65, 5.40],
    target: [2.60, 1.05, 8.65],
    lens: 18,
    scenarios: ['material_review', 'daylight_clear'],
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
    scenario_overrides: {
      material_review: { exposure: -0.75 },
    },
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
    position: [7.20, 2.30, 5.85],
    target: [9.35, 1.00, 1.35],
    lens: 24,
    fill_light: 420,
    exposure: -1.0,
    scenarios: ['material_review'],
  },
  {
    id: 'kitchen_function_reverse_se',
    label: '厨房南侧开放口功能视角（避开餐桌，水槽—灶台—冰箱及 L 型柜体）',
    position: [9.25, 1.55, 3.55],
    target: [9.75, 1.05, 0.95],
    lens: 28,
    scenarios: ['material_review', 'daylight_clear'],
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
    id: 'bedroom_se_entry_context',
    label: '书房入口关系机位（桌椅、训练区、低柜、南侧飘窗/玻璃与通道）',
    position: [13.80, 1.60, 6.20],
    target: [15.20, 1.05, 7.35],
    lens: 18,
    scenarios: ['material_review'],
  },
  {
    id: 'bedroom_se_relationship_overview',
    label: '书房东侧斜向关系总览（避开训练架，书桌、椅子、东墙低柜、南侧飘窗/玻璃与入口通道）',
    position: [16.05, 1.60, 5.85],
    target: [14.70, 1.05, 7.50],
    lens: 19,
    scenarios: ['material_review'],
  },
  {
    id: 'study_work_detail',
    label: '书房东侧桌椅工作区辅助视角（避开训练架横杆；桌椅/桌前使用尺度）',
    position: [15.80, 1.50, 6.40],
    target: [14.20, 0.90, 8.00],
    lens: 20,
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
    id: 'bedroom_nw_relationship',
    label: '儿童房门外右侧开阔关系视角（床+衣柜+书桌椅+窗+入口通道）',
    position: [5.72, 2.05, 4.78],
    target: [3.95, 1.05, 2.45],
    lens: 18,
    scenarios: ['material_review'],
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
    id: 'master_bath_door_relationship',
    label: '主卫门洞门扇关系视角（入口外侧看门洞/门扇/淋浴/马桶/外置洗手台）',
    position: [1.55, 1.65, 4.65],
    target: [1.45, 1.00, 1.55],
    lens: 18,
    scenarios: ['material_review'],
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
    label: '客卫门外三分之四总览（马桶、淋浴与外置洗漱台）',
    position: [5.15, 1.55, 4.65],
    target: [6.45, 0.95, 3.15],
    lens: 20,
    scenarios: ['material_review', 'bare_shell'],
    fill_light: 60,
    // 门外三分之四方案：从客卫门外取景，兼顾马桶、淋浴区与外置洗漱台。
    exposure: -1.5,
  },
  {
    id: 'guest_bath_fixture_reverse',
    label: '客卫洁具反向关系视角（马桶/淋浴/玻璃隔断/门洞/外置洗手台/通道）',
    position: [5.80, 1.45, 3.25],
    target: [6.70, 0.95, 2.65],
    lens: 20,
    scenarios: ['material_review'],
  },
  {
    id: 'guest_bath_door_relationship',
    label: '客卫门洞门扇关系候选视角（门洞/门扇/洁具/外置洗手台/过道）',
    position: [5.95, 1.55, 4.65],
    target: [6.40, 0.95, 2.65],
    lens: 20,
    scenarios: ['material_review'],
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
    id: 'balcony_utility_wall',
    label: '生活阳台洗烘设备墙正视（设备前通道与玻璃门关系）',
    position: [6.72, 1.45, 1.55],
    target: [5.92, 1.20, 1.55],
    lens: 18,
    scenarios: ['material_review'],
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
    // Render-only daylight 修正：从西南角回望餐厨时室内深处欠曝，仅增加相机同轴补光与轻微曝光。
    scenario_overrides: {
      daylight: { fill_light: 120, fill_from_camera: true, exposure: 0.25 },
    },
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
  cameras: cameras.map((camera) => ({
    ...camera,
    ...cameraMetadata[camera.id],
  })),
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
