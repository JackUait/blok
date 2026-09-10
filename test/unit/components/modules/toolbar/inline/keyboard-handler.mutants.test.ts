import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InlineKeyboardHandler } from '../../../../../../src/components/modules/toolbar/inline/keyboard-handler';
import { hasEscapeLayer } from '../../../../../../src/components/utils/dismissable-layer';
import { isInsideKeyboardOwner } from '../../../../../../src/components/modules/blockEvents/utils/keyboard';
import type { PopoverInline } from '../../../../../../src/components/utils/popover/popover-inline';

const flipperHoist = vi.hoisted(() => {
  class MockFlipper {
    public hasFocus = vi.fn(() => false);

    public flipLeft = vi.fn(() => {});

    public flipRight = vi.fn(() => {});
  }

  return { MockFlipper };
});

vi.mock('../../../../../../src/components/flipper', () => ({ Flipper: flipperHoist.MockFlipper }));
vi.mock('../../../../../../src/components/utils/dismissable-layer', () => ({ hasEscapeLayer: vi.fn(() => false) }));
vi.mock('../../../../../../src/components/modules/blockEvents/utils/keyboard', () => ({
  isInsideKeyboardOwner: vi.fn(() => true),
}));

type PopoverStub = {
  flipper?: { hasFocus: () => boolean };
  hasNestedPopoverOpen?: boolean;
  closeNestedPopover: ReturnType<typeof vi.fn>;
  hasNode: ReturnType<typeof vi.fn>;
};

const makeEvent = (key: string, overrides: { defaultPrevented?: boolean; target?: unknown } = {}) => {
  const event = {
    key,
    shiftKey: false,
    defaultPrevented: overrides.defaultPrevented ?? false,
    target: overrides.target ?? document.createElement('div'),
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  };

  return event as unknown as KeyboardEvent;
};

const makeHandler = (popover: PopoverStub | null): {
  handler: InlineKeyboardHandler;
  closeToolbar: ReturnType<typeof vi.fn>;
} => {
  const closeToolbar = vi.fn();
  const handler = new InlineKeyboardHandler(() => popover as unknown as PopoverInline | null, closeToolbar);

  return { handler, closeToolbar };
};

const makePopover = (overrides: Partial<PopoverStub> = {}): PopoverStub => ({
  flipper: { hasFocus: vi.fn(() => false) },
  hasNestedPopoverOpen: false,
  closeNestedPopover: vi.fn(),
  hasNode: vi.fn(() => true),
  ...overrides,
});

/**
 * PROVEN EQUIVALENT (no test can distinguish this mutant):
 *
 * - L97 popover?.hasNode -> popover.hasNode: the conjunct
 *   `popover?.hasNestedPopoverOpen ?? false` earlier in the same condition is
 *   false whenever the popover is null, so the chain is only evaluated for a
 *   non-null popover where ?. and . agree.
 */
/**
 * PROVEN EQUIVALENT (no test can distinguish this mutant):
 *
 * - L97 popover?.hasNode -> popover.hasNode: the conjunct
 *   `popover?.hasNestedPopoverOpen ?? false` earlier in the same condition is
 *   false whenever the popover is null, so the chain is only evaluated for a
 *   non-null popover where ?. and . agree.
 */
describe('InlineKeyboardHandler — mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // restoreAllMocks in afterEach wipes factory-mock implementations, so the
    // gate mocks must be re-primed before every test.
    vi.mocked(hasEscapeLayer).mockReturnValue(false);
    vi.mocked(isInsideKeyboardOwner).mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('swallows Escape only when every guard holds', () => {
    const popover = makePopover({ hasNestedPopoverOpen: true });
    const { handler } = makeHandler(popover);
    const event = makeEvent('Escape');

    handler.handle(event, true);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(popover.closeNestedPopover).toHaveBeenCalledOnce();
  });

  it('ignores non-Escape keys in the nested-close branch', () => {
    const popover = makePopover({ hasNestedPopoverOpen: true });
    const { handler } = makeHandler(popover);
    const event = makeEvent('a');

    handler.handle(event, true);

    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(popover.closeNestedPopover).not.toHaveBeenCalled();
  });

  it('ignores Escape when the event was already handled', () => {
    const popover = makePopover({ hasNestedPopoverOpen: true });
    const { handler } = makeHandler(popover);
    const event = makeEvent('Escape', { defaultPrevented: true });

    handler.handle(event, true);

    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(popover.closeNestedPopover).not.toHaveBeenCalled();
  });

  it('ignores Escape when the toolbar is closed', () => {
    const popover = makePopover({ hasNestedPopoverOpen: true });
    const { handler } = makeHandler(popover);
    const event = makeEvent('Escape');

    handler.handle(event, false);

    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(popover.closeNestedPopover).not.toHaveBeenCalled();
  });

  it('ignores Escape when no nested popover is open', () => {
    const popover = makePopover();
    const { handler } = makeHandler(popover);
    const event = makeEvent('Escape');

    handler.handle(event, true);

    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(popover.closeNestedPopover).not.toHaveBeenCalled();
  });

  it('leaves Escape to the escape layer when one is active', async () => {
    const dismissable = vi.mocked(await import('../../../../../../src/components/utils/dismissable-layer'));

    dismissable.hasEscapeLayer.mockReturnValue(true);

    const popover = makePopover({ hasNestedPopoverOpen: true });
    const { handler } = makeHandler(popover);
    const event = makeEvent('Escape');

    handler.handle(event, true);

    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(popover.closeNestedPopover).not.toHaveBeenCalled();
  });

  it('needs a real Node target before it owns Escape', () => {
    const popover = makePopover({ hasNestedPopoverOpen: true });
    const { handler } = makeHandler(popover);
    const event = makeEvent('Escape', { target: 42 });

    handler.handle(event, true);

    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(popover.closeNestedPopover).not.toHaveBeenCalled();
  });

  it('survives a null popover on Escape without throwing', () => {
    const { handler, closeToolbar } = makeHandler(null);
    const event = makeEvent('Escape');

    expect(() => handler.handle(event, true)).not.toThrow();
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(closeToolbar).not.toHaveBeenCalled();
  });

  it('reports no flipper focus when the popover has no flipper', () => {
    const { handler } = makeHandler(makePopover({ flipper: undefined }));

    expect(handler.hasFlipperFocus).toBe(false);
  });

  it('treats an absent nested-popover flag as closed in handle()', () => {
    const popover = makePopover({ hasNestedPopoverOpen: undefined });
    const { handler } = makeHandler(popover);
    const event = makeEvent('Escape');

    handler.handle(event, true);

    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(popover.closeNestedPopover).not.toHaveBeenCalled();
  });

  it('keeps the toolbar open on ArrowDown when the flipper owns focus', () => {
    const popoverFlipper = new flipperHoist.MockFlipper();
    popoverFlipper.hasFocus.mockReturnValue(true);
    const popover = makePopover({ flipper: popoverFlipper });
    const { handler, closeToolbar } = makeHandler(popover);
    const event = makeEvent('ArrowDown');

    handler.handle(event, true);

    expect(closeToolbar).not.toHaveBeenCalled();
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
  });

  it('stops same-node listeners when flipping on horizontal arrows', () => {
    const popoverFlipper = new flipperHoist.MockFlipper();
    popoverFlipper.hasFocus.mockReturnValue(true);
    const popover = makePopover({ flipper: popoverFlipper });
    const { handler } = makeHandler(popover);
    const event = makeEvent('ArrowLeft');

    handler.handle(event, true);

    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
  });

  it('closes the toolbar on a plain ArrowDown without flipper focus', () => {
    const { handler, closeToolbar } = makeHandler(makePopover());
    const event = makeEvent('ArrowDown');

    handler.handle(event, true);

    expect(closeToolbar).toHaveBeenCalledOnce();
  });
});
