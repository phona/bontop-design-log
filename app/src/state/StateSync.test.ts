import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StateSync } from './StateSync';

describe('StateSync', () => {
  let stateSync: StateSync;

  beforeEach(() => {
    vi.useFakeTimers();
    stateSync = new StateSync();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    stateSync.dispose();
  });

  it('should use exponential backoff on scheme failure', async () => {
    const fetchMock = vi.spyOn(global, 'fetch')
      .mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
        if (urlStr.includes('/api/scheme/current')) {
          throw new Error('Network error');
        }
        return { ok: true, json: async () => [] } as Response;
      });

    const offlineCallback = vi.fn();
    stateSync.onOfflineChange(offlineCallback);

    stateSync.start();
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(1000);

    await vi.advanceTimersByTimeAsync(2000);

    await vi.advanceTimersByTimeAsync(4000);

    await vi.advanceTimersByTimeAsync(8000);

    await vi.advanceTimersByTimeAsync(8000);

    expect(offlineCallback).toHaveBeenCalledWith(true);
  });

  it('should poll scheme and detect changes', async () => {
    const scheme1 = { version: 1, selections: [] };
    const scheme2 = { version: 2, selections: [{ topic: 'wall', optionId: 'opt1' }] };

    let schemeCallCount = 0;
    const fetchMock = vi.spyOn(global, 'fetch')
      .mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
        if (urlStr.includes('/api/scheme/current')) {
          schemeCallCount++;
          if (schemeCallCount === 1) return { ok: true, json: async () => scheme1 } as Response;
          if (schemeCallCount === 2) return { ok: true, json: async () => scheme1 } as Response;
          if (schemeCallCount === 3) return { ok: true, json: async () => scheme2 } as Response;
          return { ok: true, json: async () => scheme2 } as Response;
        }
        return { ok: true, json: async () => [] } as Response;
      });

    const schemeCallback = vi.fn();
    stateSync.onSchemeChange(schemeCallback);

    stateSync.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(schemeCallback).toHaveBeenCalledTimes(1);
    expect(schemeCallback).toHaveBeenCalledWith(scheme1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(schemeCallback).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(schemeCallback).toHaveBeenCalledTimes(2);
    expect(schemeCallback).toHaveBeenCalledWith(scheme2);
  });

  it('should poll visual commands and deduplicate', async () => {
    const cmd1 = { commandId: 'cmd1', type: 'highlight_object', payload: {}, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() };
    const cmd2 = { commandId: 'cmd2', type: 'set_camera_target', payload: {}, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() };

    let vcCallCount = 0;
    const fetchMock = vi.spyOn(global, 'fetch')
      .mockImplementation(async (url: string | URL | Request, options?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
        if (urlStr.includes('/api/scheme/current')) {
          return { ok: true, json: async () => ({ version: 1, selections: [] }) } as Response;
        }
        if (urlStr.includes('/api/visual-commands/ack')) {
          return { ok: true } as Response;
        }
        if (urlStr.includes('/api/visual-commands')) {
          vcCallCount++;
          if (vcCallCount === 1) return { ok: true, json: async () => [] } as Response;
          if (vcCallCount === 2) return { ok: true, json: async () => [cmd1] } as Response;
          if (vcCallCount === 3) return { ok: true, json: async () => [cmd1, cmd2] } as Response;
          return { ok: true, json: async () => [cmd1, cmd2] } as Response;
        }
        return { ok: true, json: async () => [] } as Response;
      });

    const commandCallback = vi.fn();
    stateSync.onVisualCommand(commandCallback);

    stateSync.start();
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(500);
    expect(commandCallback).toHaveBeenCalledTimes(1);
    expect(commandCallback).toHaveBeenCalledWith(cmd1);

    await vi.advanceTimersByTimeAsync(500);
    expect(commandCallback).toHaveBeenCalledTimes(2);
    expect(commandCallback).toHaveBeenCalledWith(cmd2);

    await vi.advanceTimersByTimeAsync(500);
    expect(commandCallback).toHaveBeenCalledTimes(2);
  });

  it('should recover from offline state and reset backoff', async () => {
    const scheme = { version: 1, selections: [] };

    let schemeCallCount = 0;
    const fetchMock = vi.spyOn(global, 'fetch')
      .mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
        if (urlStr.includes('/api/scheme/current')) {
          schemeCallCount++;
          if (schemeCallCount === 1) throw new Error('Network error');
          return { ok: true, json: async () => scheme } as Response;
        }
        return { ok: true, json: async () => [] } as Response;
      });

    const offlineCallback = vi.fn();
    stateSync.onOfflineChange(offlineCallback);

    stateSync.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(offlineCallback).toHaveBeenCalledWith(true);

    await vi.advanceTimersByTimeAsync(1000);
    expect(offlineCallback).toHaveBeenCalledWith(false);
    expect(offlineCallback).toHaveBeenCalledTimes(2);
  });

  it('should call updateScheme with correct payload', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);

    const selections = [{ topic: 'wall', optionId: 'opt1' }];
    await stateSync.updateScheme(selections);

    expect(fetchMock).toHaveBeenCalledWith('/api/scheme/current', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selections, source: 'user' }),
    });
  });

  it('should call ackVisualCommands with correct payload', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);

    await stateSync.ackVisualCommands(['cmd1', 'cmd2']);

    expect(fetchMock).toHaveBeenCalledWith('/api/visual-commands/ack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['cmd1', 'cmd2'] }),
    });
  });

  it('should call postViewContext with correct payload', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);

    await stateSync.postViewContext('room:master_bedroom');

    expect(fetchMock).toHaveBeenCalledWith('/api/view-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ objectId: 'room:master_bedroom' }),
    });
  });

  it('should cleanup processedCommandIds on dispose', async () => {
    const cmd = { commandId: 'cmd1', type: 'highlight_object', payload: {}, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() };

    let vcCallCount = 0;
    vi.spyOn(global, 'fetch')
      .mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
        if (urlStr.includes('/api/scheme/current')) {
          return { ok: true, json: async () => ({ version: 1, selections: [] }) } as Response;
        }
        if (urlStr.includes('/api/visual-commands/ack')) {
          return { ok: true } as Response;
        }
        if (urlStr.includes('/api/visual-commands')) {
          vcCallCount++;
          if (vcCallCount === 1) return { ok: true, json: async () => [cmd] } as Response;
          return { ok: true, json: async () => [] } as Response;
        }
        return { ok: true, json: async () => [] } as Response;
      });

    stateSync.start();
    await vi.advanceTimersByTimeAsync(0);

    stateSync.dispose();

    const stateSync2 = new StateSync();
    let vcCallCount2 = 0;
    const fetchMock2 = vi.spyOn(global, 'fetch')
      .mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
        if (urlStr.includes('/api/scheme/current')) {
          return { ok: true, json: async () => ({ version: 1, selections: [] }) } as Response;
        }
        if (urlStr.includes('/api/visual-commands/ack')) {
          return { ok: true } as Response;
        }
        if (urlStr.includes('/api/visual-commands')) {
          vcCallCount2++;
          if (vcCallCount2 === 1) return { ok: true, json: async () => [cmd] } as Response;
          return { ok: true, json: async () => [] } as Response;
        }
        return { ok: true, json: async () => [] } as Response;
      });

    const commandCallback = vi.fn();
    stateSync2.onVisualCommand(commandCallback);

    stateSync2.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(commandCallback).toHaveBeenCalledTimes(1);
    stateSync2.dispose();
  });

  it('should cleanup expired processedCommandIds during polling', async () => {
    const expiredCmd = { commandId: 'cmd1', type: 'highlight_object', payload: {}, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 100).toISOString() };
    const newCmd = { commandId: 'cmd1', type: 'highlight_object', payload: {}, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() };

    let vcCallCount = 0;
    const fetchMock = vi.spyOn(global, 'fetch')
      .mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
        if (urlStr.includes('/api/scheme/current')) {
          return { ok: true, json: async () => ({ version: 1, selections: [] }) } as Response;
        }
        if (urlStr.includes('/api/visual-commands/ack')) {
          return { ok: true } as Response;
        }
        if (urlStr.includes('/api/visual-commands')) {
          vcCallCount++;
          if (vcCallCount === 1) return { ok: true, json: async () => [expiredCmd] } as Response;
          if (vcCallCount === 2) return { ok: true, json: async () => [] } as Response;
          if (vcCallCount === 3) return { ok: true, json: async () => [newCmd] } as Response;
          return { ok: true, json: async () => [] } as Response;
        }
        return { ok: true, json: async () => [] } as Response;
      });

    const commandCallback = vi.fn();
    stateSync.onVisualCommand(commandCallback);

    stateSync.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(commandCallback).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(500);

    await vi.advanceTimersByTimeAsync(500);
    expect(commandCallback).toHaveBeenCalledTimes(2);
  });

  it('emits configError when a config is failed', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes('/api/config-status')) {
        return { ok: true, json: async () => ({ configs: [{ path: 'config/x.yaml', status: 'failed', error: 'bad' }] }) } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    const sync = new StateSync();
    const configErrorCallback = vi.fn();
    sync.onConfigError(configErrorCallback);
    sync.start();
    await vi.advanceTimersByTimeAsync(0);
    sync.dispose();
    expect(configErrorCallback).toHaveBeenCalledWith([{ path: 'config/x.yaml', error: 'bad' }]);
  });

  it('emits empty configError array when all configs are ok', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes('/api/config-status')) {
        return { ok: true, json: async () => ({ configs: [{ path: 'config/x.yaml', status: 'ok' }] }) } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    const sync = new StateSync();
    const configErrorCallback = vi.fn();
    sync.onConfigError(configErrorCallback);
    sync.start();
    await vi.advanceTimersByTimeAsync(0);
    sync.dispose();
    expect(configErrorCallback).toHaveBeenCalledWith([]);
  });
});
