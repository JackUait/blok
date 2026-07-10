import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { PopoverDesktop } from '../../../src/components/utils/popover/popover-desktop';
import type { PopoverParams } from '@/types/utils/popover/popover';

const createRect = (overrides: Partial<DOMRect>): DOMRect => ({
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  toJSON: () => ({}),
  ...overrides,
});

const createDefaultItems = (): PopoverParams['items'] => [
  {
    title: 'First',
    name: 'first',
    onActivate: vi.fn(),
  },
];

/**
 * Regression guard for the position-tracker wiring: a trigger-anchored
 * PopoverDesktop must keep following its trigger while open (scroll / resize
 * re-run positioning) and must stop once hidden.
 */
describe('PopoverDesktop position tracker wiring', () => {
  let rafSpy: MockInstance<(callback: FrameRequestCallback) => number> | undefined;
  let trigger: HTMLButtonElement;
  let triggerRectSpy: MockInstance<() => DOMRect>;
  let popover: PopoverDesktop;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024, writable: true });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768, writable: true });

    if (typeof window.requestAnimationFrame !== 'function') {
      window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
        callback(0);

        return 0;
      }) as typeof window.requestAnimationFrame;
    }

    rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0);

      return 0;
    });

    const scopeElement = document.createElement('div');

    document.body.appendChild(scopeElement);
    vi.spyOn(scopeElement, 'getBoundingClientRect').mockReturnValue(
      createRect({ top: 0, left: 0, right: 1024, bottom: 768, width: 1024, height: 768 })
    );

    trigger = document.createElement('button');
    document.body.appendChild(trigger);
    triggerRectSpy = vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(
      createRect({ top: 100, bottom: 140, left: 50, right: 250, width: 200, height: 40 })
    );

    popover = new PopoverDesktop({
      items: createDefaultItems(),
      scopeElement,
      trigger,
    });
  });

  afterEach(() => {
    popover.destroy();
    rafSpy?.mockRestore();
    vi.restoreAllMocks();
  });

  it('re-runs positioning on window scroll while shown', () => {
    popover.show();

    const element = popover.getElement();

    // trigger.bottom (140) + offset (8) = 148
    expect(element.style.top).toBe('148px');

    // The trigger moved (its container scrolled): the tracker must re-anchor.
    triggerRectSpy.mockReturnValue(
      createRect({ top: 60, bottom: 100, left: 50, right: 250, width: 200, height: 40 })
    );
    window.dispatchEvent(new Event('scroll'));

    expect(element.style.top).toBe('108px');
  });

  it('re-runs positioning on window resize while shown', () => {
    popover.show();

    const element = popover.getElement();

    expect(element.style.top).toBe('148px');

    triggerRectSpy.mockReturnValue(
      createRect({ top: 200, bottom: 240, left: 50, right: 250, width: 200, height: 40 })
    );
    window.dispatchEvent(new Event('resize'));

    expect(element.style.top).toBe('248px');
  });

  it('detaches the tracker on hide() so no repositioning happens afterwards', () => {
    popover.show();
    popover.hide();

    const element = popover.getElement();

    // hide() clears the inline position; a live tracker would re-stamp it here.
    expect(element.style.top).toBe('');

    triggerRectSpy.mockReturnValue(
      createRect({ top: 300, bottom: 340, left: 50, right: 250, width: 200, height: 40 })
    );
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));

    expect(element.style.top).toBe('');
    expect(element.style.left).toBe('');
  });
});
