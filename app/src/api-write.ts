/**
 * 写操作统一出口（issue #64，2026-11-04 业主拍板）：
 *
 * 服务端对所有 POST/PUT/PATCH/DELETE 一律校验 `x-bontop-token`（无只读豁免，
 * 本机回环同样不免；GET 不校验）。本 helper 收敛全部写 fetch：
 *   - token 存 `localStorage['bontop.write-token']`，自动带头；
 *   - 本地无 token → 弹页面内嵌对话框输入（文案指向服务端日志 /
 *     `.bontop-write-token`）→ 存入 → 自动重发该次请求；
 *   - 收到 401（token 不对或已轮换）→ 清掉本地 token、重新走输入流程，
 *     重发仍 401 则报「token 不正确或已轮换」。
 *   - 并发写共享一次认证（模块级 in-flight）：一个对话框、输入一次全体复用；
 *     取消 = 所有等待中的写一起 reject。清 localStorage 前先比对，迟到 401
 *     不会误清并发请求刚存入的新 token。
 *
 * 对话框全宽（max-width 420px、width 100%），≤700px 手机窄屏可用。
 */

const TOKEN_STORAGE_KEY = 'bontop.write-token';
const TOKEN_HEADER = 'x-bontop-token';

export function getStoredWriteToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeWriteToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // 隐私模式等写不进去时退化为「每次写都问」，不阻断功能
  }
}

function clearStoredWriteToken(): void {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * 页面内嵌 token 输入框。确认且输入非空 → 存入 localStorage 并 resolve；
 * 取消 → reject（调用方已有的错误路径接管）。
 */
function promptForWriteToken(reason: 'missing' | 'rejected'): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const overlay = document.createElement('div');
    overlay.id = 'write-token-dialog';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 1000;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0, 0, 0, 0.6); padding: 16px;
    `;
    const box = document.createElement('div');
    box.style.cssText = `
      background: #1a1a2e; color: #e0e0e0; border-radius: 10px; padding: 16px;
      font-family: 'Segoe UI', system-ui, sans-serif; font-size: 13px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
      width: 100%; max-width: 420px;
    `;
    const hint = reason === 'missing'
      ? '写操作需要服务端 token。请查看服务端启动日志，或仓库根目录的 .bontop-write-token 文件。'
      : 'token 不正确或已轮换，请重新输入（服务端启动日志或仓库根目录 .bontop-write-token）。';
    box.innerHTML = `
      <div style="font-size: 15px; font-weight: 600; margin-bottom: 8px;">输入写操作 token</div>
      <div style="color: #aaa; margin-bottom: 10px;">${hint}</div>
      <input id="write-token-input" type="text" autocomplete="off" spellcheck="false"
        style="width: 100%; box-sizing: border-box; padding: 8px; margin-bottom: 12px;
               border: 1px solid rgba(255,255,255,0.18); border-radius: 6px;
               background: rgba(255,255,255,0.06); color: #eee; font-size: 14px;" />
      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button id="write-token-cancel" type="button"
          style="padding: 6px 14px; border: 1px solid rgba(255,255,255,0.18); border-radius: 6px;
                 background: rgba(255,255,255,0.06); color: #ddd; cursor: pointer;">取消</button>
        <button id="write-token-confirm" type="button"
          style="padding: 6px 14px; border: 1px solid rgba(255,255,255,0.18); border-radius: 6px;
                 background: #2a2a3e; color: #c9cede; cursor: pointer;">确定</button>
      </div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const input = box.querySelector('#write-token-input') as HTMLInputElement;
    const confirmBtn = box.querySelector('#write-token-confirm') as HTMLButtonElement;
    const cancelBtn = box.querySelector('#write-token-cancel') as HTMLButtonElement;

    const close = (): void => {
      overlay.remove();
    };
    const confirm = (): void => {
      const value = input.value.trim();
      if (!value) {
        input.focus();
        return;
      }
      storeWriteToken(value);
      close();
      resolve(value);
    };
    const cancel = (): void => {
      close();
      reject(new Error('write token required'));
    };

    confirmBtn.addEventListener('click', confirm);
    cancelBtn.addEventListener('click', cancel);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') confirm();
      if (event.key === 'Escape') cancel();
    });
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') cancel();
    });
    input.focus();
  });
}

function sendWrite(url: string, init: RequestInit, token: string): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set(TOKEN_HEADER, token);
  return fetch(url, { ...init, headers });
}

let authInFlight: Promise<string> | null = null;

/**
 * 并发写共享一次认证（issue #64 codex 复审 major）：in-flight 期间所有调用 await
 * 同一次输入——对象点击的 postViewContext 与后台 visual-commands ack 并发时只弹
 * 一个对话框，输入一次全体复用。这次认证 settle 后清空 in-flight（下次缺 token
 * 重新弹）。取消 = promise reject，所有等待中的写一起失败，语义一致。
 */
function authenticate(reason: 'missing' | 'rejected'): Promise<string> {
  if (!authInFlight) {
    authInFlight = promptForWriteToken(reason).finally(() => {
      authInFlight = null;
    });
  }
  return authInFlight;
}

/**
 * 仅当本地存的正是刚失败的这个 token 才清——401 可能迟到：并发请求刚通过另一次
 * 认证存入新 token 时，无条件 clear 会把新 token 误清、导致再次弹框。
 */
function clearTokenIfItIs(token: string): void {
  if (getStoredWriteToken() === token) {
    clearStoredWriteToken();
  }
}

/**
 * 带 token 的写请求。用法与 `fetch` 相同，只用于 POST/PUT/PATCH/DELETE。
 */
export async function apiWrite(url: string, init: RequestInit = {}): Promise<Response> {
  let token = getStoredWriteToken();
  if (!token) {
    token = await authenticate('missing');
  }
  const response = await sendWrite(url, init, token);
  if (response.status !== 401) return response;
  // token 不对或已轮换：先比对再清；若本地已被并发认证换成新 token，直接用它
  // 重发一次，不重复弹框
  clearTokenIfItIs(token);
  const refreshed = getStoredWriteToken();
  const retryToken = refreshed && refreshed !== token ? refreshed : await authenticate('rejected');
  const retry = await sendWrite(url, init, retryToken);
  if (retry.status === 401) {
    clearTokenIfItIs(retryToken);
    throw new Error('token 不正确或已轮换，请重新输入（服务端日志或 .bontop-write-token）');
  }
  return retry;
}
