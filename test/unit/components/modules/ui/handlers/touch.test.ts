import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRedactorTouchHandler,
  getClickedNode,
} from '../../../../../../src/components/modules/uiControllers/handlers/touch';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';

const createBlokStub = (): BlokModules => {
  return {
    BlockManager: {
      setCurrentBlockByChildNode: vi.fn(),
    },
    RectangleSelection: {
      isRectActivated: vi.fn(() => false),
    },
    Caret: {
      setToTheLastBlock: vi.fn(),
    },
    ReadOnly: {
      isEnabled: false,
    },
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
    (document as any).elementFromPoint = vi.fn(() => null);

    redactorElement = document.createElement('div');
    document.body.appendChild(redactorElement);

    blok = createBlokStub();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    (document as any).elementFromPoint = originalElementFromPoint;
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

      // The real implementation uses try/catch, expecting setCurrentBlockByChildNode to throw
      vi.mocked(blok.BlockManager.setCurrentBlockByChildNode).mockImplementation(() => {
        throw new Error('Not found');
      });
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

      vi.mocked(blok.BlockManager.setCurrentBlockByChildNode).mockImplementation(() => {
        throw new Error('Not found');
      });
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
      (blok.ReadOnly as any).isEnabled = true;

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

    it('handles failed setCurrentBlockByChildNode without error', () => {
      const handler = createRedactorTouchHandler({
        Blok: blok,
        redactorElement,
      });

      const target = document.createElement('div');
      redactorElement.appendChild(target);

      vi.mocked(blok.BlockManager.setCurrentBlockByChildNode).mockImplementation(() => {
        throw new Error('No block found');
      });
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
  });
});
