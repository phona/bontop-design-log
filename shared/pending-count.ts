/**
 * 「还有多少个未决断」的单一来源（issue #98 第六阶段 S2-B）。
 *
 * 2026-11-08 业主裁定③：原量房台账（已于 S2-B 退场） 整份退场——它曾是「量房待填清单」
 * 这本手账，未决项现已全数搬到 config 各对象自己的 `status` / `blocker` 字段上
 * （见 shared/element-blockers.ts 的 checkBlockers 门禁）。
 *
 * 本模块回答原来手账回答的同一个问题，但只读对象、不读任何文档：
 * **有多少个构件卡着（pending / undeclared）**。
 * 人要可读视图时用 `npm run docs:generate-pending-view`（输出 tmp/capture/）。
 *
 * 为什么不保留文档再从中计数：那就是「第二份真相」——手账的编号与对象状态会漂移，
 * 而漂移时没有任何门禁会叫（实测 39 个对象里 28 个曾无台账条目）。
 */
import { collectElements } from './element-sources.js';
import { deriveElementStates } from './element-state.js';

/** 派生状态为 pending / undeclared 的构件数（= 受 blocker 门禁管辖的对象数）。 */
export function countPendingComponents(): number {
  const elements = collectElements();
  const derived = deriveElementStates({ elements, issues: [] });
  return derived.states.filter((s) => s.status === 'pending' || s.status === 'undeclared').length;
}
