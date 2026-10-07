// 吊顶分区高亮配色（DEC-2026-10-08-C01）。
//
// 两个要求同时满足：
//  ① 每个分区颜色都不同（业主原话「不同的吊顶区域用不同的颜色」）——本仓 19 个实心分区，
//     固定调色板必然撞色，所以用 HSL 连续偏移：同族共用一个色相带，按 zoneId 哈希在
//     「色相 ±range / 明度 ±range」内取一个点，撞色概率可忽略；
//  ② 一眼能看出工艺类别（石膏板 / 铝扣板 / 窗帘盒 / 晾衣架吊顶），因为报价口径按类别走。
// 哈希而非数组下标：新增/删除分区不会打乱已有分区的颜色，图例与业主记忆保持稳定。
import type { CeilingTradeClass } from '@shared/ceiling-takeoff';

export type CeilingZoneColorMode = 'zone' | 'trade';

export const TRADE_LABEL: Record<CeilingTradeClass, string> = {
  gypsum_board: '石膏板吊顶',
  aluminum_buckle: '铝扣板吊顶',
  curtain_box: '窗帘盒',
  drying_rack: '隐藏晾衣架吊顶',
};

interface TradeFamily {
  /** 色相带中心（度）。 */
  hue: number;
  /** ±色相偏移（度）。 */
  hueRange: number;
  sat: number;
  satRange: number;
  light: number;
  lightRange: number;
}

const TRADE_FAMILY: Record<CeilingTradeClass, TradeFamily> = {
  gypsum_board: { hue: 212, hueRange: 20, sat: 14, satRange: 6, light: 58, lightRange: 13 },
  aluminum_buckle: { hue: 172, hueRange: 14, sat: 42, satRange: 10, light: 38, lightRange: 11 },
  curtain_box: { hue: 43, hueRange: 10, sat: 66, satRange: 8, light: 66, lightRange: 9 },
  drying_rack: { hue: 24, hueRange: 8, sat: 76, satRange: 6, light: 68, lightRange: 7 },
};

/** 未归类分区（trade 缺失/非法）的专用色：显眼但不冒充任何工艺族。 */
export const UNCLASSIFIED_COLOR = '#e63946';

/** 稳定哈希（FNV-1a 变体）：同一 id 永远得到同一颜色，与声明顺序无关。 */
function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

/** 把哈希映射到 [-range, +range]。 */
function offset(hash: number, salt: number, range: number): number {
  const mixed = hashString(`${hash}:${salt}`);
  return ((mixed % 2001) / 1000 - 1) * range;
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const k = (n: number): number => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number): number => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (value: number): string => Math.round(255 * value).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

/** 工艺主色（按工艺归并模式 + 色族基准）。 */
export function tradeColor(trade: CeilingTradeClass): string {
  const family = TRADE_FAMILY[trade];
  return hslToHex(family.hue, family.sat, family.light);
}

export const TRADE_COLOR: Record<CeilingTradeClass, string> = {
  gypsum_board: tradeColor('gypsum_board'),
  aluminum_buckle: tradeColor('aluminum_buckle'),
  curtain_box: tradeColor('curtain_box'),
  drying_rack: tradeColor('drying_rack'),
};

export function ceilingZoneColor(
  zoneId: string,
  trade: CeilingTradeClass | null,
  mode: CeilingZoneColorMode = 'zone',
): string {
  if (trade === null) return UNCLASSIFIED_COLOR;
  const family = TRADE_FAMILY[trade];
  if (mode === 'trade') return tradeColor(trade);
  const hash = hashString(zoneId);
  const hue = family.hue + offset(hash, 1, family.hueRange);
  const sat = Math.max(0, Math.min(100, family.sat + offset(hash, 2, family.satRange)));
  const light = Math.max(8, Math.min(94, family.light + offset(hash, 3, family.lightRange)));
  return hslToHex(hue, sat, light);
}
