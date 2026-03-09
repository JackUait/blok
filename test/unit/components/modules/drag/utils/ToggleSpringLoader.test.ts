import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToggleSpringLoader } from '../../../../../../src/components/modules/drag/utils/ToggleSpringLoader';
import type { Block } from '../../../../../../src/components/block';

const makeBlock = (isToggle: boolean, isOpen: boolean): Block => {
  const holder = document.createElement('div');
  if (isToggle) {
    const toggleEl = document.createElement('div');
    toggleEl.setAttribute('data-blok-toggle-open', isOpen ? 'true' : 'false');
    holder.appendChild(toggleEl);
  }
  return { holder, call: vi.fn() } as unknown as Block;
};

describe('ToggleSpringLoader', () => {
  let springLoader: ToggleSpringLoader;

  beforeEach(() => {
    vi.useFakeTimers();
    springLoader = new ToggleSpringLoader();
  });

  afterEach(() => {
    springLoader.cancel();
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('calls expand on toggle after 500ms hover', () => {
    const block = makeBlock(true, false);
    springLoader.update(block);
    vi.advanceTimersByTime(499);
    expect(block.call).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(block.call).toHaveBeenCalledWith('expand');
  });

  it('adds data-blok-spring-loading attribute on hover start', () => {
    const block = makeBlock(true, false);
    springLoader.update(block);
    expect(block.holder.hasAttribute('data-blok-spring-loading')).toBe(true);
  });

  it('removes data-blok-spring-loading after expand fires', () => {
    const block = makeBlock(true, false);
    springLoader.update(block);
    vi.advanceTimersByTime(500);
    expect(block.holder.hasAttribute('data-blok-spring-loading')).toBe(false);
  });

  it('does not start timer for open toggle', () => {
    const block = makeBlock(true, true);
    springLoader.update(block);
    vi.advanceTimersByTime(500);
    expect(block.call).not.toHaveBeenCalled();
    expect(block.holder.hasAttribute('data-blok-spring-loading')).toBe(false);
  });

  it('does not start timer for non-toggle block', () => {
    const block = makeBlock(false, false);
    springLoader.update(block);
    vi.advanceTimersByTime(500);
    expect(block.call).not.toHaveBeenCalled();
  });

  it('cancels pending timer when target changes to a different block', () => {
    const block1 = makeBlock(true, false);
    const block2 = makeBlock(true, false);
    springLoader.update(block1);
    vi.advanceTimersByTime(300);
    springLoader.update(block2); // change target before timer fires
    vi.advanceTimersByTime(200); // original timer would have fired now
    expect(block1.call).not.toHaveBeenCalled(); // cancelled
    expect(block1.holder.hasAttribute('data-blok-spring-loading')).toBe(false);
  });

  it('restarts 500ms timer from zero on new target', () => {
    const block1 = makeBlock(true, false);
    const block2 = makeBlock(true, false);
    springLoader.update(block1);
    vi.advanceTimersByTime(300);
    springLoader.update(block2);
    vi.advanceTimersByTime(499);
    expect(block2.call).not.toHaveBeenCalled(); // timer reset
    vi.advanceTimersByTime(1);
    expect(block2.call).toHaveBeenCalledWith('expand');
  });

  it('is a no-op when updated with same block while timer is active', () => {
    const block = makeBlock(true, false);
    springLoader.update(block);
    vi.advanceTimersByTime(200);
    springLoader.update(block); // same block, should not restart timer
    expect(block.holder.hasAttribute('data-blok-spring-loading')).toBe(true);
    vi.advanceTimersByTime(300); // 200+300 = 500ms from first call
    expect(block.call).toHaveBeenCalledTimes(1);
    expect(block.holder.hasAttribute('data-blok-spring-loading')).toBe(false);
  });

  it('cancel() clears pending timer and attribute', () => {
    const block = makeBlock(true, false);
    springLoader.update(block);
    springLoader.cancel();
    vi.advanceTimersByTime(500);
    expect(block.call).not.toHaveBeenCalled();
    expect(block.holder.hasAttribute('data-blok-spring-loading')).toBe(false);
  });

  it('cancel() is safe to call when no timer is active', () => {
    expect(() => springLoader.cancel()).not.toThrow();
  });

  it('update(null) cancels the active timer', () => {
    const block = makeBlock(true, false);
    springLoader.update(block);
    springLoader.update(null);
    vi.advanceTimersByTime(500);
    expect(block.call).not.toHaveBeenCalled();
    expect(block.holder.hasAttribute('data-blok-spring-loading')).toBe(false);
  });

  it('sets data-blok-spring-loaded attribute on holder after expand fires', () => {
    const block = makeBlock(true, false);
    springLoader.update(block);
    vi.advanceTimersByTime(500);
    expect(block.holder.hasAttribute('data-blok-spring-loaded')).toBe(true);
  });

  it('removes data-blok-spring-loaded attribute after 700ms', () => {
    const block = makeBlock(true, false);
    springLoader.update(block);
    vi.advanceTimersByTime(500);
    expect(block.holder.hasAttribute('data-blok-spring-loaded')).toBe(true);
    vi.advanceTimersByTime(700);
    expect(block.holder.hasAttribute('data-blok-spring-loaded')).toBe(false);
  });
});
