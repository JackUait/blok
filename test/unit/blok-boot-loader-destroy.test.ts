import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Blok } from '../../src/blok';
import { Paragraph } from '../../src/tools/paragraph';
import type { OutputData } from '../../types';

const SKELETON = '[data-blok-loading-skeleton]';
let holder: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'],
  });
  holder = document.createElement('div');
  document.body.appendChild(holder);
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

it('pre-ready destroy removes a visible skeleton before load resolves', async () => {
  let resolveLoad: (value: OutputData) => void = () => {};
  const load = new Promise<OutputData>((resolve) => {
    resolveLoad = resolve;
  });
  let resolveMounted: () => void = () => {};
  const mounted = new Promise<void>((resolve) => {
    resolveMounted = resolve;
  });
  const observer = new MutationObserver(() => {
    if (holder.querySelector(SKELETON) !== null) {
      observer.disconnect();
      resolveMounted();
    }
  });

  observer.observe(holder, { childList: true, subtree: true });
  const editor = new Blok({
    holder,
    tools: { paragraph: Paragraph },
    loader: { delay: 50 },
    persistence: { load: () => load, save: async () => {} },
  });
  const ready = editor.isReady;

  try {
    await mounted;
    await vi.advanceTimersByTimeAsync(51);
    editor.destroy();
    await vi.advanceTimersByTimeAsync(0);

    expect(holder.querySelector(SKELETON)).toBeNull();
  } finally {
    observer.disconnect();
    resolveLoad({ blocks: [] });
    await vi.advanceTimersByTimeAsync(2000);
    await ready;
    if (typeof editor.destroy === 'function') {
      editor.destroy();
    }
  }

  expect(holder.childElementCount).toBe(0);
}, 10_000);
