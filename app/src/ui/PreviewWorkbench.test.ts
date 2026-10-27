import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PreviewWorkbench } from './PreviewWorkbench.js';

function installDom(): HTMLElement {
  document.body.innerHTML = `
    <aside id="right-panel-stack" aria-label="预演与对象工作台">
      <div class="workbench-header">
        <button type="button" data-workbench-close aria-label="收起预演工作台">−</button>
      </div>
      <div class="workbench-accordion">
        <button type="button" data-workbench-toggle="object" aria-controls="workbench-page-object" aria-expanded="false">对象信息</button>
        <button type="button" data-workbench-toggle="material" aria-controls="workbench-page-material" aria-expanded="true">材质预演</button>
        <button type="button" data-workbench-toggle="lighting" aria-controls="workbench-page-lighting" aria-expanded="false">灯光预演</button>
      </div>
      <div id="workbench-scroll">
        <section id="workbench-page-object" data-workbench-content="object" hidden></section>
        <section id="workbench-page-material" data-workbench-content="material"></section>
        <section id="workbench-page-lighting" data-workbench-content="lighting" hidden>
          <details id="lighting-sunlight-section"><summary>日照与时刻</summary></details>
        </section>
      </div>
      <div id="material-preview-actions"></div>
    </aside>
    <button id="workbench-reopen" type="button">预演</button>
  `;
  return document.getElementById('right-panel-stack')!;
}

describe('PreviewWorkbench', () => {
  beforeEach(() => {
    installDom();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.body.classList.remove('workbench-open', 'workbench-closed');
  });

  it('默认收起：画布优先，body 带 workbench-closed', () => {
    const wb = new PreviewWorkbench(installDom());
    expect(wb.isOpen()).toBe(false);
    expect(document.body.classList.contains('workbench-closed')).toBe(true);
    expect(document.body.classList.contains('workbench-open')).toBe(false);
  });

  it('「预演」按钮呼出，data-workbench-close 收起', () => {
    const wb = new PreviewWorkbench(installDom());
    document.getElementById('workbench-reopen')!.click();
    expect(wb.isOpen()).toBe(true);
    expect(document.body.classList.contains('workbench-open')).toBe(true);
    document.querySelector<HTMLButtonElement>('[data-workbench-close]')!.click();
    expect(wb.isOpen()).toBe(false);
  });

  it('activate(page) 呼出工作台并切到该页', () => {
    const wb = new PreviewWorkbench(installDom());
    wb.activate('object');
    expect(wb.isOpen()).toBe(true);
    expect(document.getElementById('workbench-page-object')!.hidden).toBe(false);
    expect(document.getElementById('workbench-page-material')!.hidden).toBe(true);
  });

  it('手风琴单页：再点一次收起该页', () => {
    const wb = new PreviewWorkbench(installDom());
    wb.activate('lighting');
    expect(document.getElementById('workbench-page-lighting')!.hidden).toBe(false);
    document.querySelector<HTMLButtonElement>('[data-workbench-toggle="lighting"]')!.click();
    expect(document.getElementById('workbench-page-lighting')!.hidden).toBe(true);
  });

  it('第一人称自动收起，退出时恢复先前开合', () => {
    const wb = new PreviewWorkbench(installDom());
    document.getElementById('workbench-reopen')!.click();
    expect(wb.isOpen()).toBe(true);
    wb.setFirstPerson(true);
    expect(wb.isOpen()).toBe(false);
    wb.setFirstPerson(false);
    expect(wb.isOpen()).toBe(true);
  });

  it('第一人称前是收起的，退出后保持收起', () => {
    const wb = new PreviewWorkbench(installDom());
    wb.setFirstPerson(true);
    wb.setFirstPerson(false);
    expect(wb.isOpen()).toBe(false);
  });

  it('缺少手风琴部件时构造抛错（DOM 契约）', () => {
    document.body.innerHTML = '<aside id="right-panel-stack"></aside><button id="workbench-reopen"></button>';
    expect(() => new PreviewWorkbench(document.getElementById('right-panel-stack')!)).toThrow(/accordion item/);
  });
});
