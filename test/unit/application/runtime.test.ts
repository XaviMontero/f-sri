import { afterEach, describe, expect, it, vi } from 'vitest';
import { consoleLogger, realSleep, silentLogger, systemClock } from '../../../src/application/ports/runtime';

describe('runtime', () => {
  afterEach(() => vi.restoreAllMocks());

  it('systemClock devuelve la hora actual', () => {
    const before = Date.now();
    expect(systemClock.now().getTime()).toBeGreaterThanOrEqual(before);
  });

  it('realSleep espera con setTimeout', async () => {
    vi.useFakeTimers();
    try {
      let done = false;
      const p = realSleep(1000).then(() => (done = true));
      await vi.advanceTimersByTimeAsync(999);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await p;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('consoleLogger delega en console con meta opcional', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogger.info('a', { x: 1 });
    consoleLogger.warn('b');
    consoleLogger.error('c', { y: 2 });
    expect(log).toHaveBeenCalledWith('a', { x: 1 });
    expect(warn).toHaveBeenCalledWith('b', '');
    expect(error).toHaveBeenCalledWith('c', { y: 2 });
  });

  it('silentLogger no escribe nada', () => {
    const log = vi.spyOn(console, 'log');
    silentLogger.info('a');
    silentLogger.warn('b');
    silentLogger.error('c');
    expect(log).not.toHaveBeenCalled();
  });
});
