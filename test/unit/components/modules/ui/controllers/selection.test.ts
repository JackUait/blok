import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SelectionController } from '../../../../../../src/components/modules/uiControllers/controllers/selection';
import { SelectionUtils as Selection } from '../../../../../../src/components/selection';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';
import type { BlokConfig } from '../../../../../../types';
import type { ModuleConfig } from '../../../../../../src/types-internal/module-config';

const createBlokStub = (): BlokModules => {
  return {
    BlockManager: {
      setCurrentBlockByChildNode: vi.fn(),
      blocks: [],
    },
    CrossBlockSelection: {
      isCrossBlockSelectionStarted: false,
    },
    BlockSelection: {
      anyBlockSelected: false,
    },
    InlineToolbar: {
      opened: false,
      close: vi.fn(),
      tryToShow: vi.fn(() => Promise.resolve()),
      containsNode: vi.fn(() => false),
      hasFlipperFocus: false,
      hasNestedPopoverOpen: false,
    },
  } as unknown as BlokModules;
};

describe('SelectionController', () => {
  const controllers: SelectionController[] = [];

  const createSelectionController = (options?: {
    blokOverrides?: Partial<BlokModules>;
    configOverrides?: Partial<BlokConfig>;
  }): {
    controller: SelectionController;
    blok: BlokModules;
    wrapper: HTMLElement;
    eventsDispatcher: ModuleConfig['eventsDispatcher'];
  } => {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-blok-testid', 'blok-editor');
    document.body.appendChild(wrapper);

    const eventsDispatcher = {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    } as unknown as ModuleConfig['eventsDispatcher'];

    const blok = createBlokStub();

    if (options?.blokOverrides) {
      Object.assign(blok, options.blokOverrides);
    }

    const controller = new SelectionController({
      config: {
        holder: document.createElement('div'),
        minHeight: 50,
        ...options?.configOverrides,
      } as BlokConfig,
      eventsDispatcher: eventsDispatcher,
    });

    controller.state = blok;
    controller.setWrapperElement(wrapper);

    // Register for cleanup
    controllers.push(controller);

    return { controller, blok, wrapper, eventsDispatcher };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    // Disable all controllers to remove event listeners
    controllers.forEach((controller) => {
      (controller as unknown as { disable: () => void }).disable();
    });
    controllers.length = 0;

    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('creates controller with dependencies', () => {
      const { controller } = createSelectionController();

      expect(controller).toBeInstanceOf(SelectionController);
    });

    it('can be enabled and disabled', () => {
      const { controller } = createSelectionController();

      expect(() => {
        (controller as unknown as { enable: () => void }).enable();
        (controller as unknown as { disable: () => void }).disable();
      }).not.toThrow();
    });

    it('binds selectionchange listener on enable', () => {
      const { controller } = createSelectionController();

      const onSpy = vi.spyOn(
        (controller as unknown as { listeners: { on: ReturnType<typeof vi.fn> } }).listeners,
        'on'
      );

      (controller as unknown as { enable: () => void }).enable();

      expect(onSpy).toHaveBeenCalledWith(document, 'selectionchange', expect.any(Function));
    });
  });

  describe('selection change handling', () => {
    it('removes all ranges when cross block selection is started', async () => {
      const { controller, blok } = createSelectionController();
      const removeRangesSpy = vi.fn();

      (controller as unknown as { enable: () => void }).enable();

      Object.assign(blok.BlockSelection, { anyBlockSelected: true });
      Object.assign(blok.CrossBlockSelection, { isCrossBlockSelectionStarted: true });
      vi.spyOn(Selection, 'get').mockReturnValue({
        removeAllRanges: removeRangesSpy,
      } as unknown as ReturnType<typeof Selection.get>);

      // Trigger selection change
      document.dispatchEvent(new Event('selectionchange'));
      vi.runAllTimers();

      // Verify the selection removeAllRanges method was called
      expect(removeRangesSpy).toHaveBeenCalled();
      // Verify the Selection.get method was called to access the selection
      expect(Selection.get).toHaveBeenCalledWith();
    });

    it('ignores selection change when fake background exists and toolbar is open', async () => {
      const { controller, blok } = createSelectionController();
      const fakeBackground = document.createElement('div');

      fakeBackground.setAttribute('data-blok-fake-background', 'true');
      document.body.appendChild(fakeBackground);

      (controller as unknown as { enable: () => void }).enable();

      blok.InlineToolbar.opened = true;

      // Trigger selection change
      document.dispatchEvent(new Event('selectionchange'));
      vi.runAllTimers();

      // tryToShow should not be called when we ignore the selection change
      expect(blok.InlineToolbar.tryToShow).not.toHaveBeenCalled();
    });

    it('closes inline toolbar when no focused element and no range', async () => {
      const { controller, blok } = createSelectionController();

      (controller as unknown as { enable: () => void }).enable();

      vi.spyOn(Selection, 'anchorElement', 'get').mockReturnValue(null);
      vi.spyOn(Selection, 'range', 'get').mockReturnValue(null);

      // Trigger selection change
      document.dispatchEvent(new Event('selectionchange'));
      vi.runAllTimers();

      // Verify the inline toolbar close method was called
      expect(blok.InlineToolbar.close).toHaveBeenCalledWith();
      // Verify that no further processing happened (tryToShow was not called)
      expect(blok.InlineToolbar.tryToShow).not.toHaveBeenCalled();
    });

    it('does nothing when focused element is null', async () => {
      const { controller, blok } = createSelectionController();

      (controller as unknown as { enable: () => void }).enable();

      vi.spyOn(Selection, 'anchorElement', 'get').mockReturnValue(null);
      vi.spyOn(Selection, 'range', 'get').mockReturnValue(null);

      // Trigger selection change
      document.dispatchEvent(new Event('selectionchange'));
      vi.runAllTimers();

      expect(blok.InlineToolbar.tryToShow).not.toHaveBeenCalled();
      expect(blok.BlockManager.setCurrentBlockByChildNode).not.toHaveBeenCalled();
    });
  });

  describe('inline toolbar closing conditions', () => {
    it('closes inline toolbar when selection is empty and no flipper focus', async () => {
      const { controller, blok } = createSelectionController();
      const focusedElement = document.createElement('div');

      document.body.appendChild(focusedElement);

      (controller as unknown as { enable: () => void }).enable();

      blok.InlineToolbar.opened = true;
      (blok.InlineToolbar as { hasFlipperFocus: boolean }).hasFlipperFocus = false;
      (blok.InlineToolbar as { hasNestedPopoverOpen: boolean }).hasNestedPopoverOpen = false;

      vi.spyOn(Selection, 'anchorElement', 'get').mockReturnValue(focusedElement);
      vi.spyOn(Selection, 'get').mockReturnValue({
        isCollapsed: true,
      } as unknown as ReturnType<typeof Selection.get>);
      vi.spyOn(Selection, 'text', 'get').mockReturnValue('');

      // Trigger selection change
      document.dispatchEvent(new Event('selectionchange'));
      vi.runAllTimers();

      // Verify the inline toolbar close method was called
      expect(blok.InlineToolbar.close).toHaveBeenCalledWith();
      // Verify that tryToShow was not called since toolbar was closed
      expect(blok.InlineToolbar.tryToShow).not.toHaveBeenCalled();
    });

    it('does not close inline toolbar when flipper has focus', async () => {
      const { controller, blok } = createSelectionController();
      const focusedElement = document.createElement('div');

      document.body.appendChild(focusedElement);

      (controller as unknown as { enable: () => void }).enable();

      blok.InlineToolbar.opened = true;
      (blok.InlineToolbar as { hasFlipperFocus: boolean }).hasFlipperFocus = true;

      vi.spyOn(Selection, 'anchorElement', 'get').mockReturnValue(focusedElement);
      vi.spyOn(Selection, 'get').mockReturnValue({
        isCollapsed: true,
      } as unknown as ReturnType<typeof Selection.get>);
      vi.spyOn(Selection, 'text', 'get').mockReturnValue('');

      // Trigger selection change
      document.dispatchEvent(new Event('selectionchange'));
      vi.runAllTimers();

      expect(blok.InlineToolbar.close).not.toHaveBeenCalled();
    });

    it('does not re-render toolbar when open without nested popover', async () => {
      const { controller, blok, wrapper } = createSelectionController();
      const focusedElement = document.createElement('div');

      focusedElement.setAttribute('contenteditable', 'true');
      focusedElement.setAttribute('data-blok-testid', 'block-content');
      wrapper.appendChild(focusedElement);

      (controller as unknown as { enable: () => void }).enable();

      blok.InlineToolbar.opened = true;
      (blok.InlineToolbar as { hasNestedPopoverOpen: boolean }).hasNestedPopoverOpen = false;

      vi.spyOn(Selection, 'anchorElement', 'get').mockReturnValue(focusedElement);
      vi.spyOn(Selection, 'get').mockReturnValue({
        isCollapsed: false,
      } as unknown as ReturnType<typeof Selection.get>);
      vi.spyOn(Selection, 'text', 'get').mockReturnValue('selected text');

      // Trigger selection change
      document.dispatchEvent(new Event('selectionchange'));
      vi.runAllTimers();

      // Should not try to show or close - toolbar is already open without nested popover
      expect(blok.InlineToolbar.close).not.toHaveBeenCalled();
      expect(blok.InlineToolbar.tryToShow).not.toHaveBeenCalled();
    });

    it('closes inline toolbar when clicked outside block content', async () => {
      const { controller, blok } = createSelectionController();
      const outsideElement = document.createElement('div');

      document.body.appendChild(outsideElement);

      (controller as unknown as { enable: () => void }).enable();

      blok.InlineToolbar.opened = true;
      (blok.InlineToolbar as { hasNestedPopoverOpen: boolean }).hasNestedPopoverOpen = false;
      vi.mocked(blok.InlineToolbar.containsNode).mockReturnValue(false);

      vi.spyOn(Selection, 'anchorElement', 'get').mockReturnValue(outsideElement);
      vi.spyOn(Selection, 'get').mockReturnValue({
        isCollapsed: true,
      } as unknown as ReturnType<typeof Selection.get>);
      vi.spyOn(Selection, 'text', 'get').mockReturnValue('');

      // Trigger selection change
      document.dispatchEvent(new Event('selectionchange'));
      vi.runAllTimers();

      // Verify the inline toolbar close method was called
      expect(blok.InlineToolbar.close).toHaveBeenCalledTimes(1);
      // Verify that containsNode was checked to determine if clicked element is in toolbar
      expect(blok.InlineToolbar.containsNode).toHaveBeenCalledWith(outsideElement);
      // Verify that tryToShow was not called since toolbar was closed
      expect(blok.InlineToolbar.tryToShow).not.toHaveBeenCalled();
    });
  });

  describe('current block updates', () => {
    it('updates current block when focus moves to different block', async () => {
      const { controller, blok, wrapper } = createSelectionController();
      const blockContent = document.createElement('div');

      blockContent.setAttribute('data-blok-testid', 'block-content');
      wrapper.appendChild(blockContent);

      (controller as unknown as { enable: () => void }).enable();

      blok.InlineToolbar.opened = false;
      (blok.InlineToolbar as { hasNestedPopoverOpen: boolean }).hasNestedPopoverOpen = false;

      vi.spyOn(Selection, 'anchorElement', 'get').mockReturnValue(blockContent);
      vi.spyOn(Selection, 'get').mockReturnValue({
        isCollapsed: false,
      } as unknown as ReturnType<typeof Selection.get>);
      vi.spyOn(Selection, 'text', 'get').mockReturnValue('text');

      // Trigger selection change
      document.dispatchEvent(new Event('selectionchange'));
      vi.runAllTimers();

      expect(blok.BlockManager.setCurrentBlockByChildNode).toHaveBeenCalledWith(blockContent);
    });

    it('does not update current block when clicked outside wrapper', async () => {
      const { controller, blok } = createSelectionController();
      const outsideElement = document.createElement('div');

      document.body.appendChild(outsideElement);

      (controller as unknown as { enable: () => void }).enable();

      vi.spyOn(Selection, 'anchorElement', 'get').mockReturnValue(outsideElement);
      vi.spyOn(Selection, 'get').mockReturnValue({
        isCollapsed: true,
      } as unknown as ReturnType<typeof Selection.get>);

      // Trigger selection change
      document.dispatchEvent(new Event('selectionchange'));
      vi.runAllTimers();

      expect(blok.BlockManager.setCurrentBlockByChildNode).not.toHaveBeenCalled();
    });

    it('handles external tool elements with inline toolbar attribute', async () => {
      const { controller, blok } = createSelectionController();
      const externalElement = document.createElement('div');

      externalElement.setAttribute('data-blok-inline-toolbar', 'true');
      document.body.appendChild(externalElement);

      (controller as unknown as { enable: () => void }).enable();

      blok.InlineToolbar.opened = false;
      (blok.InlineToolbar as { hasNestedPopoverOpen: boolean }).hasNestedPopoverOpen = false;

      vi.spyOn(Selection, 'anchorElement', 'get').mockReturnValue(externalElement);
      vi.spyOn(Selection, 'get').mockReturnValue({
        isCollapsed: false,
      } as unknown as ReturnType<typeof Selection.get>);
      vi.spyOn(Selection, 'text', 'get').mockReturnValue('text');

      // Trigger selection change
      document.dispatchEvent(new Event('selectionchange'));
      vi.runAllTimers();

      // Verify that tryToShow was called with the force parameter
      expect(blok.InlineToolbar.tryToShow).toHaveBeenCalledWith(true);
    });
  });

  describe('nested popover handling', () => {
    it('does not close toolbar when nested popover is open', async () => {
      const { controller, blok, wrapper } = createSelectionController();
      const blockContent = document.createElement('div');

      blockContent.setAttribute('data-blok-testid', 'block-content');
      wrapper.appendChild(blockContent);

      (controller as unknown as { enable: () => void }).enable();

      blok.InlineToolbar.opened = true;
      (blok.InlineToolbar as { hasNestedPopoverOpen: boolean }).hasNestedPopoverOpen = true;

      vi.spyOn(Selection, 'anchorElement', 'get').mockReturnValue(blockContent);
      vi.spyOn(Selection, 'get').mockReturnValue({
        isCollapsed: false,
      } as unknown as ReturnType<typeof Selection.get>);
      vi.spyOn(Selection, 'text', 'get').mockReturnValue('text');

      // Trigger selection change
      document.dispatchEvent(new Event('selectionchange'));
      vi.runAllTimers();

      // Should not close when nested popover is open
      expect(blok.InlineToolbar.close).not.toHaveBeenCalled();
    });
  });

  describe('debouncing', () => {
    it('debounces selection change events', async () => {
      const { controller, blok, wrapper } = createSelectionController();

      (controller as unknown as { enable: () => void }).enable();

      const blockContent = document.createElement('div');
      blockContent.setAttribute('data-blok-testid', 'block-content');
      wrapper.appendChild(blockContent);

      vi.spyOn(Selection, 'anchorElement', 'get').mockReturnValue(blockContent);
      vi.spyOn(Selection, 'get').mockReturnValue({
        isCollapsed: false,
      } as unknown as ReturnType<typeof Selection.get>);
      vi.spyOn(Selection, 'text', 'get').mockReturnValue('text');

      // Trigger multiple selection changes rapidly
      document.dispatchEvent(new Event('selectionchange'));
      document.dispatchEvent(new Event('selectionchange'));
      document.dispatchEvent(new Event('selectionchange'));

      // Should only call once after debounce
      vi.runAllTimers();

      // Verify debouncing behavior: handler runs once despite multiple events
      expect(blok.InlineToolbar.tryToShow).toHaveBeenCalledTimes(1);
      // Verify the correct parameters were passed
      expect(blok.InlineToolbar.tryToShow).toHaveBeenCalledWith(true);
    });
  });

  describe('edge cases', () => {
    it('handles null wrapper element gracefully', async () => {
      const { controller, blok } = createSelectionController();

      // Set wrapper to null
      (controller as unknown as { wrapperElement: HTMLElement | null }).wrapperElement = null;

      (controller as unknown as { enable: () => void }).enable();

      const focusedElement = document.createElement('div');
      document.body.appendChild(focusedElement);

      blok.InlineToolbar.opened = false;
      (blok.InlineToolbar as { hasNestedPopoverOpen: boolean }).hasNestedPopoverOpen = false;

      vi.spyOn(Selection, 'anchorElement', 'get').mockReturnValue(focusedElement);
      vi.spyOn(Selection, 'get').mockReturnValue({
        isCollapsed: false,
      } as unknown as ReturnType<typeof Selection.get>);
      vi.spyOn(Selection, 'text', 'get').mockReturnValue('text');

      // Should not throw
      expect(() => {
        document.dispatchEvent(new Event('selectionchange'));
        vi.runAllTimers();
      }).not.toThrow();
    });

    it('handles element inside nested blok editor', async () => {
      const { controller, blok } = createSelectionController();
      const parentWrapper = document.createElement('div');

      parentWrapper.setAttribute('data-blok-testid', 'blok-editor');
      document.body.appendChild(parentWrapper);

      const blockContent = document.createElement('div');
      blockContent.setAttribute('data-blok-testid', 'block-content');
      parentWrapper.appendChild(blockContent);

      (controller as unknown as { enable: () => void }).enable();

      blok.InlineToolbar.opened = false;
      (blok.InlineToolbar as { hasNestedPopoverOpen: boolean }).hasNestedPopoverOpen = false;

      vi.spyOn(Selection, 'anchorElement', 'get').mockReturnValue(blockContent);
      vi.spyOn(Selection, 'get').mockReturnValue({
        isCollapsed: false,
      } as unknown as ReturnType<typeof Selection.get>);
      vi.spyOn(Selection, 'text', 'get').mockReturnValue('text');

      // Trigger selection change
      document.dispatchEvent(new Event('selectionchange'));
      vi.runAllTimers();

      // Should not update current block for nested blok instance
      expect(blok.BlockManager.setCurrentBlockByChildNode).not.toHaveBeenCalled();
    });
  });
});
