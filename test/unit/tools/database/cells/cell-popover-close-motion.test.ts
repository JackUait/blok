/**
 * Filter, Sort and the other database panels sit in a CellPopover. Closing one
 * fades it out like the database menus (notion-motion.md "Popovers": the close
 * is the reverse of the open), so the card stays painted until its motion ends.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CellPopover } from '../../../../../src/tools/database/cells/cell-popover';
import { PopoverRegistry } from '../../../../../src/components/utils/popover/popover-registry';

const enablePopoverApi = (): void => {
  Object.defineProperty(HTMLElement.prototype, 'popover', { configurable: true, writable: true, value: null });
  Object.defineProperty(HTMLElement.prototype, 'showPopover', { configurable: true, writable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, 'hidePopover', { configurable: true, writable: true, value: vi.fn() });
};

const disablePopoverApi = (): void => {
  Reflect.deleteProperty(HTMLElement.prototype, 'popover');
  Reflect.deleteProperty(HTMLElement.prototype, 'showPopover');
  Reflect.deleteProperty(HTMLElement.prototype, 'hidePopover');
};

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');

/** A running close transition that ends when the test says. */
const motion = (): { animation: Animation; end: () => Promise<void> } => {
  const handlers: { resolve?: (value: Animation) => void } = {};
  const finished = new Promise<Animation>((resolve) => {
    handlers.resolve = resolve;
  });
  const animation = { finished } as unknown as Animation;

  return {
    animation,
    end: async () => {
      handlers.resolve?.(animation);
      await finished;
      await Promise.resolve();
    },
  };
};

const openPanel = (): { popover: CellPopover; card: HTMLElement; content: HTMLElement } => {
  const anchor = document.createElement('button');
  const content = document.createElement('div');

  document.body.appendChild(anchor);
  const popover = new CellPopover({ anchor, content, onEscape: vi.fn(), onDismiss: vi.fn() });

  popover.show();
  const card = content.closest<HTMLElement>('[data-blok-popover]');

  if (card === null) {
    throw new Error('panel card missing');
  }

  return { popover, card, content };
};

describe('CellPopover close', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    PopoverRegistry.resetForTests();
    enablePopoverApi();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    disablePopoverApi();
    if (originalMatchMedia === undefined) {
      Reflect.deleteProperty(window, 'matchMedia');
    } else {
      Object.defineProperty(window, 'matchMedia', originalMatchMedia);
    }
    document.body.innerHTML = '';
  });

  it('keeps the panel painted while it fades out, then removes it', async () => {
    const { popover, card } = openPanel();
    const fade = motion();
    const container = card.querySelector<HTMLElement>('[data-blok-popover-container]');

    if (container === null) {
      throw new Error('panel container missing');
    }
    Object.defineProperty(container, 'getAnimations', { configurable: true, value: () => [fade.animation] });

    popover.close();

    expect(popover.isOpen).toBe(false);
    expect(card.isConnected).toBe(true);
    expect(card.getAttribute('data-state')).toBe('closed');
    expect(card.hasAttribute('data-blok-top-layer')).toBe(true);

    await fade.end();

    expect(card.isConnected).toBe(false);
  });

  it('removes the panel at once when nothing animates (a table cell editor)', () => {
    const { popover, card } = openPanel();
    const container = card.querySelector<HTMLElement>('[data-blok-popover-container]');

    if (container === null) {
      throw new Error('panel container missing');
    }
    Object.defineProperty(container, 'getAnimations', { configurable: true, value: () => [] });

    popover.close();

    expect(card.isConnected).toBe(false);
  });
});
