import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InlineKeyboardHandler } from '../../../../../../src/components/modules/toolbar/inline/keyboard-handler';
import type { PopoverInline } from '../../../../../../src/components/utils/popover/popover-inline';

describe('InlineKeyboardHandler', () => {
  let keyboardHandler: InlineKeyboardHandler;
  let mockPopover: PopoverInline;
  let closeToolbarSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    closeToolbarSpy = vi.fn();

    // Create a minimal PopoverInline mock
    mockPopover = {
      flipper: {
        hasFocus: vi.fn(() => false),
      },
      hasNestedPopoverOpen: false,
      closeNestedPopover: vi.fn(),
    } as unknown as PopoverInline;

    keyboardHandler = new InlineKeyboardHandler(
      () => mockPopover,
      closeToolbarSpy
    );
  });

  describe('hasFlipperFocus', () => {
    it('returns false when popover is null', () => {
      keyboardHandler = new InlineKeyboardHandler(
        () => null,
        closeToolbarSpy
      );

      expect(keyboardHandler.hasFlipperFocus).toBe(false);
    });

    it('returns false when main flipper has no focus', () => {
      vi.mocked(mockPopover.flipper!.hasFocus).mockReturnValue(false);

      expect(keyboardHandler.hasFlipperFocus).toBe(false);
    });

    it('returns true when main flipper has focus', () => {
      vi.mocked(mockPopover.flipper!.hasFocus).mockReturnValue(true);

      expect(keyboardHandler.hasFlipperFocus).toBe(true);
    });

    it('returns true when nested flipper has focus', () => {
      vi.mocked(mockPopover.flipper!.hasFocus).mockReturnValue(false);
      (mockPopover as unknown as { nestedPopover?: { flipper?: { hasFocus: () => boolean } } }).nestedPopover = {
        flipper: {
          hasFocus: vi.fn(() => true),
        },
      };

      expect(keyboardHandler.hasFlipperFocus).toBe(true);
    });
  });

  describe('hasNestedPopoverOpen', () => {
    it('returns false when popover is null', () => {
      keyboardHandler = new InlineKeyboardHandler(
        () => null,
        closeToolbarSpy
      );

      expect(keyboardHandler.hasNestedPopoverOpen).toBe(false);
    });

    it('returns false when no nested popover is open', () => {
      mockPopover.hasNestedPopoverOpen = false;

      expect(keyboardHandler.hasNestedPopoverOpen).toBe(false);
    });

    it('returns true when nested popover is open', () => {
      mockPopover.hasNestedPopoverOpen = true;

      expect(keyboardHandler.hasNestedPopoverOpen).toBe(true);
    });
  });

  describe('closeNestedPopover', () => {
    it('returns false when popover is null', () => {
      keyboardHandler = new InlineKeyboardHandler(
        () => null,
        closeToolbarSpy
      );

      expect(keyboardHandler.closeNestedPopover()).toBe(false);
    });

    it('returns false when no nested popover is open', () => {
      mockPopover.hasNestedPopoverOpen = false;

      expect(keyboardHandler.closeNestedPopover()).toBe(false);
    });

    it('closes nested popover and returns true when open', () => {
      mockPopover.hasNestedPopoverOpen = true;
      const closeSpy = vi.fn();
      (mockPopover as { closeNestedPopover: typeof closeSpy }).closeNestedPopover = closeSpy;

      const result = keyboardHandler.closeNestedPopover();

      expect(result).toBe(true);
      expect(closeSpy).toHaveBeenCalled();
    });
  });

  describe('handle', () => {
    it('closes toolbar on vertical arrow key without shift when opened', () => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: false });
      vi.mocked(mockPopover.flipper!.hasFocus).mockReturnValue(false);

      keyboardHandler.handle(event, true);

      expect(closeToolbarSpy).toHaveBeenCalled();
    });

    it('does not close toolbar on vertical arrow key when shift is pressed', () => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true });
      vi.mocked(mockPopover.flipper!.hasFocus).mockReturnValue(false);

      keyboardHandler.handle(event, true);

      expect(closeToolbarSpy).not.toHaveBeenCalled();
    });

    it('does not close toolbar on horizontal arrow key', () => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: false });
      vi.mocked(mockPopover.flipper!.hasFocus).mockReturnValue(false);

      keyboardHandler.handle(event, true);

      expect(closeToolbarSpy).not.toHaveBeenCalled();
    });

    it('does not close toolbar when flipper has focus', () => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: false });
      vi.mocked(mockPopover.flipper!.hasFocus).mockReturnValue(true);

      keyboardHandler.handle(event, true);

      expect(closeToolbarSpy).not.toHaveBeenCalled();
    });

    it('does not close toolbar when nested popover is open', () => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: false });
      vi.mocked(mockPopover.flipper!.hasFocus).mockReturnValue(false);
      (mockPopover as unknown as { nestedPopover?: Record<string, unknown> }).nestedPopover = {};

      keyboardHandler.handle(event, true);

      expect(closeToolbarSpy).not.toHaveBeenCalled();
    });

    it('prevents horizontal arrow keys when flipper has focus', () => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: false });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
      const stopPropagationSpy = vi.spyOn(event, 'stopPropagation');
      vi.mocked(mockPopover.flipper!.hasFocus).mockReturnValue(true);

      keyboardHandler.handle(event, true);

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(stopPropagationSpy).toHaveBeenCalled();
    });

    it('does not prevent horizontal arrow keys when flipper has no focus', () => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: false });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
      vi.mocked(mockPopover.flipper!.hasFocus).mockReturnValue(false);

      keyboardHandler.handle(event, true);

      expect(preventDefaultSpy).not.toHaveBeenCalled();
    });

    it('does not close toolbar when not opened', () => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: false });
      vi.mocked(mockPopover.flipper!.hasFocus).mockReturnValue(false);

      keyboardHandler.handle(event, false);

      expect(closeToolbarSpy).not.toHaveBeenCalled();
    });

    it('handles ArrowUp the same as ArrowDown', () => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: false });
      vi.mocked(mockPopover.flipper!.hasFocus).mockReturnValue(false);

      keyboardHandler.handle(event, true);

      expect(closeToolbarSpy).toHaveBeenCalled();
    });
  });

  describe('isShiftArrow', () => {
    it('returns true for Shift+ArrowDown', () => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true });

      expect(keyboardHandler.isShiftArrow(event)).toBe(true);
    });

    it('returns true for Shift+ArrowUp', () => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true });

      expect(keyboardHandler.isShiftArrow(event)).toBe(true);
    });

    it('returns false for Shift+ArrowLeft', () => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true });

      expect(keyboardHandler.isShiftArrow(event)).toBe(false);
    });

    it('returns false for Shift+ArrowRight', () => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true });

      expect(keyboardHandler.isShiftArrow(event)).toBe(false);
    });

    it('returns false for ArrowDown without shift', () => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: false });

      expect(keyboardHandler.isShiftArrow(event)).toBe(false);
    });

    it('returns false for other keys with shift', () => {
      const event = new KeyboardEvent('keydown', { key: 'a', shiftKey: true });

      expect(keyboardHandler.isShiftArrow(event)).toBe(false);
    });
  });
});
