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
];

const cameras = [
  {
    id: 'living_sofa_glass',
    label: '客厅餐桌侧南望沙发+玻璃幕（全景）',
    position: [10.3, 1.55, 2.9],
    target: [9.6, 1.2, 8.6],
  },
  {
    id: 'master_bed_looking_glass',
    label: '主卧西北角看全景（床+南窗）',
    position: [0.7, 1.6, 5.9],
    target: [3.2, 1.0, 9.5],
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
