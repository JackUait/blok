import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type * as AnnouncerModuleNs from '../../../../src/components/utils/announcer';

const POLITE_REGION_ID = 'blok-announcer';
const ASSERTIVE_REGION_ID = 'blok-announcer-assertive';

type AnnouncerModule = typeof AnnouncerModuleNs;

/**
 * Load a fresh copy of the announcer module so its static singleton/refcount
 * state does not leak between tests.
 */
const loadAnnouncer = async (): Promise<AnnouncerModule> => {
  vi.resetModules();

  return import('../../../../src/components/utils/announcer');
};

describe('Announcer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Run requestAnimationFrame callbacks synchronously for deterministic assertions
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
      cb(0);

      return 0;
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('creates two distinct live regions with correct roles and politeness', async () => {
    const { registerAnnouncer } = await loadAnnouncer();

    registerAnnouncer();

    const polite = document.getElementById(POLITE_REGION_ID);
    const assertive = document.getElementById(ASSERTIVE_REGION_ID);

    expect(polite).not.toBeNull();
    expect(assertive).not.toBeNull();

    expect(polite?.getAttribute('role')).toBe('status');
    expect(polite?.getAttribute('aria-live')).toBe('polite');

    expect(assertive?.getAttribute('role')).toBe('alert');
    expect(assertive?.getAttribute('aria-live')).toBe('assertive');
  });

  it('preserves sr-only styling on the regions', async () => {
    const { registerAnnouncer } = await loadAnnouncer();

    registerAnnouncer();

    const polite = document.getElementById(POLITE_REGION_ID);

    expect(polite?.className).toContain('overflow-hidden');
    expect(polite?.className).toContain('w-px');
  });

  it('routes polite and assertive announcements to their own regions without flipping aria-live', async () => {
    const { registerAnnouncer, announce } = await loadAnnouncer();

    registerAnnouncer();

    announce('polite message', { politeness: 'polite' });
    announce('assertive message', { politeness: 'assertive' });

    // Let the queue process (rAF is synchronous, advance the settle timers)
    vi.advanceTimersByTime(1000);

    const polite = document.getElementById(POLITE_REGION_ID);
    const assertive = document.getElementById(ASSERTIVE_REGION_ID);

    // aria-live is never flipped on a region
    expect(polite?.getAttribute('aria-live')).toBe('polite');
    expect(assertive?.getAttribute('aria-live')).toBe('assertive');
  });

  it('does not clobber rapid successive announcements (FIFO queue)', async () => {
    const { registerAnnouncer, announce } = await loadAnnouncer();

    registerAnnouncer();

    const written: string[] = [];
    const polite = document.getElementById(POLITE_REGION_ID);

    if (polite === null) {
      throw new Error('expected polite region');
    }

    // Capture every non-empty write to the region synchronously
    let stored = '';

    Object.defineProperty(polite, 'textContent', {
      configurable: true,
      get: (): string => stored,
      set: (value: string): void => {
        stored = value;

        if (value !== '') {
          written.push(value);
        }
      },
    });

    announce('first', { politeness: 'polite' });
    announce('second', { politeness: 'polite' });
    announce('third', { politeness: 'polite' });

    // Drain the queue
    vi.advanceTimersByTime(5000);

    expect(written).toContain('first');
    expect(written).toContain('second');
    expect(written).toContain('third');
    expect(written.indexOf('first')).toBeLessThan(written.indexOf('second'));
    expect(written.indexOf('second')).toBeLessThan(written.indexOf('third'));
  });

  it('clamps the reference count so extra destroy calls do not underflow', async () => {
    const { registerAnnouncer, destroyAnnouncer } = await loadAnnouncer();

    registerAnnouncer();

    // More destroys than registers must not underflow
    destroyAnnouncer();
    destroyAnnouncer();
    destroyAnnouncer();

    expect(document.getElementById(POLITE_REGION_ID)).toBeNull();

    // A fresh register after over-destroying still works (refcount not negative)
    registerAnnouncer();

    expect(document.getElementById(POLITE_REGION_ID)).not.toBeNull();
  });

  it('keeps the regions alive until the last reference is released', async () => {
    const { registerAnnouncer, destroyAnnouncer } = await loadAnnouncer();

    registerAnnouncer();
    registerAnnouncer();

    destroyAnnouncer();
    expect(document.getElementById(POLITE_REGION_ID)).not.toBeNull();

    destroyAnnouncer();
    expect(document.getElementById(POLITE_REGION_ID)).toBeNull();
  });

  it('destroyAnnouncer does nothing when no instance exists (no lazy creation)', async () => {
    const { destroyAnnouncer } = await loadAnnouncer();

    destroyAnnouncer();

    expect(document.getElementById(POLITE_REGION_ID)).toBeNull();
    expect(document.getElementById(ASSERTIVE_REGION_ID)).toBeNull();
  });
});
