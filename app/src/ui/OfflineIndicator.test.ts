import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OfflineIndicator } from './OfflineIndicator';

function createMockElement(tag: string) {
  return {
    tagName: tag,
    id: '',
    style: { display: '' },
    innerHTML: '',
    textContent: '',
    appendChild: vi.fn(),
    removeChild: vi.fn(),
  } as unknown as HTMLElement;
}

describe('OfflineIndicator', () => {
  let indicator: OfflineIndicator;
  let container: HTMLElement;

  beforeEach(() => {
    container = createMockElement('div');
    container.id = 'offline-indicator';
    vi.stubGlobal('document', {
      body: { innerHTML: '', appendChild: vi.fn() },
      createElement: vi.fn(() => container),
      getElementById: vi.fn((id: string) => (id === 'offline-indicator' ? container : null)),
    });
    document.body.appendChild(container);
    indicator = new OfflineIndicator('offline-indicator');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should show when offline', () => {
    indicator.setOffline(true);
    expect(container.style.display).toBe('block');
  });

  it('should hide when online', () => {
    indicator.setOffline(false);
    expect(container.style.display).toBe('none');
  });

  it('should toggle between online and offline', () => {
    indicator.setOffline(true);
    expect(container.style.display).toBe('block');

    indicator.setOffline(false);
    expect(container.style.display).toBe('none');

    indicator.setOffline(true);
    expect(container.style.display).toBe('block');
  });
});
