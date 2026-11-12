// 集成测试：真实路由响应 → 真实面板渲染（issue #202 S4 §21.4 ⑤ 的缺口）。
//
// 缺口是什么：服务端（api.test.ts / schedule-*.test.ts）与面板（app 的 vitest 夹具）各自全绿，
// 但两边形状漂移时没有一条测试会红——服务端把 `coordination_conflicts` 改名或删键，面板测试
// 照绿（夹具自给自足），api.test 也不会发现。这里把两端接起来：
//   ① `GET /api/schedule/state` 走**真实 express 路由**（createApiRouter + supertest），
//      拿真 HTTP 响应体（不是 buildScheduleSnapshot 的手工副本，也不是夹具）；
//   ② 装一个 jsdom DOM，把响应体喂给**真实面板**（app/src/ui 的两个面板，动态 import），
//      断言真实数据被渲染出来；
//   ③ 断言按响应体自身推导（anchor 是否为空、potential 有几簇），漂移时失败信息指向具体的键。
//
// 面板的 DOM 依赖在 jsdom 下齐备；`ResizeObserver` 面板自身有 typeof 守卫，保持未定义。
// 本文件按仓库边界放在 tests/server（root 程序），因此 root tsconfig 需要 `@shared/*` 路径别名
// 才能解析被拉进程序的 app 模块（见 tsconfig.json）。
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { JSDOM } from 'jsdom';
import { createApiRouter, type ApiDeps } from '../../server/routes.js';

/** 面板消费的顶层键（与 S4 §21.4 ⑤、设计 §22.1 的接线口径一致）。 */
const PANEL_KEYS = ['packages', 'next_actions', 'schedule', 'coordination', 'coordination_conflicts'] as const;

const DATE_PATTERN = /\d{4}-\d{2}-\d{2}/;

function installDomGlobals(dom: JSDOM): void {
  const win = dom.window as unknown as Record<string, unknown>;
  for (const key of [
    'window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MouseEvent',
    'navigator', 'location', 'history', 'localStorage', 'getComputedStyle', 'DOMParser',
  ]) {
    // defineProperty 而不是赋值：Node 21+ 的 globalThis.navigator 是 getter-only，
    // 直接赋值会抛「has only a getter」。
    Object.defineProperty(globalThis, key, {value: win[key], configurable: true, writable: true});
  }
}

/** 轮询等待（node:test 没有 vitest 的 waitFor）。 */
async function waitFor(predicate: () => boolean, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`waitFor 超时（${timeoutMs}ms）：条件未成立`);
}

test('真实路由响应喂进两个面板：真实数据渲染出来，形状漂移即红', async () => {
  // ① 真实 HTTP 响应。createApiRouter 构造期只解构 deps + 读 phase-scope；/schedule/state 的
  //    handler 只走 loader + buildScheduleSnapshot，不触及其它依赖，故空 deps 足够（若将来构造期
  //    开始读 deps，这里会抛错，测试当场点名）。
  const app = express();
  app.use('/api', createApiRouter({} as ApiDeps));
  const response = await request(app).get('/api/schedule/state').expect(200);
  const payload = response.body as {
    packages: Array<{id: string; name?: string}>;
    next_actions: unknown[];
    schedule: {anchor_date: string | null; ordinals: Array<{ord: number; date: string | null}>} | undefined;
    coordination: Record<string, {package_id: string; status: string; required_roles: string[]}> | undefined;
    coordination_conflicts: {conflicts: Array<{role: string}>; potential: Array<{role: string}>} | undefined;
  };

  // 漂移守卫：面板读的键一个都不能少（删键即红，报错直接说清是哪个键）。
  for (const key of PANEL_KEYS) {
    assert.ok(Object.hasOwn(payload, key), `GET /api/schedule/state 响应缺 \`${key}\`——面板读的就是这个键（S4 §21.4 ⑤）`);
  }
  const schedule = payload.schedule;
  assert.ok(schedule, 'schedule 键必须在（面板的排程视图来源）');
  // 只读基准必须取在面板拿到 payload **之前**：渲染期间的原地改写才可能被下面比较抓到
  // （Codex 一审 major：基准取在渲染后等于把改写写进基准）。
  const payloadBaseline = JSON.stringify(payload);

  // ② 装 DOM + 喂响应体。
  const dom = new JSDOM('<!doctype html><html><body><div id="approval-page-panels"></div></body></html>', {url: 'http://localhost/'});
  installDomGlobals(dom);
  (globalThis as unknown as Record<string, unknown>).fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => payload,
  });

  const { RoleWorkbenchPanel } = await import('../../app/src/ui/RoleWorkbenchPanel.js');
  const { CoordinationCalendarPanel } = await import('../../app/src/ui/CoordinationCalendarPanel.js');
  const { ScheduleSelectionStore } = await import('../../app/src/state/schedule-selection.js');
  const selection = new ScheduleSelectionStore();
  const workbench = new RoleWorkbenchPanel(selection);
  const calendar = new CoordinationCalendarPanel(selection);
  workbench.show();
  calendar.show();

  await waitFor(() => (dom.window.document.querySelector('#role-workbench-body')?.textContent ?? '').includes('SCH-'));
  await waitFor(() => (dom.window.document.querySelector('#coordination-calendar-body')?.textContent ?? '').includes('SCH-'));

  const workbenchText = dom.window.document.querySelector('#role-workbench-body')?.textContent ?? '';
  const calendarText = dom.window.document.querySelector('#coordination-calendar-body')?.textContent ?? '';

  // ③ 真实数据断言（期望值从响应体本身推导，不做「面板没渲染也不会红」的空断言）。
  const coordination = payload.coordination ?? {};
  const coordinationIds = Object.keys(coordination);
  // 条数必须独立钉死，不能从响应体自身推导：条目若从快照里整体消失，循环里就没有它，
  // 「逐条断言」会静默通过（Codex 一审 major 的同类陷阱）。9 = 设计 §20 的试点规模；
  // 扩面时同步本断言（失败信息直接说明该改哪里）。
  assert.equal(coordinationIds.length, 9, '真实 control.yaml 的试点 coordination 应为 9 条（设计 §20）；扩面时同步本断言');
  const packageNameById = new Map((payload.packages ?? []).map((pkg) => [pkg.id, pkg.name ?? pkg.id]));
  // 逐条按 data-sch-id 定位**具体行/chip**（Codex 一审 major：只查全文会出现「行漏渲染但包名
  // 恰好出现在其它节里」的假绿）。工作台协调行 = .rw-coord-row，日历条幅 = .cal-chip。
  const coordRows = Array.from(dom.window.document.querySelectorAll('.rw-coord-row[data-sch-id]'));
  const chips = Array.from(dom.window.document.querySelectorAll('.cal-chip[data-sch-id]'));
  for (const schId of coordinationIds) {
    const entry = coordination[schId];
    const name = packageNameById.get(entry.package_id);
    assert.ok(name, `coordination 指向的包 ${entry.package_id} 必须在 packages 里（快照自洽）`);
    const row = coordRows.find((element) => (element as HTMLElement).dataset.schId === schId);
    assert.ok(row, `工作台应有协调行 ${schId}（.rw-coord-row[data-sch-id]）`);
    assert.ok((row.textContent ?? '').includes(name), `协调行 ${schId} 内应写所属包「${name}」`);
    assert.equal((row as HTMLElement).dataset.pkgId, entry.package_id, `协调行 ${schId} 的 data-pkg-id 应与快照一致`);
    const chip = chips.find((element) => (element as HTMLElement).dataset.schId === schId);
    assert.ok(chip, `日历应有 chip ${schId}（.cal-chip[data-sch-id]）`);
    // chip 不带 data-pkg-id（日历按 SCH 定位；包归属由工作台行的 data-pkg-id 与快照自洽性覆盖）。
    assert.equal((chip as HTMLElement).dataset.status, entry.status, `chip ${schId} 的 data-status 应与快照一致`);
  }
  assert.equal(chips.length, coordinationIds.length, '日历 chip 数应等于协调条目数（每条的潜在窗口各一条幅）');

  // 冲突节：真实数据有潜在簇（9 条全 pending_invite）时不得显示「无冲突」。
  const potentialClusters = payload.coordination_conflicts?.potential ?? [];
  const conflicts = payload.coordination_conflicts?.conflicts ?? [];
  assert.equal(conflicts.length, 0, '真实数据目前没有同日已确认占用（有的话本断言需随事实更新）');
  assert.ok(potentialClusters.length > 0, '9 条试点协调存在潜在窗口重叠（S3/S4 已核算）');
  assert.ok(workbenchText.includes('潜在重叠'), '有潜在簇时工作台必须出「潜在重叠」徽标');
  // 「无冲突」是**逐角色节**的文案：有簇的角色不得说无冲突，没有簇的角色照常（按角色定位断言）。
  const clusterRole = potentialClusters[0]?.role;
  assert.ok(clusterRole, '真实数据应有潜在簇（S3/S4 已核算）');
  const clusterRoleGroup = dom.window.document.querySelector(`.rw-role[data-role="${clusterRole}"]`);
  assert.ok(clusterRoleGroup, `工作台应有角色分组「${clusterRole}」`);
  const clusterRoleText = clusterRoleGroup.textContent ?? '';
  assert.ok(clusterRoleText.includes('潜在重叠'), `角色「${clusterRole}」有潜在簇，应出徽标`);
  assert.ok(!clusterRoleText.includes('无冲突、无潜在窗口重叠'), `角色「${clusterRole}」有潜在簇，不得同时显示「无冲突」`);

  // 日历：锚点未定 → 面板不得出现任何年月日（§18）；锚点就绪 → 列头必须带快照日期。
  if (schedule!.anchor_date === null) {
    assert.equal(schedule!.ordinals.every((ordinal) => ordinal.date === null), true, '无锚点时 ordinals 日期应全 null');
    assert.doesNotMatch(calendarText, DATE_PATTERN, '无锚点日历不得出现日期字符串（面板不造年月日）');
    assert.match(calendarText, /第 \d+ 工作日/, '无锚点日历应标「第 N 工作日」');
  } else {
    assert.match(calendarText, DATE_PATTERN, '锚点就绪时日历列头应带快照日期');
  }

  // 只读：与**渲染前**的基准逐字节比较（渲染期间的原地改写才可能被抓到）。
  workbench.hide();
  calendar.hide();
  assert.equal(JSON.stringify(payload), payloadBaseline, '面板渲染不得改写快照对象（逐字节对照渲染前基准）');

  dom.window.close();
});
