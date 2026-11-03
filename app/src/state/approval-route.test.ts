// 审批路由（hash 语法 + 选中派生）的回归测试（2026-11-03 独立页面化）。
// 守：深链 #pkg= 落 detail；选中写 hash 保持子页；序列化往返；坏 hash 不抛。

import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseApprovalRoute,
  serializeApprovalRoute,
  withSelection,
  getApprovalRoute,
  setApprovalRoute,
  navigateApproval,
  writeSelectionRoute,
  exitApproval,
  invalidateExitPop,
} from './approval-route.js';

describe('parseApprovalRoute', () => {
  it('approval 参数指定子页', () => {
    expect(parseApprovalRoute('#approval=flow')).toEqual({subPage: 'flow', packageId: null, checkId: null});
    expect(parseApprovalRoute('#approval=next_action')).toEqual({subPage: 'next_action', packageId: null, checkId: null});
    expect(parseApprovalRoute('#approval=detail&pkg=PKG-060&check=check_tile_hollow')).toEqual({
      subPage: 'detail', packageId: 'PKG-060', checkId: 'check_tile_hollow',
    });
  });

  it('无 approval 但有 pkg：深链落 detail（2026-11-02 可分享链接口径不变）', () => {
    expect(parseApprovalRoute('#pkg=PKG-060')).toEqual({subPage: 'detail', packageId: 'PKG-060', checkId: null});
    expect(parseApprovalRoute('#pkg=PKG-060&check=SCH-060-01')).toEqual({
      subPage: 'detail', packageId: 'PKG-060', checkId: 'SCH-060-01',
    });
  });

  it('两者都无 = 3D 页；未知子页值回落；坏输入不抛', () => {
    expect(parseApprovalRoute('')).toEqual({subPage: null, packageId: null, checkId: null});
    expect(parseApprovalRoute('#')).toEqual({subPage: null, packageId: null, checkId: null});
    // 未知 approval 值不当真，回落：无 pkg → 3D 页
    expect(parseApprovalRoute('#approval=nonsense')).toEqual({subPage: null, packageId: null, checkId: null});
    // 坏 percent 编码：URLSearchParams 宽容替换、不抛——契约只是不抛
    expect(() => parseApprovalRoute('#%E0%A4%A')).not.toThrow();
    expect(() => parseApprovalRoute('#pkg=%E0%A4%A&approval=')).not.toThrow();
  });
});

describe('serializeApprovalRoute', () => {
  it('往返稳定，不写空参数', () => {
    const route = {subPage: 'detail' as const, packageId: 'PKG-060', checkId: null};
    expect(serializeApprovalRoute(route)).toBe('#approval=detail&pkg=PKG-060');
    expect(parseApprovalRoute(serializeApprovalRoute(route))).toEqual(route);
    expect(serializeApprovalRoute({subPage: null, packageId: null, checkId: null})).toBe('#');
  });
});

describe('withSelection', () => {
  it('只改 pkg/check，保持子页（流程图点节点不弹详情）', () => {
    const route = {subPage: 'flow' as const, packageId: 'PKG-010', checkId: null};
    expect(withSelection(route, {packageId: 'PKG-020'})).toEqual({subPage: 'flow', packageId: 'PKG-020', checkId: null});
    expect(withSelection({subPage: null, packageId: null, checkId: null}, {checkId: 'c1'})).toEqual({
      subPage: null, packageId: null, checkId: 'c1',
    });
  });
});

describe('navigateApproval / writeSelectionRoute（镜像与 hash 写入）', () => {
  beforeEach(() => {
    window.location.hash = '';
    setApprovalRoute({subPage: null, packageId: null, checkId: null});
  });

  it('replace 写 hash 并更新镜像', () => {
    navigateApproval({subPage: 'schedule', packageId: null, checkId: null}, 'replace');
    expect(window.location.hash).toBe('#approval=schedule');
    expect(getApprovalRoute().subPage).toBe('schedule');
  });

  it('writeSelectionRoute 保持子页（在流程图里选中包不弹详情）', () => {
    navigateApproval({subPage: 'flow', packageId: null, checkId: null}, 'replace');
    writeSelectionRoute({packageId: 'PKG-030'});
    expect(window.location.hash).toBe('#approval=flow&pkg=PKG-030');
    expect(getApprovalRoute().subPage).toBe('flow');
  });

  it('3D 页的选中写入不凭空打开审批页（hash 无 approval 参数）', () => {
    writeSelectionRoute({packageId: 'PKG-030'});
    expect(window.location.hash).toBe('#pkg=PKG-030');
    expect(getApprovalRoute().subPage).toBe(null);
  });

  it('清空选中只清 pkg/check、留在当前子页（退出页面是显式导航，不搭选中清零的车）', () => {
    navigateApproval({subPage: 'detail', packageId: 'PKG-060', checkId: 'c1'}, 'replace');
    writeSelectionRoute({packageId: null, checkId: null});
    expect(window.location.hash).toBe('#approval=detail');
    expect(getApprovalRoute()).toEqual({subPage: 'detail', packageId: null, checkId: null});
  });

  it('invalidateExitPop 后 exitApproval 走 replace 兜底（手改 hash 后「返回 3D」退不出去的解药）', () => {
    // codex 审查 blocking 2：push 进审批页后用户手改 hash 到另一个审批态，
    // 若不兑现资格就 back()，退到的是手改前那页（可能还是审批页）——用户出不去。
    navigateApproval({subPage: 'flow', packageId: null, checkId: null}, 'push');
    invalidateExitPop(); // 模拟 hashchange（用户返回/手改）后的资格作废
    expect(exitApproval()).toBe(false); // 不 pop，走 replace
    expect(window.location.hash).toBe('');
    expect(getApprovalRoute().subPage).toBe(null);
  });

  it('3D 页清空选中回落空 hash', () => {
    writeSelectionRoute({packageId: 'PKG-030'});
    writeSelectionRoute({packageId: null, checkId: null});
    expect(window.location.hash).toBe('');
  });
});
