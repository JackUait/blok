import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { PasteMenuController } from '../../../../src/tools/link/paste-menu/controller';

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

describe('PasteMenuController virtual anchor lifecycle', () => {
  let rafSpy: MockInstance<(callback: FrameRequestCallback) => number> | undefined;

  beforeEach(() => {
    document.body.innerHTML = '';

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
    Object.defineProperty(window, 'scrollX', { configurable: true, value: 0 });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });

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
  });

  afterEach(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    rafSpy?.mockRestore();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('keeps the menu attached to its link block when a nested scroller moves', () => {
    const scroller = document.createElement('div');
    const trigger = document.createElement('div');

    scroller.appendChild(trigger);
    document.body.appendChild(scroller);

    const triggerRectSpy = vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(
      createRect({ top: 90, bottom: 290, left: 40, right: 440, width: 400, height: 200 })
    );
    const controller = new PasteMenuController({ t: (key) => key });

    controller.open({
      url: 'https://example.com/article',
      hasSelection: false,
      position: createRect({ top: 110, bottom: 126, left: 80, right: 80, width: 0, height: 16 }),
      trigger,
      onSelect: vi.fn(),
      onDismiss: vi.fn(),
    });

    const openPopover = document.querySelector<HTMLElement>('[data-blok-popover-opened]');

    expect(openPopover?.style.top).toBe('134px');

    triggerRectSpy.mockReturnValue(
      createRect({ top: 50, bottom: 250, left: 40, right: 440, width: 400, height: 200 })
    );
    scroller.dispatchEvent(new Event('scroll'));

    expect(document.querySelector<HTMLElement>('[data-blok-popover-opened]')?.style.top).toBe('94px');
  });

  it('uses explicit editor direction for a source-less virtual menu instead of the host body', () => {
    document.body.style.direction = 'ltr';
    const controller = new PasteMenuController({ t: (key) => key });

    controller.open({
      url: 'https://example.com/article',
      hasSelection: false,
      position: createRect({ top: 110, bottom: 126, left: 80, right: 80, width: 0, height: 16 }),
      direction: 'rtl',
      onSelect: vi.fn(),
      onDismiss: vi.fn(),
    } as Parameters<PasteMenuController['open']>[0] & { direction: 'rtl' });

    const openPopover = document.querySelector<HTMLElement>('[data-blok-popover-opened]');

    expect(openPopover).toHaveAttribute('dir', 'rtl');
    expect(openPopover?.style.getPropertyValue('direction')).toBe('rtl');
    expect(openPopover?.style.getPropertyPriority('direction')).toBe('important');
  });
});
