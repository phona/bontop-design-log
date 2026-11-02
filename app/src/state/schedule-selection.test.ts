// 审批视图共享选中态 + URL hash 的回归测试（自装交互审批第一步，2026-11-02）。
// 守：选中可进链接（#pkg=PKG-040&check=…）、坏 hash 不抛、store 局部更新不丢另一字段。

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ScheduleSelectionStore,
  readSelectionFromHash,
  writeSelectionToHash,
} from './schedule-selection.js';

describe('readSelectionFromHash', () => {
  it('解析 pkg 与 check', () => {
    expect(readSelectionFromHash('#pkg=PKG-040&check=SCH-040-01')).toEqual({
      packageId: 'PKG-040',
      checkId: 'SCH-040-01',
    });
  });

  it('缺字段为 null，坏输入不抛', () => {
    expect(readSelectionFromHash('#pkg=PKG-060')).toEqual({packageId: 'PKG-060', checkId: null});
    expect(readSelectionFromHash('')).toEqual({packageId: null, checkId: null});
    expect(readSelectionFromHash('#%E0%A4%A')).toEqual({packageId: null, checkId: null});
  });
});

describe('ScheduleSelectionStore', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  it('set 局部更新并通知订阅者', () => {
    const store = new ScheduleSelectionStore();
    const seen: Array<{packageId: string | null; checkId: string | null}> = [];
    store.subscribe((selection) => seen.push({...selection}));
    store.set({packageId: 'PKG-060'});
    store.set({checkId: 'check_tile_hollow'});
    expect(store.get()).toEqual({packageId: 'PKG-060', checkId: 'check_tile_hollow'});
    expect(seen).toEqual([
      {packageId: 'PKG-060', checkId: null},
      {packageId: 'PKG-060', checkId: 'check_tile_hollow'},
    ]);
  });

  it('相同选中不重复通知', () => {
    const store = new ScheduleSelectionStore();
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    store.set({packageId: 'PKG-060'});
    store.set({packageId: 'PKG-060'});
    expect(calls).toBe(1);
  });

  it('选中同步进地址栏 hash（可分享链接）', () => {
    const store = new ScheduleSelectionStore();
    store.set({packageId: 'PKG-040', checkId: 'SCH-040-01'});
    expect(window.location.hash).toBe('#pkg=PKG-040&check=SCH-040-01');
  });

  it('restoreFromHash 从地址栏恢复并通知', () => {
    window.location.hash = '#pkg=PKG-070&check=SCH-070-01';
    const store = new ScheduleSelectionStore();
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    store.restoreFromHash();
    expect(store.get()).toEqual({packageId: 'PKG-070', checkId: 'SCH-070-01'});
    expect(notified).toBe(1);
  });

  it('退订后不再通知', () => {
    const store = new ScheduleSelectionStore();
    let calls = 0;
    const off = store.subscribe(() => {
      calls += 1;
    });
    store.set({packageId: 'PKG-060'});
    off();
    store.set({packageId: 'PKG-070'});
    expect(calls).toBe(1);
  });

  it('writeSelectionToHash 清空选中时地址栏不残留查询', () => {
    writeSelectionToHash({packageId: null, checkId: null});
    // 浏览器/jsdom 对裸 # 的 location.hash 一律返回 ''（不含 # 前缀）
    expect(window.location.hash).toBe('');
  });
});
