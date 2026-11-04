import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiWrite, getStoredWriteToken } from './api-write';

const TOKEN_KEY = 'bontop.write-token';

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  vi.stubGlobal('fetch', fn as never);
  return fn;
}

function okResponse(): Response {
  return { ok: true, status: 200, json: async () => ({}) } as Response;
}

function unauthorizedResponse(): Response {
  return { ok: false, status: 401, json: async () => ({}) } as Response;
}

/** 在页面内嵌对话框里输入 token 并点「确定」。 */
async function fillTokenDialog(token: string): Promise<void> {
  await vi.waitFor(() => expect(document.getElementById('write-token-input')).not.toBeNull());
  const input = document.getElementById('write-token-input') as HTMLInputElement;
  input.value = token;
  (document.getElementById('write-token-confirm') as HTMLButtonElement).click();
}

/** 统计 #write-token-dialog 被插入 document.body 的次数（并发重复弹框会 >1）。 */
function watchDialogAdditions(): { count: number; stop: () => void } {
  const watcher = { count: 0, stop: () => {} };
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) {
        if (node instanceof HTMLElement && node.id === 'write-token-dialog') watcher.count += 1;
      }
    }
  });
  observer.observe(document.body, { childList: true });
  watcher.stop = () => observer.disconnect();
  return watcher;
}

/** 冲刷微任务/计时器，确保 MutationObserver 回调已交付。 */
async function flushObservers(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('api-write（issue #64 写操作 token 认证）', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.getElementById('write-token-dialog')?.remove();
  });

  it('本地有 token：自动带 x-bontop-token 头，不弹框', async () => {
    localStorage.setItem(TOKEN_KEY, 'stored-token');
    const fetchMock = mockFetch(() => okResponse());

    const res = await apiWrite('/api/scheme/current', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/scheme/current');
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe('{}');
    // 原有头保留，token 头追加
    const headers = new Headers(init.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('x-bontop-token')).toBe('stored-token');
    expect(document.getElementById('write-token-dialog')).toBeNull();
  });

  it('本地无 token：弹框输入 → 存入 → 自动重发该次请求', async () => {
    expect(getStoredWriteToken()).toBeNull();
    const fetchMock = mockFetch(() => okResponse());

    const pending = apiWrite('/api/view-context', { method: 'POST', body: '{}' });
    await fillTokenDialog('fresh-token');
    const res = await pending;

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get('x-bontop-token')).toBe('fresh-token');
    expect(getStoredWriteToken()).toBe('fresh-token');
    expect(document.getElementById('write-token-dialog')).toBeNull();
  });

  it('空输入点确定不关闭对话框', async () => {
    mockFetch(() => okResponse());
    const pending = apiWrite('/api/view-context', { method: 'POST' });
    await vi.waitFor(() => expect(document.getElementById('write-token-input')).not.toBeNull());
    (document.getElementById('write-token-confirm') as HTMLButtonElement).click();
    // 对话框仍在，请求未发出
    expect(document.getElementById('write-token-dialog')).not.toBeNull();
    (document.getElementById('write-token-cancel') as HTMLButtonElement).click();
    await expect(pending).rejects.toThrow('write token required');
  });

  it('401：清掉本地 token、重新走输入流程，重发带新 token', async () => {
    localStorage.setItem(TOKEN_KEY, 'rotated-away');
    let call = 0;
    const fetchMock = mockFetch(() => {
      call += 1;
      return call === 1 ? unauthorizedResponse() : okResponse();
    });

    const pending = apiWrite('/api/acceptance/gates', { method: 'POST', body: '{}' });
    await fillTokenDialog('new-token');
    const res = await pending;

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Headers((fetchMock.mock.calls[0] as [string, RequestInit])[1].headers).get('x-bontop-token')).toBe('rotated-away');
    expect(new Headers((fetchMock.mock.calls[1] as [string, RequestInit])[1].headers).get('x-bontop-token')).toBe('new-token');
    expect(getStoredWriteToken()).toBe('new-token');
  });

  it('重发仍 401：抛「token 不正确或已轮换」并清掉本地 token', async () => {
    localStorage.setItem(TOKEN_KEY, 'bad');
    const fetchMock = mockFetch(() => unauthorizedResponse());

    const pending = apiWrite('/api/acceptance/submit', { method: 'POST' });
    await fillTokenDialog('still-bad');
    await expect(pending).rejects.toThrow('token 不正确或已轮换');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getStoredWriteToken()).toBeNull();
  });

  it('对话框取消：拒绝这次写请求，不发 fetch', async () => {
    const fetchMock = mockFetch(() => okResponse());
    const pending = apiWrite('/api/view-context', { method: 'POST' });
    await vi.waitFor(() => expect(document.getElementById('write-token-input')).not.toBeNull());
    (document.getElementById('write-token-cancel') as HTMLButtonElement).click();
    await expect(pending).rejects.toThrow('write token required');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('非 401 的错误响应原样返回，由调用方处理', async () => {
    localStorage.setItem(TOKEN_KEY, 'stored-token');
    const fetchMock = mockFetch(() => ({ ok: false, status: 422, json: async () => ({ error: 'x' }) }) as Response);
    const res = await apiWrite('/api/acceptance/submit', { method: 'POST' });
    expect(res.status).toBe(422);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('并发两个写请求且本地无 token → 只弹一个对话框，输入一次两个请求都带同一 token 发出', async () => {
    expect(getStoredWriteToken()).toBeNull();
    const dialogs = watchDialogAdditions();
    const fetchMock = mockFetch(() => okResponse());

    // 对象点击的 postViewContext 与后台 visual-commands ack 并发
    const pendingA = apiWrite('/api/view-context', { method: 'POST', body: '{}' });
    const pendingB = apiWrite('/api/visual-commands/ack', { method: 'POST', body: '{}' });
    await fillTokenDialog('shared-token');

    const [resA, resB] = await Promise.all([pendingA, pendingB]);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = (fetchMock.mock.calls as Array<[string, RequestInit]>).map(([url]) => url).sort();
    expect(urls).toEqual(['/api/view-context', '/api/visual-commands/ack']);
    for (const [, init] of fetchMock.mock.calls as Array<[string, RequestInit]>) {
      expect(new Headers(init.headers).get('x-bontop-token')).toBe('shared-token');
    }
    expect(getStoredWriteToken()).toBe('shared-token');
    await flushObservers();
    expect(dialogs.count).toBe(1);
    dialogs.stop();
  });

  it('交错 401：旧 token 请求迟到时不清掉并发请求刚存入的新 token，也不重复弹框', async () => {
    localStorage.setItem(TOKEN_KEY, 'old-token');
    const dialogs = watchDialogAdditions();
    let releaseFirst!: (response: Response) => void;
    const firstHeld = new Promise<Response>((resolve) => { releaseFirst = resolve; });
    let call = 0;
    const fetchMock = mockFetch(() => {
      call += 1;
      if (call === 1) return firstHeld;              // 请求 1：旧 token，401 迟回
      if (call === 2) return unauthorizedResponse(); // 请求 2：旧 token，401 先回
      return okResponse();                           // 之后的重发一律放行
    });

    const pending1 = apiWrite('/api/a', { method: 'POST' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const pending2 = apiWrite('/api/b', { method: 'POST' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // 请求 2 先拿到 401 → 弹框 → 输入新 token → 存入 → 重发成功
    await fillTokenDialog('new-token');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(localStorage.getItem(TOKEN_KEY)).toBe('new-token');

    // 请求 1 的 401 此刻才返回：不得清掉新 token，也不得再弹框，直接用新 token 重发
    releaseFirst(unauthorizedResponse());
    await expect(pending1).resolves.toMatchObject({ status: 200 });
    await expect(pending2).resolves.toMatchObject({ status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(new Headers((fetchMock.mock.calls[3] as [string, RequestInit])[1].headers).get('x-bontop-token')).toBe('new-token');
    expect(localStorage.getItem(TOKEN_KEY)).toBe('new-token');
    await flushObservers();
    expect(dialogs.count).toBe(1);
    dialogs.stop();
  });

  it('弹框打开即释放第一人称鼠标锁定（缺 token 与 401 重输两条路径都调 exitPointerLock）', async () => {
    const exitPointerLock = vi.fn();
    // jsdom 没有 document.exitPointerLock；生产代码有存在性守卫，这里补上再断言被调
    (document as unknown as { exitPointerLock: () => void }).exitPointerLock = exitPointerLock;
    try {
      // 路径一：本地无 token（missing）——第一人称点对象触发 postViewContext 的场景
      mockFetch(() => okResponse());
      const pending = apiWrite('/api/view-context', { method: 'POST' });
      await fillTokenDialog('tok-1');
      await expect(pending).resolves.toMatchObject({ status: 200 });
      expect(exitPointerLock).toHaveBeenCalledTimes(1);

      // 路径二：token 失效重输（rejected）
      localStorage.setItem(TOKEN_KEY, 'stale');
      let call = 0;
      mockFetch(() => {
        call += 1;
        return call === 1 ? unauthorizedResponse() : okResponse();
      });
      const pending2 = apiWrite('/api/acceptance/gates', { method: 'POST' });
      await fillTokenDialog('tok-2');
      await expect(pending2).resolves.toMatchObject({ status: 200 });
      expect(exitPointerLock).toHaveBeenCalledTimes(2);
    } finally {
      delete (document as unknown as { exitPointerLock?: unknown }).exitPointerLock;
    }
  });

  it('弹框期间 overlay 上的 keydown 不冒泡到 document（第一人称 WASD 不作用于场景）', async () => {
    mockFetch(() => okResponse());
    const pending = apiWrite('/api/view-context', { method: 'POST' });
    await vi.waitFor(() => expect(document.getElementById('write-token-input')).not.toBeNull());
    const overlay = document.getElementById('write-token-dialog') as HTMLElement;
    const input = document.getElementById('write-token-input') as HTMLInputElement;
    const docKeyDown = vi.fn();
    document.addEventListener('keydown', docKeyDown);
    try {
      // 落在浮层上的按键（焦点不在 input，如点了遮罩）不得冒泡到 document
      overlay.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true, cancelable: true }));
      // input 上的 Enter 在目标阶段先执行（确认并关框），同样不得冒泡
      input.value = 'tok';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      expect(docKeyDown).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', docKeyDown);
    }
    await expect(pending).resolves.toMatchObject({ status: 200 });
    expect(document.getElementById('write-token-dialog')).toBeNull();
  });
});

describe('api-write token 对话框焦点陷阱（issue #82）', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.getElementById('write-token-dialog')?.remove();
  });

  /** 在 body 里放一个背景按钮，作为「焦点逃逸到背景控件」的断言靶。 */
  function appendBackgroundButton(): HTMLButtonElement {
    const bgButton = document.createElement('button');
    bgButton.id = 'bg-button';
    document.body.appendChild(bgButton);
    return bgButton;
  }

  /**
   * 打开对话框（本地无 token 路径）并返回这次写请求的 promise。
   * 注意：本函数刻意不是 async 且不 await——返回的 promise 要等对话框确认后才
   * settle，调用方必须直接把它交给 expect(...).rejects/resolves，不能先 await；
   * 对话框在 apiWrite 的同步前缀里就已创建，waitFor 只作保险。
   */
  function openDialog(): Promise<Response> {
    mockFetch(() => okResponse());
    return apiWrite('/api/view-context', { method: 'POST' });
  }

  /** 等到对话框输入框挂载（与既有 #64 用例同一等法）。 */
  async function awaitDialog(): Promise<void> {
    await vi.waitFor(() => expect(document.getElementById('write-token-input')).not.toBeNull());
  }

  it('弹框打开即聚焦 input，Tab / Shift+Tab 在「输入框 ↔ 取消 ↔ 确定」之间循环，焦点不逃逸到背景控件', async () => {
    const pending = openDialog();
    await awaitDialog();
    const bgButton = appendBackgroundButton();

    const input = document.getElementById('write-token-input') as HTMLInputElement;
    const cancelBtn = document.getElementById('write-token-cancel') as HTMLButtonElement;
    const confirmBtn = document.getElementById('write-token-confirm') as HTMLButtonElement;
    const pressTab = (shift: boolean): void => {
      (document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true }),
      );
    };

    // 开框即聚焦 input（issue #82 要求 4 保留的既有行为）
    expect(document.activeElement).toBe(input);
    pressTab(false);
    expect(document.activeElement).toBe(cancelBtn);
    pressTab(false);
    expect(document.activeElement).toBe(confirmBtn);
    pressTab(false);
    expect(document.activeElement).toBe(input); // 链尾循环回 input，不逃逸到背景
    pressTab(true);
    expect(document.activeElement).toBe(confirmBtn); // Shift+Tab 反向循环
    pressTab(true);
    expect(document.activeElement).toBe(cancelBtn);
    pressTab(true);
    expect(document.activeElement).toBe(input);

    // issue #82 触发路径：焦点已逃逸到背景控件时按 Tab，也被拉回对话框
    bgButton.focus();
    expect(document.activeElement).toBe(bgButton);
    pressTab(false);
    expect(document.activeElement).toBe(input);
    expect(document.activeElement).not.toBe(bgButton);

    bgButton.remove();
    (document.getElementById('write-token-cancel') as HTMLButtonElement).click();
    await expect(pending).rejects.toThrow('write token required');
  });

  it('弹框期间 document 级 keydown spy 收不到 Tab / 背景快捷键（焦点在浮层内与逃逸到背景两种情形）', async () => {
    const pending = openDialog();
    await awaitDialog();
    const bgButton = appendBackgroundButton();
    const input = document.getElementById('write-token-input') as HTMLInputElement;
    const docKeyDown = vi.fn();
    document.addEventListener('keydown', docKeyDown);
    try {
      // 情形一：焦点在 input 上按 Tab——原生行为会走到 overlay 之后的背景可聚焦
      // 元素（逃逸），必须被就地截停并循环
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      // 情形二：焦点已逃逸到背景控件——按键目标不在浮层内，overlay 冒泡截停
      // 覆盖不到（这正是 issue #82 的洞），由 document 捕获段兜底；App.ts
      // setupKeyboard 的 KeyV（请求第一人称指针锁定）在此情形下原本会开火，
      // 把鼠标抢回画布、弹框再次点不动
      bgButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      bgButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', bubbles: true, cancelable: true }));
      expect(docKeyDown).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', docKeyDown);
      bgButton.remove();
    }
    (document.getElementById('write-token-cancel') as HTMLButtonElement).click();
    await expect(pending).rejects.toThrow('write token required');
  });

  it('关框后焦点陷阱与 document 拦截一并解除（Tab / 背景键恢复到达 document，不永久拦截）', async () => {
    const pending = openDialog();
    await awaitDialog();
    (document.getElementById('write-token-cancel') as HTMLButtonElement).click();
    await expect(pending).rejects.toThrow('write token required');
    expect(document.getElementById('write-token-dialog')).toBeNull();

    const docKeyDown = vi.fn();
    document.addEventListener('keydown', docKeyDown);
    try {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', bubbles: true, cancelable: true }));
      expect(docKeyDown).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener('keydown', docKeyDown);
    }
  });

  it('input 上的 Escape 仍走取消、Enter 仍走确认（焦点陷阱不改既有键位）', async () => {
    // Escape → 取消
    const pendingCancel = openDialog();
    await awaitDialog();
    const input = document.getElementById('write-token-input') as HTMLInputElement;
    input.value = 'tok';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await expect(pendingCancel).rejects.toThrow('write token required');
    expect(document.getElementById('write-token-dialog')).toBeNull();

    // Enter → 确认（与既有 #64 用例同一路径，此处确认焦点陷阱接入后仍走通）
    const pendingConfirm = openDialog();
    await awaitDialog();
    (document.getElementById('write-token-input') as HTMLInputElement).value = 'tok';
    (document.getElementById('write-token-input') as HTMLInputElement)
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await expect(pendingConfirm).resolves.toMatchObject({ status: 200 });
    expect(document.getElementById('write-token-dialog')).toBeNull();
  });

  it('弹框期间背景顶层节点挂 inert、关框移除；浮层自身与已预设 inert 的节点不被误伤', async () => {
    // jsdom 29.1.1 实测（本仓 node_modules）：'inert' in HTMLElement.prototype ===
    // false，el.inert = true 不反射到属性——inert 的真实行为（挡焦点/挡点击）
    // 只能浏览器实测；这里只验证「挂载时设、卸载时逐个移除」的属性记账不漂移。
    const bgRoot = document.createElement('div');
    bgRoot.id = 'bg-root';
    document.body.appendChild(bgRoot);
    const approvalPage = document.createElement('div');
    approvalPage.id = 'approval-page';
    document.body.appendChild(approvalPage);
    const alreadyInert = document.createElement('div');
    alreadyInert.id = 'already-inert';
    alreadyInert.setAttribute('inert', '');
    document.body.appendChild(alreadyInert);

    const pending = openDialog();
    await awaitDialog();
    const overlay = document.getElementById('write-token-dialog') as HTMLElement;

    expect(overlay.hasAttribute('inert')).toBe(false); // 浮层自身不禁用
    expect(bgRoot.hasAttribute('inert')).toBe(true);
    expect(approvalPage.hasAttribute('inert')).toBe(true);

    (document.getElementById('write-token-cancel') as HTMLButtonElement).click();
    await expect(pending).rejects.toThrow('write token required');

    expect(bgRoot.hasAttribute('inert')).toBe(false);
    expect(approvalPage.hasAttribute('inert')).toBe(false);
    // 开框前就 inert 的节点：属性仍在（不是我们挂的，不误删）
    expect(alreadyInert.hasAttribute('inert')).toBe(true);

    bgRoot.remove();
    approvalPage.remove();
    alreadyInert.remove();
  });
});
