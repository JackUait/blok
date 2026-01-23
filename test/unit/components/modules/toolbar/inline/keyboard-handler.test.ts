import { beforeEach, describe, expect, it, vi } from "vitest";
import { InlineKeyboardHandler } from "../../../../../../src/components/modules/toolbar/inline/keyboard-handler";

/**
 * Creates a mock KeyboardEvent that properly tracks preventDefault state.
 * This is necessary because native KeyboardEvent objects don't properly
 * reflect defaultPrevented when preventDefault() is called in test environments.
 */
const createMockKeyboardEvent = (options: {
  key: string;
  shiftKey?: boolean;
}): KeyboardEvent => {
  const mockEvent = {
    key: options.key,
    shiftKey: options.shiftKey ?? false,
    defaultPrevented: false,
    preventDefault: vi.fn(function (this: typeof mockEvent) {
      this.defaultPrevented = true;
    }),
    stopPropagation: vi.fn(),
  };

  return mockEvent as unknown as KeyboardEvent;
};

// Define a mock interface that matches the shape InlineKeyboardHandler expects from PopoverInline
interface MockPopoverInline {
  flipper?: {
    hasFocus: () => boolean;
  };
  hasNestedPopoverOpen: boolean;
  closeNestedPopover: () => void;
  nestedPopover?: {
    flipper?: {
      hasFocus: () => boolean;
    };
  } | null;
}

// Type-safe spy function
type MockFn<T extends (...args: unknown[]) => unknown> = ReturnType<
  typeof vi.fn
> &
  T;

const createMockFn = <
  T extends (...args: unknown[]) => unknown,
>(): MockFn<T> => {
  return vi.fn() as MockFn<T>;
};

describe("InlineKeyboardHandler", () => {
  let keyboardHandler: InlineKeyboardHandler;
  let mockPopover: MockPopoverInline;
  let closeToolbarSpy: MockFn<() => void>;

  beforeEach(() => {
    vi.clearAllMocks();
    closeToolbarSpy = createMockFn<() => void>();

    // Create a minimal PopoverInline mock
    mockPopover = {
      flipper: {
        hasFocus: vi.fn(() => false),
      },
      hasNestedPopoverOpen: false,
      closeNestedPopover: createMockFn<() => void>(),
    };

    keyboardHandler = new InlineKeyboardHandler(
      () =>
        mockPopover as unknown as ReturnType<
          NonNullable<InlineKeyboardHandler["getPopover"]>
        >,
      closeToolbarSpy,
    );
  });

  describe("hasFlipperFocus", () => {
    it("returns false when popover is null", () => {
      keyboardHandler = new InlineKeyboardHandler(() => null, closeToolbarSpy);

      expect(keyboardHandler.hasFlipperFocus).toBe(false);
    });

    it("returns false when main flipper has no focus", () => {
      const hasFocusSpy = mockPopover.flipper?.hasFocus;
      if (hasFocusSpy) {
        vi.mocked(hasFocusSpy).mockReturnValue(false);
      }

      expect(keyboardHandler.hasFlipperFocus).toBe(false);
    });

    it("returns true when main flipper has focus", () => {
      const hasFocusSpy = mockPopover.flipper?.hasFocus;
      if (hasFocusSpy) {
        vi.mocked(hasFocusSpy).mockReturnValue(true);
      }

      expect(keyboardHandler.hasFlipperFocus).toBe(true);
    });

    it("returns true when nested flipper has focus", () => {
      const hasFocusSpy = mockPopover.flipper?.hasFocus;
      if (hasFocusSpy) {
        vi.mocked(hasFocusSpy).mockReturnValue(false);
      }
      mockPopover.nestedPopover = {
        flipper: {
          hasFocus: vi.fn(() => true),
        },
      };

      expect(keyboardHandler.hasFlipperFocus).toBe(true);
    });
  });

  describe("hasNestedPopoverOpen", () => {
    it("returns false when popover is null", () => {
      keyboardHandler = new InlineKeyboardHandler(() => null, closeToolbarSpy);

      expect(keyboardHandler.hasNestedPopoverOpen).toBe(false);
    });

    it("returns false when no nested popover is open", () => {
      mockPopover.hasNestedPopoverOpen = false;

      expect(keyboardHandler.hasNestedPopoverOpen).toBe(false);
    });

    it("returns true when nested popover is open", () => {
      mockPopover.hasNestedPopoverOpen = true;

      expect(keyboardHandler.hasNestedPopoverOpen).toBe(true);
    });
  });

  describe("closeNestedPopover", () => {
    it("returns false when popover is null", () => {
      keyboardHandler = new InlineKeyboardHandler(() => null, closeToolbarSpy);

      expect(keyboardHandler.closeNestedPopover()).toBe(false);
    });

    it("returns false when no nested popover is open", () => {
      mockPopover.hasNestedPopoverOpen = false;

      expect(keyboardHandler.closeNestedPopover()).toBe(false);
    });

    it("closes nested popover and returns true when open", () => {
      mockPopover.hasNestedPopoverOpen = true;
      const closeSpy = createMockFn<() => void>();
      mockPopover.closeNestedPopover = closeSpy;

      const result = keyboardHandler.closeNestedPopover();

      expect(result).toBe(true);
      expect(closeSpy).toHaveBeenCalled();
    });
  });

  describe("handle", () => {
    it("closes toolbar on vertical arrow key without shift when opened", () => {
      const event = createMockKeyboardEvent({
        key: "ArrowDown",
        shiftKey: false,
      });
      const hasFocusSpy = mockPopover.flipper?.hasFocus;
      if (hasFocusSpy) {
        vi.mocked(hasFocusSpy).mockReturnValue(false);
      }

      let toolbarClosed = false;
      const trackingCloseToolbarSpy = vi.fn(() => {
        toolbarClosed = true;
      }) as MockFn<() => void>;
      const handlerWithTracking = new InlineKeyboardHandler(
        () =>
          mockPopover as unknown as ReturnType<
            NonNullable<InlineKeyboardHandler["getPopover"]>
          >,
        trackingCloseToolbarSpy,
      );

      handlerWithTracking.handle(event, true);

      expect(toolbarClosed).toBe(true);
    });

    it("does not close toolbar on vertical arrow key when shift is pressed", () => {
      const event = createMockKeyboardEvent({
        key: "ArrowDown",
        shiftKey: true,
      });
      const hasFocusSpy = mockPopover.flipper?.hasFocus;
      if (hasFocusSpy) {
        vi.mocked(hasFocusSpy).mockReturnValue(false);
      }

      keyboardHandler.handle(event, true);

      expect(closeToolbarSpy).not.toHaveBeenCalled();
    });

    it("does not close toolbar on horizontal arrow key", () => {
      const event = createMockKeyboardEvent({
        key: "ArrowLeft",
        shiftKey: false,
      });
      const hasFocusSpy = mockPopover.flipper?.hasFocus;
      if (hasFocusSpy) {
        vi.mocked(hasFocusSpy).mockReturnValue(false);
      }

      keyboardHandler.handle(event, true);

      expect(closeToolbarSpy).not.toHaveBeenCalled();
    });

    it("does not close toolbar when flipper has focus", () => {
      const event = createMockKeyboardEvent({
        key: "ArrowDown",
        shiftKey: false,
      });
      const hasFocusSpy = mockPopover.flipper?.hasFocus;
      if (hasFocusSpy) {
        vi.mocked(hasFocusSpy).mockReturnValue(true);
      }

      keyboardHandler.handle(event, true);

      expect(closeToolbarSpy).not.toHaveBeenCalled();
    });

    it("does not close toolbar when nested popover is open", () => {
      const event = createMockKeyboardEvent({
        key: "ArrowDown",
        shiftKey: false,
      });
      const hasFocusSpy = mockPopover.flipper?.hasFocus;
      if (hasFocusSpy) {
        vi.mocked(hasFocusSpy).mockReturnValue(false);
      }
      mockPopover.nestedPopover = {};

      keyboardHandler.handle(event, true);

      expect(closeToolbarSpy).not.toHaveBeenCalled();
    });

    it("prevents horizontal arrow keys when flipper has focus", () => {
      const event = createMockKeyboardEvent({
        key: "ArrowLeft",
        shiftKey: false,
      });
      const hasFocusSpy = mockPopover.flipper?.hasFocus;
      if (hasFocusSpy) {
        vi.mocked(hasFocusSpy).mockReturnValue(true);
      }

      keyboardHandler.handle(event, true);

      // Verify observable effect: default behavior was prevented
      expect(event.defaultPrevented).toBe(true);
    });

    it("does not prevent horizontal arrow keys when flipper has no focus", () => {
      const event = createMockKeyboardEvent({
        key: "ArrowLeft",
        shiftKey: false,
      });
      const hasFocusSpy = mockPopover.flipper?.hasFocus;
      if (hasFocusSpy) {
        vi.mocked(hasFocusSpy).mockReturnValue(false);
      }

      keyboardHandler.handle(event, true);

      // Verify observable effect: default behavior was NOT prevented
      expect(event.defaultPrevented).toBe(false);
    });

    it("does not close toolbar when not opened", () => {
      const event = createMockKeyboardEvent({
        key: "ArrowDown",
        shiftKey: false,
      });
      const hasFocusSpy = mockPopover.flipper?.hasFocus;
      if (hasFocusSpy) {
        vi.mocked(hasFocusSpy).mockReturnValue(false);
      }

      keyboardHandler.handle(event, false);

      expect(closeToolbarSpy).not.toHaveBeenCalled();
    });

    it("handles ArrowUp the same as ArrowDown", () => {
      const event = createMockKeyboardEvent({
        key: "ArrowUp",
        shiftKey: false,
      });
      const hasFocusSpy = mockPopover.flipper?.hasFocus;
      if (hasFocusSpy) {
        vi.mocked(hasFocusSpy).mockReturnValue(false);
      }

      let toolbarClosed = false;
      const trackingCloseToolbarSpy = vi.fn(() => {
        toolbarClosed = true;
      }) as MockFn<() => void>;
      const handlerWithTracking = new InlineKeyboardHandler(
        () =>
          mockPopover as unknown as ReturnType<
            NonNullable<InlineKeyboardHandler["getPopover"]>
          >,
        trackingCloseToolbarSpy,
      );

      handlerWithTracking.handle(event, true);

      expect(toolbarClosed).toBe(true);
    });
  });

  describe("isShiftArrow", () => {
    it("returns true for Shift+ArrowDown", () => {
      const event = new KeyboardEvent("keydown", {
        key: "ArrowDown",
        shiftKey: true,
      });

      expect(keyboardHandler.isShiftArrow(event)).toBe(true);
    });

    it("returns true for Shift+ArrowUp", () => {
      const event = new KeyboardEvent("keydown", {
        key: "ArrowUp",
        shiftKey: true,
      });

      expect(keyboardHandler.isShiftArrow(event)).toBe(true);
    });

    it("returns false for Shift+ArrowLeft", () => {
      const event = new KeyboardEvent("keydown", {
        key: "ArrowLeft",
        shiftKey: true,
      });

      expect(keyboardHandler.isShiftArrow(event)).toBe(false);
    });

    it("returns false for Shift+ArrowRight", () => {
      const event = new KeyboardEvent("keydown", {
        key: "ArrowRight",
        shiftKey: true,
      });

      expect(keyboardHandler.isShiftArrow(event)).toBe(false);
    });

    it("returns false for ArrowDown without shift", () => {
      const event = new KeyboardEvent("keydown", {
        key: "ArrowDown",
        shiftKey: false,
      });

      expect(keyboardHandler.isShiftArrow(event)).toBe(false);
    });

    it("returns false for other keys with shift", () => {
      const event = new KeyboardEvent("keydown", { key: "a", shiftKey: true });

      expect(keyboardHandler.isShiftArrow(event)).toBe(false);
    });
  });
});
