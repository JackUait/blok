import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRedactorTouchHandler,
  getClickedNode,
} from '../../../../../../src/components/modules/uiControllers/handlers/touch';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';

const createBlokStub = (): BlokModules => {
  const readOnlyStub = {
    isEnabled: false,
  };

  return {
    BlockManager: {
      setCurrentBlockByChildNode: vi.fn(),
      getBlockByChildNode: vi.fn(),
    },
    RectangleSelection: {
      isRectActivated: vi.fn(() => false),
    },
    Caret: {
      setToTheLastBlock: vi.fn(),
    },
    ReadOnly: readOnlyStub,
    Toolbar: {
      moveAndOpen: vi.fn(),
      contains: vi.fn(() => false),
    },
  } as unknown as BlokModules;
};

describe('Touch Handler', () => {
  let blok: BlokModules;
  let redactorElement: HTMLElement;
  let originalElementFromPoint: typeof document.elementFromPoint;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock document.elementFromPoint which is not always available in jsdom
    originalElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = vi.fn(() => null) as unknown as Document['elementFromPoint'];

    redactorElement = document.createElement('div');
    document.body.appendChild(redactorElement);

    blok = createBlokStub();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.elementFromPoint = originalElementFromPoint;
    vi.restoreAllMocks();
  });

  describe('getClickedNode', () => {
    it('returns initial target when not redactor', () => {
      const target = document.createElement('div');
      const event = new MouseEvent('mousedown');
      Object.defineProperty(event, 'target', { value: target });

      const result = getClickedNode(target, event, redactorElement);

      expect(result).toBe(target);
    });

    it('returns redactor when target equals redactor and elementFromPoint not available', () => {
      // When target is redactor and elementFromPoint is not available,
      // getClickedNode returns redactor (fallback behavior)
      const event = new MouseEvent('mousedown', {
        clientX: 50,
        clientY: 50,
      });
      Object.defineProperty(event, 'target', { value: redactorElement });

      const result = getClickedNode(redactorElement, event, redactorElement);

      // Should return redactor as fallback
      expect(result).toBe(redactorElement);
    });

    it('returns redactor when TouchEvent has no touches', () => {
      const event = new TouchEvent('touchstart', {
        touches: [],
      });
      Object.defineProperty(event, 'target', { value: redactorElement });

      const result = getClickedNode(redactorElement, event, redactorElement);

      expect(result).toBe(redactorElement);
    });
  });

  describe('createRedactorTouchHandler', () => {
    it('sets current block by child node on touch', () => {
      const handler = createRedactorTouchHandler({
        Blok: blok,
        redactorElement,
      });

      const target = document.createElement('div');
      redactorElement.appendChild(target);

      const event = new MouseEvent('mousedown', {
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: target });

      handler(event);

      expect(blok.BlockManager.setCurrentBlockByChildNode).toHaveBeenCalledWith(target);
    });

    it('sets caret to last block when outside first-level blocks and no rect selection', () => {
      const handler = createRedactorTouchHandler({
        Blok: blok,
        redactorElement,
      });

      const target = document.createElement('div');
      redactorElement.appendChild(target);

      // setCurrentBlockByChildNode returns undefined when no block is found
      vi.mocked(blok.BlockManager.setCurrentBlockByChildNode).mockReturnValue(undefined);
      vi.mocked(blok.RectangleSelection.isRectActivated).mockReturnValue(false);

      const event = new MouseEvent('mousedown', {
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: target });

      handler(event);

      // Verify caret fallback behavior when block is not found
      expect(blok.Caret.setToTheLastBlock).toHaveBeenCalledTimes(1);
      // Verify toolbar still moves to the clicked node even when caret fallback is used
      expect(blok.Toolbar.moveAndOpen).toHaveBeenCalledWith(undefined, target);
    });

    it('does not set caret when rectangle selection is activated', () => {
      const handler = createRedactorTouchHandler({
        Blok: blok,
        redactorElement,
      });

      const target = document.createElement('div');
      redactorElement.appendChild(target);

      vi.mocked(blok.BlockManager.setCurrentBlockByChildNode).mockReturnValue(undefined);
      vi.mocked(blok.RectangleSelection.isRectActivated).mockReturnValue(true);

      const event = new MouseEvent('mousedown', {
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: target });

      handler(event);

      expect(blok.Caret.setToTheLastBlock).not.toHaveBeenCalled();
    });

    it('moves and opens toolbar when not read-only', () => {
      const handler = createRedactorTouchHandler({
        Blok: blok,
        redactorElement,
      });

      const target = document.createElement('div');
      redactorElement.appendChild(target);

      vi.mocked(blok.Toolbar.contains).mockReturnValue(false);

      const event = new MouseEvent('mousedown', {
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: target });

      handler(event);

      expect(blok.Toolbar.moveAndOpen).toHaveBeenCalledWith(undefined, target);
    });

    it('does not move toolbar when read-only is enabled', () => {
      (blok.ReadOnly as { isEnabled: boolean }).isEnabled = true;

      const handler = createRedactorTouchHandler({
        Blok: blok,
        redactorElement,
      });

      const target = document.createElement('div');
      redactorElement.appendChild(target);

      const event = new MouseEvent('mousedown', {
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: target });

      handler(event);

      expect(blok.Toolbar.moveAndOpen).not.toHaveBeenCalled();
    });

    it('does not move toolbar when target is inside toolbar', () => {
      const handler = createRedactorTouchHandler({
        Blok: blok,
        redactorElement,
      });

      const target = document.createElement('div');
      redactorElement.appendChild(target);

      vi.mocked(blok.Toolbar.contains).mockReturnValue(true);

      const event = new MouseEvent('mousedown', {
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: target });

      handler(event);

      expect(blok.Toolbar.moveAndOpen).not.toHaveBeenCalled();
    });

    it('handles target that is redactor directly', () => {
      const handler = createRedactorTouchHandler({
        Blok: blok,
        redactorElement,
      });

      vi.mocked(blok.Toolbar.contains).mockReturnValue(false);

      const event = new MouseEvent('mousedown', {
        clientX: 50,
        clientY: 50,
      });
      Object.defineProperty(event, 'target', { value: redactorElement });

      handler(event);

      // Should set current block by redactor element itself
      expect(blok.BlockManager.setCurrentBlockByChildNode).toHaveBeenCalledWith(redactorElement);
    });

    it('falls back to setToTheLastBlock when no block is found', () => {
      const handler = createRedactorTouchHandler({
        Blok: blok,
        redactorElement,
      });

      const target = document.createElement('div');
      redactorElement.appendChild(target);

      vi.mocked(blok.BlockManager.setCurrentBlockByChildNode).mockReturnValue(undefined);
      vi.mocked(blok.RectangleSelection.isRectActivated).mockReturnValue(false);
      vi.mocked(blok.Toolbar.contains).mockReturnValue(false);

      const event = new MouseEvent('mousedown', {
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: target });

      // Verify handler completes without throwing
      expect(() => handler(event)).not.toThrow();

      // Verify the fallback behavior: caret moves to last block when no block is found
      expect(blok.Caret.setToTheLastBlock).toHaveBeenCalled();
      // Verify toolbar still moves to the clicked node
      expect(blok.Toolbar.moveAndOpen).toHaveBeenCalledWith(undefined, target);
    });

    describe('click below last block content', () => {
      it('delegates to setToTheLastBlock when click is below the last block content area', () => {
        const handler = createRedactorTouchHandler({
          Blok: blok,
          redactorElement,
        });

        // Create a block wrapper with a content element
        const blockWrapper = document.createElement('div');

        blockWrapper.setAttribute('data-blok-element', '');

        const contentEl = document.createElement('div');

        contentEl.setAttribute('data-blok-element-content', '');
        blockWrapper.appendChild(contentEl);
        redactorElement.appendChild(blockWrapper);

        // Mock the block as the last block
        const mockBlock = {
          holder: blockWrapper,
        };

        vi.mocked(blok.BlockManager.setCurrentBlockByChildNode).mockReturnValue(mockBlock as unknown as ReturnType<typeof blok.BlockManager.setCurrentBlockByChildNode>);

        // Make it the last block
        Object.defineProperty(blok.BlockManager, 'lastBlock', {
          get: () => mockBlock,
          configurable: true,
        });

        // Mock contentElement bounding rect: bottom at 100px
        vi.spyOn(contentEl, 'getBoundingClientRect').mockReturnValue(
          new DOMRect(0, 0, 200, 100)
        );

        // Click at Y=120, which is below the content bottom (100)
        const event = new MouseEvent('mousedown', {
          bubbles: true,
          clientY: 120,
        });

        Object.defineProperty(event, 'target', { value: blockWrapper });

        handler(event);

        expect(blok.Caret.setToTheLastBlock).toHaveBeenCalled();
      });

      it('does NOT delegate to setToTheLastBlock when click is inside the last block content area', () => {
        const handler = createRedactorTouchHandler({
          Blok: blok,
          redactorElement,
        });

        const blockWrapper = document.createElement('div');

        blockWrapper.setAttribute('data-blok-element', '');

        const contentEl = document.createElement('div');

        contentEl.setAttribute('data-blok-element-content', '');
        blockWrapper.appendChild(contentEl);
        redactorElement.appendChild(blockWrapper);

        const mockBlock = {
          holder: blockWrapper,
        };

        vi.mocked(blok.BlockManager.setCurrentBlockByChildNode).mockReturnValue(mockBlock as unknown as ReturnType<typeof blok.BlockManager.setCurrentBlockByChildNode>);

        Object.defineProperty(blok.BlockManager, 'lastBlock', {
          get: () => mockBlock,
          configurable: true,
        });

        vi.spyOn(contentEl, 'getBoundingClientRect').mockReturnValue(
          new DOMRect(0, 0, 200, 100)
        );

        // Click at Y=50, which is INSIDE the content area (bottom=100)
        const event = new MouseEvent('mousedown', {
          bubbles: true,
          clientY: 50,
        });

        Object.defineProperty(event, 'target', { value: contentEl });

        handler(event);

        expect(blok.Caret.setToTheLastBlock).not.toHaveBeenCalled();
      });

      it('does NOT delegate to setToTheLastBlock when click is on a non-last block', () => {
        const handler = createRedactorTouchHandler({
          Blok: blok,
          redactorElement,
        });

        const blockWrapper = document.createElement('div');

        blockWrapper.setAttribute('data-blok-element', '');

        const contentEl = document.createElement('div');

        contentEl.setAttribute('data-blok-element-content', '');
        blockWrapper.appendChild(contentEl);
        redactorElement.appendChild(blockWrapper);

        const mockBlock = {
          holder: blockWrapper,
        };
        const anotherBlock = {
          holder: document.createElement('div'),
        };

        vi.mocked(blok.BlockManager.setCurrentBlockByChildNode).mockReturnValue(mockBlock as unknown as ReturnType<typeof blok.BlockManager.setCurrentBlockByChildNode>);

        // lastBlock is a different block
        Object.defineProperty(blok.BlockManager, 'lastBlock', {
          get: () => anotherBlock,
          configurable: true,
        });

        vi.spyOn(contentEl, 'getBoundingClientRect').mockReturnValue(
          new DOMRect(0, 0, 200, 100)
        );

        const event = new MouseEvent('mousedown', {
          bubbles: true,
          clientY: 120,
        });

        Object.defineProperty(event, 'target', { value: blockWrapper });

        handler(event);

        expect(blok.Caret.setToTheLastBlock).not.toHaveBeenCalled();
      });
    });

    describe('table cell toolbar preservation', () => {
      /**
       * Creates a DOM structure that mimics a table cell containing a paragraph block.
       * The target (paragraph's contenteditable) is nested inside [data-blok-table-cell-blocks].
       */
      const createTableCellDOM = (): {
        tableBlockWrapper: HTMLElement;
        cellTarget: HTMLElement;
        tableBlock: { id: string; holder: HTMLElement };
      } => {
        // Table block wrapper
        const tableBlockWrapper = document.createElement('div');

        tableBlockWrapper.setAttribute('data-blok-testid', 'block-wrapper');
        tableBlockWrapper.setAttribute('data-blok-id', 'table-block-1');

        // Cell blocks container
        const cellBlocksContainer = document.createElement('div');

        cellBlocksContainer.setAttribute('data-blok-table-cell-blocks', '');
        tableBlockWrapper.appendChild(cellBlocksContainer);

        // Inner paragraph block wrapper (inside table cell)
        const paragraphWrapper = document.createElement('div');

        paragraphWrapper.setAttribute('data-blok-testid', 'block-wrapper');
        paragraphWrapper.setAttribute('data-blok-id', 'para-block-1');
        cellBlocksContainer.appendChild(paragraphWrapper);

        // Contenteditable element inside paragraph
        const contentEditable = document.createElement('div');

        contentEditable.setAttribute('contenteditable', 'true');
        paragraphWrapper.appendChild(contentEditable);

        const tableBlock = { id: 'table-block-1', holder: tableBlockWrapper };

        return { tableBlockWrapper, cellTarget: contentEditable, tableBlock };
      };

      it('should pass the resolved table block to moveAndOpen when clicking inside a table cell', () => {
        const { tableBlockWrapper, cellTarget, tableBlock } = createTableCellDOM();

        redactorElement.appendChild(tableBlockWrapper);

        vi.mocked(blok.BlockManager.getBlockByChildNode).mockReturnValue(tableBlock as unknown as Parameters<typeof blok.BlockManager.getBlockByChildNode>[0] extends Node ? ReturnType<typeof blok.BlockManager.getBlockByChildNode> : never);

        const handler = createRedactorTouchHandler({
          Blok: blok,
          redactorElement,
        });

        const event = new MouseEvent('mousedown', { bubbles: true });

        Object.defineProperty(event, 'target', { value: cellTarget });

        handler(event);

        // moveAndOpen should receive the TABLE block, not undefined
        const moveAndOpenCall = vi.mocked(blok.Toolbar.moveAndOpen).mock.calls[0];

        expect(moveAndOpenCall[0]).toBe(tableBlock);
      });

      it('should still pass undefined for non-table-cell blocks', () => {
        const target = document.createElement('div');

        target.setAttribute('contenteditable', 'true');
        redactorElement.appendChild(target);

        const handler = createRedactorTouchHandler({
          Blok: blok,
          redactorElement,
        });

        const event = new MouseEvent('mousedown', { bubbles: true });

        Object.defineProperty(event, 'target', { value: target });

        handler(event);

        expect(blok.Toolbar.moveAndOpen).toHaveBeenCalledWith(undefined, target);
      });
    });
  });
});
