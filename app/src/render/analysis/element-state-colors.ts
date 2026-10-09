// 构件级工程状态叠加层配色（消费 shared/element-state.ts 的 ElementStatus 词汇）。
//
// 铁律：**不发明新状态词**。6 个值 measured/confirmed/inferred/pending/conflicted/undeclared
// 全部来自 shared/element-state.ts 与 config/state-model.yaml；本模块只负责「状态 → 屏幕色」。
//
// 前 3 个色值**逐字复用** shared/render/HvacGeometryBuilder.ts:5-9 的 STATUS_COLOR——
// HVAC 图里 confirmed/inferred/pending 已经是这套色，状态叠加层必须让业主看到「同一状态同一色」：
//   confirmed 0x38bdf8（天蓝）/ inferred 0xf59e0b（琥珀）/ pending 0x94a3b8（石板灰）。
// 后 3 个是本模块补的（HVAC 图没有 measured/undeclared/conflicted 三种态），取值理由：
//   measured  0x22c55e（绿）——现场实测核实过的坐标/尺寸，最可靠的观测态，绿=已量测可信；
//   conflicted 0xef4444（红）——verifier error 触及，红=冲突/必须处理；
//   undeclared 0x8b5cf6（紫）——无任何声明来源的缺口，要**显形**而非默认确认。
//     与 pending 的区分：pending 是「已知卡点、挂在台账上等数据」（灰=搁置）；
//     undeclared 是「根本没登记」（紫=待补录），二者语义不同、色相也必须不同。
// 6 个色相两两可分（绿/天蓝/琥珀/灰/红/紫），图例不会混。
import type { ElementStatus } from '@shared/element-state';

export type { ElementStatus };

/** 图例/面板的固定行序（与状态严重度无关，只求稳定可读）。 */
export const ELEMENT_STATUS_ORDER: ElementStatus[] = [
  'measured', 'confirmed', 'inferred', 'pending', 'conflicted', 'undeclared',
];

export const ELEMENT_STATUS_LABEL: Record<ElementStatus, string> = {
  measured: '已实测',
  confirmed: '已确认',
  inferred: '推断',
  pending: '待现场数据',
  conflicted: '有冲突',
  undeclared: '未申报',
};

/** 状态 → 颜色（十六进制数字，直接喂 three.js `Color.set(number)`）。 */
export const ELEMENT_STATUS_COLOR: Record<ElementStatus, number> = {
  measured: 0x22c55e,
  confirmed: 0x38bdf8,
  inferred: 0xf59e0b,
  pending: 0x94a3b8,
  conflicted: 0xef4444,
  undeclared: 0x8b5cf6,
};

const FALLBACK_COLOR = 0x6b7280;

/** 状态 → `#rrggbb`（面板图例/InfoPanel 用）。未知状态退回中性灰，绝不崩。 */
export function elementStatusColorHex(status: string): string {
  const known = ELEMENT_STATUS_COLOR[status as ElementStatus] ?? FALLBACK_COLOR;
  return `#${known.toString(16).padStart(6, '0')}`;
}

/** 状态 → 颜色（数字）。未知状态退回中性灰。 */
export function elementStatusColor(status: string): number {
  return ELEMENT_STATUS_COLOR[status as ElementStatus] ?? FALLBACK_COLOR;
}

// ─── app 侧对服务端契约的最小描述 ───
// GET /api/element-state 的 states[] 元素。与 shared/element-state.ts 的 ElementState 同构，
// 但在 app 内**本地声明**：服务端可能先于/异于 shared 出字段，app 只依赖这份已定死的契约形状，
// 不追随 shared 派生模块的内部演进。status 仍复用 shared 的 ElementStatus 联合类型（6 值不变）。
export interface OpenQuestionLike {
  ref: string;
  summary: string;
  blockedBy: string;
}

export interface ElementStateLike {
  id: string;
  kind: string;
  label: string;
  room?: string;
  status: ElementStatus;
  /** 给出该状态的权威出处（文件:字段 / 台账 #N / DEC / verifier code）。 */
  statusSource: string;
  openQuestion?: OpenQuestionLike;
  decision?: string;
  /** 触及该构件的 verifier issue code 列表（去重排序）。 */
  conflicts: string[];
}

/** 判断一个 target 字符串是「状态词」还是「构件 id」（solo 两种语义共用入口）。 */
export function isElementStatus(value: string | null): value is ElementStatus {
  return value !== null && (ELEMENT_STATUS_ORDER as string[]).includes(value);
}
