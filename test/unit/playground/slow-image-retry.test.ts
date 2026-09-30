import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { slowImageRetries } from '../../../src/playground/slow-image-retry';

/** Mimics the image tool: it reloads silently `reloads` times, then flips the tool root to the error state. */
const mountFakeImage = (reloads = 0): { holder: HTMLElement; img: HTMLImageElement; failures: () => number } => {
  const holder = document.createElement('div');
  const toolRoot = document.createElement('div');
  const img = document.createElement('img');
  let count = 0;
  let attempts = 0;

  toolRoot.setAttribute('data-blok-tool', 'image');
  toolRoot.setAttribute('data-state', 'rendered');
  img.addEventListener('error', () => {
    count++;
    attempts++;
    if (attempts > reloads) {
      attempts = 0;
      toolRoot.setAttribute('data-state', 'error');
    }
  });
  toolRoot.appendChild(img);
  holder.appendChild(toolRoot);
  document.body.appendChild(holder);

  return { holder, img, failures: () => count };
};

/** Retry moves the card out of the error state; the observer sees it a microtask later. */
const retry = async (holder: HTMLElement): Promise<void> => {
  holder.querySelector('[data-blok-tool="image"]')?.setAttribute('data-state', 'rendered');
  await Promise.resolve();
};

describe('playground slow image retries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  test('the first failure shows at once so the demo boots already failed', () => {
    const { holder, img, failures } = mountFakeImage();

    slowImageRetries(holder, 2000);
    img.dispatchEvent(new Event('error'));

    expect(failures()).toBe(1);
  });

  test('a retry fails again only after the delay', async () => {
    const { holder, img, failures } = mountFakeImage();

    slowImageRetries(holder, 2000);
    img.dispatchEvent(new Event('error'));
    await Promise.resolve();
    await retry(holder);

    img.dispatchEvent(new Event('error'));
    expect(failures()).toBe(1);

    vi.advanceTimersByTime(1999);
    expect(failures()).toBe(1);

    vi.advanceTimersByTime(1);
    expect(failures()).toBe(2);
  });

  test('a retry is held even when the card turns failed after the error event', async () => {
    const { holder, img, failures } = mountFakeImage(Infinity);
    const toolRoot = holder.querySelector('[data-blok-tool="image"]');

    slowImageRetries(holder, 2000);
    img.dispatchEvent(new Event('error'));
    await Promise.resolve();
    toolRoot?.setAttribute('data-state', 'error');
    await Promise.resolve();
    await retry(holder);

    img.dispatchEvent(new Event('error'));

    expect(failures()).toBe(1);
  });

  test('reload attempts inside one retry are not delayed again', async () => {
    const { holder, img, failures } = mountFakeImage(1);

    slowImageRetries(holder, 2000);
    img.dispatchEvent(new Event('error'));
    img.dispatchEvent(new Event('error'));
    await Promise.resolve();
    await retry(holder);

    img.dispatchEvent(new Event('error'));
    vi.advanceTimersByTime(2000);
    await Promise.resolve();
    img.dispatchEvent(new Event('error'));

    expect(failures()).toBe(4);
  });

  test('every retry gets its own delay', async () => {
    const { holder, img, failures } = mountFakeImage();

    slowImageRetries(holder, 2000);
    img.dispatchEvent(new Event('error'));
    await Promise.resolve();

    await retry(holder);
    img.dispatchEvent(new Event('error'));
    vi.advanceTimersByTime(2000);
    await Promise.resolve();

    await retry(holder);
    img.dispatchEvent(new Event('error'));
    expect(failures()).toBe(2);

    vi.advanceTimersByTime(2000);
    expect(failures()).toBe(3);
  });
});
