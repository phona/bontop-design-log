import {
  SENS_SLIDER_MIN,
  SENS_SLIDER_MAX,
  SENS_SLIDER_DEFAULT,
  SENS_FACTOR,
} from '../scene/first-person-tuning.js';

const STORAGE_KEY = 'fp-sensitivity';

export class SensitivitySlider {
  private el: HTMLDivElement;
  private input: HTMLInputElement;
  private valueSpan: HTMLSpanElement;
  private onChangeCb?: (sens: number) => void;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'sensitivity-slider';
    this.el.style.display = 'none';

    const label = document.createElement('span');
    label.textContent = '灵敏度 ';

    this.input = document.createElement('input');
    this.input.type = 'range';
    this.input.min = String(SENS_SLIDER_MIN);
    this.input.max = String(SENS_SLIDER_MAX);
    this.input.value = String(this.loadValue());

    this.valueSpan = document.createElement('span');
    this.valueSpan.className = 'sensitivity-value';
    this.refreshLabel();

    this.input.addEventListener('input', () => {
      this.persist(Number(this.input.value));
      this.refreshLabel();
      this.onChangeCb?.(this.getSensitivity());
    });

    this.el.appendChild(label);
    this.el.appendChild(this.input);
    this.el.appendChild(this.valueSpan);
    document.getElementById('app')?.appendChild(this.el);
  }

  private loadValue(): number {
    let raw: string | null = null;
    try {
      raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    } catch {
      raw = null;
    }
    if (raw === null) return SENS_SLIDER_DEFAULT;
    const n = Number(raw);
    if (!Number.isFinite(n)) return SENS_SLIDER_DEFAULT;
    return Math.max(SENS_SLIDER_MIN, Math.min(SENS_SLIDER_MAX, Math.round(n)));
  }

  private persist(v: number): void {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, String(v));
    } catch {
      // storage unavailable (private mode / SSR) — keep in-memory only
    }
  }

  private refreshLabel(): void {
    this.valueSpan.textContent = this.input.value;
  }

  getValue(): number {
    return Number(this.input.value);
  }

  getSensitivity(): number {
    return this.getValue() * SENS_FACTOR;
  }

  setValue(v: number): void {
    const clamped = Math.max(SENS_SLIDER_MIN, Math.min(SENS_SLIDER_MAX, Math.round(v)));
    this.input.value = String(clamped);
    this.persist(clamped);
    this.refreshLabel();
    this.onChangeCb?.(this.getSensitivity());
  }

  step(delta: number): void {
    this.setValue(this.getValue() + delta);
  }

  onChange(cb: (sens: number) => void): void {
    this.onChangeCb = cb;
  }

  show(): void {
    this.el.style.display = 'flex';
  }

  hide(): void {
    this.el.style.display = 'none';
  }
}
