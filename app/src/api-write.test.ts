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
});
