/**
 * Tests for DragPreview
 */

import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { DragPreview } from '../../../../../../src/components/modules/drag/preview/DragPreview';
import type { Block } from '../../../../../../src/components/block';

describe('DragPreview', () => {
  let dragPreview: DragPreview;
  let container: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    dragPreview = new DragPreview();
    container = document.createElement('div');
    container.id = 'test-container';
    document.body.appendChild(container);
  });

  afterEach(() => {
    dragPreview.destroy();
    document.body.removeChild(container);
  });

  describe('createSingle', () => {
    it('should create a preview element from content element', () => {
      const contentElement = document.createElement('div');
      contentElement.innerHTML = '<p>Test content</p>';

      const preview = dragPreview.createSingle(contentElement, false);

      expect(preview).toBeInstanceOf(HTMLElement);
      // Check that the preview contains a clone (has a child with the same content)
      const clone = preview.firstElementChild;
      expect(clone).toBeInstanceOf(HTMLElement);
      expect(clone?.innerHTML).toContain('Test content');
    });

    it('should set element property', () => {
      const contentElement = document.createElement('div');

      dragPreview.createSingle(contentElement, false);

      expect(dragPreview.exists()).toBe(true);
    });
  });

  describe('createMulti', () => {
    /**
     * Helper to mock getBoundingClientRect for both holder and content element
     */
    const mockBlockRects = (
      block: Block,
      holderRect: DOMRect,
      contentRect: DOMRect
    ): void => {
      vi.spyOn(block.holder, 'getBoundingClientRect').mockReturnValue(holderRect);
      const contentElement = block.holder.querySelector('[data-blok-element-content]') as HTMLElement;
      if (contentElement) {
        vi.spyOn(contentElement, 'getBoundingClientRect').mockReturnValue(contentRect);
      }
    };

    it('should create stacked preview for multiple blocks', () => {
      const block1 = createMockBlock('block-1', 100, 50, false);
      const block2 = createMockBlock('block-2', 100, 50, false);

      mockBlockRects(block1, {
        left: 0, top: 0, width: 100, height: 60, right: 100, bottom: 60, x: 0, y: 0, toJSON: () => ({}) },
        { left: 0, top: 0, width: 100, height: 50, right: 100, bottom: 50, x: 0, y: 0, toJSON: () => ({}) });
      mockBlockRects(block2, {
        left: 0, top: 60, width: 100, height: 60, right: 100, bottom: 120, x: 0, y: 60, toJSON: () => ({}) },
        { left: 0, top: 60, width: 100, height: 50, right: 100, bottom: 110, x: 0, y: 60, toJSON: () => ({}) });

      const preview = dragPreview.createMulti([block1, block2]);

      expect(preview.style.width).toBe('100px');
      expect(preview.style.height).toBe('110px'); // 50 + 60 (second block's top offset)
      expect(dragPreview.exists()).toBe(true);
    });

    it('should position blocks with correct offsets', () => {
      const block1 = createMockBlock('block-1', 100, 50, false);
      const block2 = createMockBlock('block-2', 100, 50, false);

      mockBlockRects(block1, {
        left: 0, top: 0, width: 100, height: 60, right: 100, bottom: 60, x: 0, y: 0, toJSON: () => ({}) },
        { left: 0, top: 0, width: 100, height: 50, right: 100, bottom: 50, x: 0, y: 0, toJSON: () => ({}) });
      mockBlockRects(block2, {
        left: 0, top: 60, width: 100, height: 60, right: 100, bottom: 120, x: 0, y: 60, toJSON: () => ({}) },
        { left: 0, top: 60, width: 100, height: 50, right: 100, bottom: 110, x: 0, y: 60, toJSON: () => ({}) });

      dragPreview.createMulti([block1, block2]);

      const preview = dragPreview.getElement();
      const clones = preview?.children;

      expect(clones?.length).toBe(2);

      const firstClone = clones?.[0] as HTMLElement;
      const secondClone = clones?.[1] as HTMLElement;

      expect(firstClone.style.top).toBe('0px');
      expect(secondClone.style.top).toBe('60px');
    });

    it('should set z-index for stacking order', () => {
      const block1 = createMockBlock('block-1', 100, 50, false);
      const block2 = createMockBlock('block-2', 100, 50, false);
      const block3 = createMockBlock('block-3', 100, 50, false);

      mockBlockRects(block1, {
        left: 0, top: 0, width: 100, height: 60, right: 100, bottom: 60, x: 0, y: 0, toJSON: () => ({}) },
        { left: 0, top: 0, width: 100, height: 50, right: 100, bottom: 50, x: 0, y: 0, toJSON: () => ({}) });
      mockBlockRects(block2, {
        left: 0, top: 60, width: 100, height: 60, right: 100, bottom: 120, x: 0, y: 60, toJSON: () => ({}) },
        { left: 0, top: 60, width: 100, height: 50, right: 100, bottom: 110, x: 0, y: 60, toJSON: () => ({}) });
      mockBlockRects(block3, {
        left: 0, top: 120, width: 100, height: 60, right: 100, bottom: 180, x: 0, y: 120, toJSON: () => ({}) },
        { left: 0, top: 120, width: 100, height: 50, right: 100, bottom: 170, x: 0, y: 120, toJSON: () => ({}) });

      dragPreview.createMulti([block1, block2, block3]);

      const preview = dragPreview.getElement();
      const clones = preview?.children;

      const firstClone = clones?.[0] as HTMLElement;
      const secondClone = clones?.[1] as HTMLElement;
      const thirdClone = clones?.[2] as HTMLElement;

      // First block should be on top (highest z-index)
      expect(firstClone.style.zIndex).toBe('3');
      expect(secondClone.style.zIndex).toBe('2');
      expect(thirdClone.style.zIndex).toBe('1');
    });

    it('should handle stretched blocks in multi-block preview', () => {
      const block1 = createMockBlock('block-1', 100, 50, true);
      const block2 = createMockBlock('block-2', 100, 50, false);

      mockBlockRects(block1, {
        left: 0, top: 0, width: 100, height: 60, right: 100, bottom: 60, x: 0, y: 0, toJSON: () => ({}) },
        { left: 0, top: 0, width: 100, height: 50, right: 100, bottom: 50, x: 0, y: 0, toJSON: () => ({}) });
      mockBlockRects(block2, {
        left: 0, top: 60, width: 100, height: 60, right: 100, bottom: 120, x: 0, y: 60, toJSON: () => ({}) },
        { left: 0, top: 60, width: 100, height: 50, right: 100, bottom: 110, x: 0, y: 60, toJSON: () => ({}) });

      dragPreview.createMulti([block1, block2]);

      const preview = dragPreview.getElement();
      // Both blocks should be included
      expect(preview?.children.length).toBe(2);
    });

    it('should skip blocks without content element', () => {
      const block1 = createMockBlock('block-1', 100, 50, false);
      const block2 = {
        id: 'block-2',
        holder: document.createElement('div'),
        name: 'paragraph',
        stretched: false,
      } as Block;

      mockBlockRects(block1, {
        left: 0, top: 0, width: 100, height: 60, right: 100, bottom: 60, x: 0, y: 0, toJSON: () => ({}) },
        { left: 0, top: 0, width: 100, height: 50, right: 100, bottom: 50, x: 0, y: 0, toJSON: () => ({}) });

      const preview = dragPreview.createMulti([block1, block2]);

      // Should only have one child (block1)
      const clones = preview?.children;
      expect(clones?.length).toBe(1);
    });
  });

  describe('updatePosition', () => {
    it('should update preview position with offset', () => {
      const contentElement = document.createElement('div');
      dragPreview.createSingle(contentElement, false);

      dragPreview.updatePosition(100, 200);

      const preview = dragPreview.getElement();

      // Default offsets: previewOffsetX: 10, previewOffsetY: 0
      expect(preview?.style.left).toBe('110px');
      expect(preview?.style.top).toBe('200px');
    });

    it('should not throw when preview does not exist', () => {
      expect(() => {
        dragPreview.updatePosition(100, 200);
      }).not.toThrow();
    });
  });

  describe('show and hide', () => {
    it('should show the preview', () => {
      const contentElement = document.createElement('div');
      dragPreview.createSingle(contentElement, false);
      dragPreview.hide(); // Start hidden

      dragPreview.show();

      const preview = dragPreview.getElement();
      expect(preview?.style.display).toBe('block');
    });

    it('should hide the preview', () => {
      const contentElement = document.createElement('div');
      dragPreview.createSingle(contentElement, false);

      dragPreview.hide();

      const preview = dragPreview.getElement();
      expect(preview?.style.display).toBe('none');
    });

    it('should not throw when showing non-existent preview', () => {
      expect(() => dragPreview.show()).not.toThrow();
    });

    it('should not throw when hiding non-existent preview', () => {
      expect(() => dragPreview.hide()).not.toThrow();
    });
  });

  describe('getElement', () => {
    it('should return null when no preview created', () => {
      expect(dragPreview.getElement()).toBeNull();
    });

    it('should return preview element after creation', () => {
      const contentElement = document.createElement('div');
      dragPreview.createSingle(contentElement, false);

      expect(dragPreview.getElement()).toBeInstanceOf(HTMLElement);
    });
  });

  describe('exists', () => {
    it('should return false when no preview created', () => {
      expect(dragPreview.exists()).toBe(false);
    });

    it('should return true after preview creation', () => {
      const contentElement = document.createElement('div');
      dragPreview.createSingle(contentElement, false);

      expect(dragPreview.exists()).toBe(true);
    });
  });

  describe('destroy', () => {
    it('should remove preview from DOM', () => {
      const contentElement = document.createElement('div');
      const preview = dragPreview.createSingle(contentElement, false);
      document.body.appendChild(preview);

      dragPreview.destroy();

      expect(document.body.contains(preview)).toBe(false);
    });

    it('should set element to null', () => {
      const contentElement = document.createElement('div');
      dragPreview.createSingle(contentElement, false);

      dragPreview.destroy();

      expect(dragPreview.getElement()).toBeNull();
      expect(dragPreview.exists()).toBe(false);
    });

    it('should be safe to call multiple times', () => {
      const contentElement = document.createElement('div');
      dragPreview.createSingle(contentElement, false);

      expect(() => {
        dragPreview.destroy();
        dragPreview.destroy();
      }).not.toThrow();
    });

    it('should be safe to call when no preview exists', () => {
      expect(() => dragPreview.destroy()).not.toThrow();
    });
  });

  describe('integration', () => {
    it('should work through full lifecycle', () => {
      const contentElement = document.createElement('div');
      contentElement.innerHTML = '<p>Test</p>';

      // Create
      const preview = dragPreview.createSingle(contentElement, false);
      document.body.appendChild(preview);

      expect(dragPreview.exists()).toBe(true);

      // Hide initially
      dragPreview.hide();
      expect(preview.style.display).toBe('none');

      // Update position
      dragPreview.updatePosition(50, 100);
      expect(preview.style.left).toBe('60px');
      expect(preview.style.top).toBe('100px');

      // Show
      dragPreview.show();
      expect(preview.style.display).toBe('block');

      // Destroy
      dragPreview.destroy();
      expect(dragPreview.exists()).toBe(false);
      expect(document.body.contains(preview)).toBe(false);
    });
  });
});

/**
 * Helper to create a mock block
 */
const createMockBlock = (
  id: string,
  contentWidth: number,
  contentHeight: number,
  stretched: boolean
): Block => {
  const holder = document.createElement('div');
  holder.setAttribute('data-blok-element', 'block');

  const contentElement = document.createElement('div');
  contentElement.setAttribute('data-blok-element-content', '');
  contentElement.style.width = `${contentWidth}px`;
  contentElement.style.height = `${contentHeight}px`;

  holder.appendChild(contentElement);

  const block = {
    id,
    holder,
    name: 'paragraph',
    stretched,
  };
  return block as unknown as Block;
};
