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
});
