import * as fs from 'fs';
import * as yaml from 'js-yaml';

// 生成 dress_scene.py 的输入配置：灯光点位（electrical.yaml）+ 固定场景常量 + 机位
// 场景固定为两个决策工况（蓝调时刻 / 夜晚），sun_direction 为预计算常量（Blender 坐标系，
// 指向太阳方向：+X 东 / +Y 北 / +Z 上）。视频等"任意时刻"需求后续再引入时间轴，当前决策渲染不需要。

interface ElectricalPoint {
  id: string;
  room: string;
  type: string;
  x?: number;
  z?: number;
  height?: number;
  temp?: number;
}

const LIGHT_TYPES = new Set(['pendant', 'dome', 'wall_lamp', 'downlight', 'led_strip']);

const electrical = yaml.load(fs.readFileSync('config/electrical.yaml', 'utf8')) as ElectricalPoint[];

const lights = electrical
  .filter((p) => LIGHT_TYPES.has(p.type))
  .map((p) => ({ id: p.id, room: p.room, type: p.type, x: p.x, z: p.z, height: p.height ?? 2.8, temp: p.temp ?? 3000 }));

// 场景固定常量：蓝调时刻/夜晚。太阳已落 → sun_direction=null（不打太阳光）；
// 天光用自定义背景色（蓝调=深蓝、夜晚=近黑蓝），保证玻璃透出可见天色而非 HOSEK_WILKIE 的黑暗天际。
// 视频等"任意时刻"需求后续再引入时间轴，当前决策渲染不需要。
// 渲染行为全部配置化（施工说明：Blender 端零手工状态）：
//   exposure: AgX 曝光；blackout_state: open=遮光帘视同拉开隐藏；sheer_opacity: 纱帘布料权重
const scenarios = [
  {
    id: 'blue_hour',
    label: '蓝调时刻（窗外 HDRi 海边日落外景、室内暖灯）',
    sun_direction: null,
    world_hdri: 'hdri/the_sky_is_on_fire_1k.hdr',
    world_color: '#3a5a8f',
    world_strength: 0.5,
    lights_on: true,
    exposure: 0.5,
    blackout_state: 'open',
    sheer_opacity: 0.15,
  },
  {
    id: 'night',
    label: '夜晚（窗外 HDRi 星夜+城市灯光、室内灯为主光）',
    sun_direction: null,
    world_hdri: 'hdri/kloppenheim_02_1k.hdr',
    world_color: '#060a14',
    world_strength: 0.15,
    lights_on: true,
    exposure: 0.5,
    blackout_state: 'open',
    sheer_opacity: 0.15,
  },
  // 材质评审工况（material-review-mode spec）：无调色、中性白光、候选色板——决策色号/拼法用
  {
    id: 'material_review',
    label: '材质评审（Standard 无调色、6500K 中性白、候选色板）',
    sun_direction: null,
    world_color: '#808080',
    world_strength: 0.3,
    lights_on: true,
    light_temp: 6500,
    view_transform: 'Standard',
    exposure: 0.0,
    blackout_state: 'open',
    sheer_opacity: 0.15,
    swatches: [
      // 地板候选色（floor_tile_01 原色系 ± 明度/奶咖向）——客厅特写视野，沿视线垂线排列
      { hex: '#c49a6c', mode: 'floor', x: 8.55, z: 7.05, size: 0.4 },
      { hex: '#cfa878', mode: 'floor', x: 9.05, z: 7.29, size: 0.4 },
      { hex: '#b98f63', mode: 'floor', x: 9.56, z: 7.53, size: 0.4 },
      { hex: '#cbab86', mode: 'floor', x: 10.06, z: 7.77, size: 0.4 },
      // 地板候选色——主卧特写视野（床西侧空地，已避开床 footprint x≥2.2）
      { hex: '#c49a6c', mode: 'floor', x: 0.64, z: 7.99, size: 0.4 },
      { hex: '#cfa878', mode: 'floor', x: 1.08, z: 7.8, size: 0.4 },
      { hex: '#b98f63', mode: 'floor', x: 1.52, z: 7.6, size: 0.4 },
      { hex: '#cbab86', mode: 'floor', x: 1.96, z: 7.41, size: 0.4 },
      // 墙面候选色（#f7f5ef 奶油系梯度）——客厅西墙（x=7.2 实体墙）前悬停
      { hex: '#f7f5ef', mode: 'vertical', x: 7.21, z: 6.35, size: 0.3 },
      { hex: '#f5f1e8', mode: 'vertical', x: 7.21, z: 6.75, size: 0.3 },
      { hex: '#f3eee2', mode: 'vertical', x: 7.21, z: 7.15, size: 0.3 },
      { hex: '#faf8f3', mode: 'vertical', x: 7.21, z: 7.55, size: 0.3 },
      // 墙面候选色——主卧西墙（x=0）
      { hex: '#f7f5ef', mode: 'vertical', x: 0.01, z: 6.8, size: 0.3 },
      { hex: '#f5f1e8', mode: 'vertical', x: 0.01, z: 7.2, size: 0.3 },
      { hex: '#f3eee2', mode: 'vertical', x: 0.01, z: 7.6, size: 0.3 },
      { hex: '#faf8f3', mode: 'vertical', x: 0.01, z: 8.0, size: 0.3 },
    ],
  },
];

const cameras = [
  {
    id: 'living_sofa_glass',
    label: '客厅餐桌侧南望沙发+玻璃幕（全景）',
    position: [10.3, 1.55, 2.9],
    target: [9.6, 1.2, 8.6],
    scenarios: ['material_review', 'blue_hour'],
  },
  {
    id: 'master_bed_looking_glass',
    label: '主卧西北角看全景（床+南窗）',
    position: [0.7, 1.6, 5.9],
    target: [3.2, 1.0, 9.5],
    scenarios: ['material_review'],
    fill_light: 150,
  },
  // 材质评审特写机位（35mm，只出 material_review 工况）
  {
    id: 'living_floor_closeup',
    label: '客厅地板 45° 特写（拼法/色号，含地板色板）',
    position: [9.9, 1.4, 6.1],
    target: [9.3, 0.0, 7.4],
    lens: 35,
    scenarios: ['material_review'],
  },
  {
    id: 'living_west_wall',
    label: '客厅西墙+地板交界（墙面色号，含墙面色板）',
    position: [9.8, 1.5, 6.8],
    target: [7.2, 0.6, 7.0],
    lens: 35,
    scenarios: ['material_review'],
  },
  {
    id: 'bedroom_floor_closeup',
    label: '主卧地板特写（床西侧空地，含地板色板）',
    position: [1.0, 1.4, 6.6],
    target: [1.7, 0.0, 7.9],
    lens: 35,
    scenarios: ['material_review'],
    fill_light: 80,
  },
  {
    id: 'bedroom_west_wall',
    label: '主卧西墙+地板交界（墙面色号，含墙面色板）',
    position: [2.5, 1.5, 7.4],
    target: [0.0, 0.6, 7.6],
    lens: 35,
    scenarios: ['material_review'],
    fill_light: 80,
  },
  // 厨房决策机位（L 型：北墙水槽+东墙灶台+冰箱）
  {
    id: 'kitchen_l_overview',
    label: '厨房 L 型全景（北墙水槽+东墙灶台+冰箱）',
    position: [7.6, 1.5, 2.2],
    target: [10.2, 0.9, 0.5],
    lens: 24,
    scenarios: ['material_review', 'blue_hour'],
  },
  {
    id: 'kitchen_counter_closeup',
    label: '厨房台面+地柜门特写（台面/柜门选材）',
    position: [8.6, 1.3, 1.6],
    target: [9.6, 0.8, 0.4],
    lens: 35,
    scenarios: ['material_review'],
  },
];

const config = {
  sun: scenarios[0].sun_direction,
  lights,
  scenarios,
  cameras,
};

fs.writeFileSync('scripts/blender/render-config.json', JSON.stringify(config, null, 2));
console.log(`render-config.json: ${lights.length} lights, ${scenarios.length} scenarios, ${cameras.length} cameras`);
