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
 *   - 开框即释放第一人称鼠标锁定（document.exitPointerLock，存在性守卫），
 *     并在 overlay 上截停 keydown 不冒泡；关框不重新锁定（重新点画布再进）。
 *   - 焦点陷阱（issue #82）：Tab/Shift+Tab 在「输入框 ↔ 取消 ↔ 确定」之间循环，
 *     不逃逸到背景；背景顶层节点（#approval-page 与 body 直接子节点）挂 inert
 *     禁交互；document 捕获段兜底截停「焦点已逃逸到背景控件」时的按键——
 *     该情形下 overlay 冒泡截停不触发（按键目标不在浮层内），App 的 V 请求
 *     第一人称指针锁定等 document 级快捷键会把鼠标抢回画布、弹框再次点不动。
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
 * 释放第一人称鼠标锁定。three.js 的 PointerLockControls.unlock() 本质就是
 * `document.exitPointerLock()`，而仓库没有「只解锁、不退出第一人称」的现成 API
 * （FirstPersonController 只暴露 requestLock；disable()/switchToOrbit 会连视角
 * 模式一起退，语义更重），api-write 与那些实例也没有依赖通路，故直接调 document
 * API。jsdom 等环境没有该方法，存在性守卫防止测试环境崩；未锁定时调用是无害 no-op。
 * 本函数不负责重新锁定——关框后业主重新点画布再进第一人称（标准行为）。
 */
function releasePointerLock(): void {
  if (typeof document.exitPointerLock === 'function') {
    document.exitPointerLock();
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
    // 第一人称下点击对象触发的写（App.handleCenterClick → postViewContext）会开这个
    // 框：指针若还锁在画布上，业主点不到输入框/确定/取消，鼠标点击还会继续场景中心
    // 拾取。开框即解锁（missing 与 401 重输两条路径都经这里）。关框不重新锁定。
    releasePointerLock();

    const input = box.querySelector('#write-token-input') as HTMLInputElement;
    const confirmBtn = box.querySelector('#write-token-confirm') as HTMLButtonElement;
    const cancelBtn = box.querySelector('#write-token-cancel') as HTMLButtonElement;

    // ── issue #82 焦点陷阱 / 背景禁交互 ────────────────────────────────
    // 背景顶层节点挂 inert：#approval-page（审批独立页，body 内层节点，循环
    // 覆盖不到）与 body 的直接子节点（#app 等全部顶层背景；overlay 自身也是
    // body 子节点，排除）。jsdom 29 不实现 inert（实测 'inert' in
    // HTMLElement.prototype === false、el.inert = true 不反射属性），其真实
    // 遮挡行为只能浏览器实测；jsdom 下 keydown 不逃逸由下方 document 捕获段
    // 保证。只记自己挂上去的节点，关框时逐个移除，不误删他人预设的 inert。
    const inertedBackground: HTMLElement[] = [];
    const setBackgroundInert = (): void => {
      const targets: HTMLElement[] = [];
      const approvalPage = document.getElementById('approval-page');
      if (approvalPage instanceof HTMLElement) targets.push(approvalPage);
      for (const child of Array.from(document.body.children)) {
        if (child instanceof HTMLElement && child !== overlay && !targets.includes(child)) {
          targets.push(child);
        }
      }
      for (const el of targets) {
        if (!el.hasAttribute('inert')) {
          el.setAttribute('inert', '');
          inertedBackground.push(el);
        }
      }
    };
    const restoreBackgroundInert = (): void => {
      for (const el of inertedBackground) el.removeAttribute('inert');
      inertedBackground.length = 0;
    };

    // document 捕获段兜底：overlay 冒泡截停管的是「按键目标在浮层内」；焦点一旦
    // 逃逸到背景控件（Tab 原生行为走到 overlay 之后的背景可聚焦元素），按键目标
    // 就在背景、overlay 监听根本不触发。Tab 一律就地循环（preventDefault 掉原生
    // 焦点移动）；其余键若目标在浮层内放行（input 的 Enter/Escape 目标阶段先
    // 执行），在背景则就地截停。stopImmediatePropagation 而非 stopPropagation：
    // 挡的是挂在同一个 document 上的监听（App.ts setupKeyboard 的 V 等快捷键、
    // FirstPersonController 的 WASD），同对象监听只有前者挡得住。
    const trapItems: HTMLElement[] = [input, cancelBtn, confirmBtn];
    const onDocKeydownCapture = (event: KeyboardEvent): void => {
      // 兜底：浮层被非 close 路径摘掉后，不再永久拦截 Tab / 背景键
      if (!overlay.isConnected) {
        document.removeEventListener('keydown', onDocKeydownCapture, true);
        restoreBackgroundInert();
        return;
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        event.stopImmediatePropagation();
        const index = trapItems.indexOf(document.activeElement as HTMLElement);
        const dir = event.shiftKey ? -1 : 1;
        // 焦点不在对话框内（已逃逸或落在 body）：拉回输入框
        const next = index === -1 ? trapItems[0] : trapItems[(index + dir + trapItems.length) % trapItems.length];
        next.focus();
        return;
      }
      if (overlay.contains(event.target as Node)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const close = (): void => {
      document.removeEventListener('keydown', onDocKeydownCapture, true);
      restoreBackgroundInert();
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
      // 弹框期间阻断场景键盘输入：第一人称的 WASD/视角快捷键挂在 document 上，
      // overlay 是全屏浮层（fixed inset-0），在这里截停不冒泡；input 上的
      // Enter/Escape 在目标阶段先执行，不受影响。鼠标点击已被浮层本身接住。
      // 注意：这只覆盖「按键目标在浮层内」；焦点逃逸到背景控件时目标不在浮层，
      // 靠 document 捕获段 onDocKeydownCapture 兜底（issue #82）。
      event.stopPropagation();
      if (event.key === 'Escape') cancel();
    });
    // issue #82：背景顶层节点禁交互 + 焦点不逃逸（两处实现见上方注释）
    setBackgroundInert();
    document.addEventListener('keydown', onDocKeydownCapture, true);
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
