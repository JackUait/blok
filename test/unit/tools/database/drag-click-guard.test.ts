import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { swallowClickAfterCancel } from '../../../../src/tools/database/drag-click-guard';

const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('swallowClickAfterCancel', () => {
  let target: HTMLElement;
  let opened: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    target = document.createElement('div');
    document.body.appendChild(target);
    opened = vi.fn();
    target.addEventListener('click', opened);
  });

  afterEach(async () => {
    // Let any armed swallow expire so it cannot reach the next test.
    target.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
    await nextTask();
    target.remove();
    vi.restoreAllMocks();
  });

  it('eats the click of the release that follows', async () => {
    swallowClickAfterCancel();
    target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    target.click();
    expect(opened).not.toHaveBeenCalled();

    await nextTask();
    target.click();
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('eats nothing when the pointer was cancelled instead of released', () => {
    swallowClickAfterCancel();
    target.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    target.click();

    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('eats nothing once a new press starts, as when the release never reached the page', () => {
    swallowClickAfterCancel();
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    target.click();

    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('eats nothing after the window loses focus', () => {
    swallowClickAfterCancel();
    window.dispatchEvent(new Event('blur'));
    target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    target.click();

    expect(opened).toHaveBeenCalledTimes(1);
  });
});
