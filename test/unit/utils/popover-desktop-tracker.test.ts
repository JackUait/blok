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
  let originalScrollX: number;
  let originalScrollY: number;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';

    originalScrollX = window.scrollX;
    originalScrollY = window.scrollY;

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024, writable: true });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768, writable: true });
    Object.defineProperty(window, 'scrollX', { configurable: true, value: 0, writable: true });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0, writable: true });

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
    Object.defineProperty(window, 'scrollX', { configurable: true, value: originalScrollX, writable: true });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: originalScrollY, writable: true });
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

  it('keeps a collapsed trigger attached to its document point after window scrolling', () => {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0, writable: true });
    popover.show();

    const element = popover.getElement();

    expect(element.style.top).toBe('148px');

    // Block settings hides its dots trigger while the menu is open. Its
    // captured rect represents a document point, so a later window scroll
    // must move that rect in the viewport instead of pinning it on screen.
    triggerRectSpy.mockReturnValue(createRect({}));
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 40, writable: true });
    window.dispatchEvent(new Event('scroll'));

    expect(element.style.top).toBe('148px');
  });

  it('moves a collapsed trigger with its measurable ancestor during nested scrolling', () => {
    const parent = document.createElement('div');
    const nestedTrigger = document.createElement('button');

    parent.appendChild(nestedTrigger);
    document.body.appendChild(parent);

    const parentRectSpy = vi.spyOn(parent, 'getBoundingClientRect').mockReturnValue(
      createRect({ top: 80, bottom: 300, left: 20, right: 500, width: 480, height: 220 })
    );
    const nestedTriggerRectSpy = vi.spyOn(nestedTrigger, 'getBoundingClientRect').mockReturnValue(
      createRect({ top: 100, bottom: 140, left: 50, right: 250, width: 200, height: 40 })
    );
    const nestedPopover = new PopoverDesktop({
      items: createDefaultItems(),
      trigger: nestedTrigger,
    });

    nestedPopover.show();
    expect(nestedPopover.getElement().style.top).toBe('148px');

    nestedTriggerRectSpy.mockReturnValue(createRect({}));
    parentRectSpy.mockReturnValue(
      createRect({ top: 40, bottom: 260, left: 20, right: 500, width: 480, height: 220 })
    );
    parent.dispatchEvent(new Event('scroll'));

    expect(nestedPopover.getElement().style.top).toBe('108px');
    nestedPopover.destroy();
  });

  it('moves an explicit virtual anchor by an explicitly supplied trigger context delta', () => {
    const caretRect = createRect({ top: 110, bottom: 126, left: 80, right: 80, width: 0, height: 16 });

    popover.updatePosition(caretRect, { positionContext: trigger });
    popover.show();

    expect(popover.getElement().style.top).toBe('134px');

    triggerRectSpy.mockReturnValue(
      createRect({ top: 60, bottom: 100, left: 50, right: 250, width: 200, height: 40 })
    );
    window.dispatchEvent(new Event('scroll'));

    expect(popover.getElement().style.top).toBe('94px');
  });

  it('dismisses a context-free virtual anchor when a nested scroller moves', () => {
    const scroller = document.createElement('div');
    const positionedPopover = new PopoverDesktop({
      items: createDefaultItems(),
      position: createRect({ top: 100, bottom: 140, left: 50, right: 250, width: 200, height: 40 }),
      positionLifecycle: 'dismiss-on-nested-scroll',
    });

    document.body.appendChild(scroller);
    positionedPopover.show();

    expect(positionedPopover.getElement().hasAttribute('data-blok-popover-opened')).toBe(true);

    scroller.dispatchEvent(new Event('scroll'));

    expect(positionedPopover.getElement().hasAttribute('data-blok-popover-opened')).toBe(false);
    positionedPopover.destroy();
  });

  it('moves an explicit virtual anchor by its dedicated position context', () => {
    const positionContext = document.createElement('div');
    const positionContextRectSpy = vi.spyOn(positionContext, 'getBoundingClientRect').mockReturnValue(
      createRect({ top: 90, bottom: 290, left: 40, right: 440, width: 400, height: 200 })
    );
    const caretRect = createRect({ top: 110, bottom: 126, left: 80, right: 80, width: 0, height: 16 });
    const contextPopover = new PopoverDesktop({
      items: createDefaultItems(),
      trigger,
      position: caretRect,
      positionContext,
    });

    document.body.appendChild(positionContext);
    contextPopover.show();

    expect(contextPopover.getElement().style.top).toBe('134px');

    // The toolbar trigger stays fixed, but the content that produced the
    // virtual caret rect moves inside its own scroller.
    positionContextRectSpy.mockReturnValue(
      createRect({ top: 50, bottom: 250, left: 40, right: 440, width: 400, height: 200 })
    );
    positionContext.dispatchEvent(new Event('scroll'));

    expect(contextPopover.getElement().style.top).toBe('94px');
    contextPopover.destroy();
  });

  it('dismisses a virtual anchor when its declared context becomes unmeasurable', () => {
    const positionContext = document.createElement('div');
    const positionContextRectSpy = vi.spyOn(positionContext, 'getBoundingClientRect').mockReturnValue(
      createRect({ top: 90, bottom: 290, left: 40, right: 440, width: 400, height: 200 })
    );
    const contextPopover = new PopoverDesktop({
      items: createDefaultItems(),
      position: createRect({ top: 110, bottom: 126, left: 80, right: 80, width: 0, height: 16 }),
      positionContext,
    });

    document.body.appendChild(positionContext);
    contextPopover.show();

    positionContextRectSpy.mockReturnValue(createRect({}));
    positionContext.dispatchEvent(new Event('scroll'));

    expect(contextPopover.getElement().hasAttribute('data-blok-popover-opened')).toBe(false);
    contextPopover.destroy();
  });

  it('treats an explicitly dismissible virtual position as a root anchor', () => {
    const positionedPopover = new PopoverDesktop({
      items: createDefaultItems(),
      position: createRect({ top: 100, bottom: 140, left: 50, right: 250, width: 200, height: 40 }),
      positionLifecycle: 'dismiss-on-nested-scroll',
    });

    positionedPopover.show();

    expect(positionedPopover.getElement().parentElement).toBe(document.body);
    expect(positionedPopover.getElement().style.position).toBe('absolute');
    expect(positionedPopover.getElement().style.top).toBe('148px');

    positionedPopover.destroy();
  });
});
