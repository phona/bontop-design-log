import type { HvacScheme } from './types.js';

/**
 * 701 户型 HVAC 方案常量。
 * 房间几何布局的权威源为 config/layout/model-geometry.yaml（人工维护；CAD 仅作参考/导出），
 * 此处仅保留 HVAC 多方案数据。
 */

export const FLOOR_HEIGHT = 3.0;

export const hvacSchemes: HvacScheme[] = [
  {
    id: 'A1',
    name: 'A1 格力 Star Ⅱ 一拖五',
    price_per_unit: 30500,
    price_range: '2.9–3.2 万',
    desc: '6HP 多联机，1 台外机，5 台吊顶内机。平台无压力，室内最整洁。',
    outdoorUnits: [{ location: 'platform', w: 0.95, d: 0.35, h: 0.72 }],
    indoorUnits: [
      { roomId: 'living_dining', type: 'ceiling', note: '71 内机或 36+28 组合' },
      { roomId: 'master_bedroom', type: 'ceiling', note: '28 内机' },
      { roomId: 'bedroom_nw', type: 'ceiling', note: '22 内机' },
      { roomId: 'bedroom_se', type: 'ceiling', note: '22 内机' },
      { roomId: 'study', type: 'ceiling', note: '22 内机' },
    ],
    pros: ['外机位无压力', '室内最整洁', '品牌稳、售后网点多'],
    cons: ['初投资高', '单次维修贵', '部分故障需拆吊顶'],
  },
  {
    id: 'A2',
    name: 'A2 美的理想家 III 一拖五',
    price_per_unit: 29000,
    price_range: '2.8–3.0 万',
    desc: '6HP 全直流变频多联机，静音好，性价比首选。',
    outdoorUnits: [{ location: 'platform', w: 0.9, d: 0.335, h: 0.7 }],
    indoorUnits: [
      { roomId: 'living_dining', type: 'ceiling' },
      { roomId: 'master_bedroom', type: 'ceiling' },
      { roomId: 'bedroom_nw', type: 'ceiling' },
      { roomId: 'bedroom_se', type: 'ceiling' },
      { roomId: 'study', type: 'ceiling' },
    ],
    pros: ['全直流变频', '静音优秀', '价格低于格力同档'],
    cons: ['增项需盯紧', '高端功能另收费'],
  },
  {
    id: 'A3',
    name: 'A3 奥克斯 DLR 一拖五',
    price_per_unit: 24000,
    price_range: '2.2–2.6 万',
    desc: '二线品牌 6HP 多联机，最便宜的一拖五方案。',
    outdoorUnits: [{ location: 'platform', w: 0.9, d: 0.35, h: 0.7 }],
    indoorUnits: [
      { roomId: 'living_dining', type: 'ceiling' },
      { roomId: 'master_bedroom', type: 'ceiling' },
      { roomId: 'bedroom_nw', type: 'ceiling' },
      { roomId: 'bedroom_se', type: 'ceiling' },
      { roomId: 'study', type: 'ceiling' },
    ],
    pros: ['一拖五最低价', '1 台外机无压力'],
    cons: ['品牌/售后弱一档', '噪音和能效稍差'],
  },
  {
    id: 'B1',
    name: 'B1 一拖三 + 一拖二挂机',
    price_per_unit: 18000,
    price_range: '1.6–2.0 万',
    desc: '2 台外机：一拖三带 3 个小房间，一拖二带客餐厅+主卧。',
    outdoorUnits: [
      { location: 'platform', w: 0.9, d: 0.35, h: 0.7 },
      { location: 'platform', w: 0.9, d: 0.35, h: 0.7 },
    ],
    indoorUnits: [
      { roomId: 'living_dining', type: 'wall', note: '3 匹大挂机' },
      { roomId: 'master_bedroom', type: 'wall', note: '1.5 匹挂机' },
      { roomId: 'bedroom_nw', type: 'wall', note: '1 匹挂机' },
      { roomId: 'bedroom_se', type: 'wall', note: '1 匹挂机' },
      { roomId: 'study', type: 'wall', note: '1 匹挂机' },
    ],
    pros: ['比中央空调省 8k–12k', '外机仅 2 台'],
    cons: ['平台摆放紧张', '墙面全是挂机', '客厅可能吹不均'],
  },
  {
    id: 'B2',
    name: 'B2 风管机 + 一拖三挂机',
    price_per_unit: 19000,
    price_range: '1.7–2.1 万',
    desc: '客厅用风管机隐藏于吊顶，卧室用一拖三挂机。',
    outdoorUnits: [
      { location: 'platform', w: 0.9, d: 0.35, h: 0.7 },
      { location: 'platform', w: 0.9, d: 0.35, h: 0.7 },
    ],
    indoorUnits: [
      { roomId: 'living_dining', type: 'ceiling', note: '3 匹风管机' },
      { roomId: 'master_bedroom', type: 'wall', note: '1.5 匹挂机' },
      { roomId: 'bedroom_nw', type: 'wall', note: '1 匹挂机' },
      { roomId: 'bedroom_se', type: 'wall', note: '1 匹挂机' },
      { roomId: 'study', type: 'wall', note: '1 匹挂机' },
    ],
    pros: ['客厅好看', '卧室省钱'],
    cons: ['仍是 2 台外机', '平台需现场确认', '风管机需吊顶'],
  },
  {
    id: 'E1',
    name: 'E1 全分体机叠叠乐',
    price_per_unit: 15000,
    price_range: '1.2–1.8 万',
    desc: '5–6 台独立挂机，外机强行叠放在西平台。',
    outdoorUnits: [
      { location: 'platform', w: 0.85, d: 0.35, h: 0.6 },
      { location: 'platform', w: 0.85, d: 0.35, h: 0.6 },
      { location: 'platform', w: 0.85, d: 0.35, h: 0.6 },
      { location: 'platform', w: 0.85, d: 0.35, h: 0.6 },
      { location: 'platform', w: 0.85, d: 0.35, h: 0.6 },
    ],
    indoorUnits: [
      { roomId: 'living_dining', type: 'cabinet', note: '3 匹柜机' },
      { roomId: 'master_bedroom', type: 'wall', note: '1.5 匹挂机' },
      { roomId: 'bedroom_nw', type: 'wall', note: '1 匹挂机' },
      { roomId: 'bedroom_se', type: 'wall', note: '1 匹挂机' },
      { roomId: 'study', type: 'wall', note: '1 匹挂机' },
    ],
    pros: ['初投资最低', '单台故障不影响其他'],
    cons: ['平台放不下', '散热/噪音/维修灾难', '下层外机寿命缩短'],
  },
  {
    id: 'F2',
    name: 'F2 中央空调外机放入户花园',
    price_per_unit: 31500,
    price_range: '2.8–3.5 万',
    desc: '把一拖五外机从西平台移到入户花园，西平台完全空出。',
    outdoorUnits: [{ location: 'entry_garden', w: 0.9, d: 0.35, h: 0.7 }],
    indoorUnits: [
      { roomId: 'living_dining', type: 'ceiling' },
      { roomId: 'master_bedroom', type: 'ceiling' },
      { roomId: 'bedroom_nw', type: 'ceiling' },
      { roomId: 'bedroom_se', type: 'ceiling' },
      { roomId: 'study', type: 'ceiling' },
    ],
    pros: ['西平台完全空出', '保留中央空调舒适度'],
    cons: ['花园噪音/热风', '需隔音围合', '占花园空间', '物业/消防风险'],
  },
];
