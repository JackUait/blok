import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToggleSpringLoader } from '../../../../../../src/components/modules/drag/utils/ToggleSpringLoader';
import type { Block } from '../../../../../../src/components/block';

// This test verifies the contract between DragController and ToggleSpringLoader:
// update() is called with a closed-toggle target, null when no target.

const makeBlock = (isToggle: boolean, isOpen: boolean): Block => {
  const holder = document.createElement('div');
  if (isToggle) {
    const el = document.createElement('div');
    el.setAttribute('data-blok-toggle-open', isOpen ? 'true' : 'false');
    holder.appendChild(el);
  }
  return { holder, call: vi.fn() } as unknown as Block;
};

describe('ToggleSpringLoader.update — null target', () => {
  let loader: ToggleSpringLoader;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    loader = new ToggleSpringLoader();
  });

  afterEach(() => {
    loader.cancel();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('passing null after a closed toggle cancels the timer', () => {
    const block = makeBlock(true, false);
    loader.update(block);
    loader.update(null);
    vi.advanceTimersByTime(500);
    expect(block.call).not.toHaveBeenCalled();
    expect(block.holder.hasAttribute('data-blok-spring-loading')).toBe(false);
  });
});
