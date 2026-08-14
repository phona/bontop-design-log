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

// 场景固定常量：南宁 8/15 预计算的太阳方向向量（见 docs/renders/sun-constants.md 的推导）
const scenarios = [
  {
    id: 'blue_hour',
    label: '蓝调时刻 19:30（太阳地平线下，玻璃透蓝天）',
    sun_direction: [-0.954, 0.29, -0.077],
    lights_on: true,
  },
  {
    id: 'night',
    label: '夜晚 21:30（室内灯为主光）',
    sun_direction: [-0.734, 0.466, -0.494],
    lights_on: true,
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
    label: '主卧床头看南窗',
    position: [2.6, 1.5, 7.9],
    target: [2.8, 1.2, 9.4],
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
