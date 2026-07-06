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

  it('should use exponential backoff on failure', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

    const offlineCallback = vi.fn();
    stateSync.onOfflineChange(offlineCallback);

    stateSync.start();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(4000);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    await vi.advanceTimersByTimeAsync(8000);
    expect(fetchMock).toHaveBeenCalledTimes(5);

    await vi.advanceTimersByTimeAsync(8000);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});
