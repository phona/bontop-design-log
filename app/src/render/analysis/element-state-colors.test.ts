import { describe, it, expect } from 'vitest';
import {
  ELEMENT_STATUS_ORDER,
  ELEMENT_STATUS_COLOR,
  ELEMENT_STATUS_LABEL,
  elementStatusColorHex,
  elementStatusColor,
  isElementStatus,
} from './element-state-colors.js';

// 状态词到颜色的映射必须覆盖全部 6 个 status（铁律：不发明新状态词，也不漏既有状态）。
describe('element-state-colors', () => {
  it('covers all six status words with distinct colors', () => {
    expect(ELEMENT_STATUS_ORDER).toEqual(['measured', 'confirmed', 'inferred', 'pending', 'conflicted', 'undeclared']);
    const colors = ELEMENT_STATUS_ORDER.map((s) => ELEMENT_STATUS_COLOR[s]);
    expect(new Set(colors).size).toBe(6);
    for (const status of ELEMENT_STATUS_ORDER) {
      expect(ELEMENT_STATUS_LABEL[status]).toBeTruthy();
    }
  });

  it('reuses the HVAC STATUS_COLOR vocabulary for confirmed/inferred/pending', () => {
    // 逐字复用 shared/render/HvacGeometryBuilder.ts:5-9，业主在 HVAC 图与状态叠加层看到同一状态同一色
    expect(ELEMENT_STATUS_COLOR.confirmed).toBe(0x38bdf8);
    expect(ELEMENT_STATUS_COLOR.inferred).toBe(0xf59e0b);
    expect(ELEMENT_STATUS_COLOR.pending).toBe(0x94a3b8);
  });

  it('renders #rrggbb hex and falls back to neutral gray for unknown status', () => {
    expect(elementStatusColorHex('confirmed')).toBe('#38bdf8');
    expect(elementStatusColorHex('measured')).toBe('#22c55e');
    expect(elementStatusColor('bogus')).toBe(0x6b7280);
    expect(elementStatusColorHex('bogus')).toBe('#6b7280');
  });

  it('distinguishes a status word from an element id for solo targeting', () => {
    expect(isElementStatus('pending')).toBe(true);
    expect(isElementStatus(null)).toBe(false);
    expect(isElementStatus('electrical:sock_child_ac')).toBe(false);
  });
});
