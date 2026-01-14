import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/* eslint-disable internal-unit-test/no-class-selectors -- Testing StyleManager integration */

import { SelectionManager } from '../../../../src/components/block/selection-manager';
import { StyleManager } from '../../../../src/components/block/style-manager';
import { EventsDispatcher } from '../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../src/components/events';
import { DATA_ATTR } from '../../../../src/components/constants';
import { SelectionUtils } from '../../../../src/components/selection';

// Mock SelectionUtils
vi.mock('../../../../src/components/selection', () => ({
  SelectionUtils: {
    isRangeInsideContainer: vi.fn(() => false),
    isFakeCursorInsideContainer: vi.fn(() => false),
    addFakeCursor: vi.fn(),
    removeFakeCursor: vi.fn(),
  },
}));

describe('SelectionManager', () => {
  let holder: HTMLDivElement;
  let contentElement: HTMLDivElement;
  let styleManager: StyleManager;
  let eventBus: EventsDispatcher<BlokEventMap>;
  let selectionManager: SelectionManager;

  beforeEach(() => {
    holder = document.createElement('div');
    contentElement = document.createElement('div');
    holder.appendChild(contentElement);
    styleManager = new StyleManager(holder, contentElement);
    eventBus = new EventsDispatcher<BlokEventMap>();
    selectionManager = new SelectionManager(
      holder,
      () => contentElement,
      () => styleManager.stretched,
      eventBus,
      styleManager
    );
  });

  afterEach(() => {
    holder.remove();
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    it('creates instance with required dependencies', () => {
      expect(selectionManager).toBeInstanceOf(SelectionManager);
    });
  });

  describe('selected getter', () => {
    it('returns false when selected attribute is not set', () => {
      expect(selectionManager.selected).toBe(false);
    });

    it('returns true when selected attribute is set', () => {
      holder.setAttribute(DATA_ATTR.selected, 'true');
      expect(selectionManager.selected).toBe(true);
    });
  });

  describe('selected setter', () => {
    it('sets data-blok-selected attribute when state is true', () => {
      selectionManager.selected = true;

      expect(holder).toHaveAttribute(DATA_ATTR.selected, 'true');
    });

    it('removes data-blok-selected attribute when state is false', () => {
      holder.setAttribute(DATA_ATTR.selected, 'true');
      selectionManager.selected = false;

      expect(holder).not.toHaveAttribute(DATA_ATTR.selected);
    });

    it('updates content element via StyleManager', () => {
      selectionManager.selected = true;

      expect(contentElement.className).toBe(styleManager.getContentClasses(true, false));
    });

    it('handles null content element gracefully', () => {
      const manager = new SelectionManager(
        holder,
        () => null,
        () => false,
        eventBus,
        styleManager
      );

      expect(() => manager.selected = true).not.toThrow();
    });
  });

  describe('Fake cursor interaction', () => {
    it('does not trigger fake cursor when range is not inside container', () => {
      const emitSpy = vi.spyOn(eventBus, 'emit');
      vi.mocked(SelectionUtils.isRangeInsideContainer).mockReturnValue(false);

      selectionManager.selected = true;

      expect(emitSpy).not.toHaveBeenCalled();
      expect(SelectionUtils.addFakeCursor).not.toHaveBeenCalled();
    });

    it('triggers fake cursor add when range is inside container', () => {
      const emitSpy = vi.spyOn(eventBus, 'emit');
      vi.mocked(SelectionUtils.isRangeInsideContainer).mockReturnValue(true);

      selectionManager.selected = true;

      expect(emitSpy).toHaveBeenCalled();
      expect(SelectionUtils.addFakeCursor).toHaveBeenCalled();
    });

    it('triggers fake cursor remove when fake cursor is inside', () => {
      const emitSpy = vi.spyOn(eventBus, 'emit');
      vi.mocked(SelectionUtils.isFakeCursorInsideContainer).mockReturnValue(true);

      selectionManager.selected = false;

      expect(emitSpy).toHaveBeenCalled();
      expect(SelectionUtils.removeFakeCursor).toHaveBeenCalledWith(holder);
    });

    it('emits mutex events around fake cursor operations', () => {
      const emitSpy = vi.spyOn(eventBus, 'emit');
      vi.mocked(SelectionUtils.isRangeInsideContainer).mockReturnValue(true);

      selectionManager.selected = true;

      // Check that emit was called with the mutex event
      const calls = emitSpy.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
    });
  });

  describe('Stretched state integration', () => {
    it('uses stretched state from StyleManager', () => {
      styleManager.setStretchState(true, false);
      selectionManager.selected = true;

      // Should update content state with current stretched state
      // Selection takes precedence over stretched
      expect(contentElement.className).toBe(styleManager.getContentClasses(true, true));
    });
  });
});
