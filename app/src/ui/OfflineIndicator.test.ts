// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OfflineIndicator } from './OfflineIndicator';

describe('OfflineIndicator', () => {
  let indicator: OfflineIndicator;
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    container.id = 'offline-indicator';
    document.body.appendChild(container);
    indicator = new OfflineIndicator('offline-indicator');
  });

  afterEach(() => {
    document.body.innerHTML = '';
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
