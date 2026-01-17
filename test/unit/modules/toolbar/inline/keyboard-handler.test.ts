import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InlineKeyboardHandler } from '../../../../../src/components/modules/toolbar/inline/index';
import type { PopoverInline } from '../../../../../src/components/utils/popover/popover-inline';

describe('InlineKeyboardHandler', () => {
  let keyboardHandler: InlineKeyboardHandler;
  let mockPopover: PopoverInline | null;
  let closeCallback: () => void;
  let flipperMock: {
    hasFocus: ReturnType<typeof vi.fn>;
  };
  let nestedPopoverMock: {
    flipper?: {
      hasFocus: ReturnType<typeof vi.fn>;
    };
  } | null;
  let closeNestedPopoverFn: ReturnType<typeof vi.fn>;
  let currentHasNestedPopoverValue: boolean;

  const createMockPopover = (hasNestedPopover: boolean): PopoverInline => {
    currentHasNestedPopoverValue = hasNestedPopover;
    closeNestedPopoverFn = vi.fn();

    return {
      flipper: flipperMock,
      get hasNestedPopoverOpen() {
        return currentHasNestedPopoverValue;
      },
      closeNestedPopover: closeNestedPopoverFn,
    } as unknown as PopoverInline;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    closeCallback = vi.fn() as unknown as () => void;

    flipperMock = {
      hasFocus: vi.fn(() => false),
    };

    nestedPopoverMock = null;
    mockPopover = createMockPopover(false);

    const getPopover = () => mockPopover;
    keyboardHandler = new InlineKeyboardHandler(getPopover, closeCallback);
  });

  describe('hasFlipperFocus', () => {
    it('should return false when popover is null', () => {
      mockPopover = null;

      expect(keyboardHandler.hasFlipperFocus).toBe(false);
    });

    it('should return true when main flipper has focus', () => {
      flipperMock.hasFocus.mockReturnValue(true);

      expect(keyboardHandler.hasFlipperFocus).toBe(true);
    });

    it('should return true when nested flipper has focus', () => {
      nestedPopoverMock = {
        flipper: {
          hasFocus: vi.fn(() => true),
        },
      };

      (mockPopover as unknown as { nestedPopover: typeof nestedPopoverMock }).nestedPopover = nestedPopoverMock;

      expect(keyboardHandler.hasFlipperFocus).toBe(true);
    });

    it('should return false when no flipper has focus', () => {
      flipperMock.hasFocus.mockReturnValue(false);

      expect(keyboardHandler.hasFlipperFocus).toBe(false);
    });
  });

  describe('hasNestedPopoverOpen', () => {
    it('should return false when popover is null', () => {
      mockPopover = null;

      expect(keyboardHandler.hasNestedPopoverOpen).toBe(false);
    });

    it('should return true when nested popover is open', () => {
      mockPopover = createMockPopover(true);
      const getPopover = () => mockPopover;
      keyboardHandler = new InlineKeyboardHandler(getPopover, closeCallback);

      expect(keyboardHandler.hasNestedPopoverOpen).toBe(true);
    });

    it('should return false when nested popover is closed', () => {
      mockPopover = createMockPopover(false);
      const getPopover = () => mockPopover;
      keyboardHandler = new InlineKeyboardHandler(getPopover, closeCallback);

      expect(keyboardHandler.hasNestedPopoverOpen).toBe(false);
    });
  });

  describe('closeNestedPopover', () => {
    it('should return false when popover is null', () => {
      mockPopover = null;
      const getPopover = () => mockPopover;
      keyboardHandler = new InlineKeyboardHandler(getPopover, closeCallback);

      const result = keyboardHandler.closeNestedPopover();

      expect(result).toBe(false);
    });

    it('should return false when nested popover is not open', () => {
      mockPopover = createMockPopover(false);
      const getPopover = () => mockPopover;
      keyboardHandler = new InlineKeyboardHandler(getPopover, closeCallback);

      const result = keyboardHandler.closeNestedPopover();

      expect(result).toBe(false);
    });

    it('should close nested popover and return true when open', () => {
      mockPopover = createMockPopover(true);
      const getPopover = () => mockPopover;
      keyboardHandler = new InlineKeyboardHandler(getPopover, closeCallback);

      const result = keyboardHandler.closeNestedPopover();

      expect(result).toBe(true);
      expect(closeNestedPopoverFn).toHaveBeenCalled();
    });
  });

  describe('handle', () => {
    it('should close toolbar on ArrowUp without Shift when opened and no focus', () => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: false });

      keyboardHandler.handle(event, true);

      // Observable behavior: the close callback is invoked
      expect(closeCallback).toHaveBeenCalled();
    });

    it('should close toolbar on ArrowDown without Shift when opened and no focus', () => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: false });

      keyboardHandler.handle(event, true);

      // Observable behavior: the close callback is invoked
      expect(closeCallback).toHaveBeenCalled();
    });

    it('should not close toolbar when not opened', () => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: false });

      keyboardHandler.handle(event, false);

      expect(closeCallback).not.toHaveBeenCalled();
    });

    it('should not close toolbar when Shift key is pressed', () => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true });

      keyboardHandler.handle(event, true);

      expect(closeCallback).not.toHaveBeenCalled();
    });

    it('should not close toolbar when main flipper has focus', () => {
      flipperMock.hasFocus.mockReturnValue(true);
      const event = new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: false });

      keyboardHandler.handle(event, true);

      expect(closeCallback).not.toHaveBeenCalled();
    });

    it('should not close toolbar when nested popover exists', () => {
      nestedPopoverMock = {
        flipper: {
          hasFocus: vi.fn(() => false),
        },
      };
      (mockPopover as unknown as { nestedPopover: typeof nestedPopoverMock }).nestedPopover = nestedPopoverMock;

      const event = new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: false });

      keyboardHandler.handle(event, true);

      expect(closeCallback).not.toHaveBeenCalled();
    });

    it('should prevent horizontal arrow key action when flipper has focus', () => {
      flipperMock.hasFocus.mockReturnValue(true);
      const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: false });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
      const stopPropagationSpy = vi.spyOn(event, 'stopPropagation');

      keyboardHandler.handle(event, true);

      // Observable behavior: event is prevented from propagating and toolbar stays open
      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(stopPropagationSpy).toHaveBeenCalled();
      expect(closeCallback).not.toHaveBeenCalled();
    });

    it('should not prevent horizontal arrow key action when flipper does not have focus', () => {
      flipperMock.hasFocus.mockReturnValue(false);
      const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: false });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      keyboardHandler.handle(event, true);

      expect(preventDefaultSpy).not.toHaveBeenCalled();
    });
  });

  describe('isShiftArrow', () => {
    it('should return true for Shift+ArrowUp', () => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true });

      expect(keyboardHandler.isShiftArrow(event)).toBe(true);
    });

    it('should return true for Shift+ArrowDown', () => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true });

      expect(keyboardHandler.isShiftArrow(event)).toBe(true);
    });

    it('should return false for ArrowUp without Shift', () => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: false });

      expect(keyboardHandler.isShiftArrow(event)).toBe(false);
    });

    it('should return false for ArrowDown without Shift', () => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: false });

      expect(keyboardHandler.isShiftArrow(event)).toBe(false);
    });

    it('should return false for other keys with Shift', () => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true });

      expect(keyboardHandler.isShiftArrow(event)).toBe(false);
    });
  });
});
