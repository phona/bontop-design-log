import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readViewState, writeViewState } from './view-state-store.js';

describe('view-state-store', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('无存档时返回空', () => {
    expect(readViewState()).toEqual({});
  });

  it('写入后可读回，且 patch 合并（不丢未提供的字段）', () => {
    writeViewState({ workbenchOpen: true, workbenchPage: 'material' });
    writeViewState({ workbenchPage: 'lighting' });
    expect(readViewState()).toEqual({ workbenchOpen: true, workbenchPage: 'lighting' });
  });

  it('忽略非法字段', () => {
    localStorage.setItem('bontop-view-state/v1', JSON.stringify({ workbenchOpen: 'yes', workbenchPage: 'nope' }));
    expect(readViewState()).toEqual({});
  });

  it('损坏 JSON 不抛', () => {
    localStorage.setItem('bontop-view-state/v1', '{not json');
    expect(readViewState()).toEqual({});
    expect(() => writeViewState({ workbenchOpen: false })).not.toThrow();
  });

  // 2026-11-11 issue #202 S2：gantt 子页必须在持久化白名单里，否则刷新后静默回落 next_action。
  it('approvalView=gantt 可写入并读回（白名单守卫）', () => {
    writeViewState({ approvalView: 'gantt' });
    expect(readViewState().approvalView).toBe('gantt');
  });

  it('未声明的审批子页仍被忽略（S3 的 roles/calendar 不提前放行）', () => {
    localStorage.setItem('bontop-view-state/v1', JSON.stringify({ approvalView: 'roles' }));
    expect(readViewState()).toEqual({});
  });
});
