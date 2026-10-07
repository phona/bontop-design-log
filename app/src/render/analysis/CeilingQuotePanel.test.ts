import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CeilingQuotePanel, type CeilingQuotesPayload } from './CeilingQuotePanel.js';

function payload(): CeilingQuotesPayload {
  return {
    activeId: 'a',
    quantities: { ceiling_zones: 40.6676, curtain_box_linear: 17.85 },
    resolved: {
      ceiling_zones: { per_unit: 45, unit: '元/㎡', source: 'quote' },
      curtain_box_linear: { per_unit: null, unit: '元/m', source: 'base.json' },
    },
    comparison: [
      {
        id: 'a', contractor: '甲', quoted_at: '2026-10-08', status: 'quoted',
        active: true, comparable: true, comparability_notes: [],
        total: null, deltaVsActive: null, pendingRows: ['curtain_box_linear'],
        outOfScopeRows: [], coveredScope: '吊顶板面（㎡，混合口径）',
        rows: [
          { key: 'ceiling_zones', label: '吊顶板面（㎡，混合口径）', quantity: 40.6676, unit: '元/㎡', per_unit: 45, rate_source: 'quote', subtotal: 1830.04, out_of_scope: false },
          { key: 'curtain_box_linear', label: '窗帘盒（延长米）', quantity: 17.85, unit: '元/m', per_unit: null, rate_source: 'base.json', subtotal: null, out_of_scope: false },
        ],
      },
      {
        id: 'b', contractor: '乙', quoted_at: '2026-10-09', status: 'candidate',
        active: false, comparable: true, comparability_notes: [],
        total: 2027.6, deltaVsActive: 197.56, pendingRows: [],
        outOfScopeRows: ['ceiling_zones'], coveredScope: '窗帘盒（延长米）',
        rows: [
          { key: 'ceiling_zones', label: '吊顶板面（㎡，混合口径）', quantity: 40.6676, unit: '元/㎡', per_unit: null, rate_source: 'quote', subtotal: null, out_of_scope: true },
          { key: 'curtain_box_linear', label: '窗帘盒（延长米）', quantity: 17.85, unit: '元/m', per_unit: 27, rate_source: 'quote', subtotal: 482.23, out_of_scope: false },
        ],
      },
    ],
  };
}

describe('CeilingQuotePanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="right-panel-stack"></div>';
  });

  it('渲染数量基准、每行单价×数量=小计、生效卡标记与差额', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => payload() })) as never);
    const panel = new CeilingQuotePanel();
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#ceiling-quote-list')!.textContent).toContain('甲'));

    const list = document.querySelector('#ceiling-quote-list') as HTMLElement;
    // 工程量来自服务端 takeoff，面板不自己算
    expect(list.textContent).toContain('板面');
    expect(list.textContent).toContain('40.668 ㎡');
    expect(list.textContent).toContain('17.85 m');
    // 逐行算式
    expect(list.textContent).toContain('45 元/㎡');
    expect(list.textContent).toContain('待报价');
    // 生效中不给切换按钮，未生效的给
    const active = document.querySelector('.ceiling-quote-card.is-active') as HTMLElement;
    expect(active.textContent).toContain('生效中');
    expect(active.querySelector('button.ceiling-quote-switch')).toBeNull();
    const inactive = document.querySelectorAll('.ceiling-quote-card')[1] as HTMLElement;
    const button = inactive.querySelector('button.ceiling-quote-switch') as HTMLButtonElement;
    expect(button.dataset.quote).toBe('b');
    expect(list.textContent).toContain('198'); // delta vs active（¥197.56 取整显示）
  });

  it('点击切换：POST active → 重新拉取 → 通知外部刷新预算', async () => {
    const get = vi.fn(async (_url: string) => ({ ok: true, status: 200, json: async () => payload() }));
    const post = vi.fn(async (_url: string, _init?: { method?: string; body?: string }) => ({ ok: true, status: 200, json: async () => ({ switched: true, activeId: 'b' }) }));
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string }) => (init?.method === 'POST' ? post(url, init) : get(url))) as never);
    const onSwitched = vi.fn();
    const panel = new CeilingQuotePanel(onSwitched);
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('button.ceiling-quote-switch')).toBeTruthy());

    (document.querySelector('button.ceiling-quote-switch') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(onSwitched).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith('/api/ceiling/quotes/active', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(String(post.mock.calls[0][1]?.body))).toEqual({ id: 'b' });
    // 切换后重新拉了一次报价
    expect(get.mock.calls.length).toBeGreaterThan(1);
  });

  it('切换失败时显示错误，不崩', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { method?: string }) => (
      init?.method === 'POST'
        ? { ok: false, status: 400, json: async () => ({ error: '报价「x」不存在' }) }
        : { ok: true, status: 200, json: async () => payload() }
    )) as never);
    const panel = new CeilingQuotePanel();
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('button.ceiling-quote-switch')).toBeTruthy());
    (document.querySelector('button.ceiling-quote-switch') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('.ceiling-quote-error')?.textContent).toContain('不存在'));
  });

  it('报价接口坏掉时给出可读错误，不抛异常', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }) as never);
    const panel = new CeilingQuotePanel();
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.ceiling-quote-error')?.textContent).toContain('network down'));
  });
});

describe('CeilingQuotePanel 分形态计价与超出范围（DEC-2026-10-08-C12）', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="right-panel-stack"></div>';
  });

  it('边吊按米显示、超出范围的行不显示金额也不写「待报价」', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => payload() })) as never);
    const panel = new CeilingQuotePanel();
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#ceiling-quote-list')!.textContent).toContain('甲'));

    const cards = document.querySelectorAll('.ceiling-quote-card');
    const b = cards[1] as HTMLElement;
    // 混合口径行超出本家范围：标「不在本家报价范围」，不出现「待报价」式的金额占位
    expect(b.textContent).toContain('不在本家报价范围');
    expect(b.textContent).toContain('本家覆盖：窗帘盒（延长米）');
    // 生效卡没有任何超出范围行 → 不显示范围提示
    const a = cards[0] as HTMLElement;
    expect(a.textContent).not.toContain('不在本家报价范围');
  });
});
