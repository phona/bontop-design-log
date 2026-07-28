import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SENS_SLIDER_MIN,
  SENS_SLIDER_MAX,
  SENS_SLIDER_DEFAULT,
  SENS_FACTOR,
} from '../scene/first-person-tuning.js';

interface MockEl {
  id: string;
  className: string;
  type: string;
  min: string;
  max: string;
  value: string;
  textContent: string;
  style: Record<string, string>;
  _handlers: Record<string, Array<() => void>>;
  addEventListener: (ev: string, h: () => void) => void;
  appendChild: (child: MockEl) => void;
  fire: (ev: string) => void;
}

function makeEl(): MockEl {
  const el: MockEl = {
    id: '',
    className: '',
    type: '',
    min: '',
    max: '',
    value: '',
    textContent: '',
    style: {},
    _handlers: {},
    addEventListener(ev, h) {
      (this._handlers[ev] = this._handlers[ev] || []).push(h);
    },
    appendChild() {},
    fire(ev) {
      (this._handlers[ev] || []).forEach((h) => h());
    },
  };
  el.appendChild = vi.fn();
  return el;
}

describe('SensitivitySlider', () => {
  let store: Record<string, string>;
  let appEl: MockEl;
  let created: MockEl[];

  beforeEach(() => {
    store = {};
    appEl = makeEl();
    created = [];
    vi.stubGlobal('document', {
      createElement: vi.fn(() => {
        const e = makeEl();
        created.push(e);
        return e;
      }),
      getElementById: vi.fn((id: string) => (id === 'app' ? appEl : null)),
    });
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((k: string) => (k in store ? store[k] : null)),
      setItem: vi.fn((k: string, v: string) => {
        store[k] = v;
      }),
    });
  });

  it('uses the default value when nothing is stored', async () => {
    const { SensitivitySlider } = await import('../ui/SensitivitySlider.js');
    const slider = new SensitivitySlider();
    expect(slider.getValue()).toBe(SENS_SLIDER_DEFAULT);
    expect(slider.getSensitivity()).toBeCloseTo(SENS_SLIDER_DEFAULT * SENS_FACTOR, 9);
  });

  it('reads a stored value on construction', async () => {
    store['fp-sensitivity'] = '42';
    const { SensitivitySlider } = await import('../ui/SensitivitySlider.js');
    const slider = new SensitivitySlider();
    expect(slider.getValue()).toBe(42);
  });

  it('falls back to default on a corrupt stored value', async () => {
    store['fp-sensitivity'] = 'not-a-number';
    const { SensitivitySlider } = await import('../ui/SensitivitySlider.js');
    const slider = new SensitivitySlider();
    expect(slider.getValue()).toBe(SENS_SLIDER_DEFAULT);
  });

  it('setValue clamps, persists, and fires onChange with value*factor', async () => {
    const { SensitivitySlider } = await import('../ui/SensitivitySlider.js');
    const slider = new SensitivitySlider();
    const seen: number[] = [];
    slider.onChange((s) => seen.push(s));

    slider.setValue(SENS_SLIDER_MAX + 50);
    expect(slider.getValue()).toBe(SENS_SLIDER_MAX);
    expect(store['fp-sensitivity']).toBe(String(SENS_SLIDER_MAX));
    expect(seen[seen.length - 1]).toBeCloseTo(SENS_SLIDER_MAX * SENS_FACTOR, 9);

    slider.setValue(SENS_SLIDER_MIN - 50);
    expect(slider.getValue()).toBe(SENS_SLIDER_MIN);
    expect(store['fp-sensitivity']).toBe(String(SENS_SLIDER_MIN));
  });

  it('step adjusts relative to the current value', async () => {
    store['fp-sensitivity'] = '20';
    const { SensitivitySlider } = await import('../ui/SensitivitySlider.js');
    const slider = new SensitivitySlider();
    slider.step(5);
    expect(slider.getValue()).toBe(25);
    slider.step(-3);
    expect(slider.getValue()).toBe(22);
  });

  it('input event persists and notifies with mapped sensitivity', async () => {
    const { SensitivitySlider } = await import('../ui/SensitivitySlider.js');
    const slider = new SensitivitySlider();
    const seen: number[] = [];
    slider.onChange((s) => seen.push(s));

    const input = created.find((e) => e.type === 'range')!;
    input.value = '7';
    input.fire('input');

    expect(slider.getValue()).toBe(7);
    expect(store['fp-sensitivity']).toBe('7');
    expect(seen[seen.length - 1]).toBeCloseTo(7 * SENS_FACTOR, 9);
  });

  it('show/hide toggle the container display', async () => {
    const { SensitivitySlider } = await import('../ui/SensitivitySlider.js');
    const slider = new SensitivitySlider();
    const container = created[0];
    expect(container.style.display).toBe('none');
    slider.show();
    expect(container.style.display).not.toBe('none');
    slider.hide();
    expect(container.style.display).toBe('none');
  });

  it('mounts into the #app container', async () => {
    const { SensitivitySlider } = await import('../ui/SensitivitySlider.js');
    new SensitivitySlider();
    expect(appEl.appendChild).toHaveBeenCalled();
  });
});
