import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as LazyStyles from '../../../../src/components/utils/lazy-styles';
import { REGISTRY as LAZY_REGISTRY } from '../../../../src/components/utils/lazy-styles';

vi.mock('../../../../src/styles/lazy/fonts.css?inline', () => ({ default: '@font-face{font-family:Probe}' }));
vi.mock('../../../../src/styles/lazy/database.css?inline', () => ({ default: '.db{}' }));

const failDatabaseChunk = (): void => {
  vi.doMock('../../../../src/styles/lazy/database.css?inline', () => {
    throw new Error('chunk failed');
  });
};
vi.mock('../../../../src/styles/lazy/block-preview.css?inline', () => ({ default: '.bp{}' }));
vi.mock('../../../../src/styles/lazy/presence.css?inline', () => ({ default: '.pr{}' }));

const REGISTRY = LAZY_REGISTRY;

const marker = (name: string): string => `[data-blok-sheet=${name}]{--blok-sheet:${name}}`;

const lazyStyles = async (): Promise<typeof LazyStyles> => import('../../../../src/components/utils/lazy-styles');

const sheetText = (): string | null | undefined => document.getElementById('blok-styles')?.textContent;

describe('lazy stylesheets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    Reflect.deleteProperty(globalThis, REGISTRY);
    document.head.innerHTML = '';
  });

  afterEach(() => {
    vi.doMock('../../../../src/styles/lazy/database.css?inline', () => ({ default: '.db{}' }));
    vi.restoreAllMocks();
    Reflect.deleteProperty(globalThis, REGISTRY);
    document.head.innerHTML = '';
  });

  it('mounts one #blok-styles first in head, with the nonce', async () => {
    const { mountStyles } = await lazyStyles();
    const host = document.createElement('style');

    host.id = 'host';
    document.head.append(host);

    mountStyles('.a{color:red}', 'n0nce');

    expect([...document.head.querySelectorAll('style')].map((tag) => tag.id)).toEqual(['blok-styles', 'host']);
    expect(document.getElementById('blok-styles')?.getAttribute('nonce')).toBe('n0nce');
  });

  it('splices a loaded sheet into #blok-styles at its marker, so its rules keep their place', async () => {
    const { mountStyles, loadSheet } = await lazyStyles();

    mountStyles(`.a{}${marker('database')}.b{}`, undefined);
    await loadSheet('database');

    expect(sheetText()).toBe('.a{}.db{}.b{}');
  });

  it.each([
    ['minified', '[data-blok-sheet=database]{--blok-sheet:database}'],
    ['as authored', "[data-blok-sheet='database'] {\n  --blok-sheet: database;\n}"],
  ])('finds a %s marker', async (_form, written) => {
    const { mountStyles, loadSheet } = await lazyStyles();

    mountStyles(`.a{}${written}.b{}`, undefined);
    await loadSheet('database');

    expect(sheetText()).toBe('.a{}.db{}.b{}');
  });

  it('writes a sheet that loaded before #blok-styles existed when it mounts', async () => {
    const { mountStyles, loadSheet } = await lazyStyles();

    await loadSheet('database');
    mountStyles(`.a{}${marker('database')}.b{}`, undefined);

    expect(sheetText()).toBe('.a{}.db{}.b{}');
  });

  it('appends a sheet whose marker is missing, once', async () => {
    const { mountStyles, loadSheet } = await lazyStyles();

    mountStyles('.a{}', undefined);
    await loadSheet('database');
    mountStyles('.ignored{}', undefined);
    await loadSheet('database');

    expect(sheetText()).toBe('.a{}\n.db{}');
  });

  it('shares one load between callers', async () => {
    const { loadSheet } = await lazyStyles();

    expect(loadSheet('database')).toBe(loadSheet('database'));
  });

  it('keeps loaded sheets page-wide, so a second copy of the module reuses them', async () => {
    const first = await lazyStyles();

    await first.loadSheet('database');
    vi.resetModules();
    failDatabaseChunk();
    const second = await lazyStyles();

    second.mountStyles(`.a{}${marker('database')}`, undefined);

    expect(second.isSheetLoaded('database')).toBe(true);
    expect(sheetText()).toBe('.a{}.db{}');
  });

  it('resolves without the sheet when its chunk fails, and leaves the marker in place', async () => {
    failDatabaseChunk();
    const { mountStyles, loadSheet, isSheetLoaded } = await lazyStyles();

    mountStyles(`.a{}${marker('database')}`, undefined);

    await expect(loadSheet('database')).resolves.toBeUndefined();
    expect(isSheetLoaded('database')).toBe(false);
    expect(sheetText()).toBe(`.a{}${marker('database')}`);
  });

  it('does not import a failed sheet again: browsers keep a failed import', async () => {
    failDatabaseChunk();
    const { loadSheet } = await lazyStyles();
    const first = loadSheet('database');

    await first;

    expect(loadSheet('database')).toBe(first);
  });

  it('keys the page-wide registry by version, so two Blok versions do not share sheets', () => {
    expect(REGISTRY.description).toMatch(/^blok\.lazySheets@.+/);
  });

  it('runs idle work in requestIdleCallback when there is one', async () => {
    const { whenIdle } = await lazyStyles();
    const idle: Array<() => void> = [];
    const task = vi.fn();

    vi.stubGlobal('requestIdleCallback', (callback: () => void) => idle.push(callback));
    try {
      whenIdle(task);
      expect(task).not.toHaveBeenCalled();
      idle.forEach((callback) => callback());
      expect(task).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('falls back to a timer for idle work', async () => {
    const { whenIdle } = await lazyStyles();
    const task = vi.fn();

    vi.useFakeTimers();
    vi.stubGlobal('requestIdleCallback', undefined);
    try {
      whenIdle(task);
      expect(task).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(task).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('waits at most the given time for a stalled promise', async () => {
    const { waitAtMost } = await lazyStyles();
    const settled = { done: false };

    vi.useFakeTimers();
    try {
      void waitAtMost(new Promise(() => undefined), 50).then(() => {
        settled.done = true;
      });
      await vi.advanceTimersByTimeAsync(49);
      expect(settled.done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(settled.done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
