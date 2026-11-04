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
