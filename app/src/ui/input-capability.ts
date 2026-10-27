/**
 * 输入能力探测：移动端形态（底部 tab bar / 底部 sheet / 触摸加固）的判定源。
 *
 * 与 CSS 断点保持一致：NARROW_MAX_PX === style.css 里 @media (max-width: 700px)。
 * touchPrimary 用 pointer:coarse（主输入为触摸）；两者任一成立即移动形态，
 * 由 App 落到 body.mobile-chrome class，CSS 与 JS 共用同一判定。
 */

export const NARROW_MAX_PX = 700;

export interface InputCapabilities {
  /** 主输入为触摸（pointer: coarse） */
  touchPrimary: boolean;
  /** 窄视口（≤700px，与 CSS 断点一致） */
  narrowViewport: boolean;
}

function safeMatch(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

export function readCapabilities(): InputCapabilities {
  return {
    touchPrimary: safeMatch('(pointer: coarse)'),
    narrowViewport: safeMatch(`(max-width: ${NARROW_MAX_PX}px)`),
  };
}

export function isMobileChrome(caps: InputCapabilities): boolean {
  return caps.touchPrimary || caps.narrowViewport;
}

/**
 * 订阅能力变化（matchMedia change 事件 + resize 兜底）。
 * 返回退订函数。matchMedia 不可用时退化为空实现（桌面测试环境）。
 */
export function subscribeCapabilities(onChange: (caps: InputCapabilities) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const queries = [
    '(pointer: coarse)',
    `(max-width: ${NARROW_MAX_PX}px)`,
  ];
  const mqls: MediaQueryList[] = [];
  const handler = () => onChange(readCapabilities());
  for (const query of queries) {
    if (typeof window.matchMedia !== 'function') continue;
    try {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', handler);
      mqls.push(mql);
    } catch {
      // 老环境不支持 addEventListener 的 MediaQueryList：忽略，resize 兜底
    }
  }
  window.addEventListener('resize', handler);
  return () => {
    for (const mql of mqls) {
      try {
        mql.removeEventListener('change', handler);
      } catch {
        // 忽略退订失败
      }
    }
    window.removeEventListener('resize', handler);
  };
}
