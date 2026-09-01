// @vitest-environment jsdom
import { describe, it, beforeEach, vi } from 'vitest';
import assert from 'node:assert/strict';

vi.mock('./render/TextureFactory.js', () => ({
  createMaterialTexture: () => ({}),
}));

import { App } from './App.js';

function installDom(): { button: HTMLButtonElement; controls: HTMLDivElement; overview: HTMLButtonElement } {
  globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
  document.body.innerHTML = `
    <button id="mep-overview-btn">机电总览</button>
    <button id="electrical-topology-btn">电气回路归属</button>
    <div id="electrical-topology-controls" hidden></div>
    <div id="mep-lint-summary" hidden></div>
  `;
  return {
    button: document.getElementById('electrical-topology-btn') as HTMLButtonElement,
    controls: document.getElementById('electrical-topology-controls') as HTMLDivElement,
    overview: document.getElementById('mep-overview-btn') as HTMLButtonElement,
  };
}

function createHarness(topology: object | null): any {
  const app = Object.create(App.prototype) as any;
  app.electricalTopology = topology;
  app.electricalTopologyVisible = false;
  app.houseScene = {
    visible: false,
    setElectricalTopologyVisible(visible: boolean) {
      this.visible = visible;
    },
    setMepOverviewVisible: vi.fn(),
  };
  return app;
}

describe('App electrical topology toggle', () => {
  beforeEach(() => installDom());

  it('shows topology after a successful topology load and click', () => {
    const app = createHarness({ circuits: [] });
    const { button, controls } = installDom();
    app.setupElectricalTopologyButton();

    button.click();

    assert.equal(app.houseScene.visible, true);
    assert.equal(controls.hidden, false);
    assert.equal(button.disabled, false);
    assert.equal(button.classList.contains('active'), true);
    assert.equal(button.textContent, '电气回路归属 · 开');
  });

  it('keeps the topology button unavailable when the API did not load topology', () => {
    const app = createHarness(null);
    const { button, controls } = installDom();
    app.setupElectricalTopologyButton();

    button.click();

    assert.equal(app.houseScene.visible, false);
    assert.equal(controls.hidden, true);
    assert.equal(button.disabled, true);
    assert.equal(button.classList.contains('active'), false);
    assert.equal(button.textContent, '电气回路归属：未就绪');
  });

  it('couples overview visibility while preserving the independent topology preference', () => {
    const app = createHarness({ circuits: [] });
    const { button, controls, overview } = installDom();
    app.hvacCoordinationState = 'ready';
    app.setupElectricalTopologyButton();
    app.setupMepCoordinationButton();

    overview.click();
    assert.equal(app.houseScene.visible, true);
    assert.equal(controls.hidden, false);
    assert.equal(button.classList.contains('active'), true);

    overview.click();
    assert.equal(app.houseScene.visible, false);
    assert.equal(controls.hidden, true);

    button.click();
    overview.click();
    overview.click();
    assert.equal(app.houseScene.visible, true);
    assert.equal(app.electricalTopologyVisible, true);
  });
});
