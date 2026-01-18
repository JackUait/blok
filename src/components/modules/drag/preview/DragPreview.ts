/**
 * DragPreview - Manages the visual preview element during drag operations
 */

import type { Block } from '../../../block';
import { Dom as $ } from '../../../dom';
import { twMerge } from '../../../utils/tw';
import { DRAG_CONFIG, PREVIEW_STYLES } from '../utils/drag.constants';

export class DragPreview {
  private element: HTMLElement | null = null;

  /**
   * Create a single-block preview element
   * @param contentElement - Element to clone for preview
   * @param isStretched - Whether block is stretched
   * @returns Preview element
   */
  createSingle(contentElement: HTMLElement, isStretched: boolean): HTMLElement {
    const preview = $.make('div', PREVIEW_STYLES.base);
    const clone = contentElement.cloneNode(true) as HTMLElement;

    // Reset styles on clone
    clone.className = twMerge(PREVIEW_STYLES.content, isStretched ? 'max-w-none' : '');

    // Reset margin on the tool's rendered element (first child) to prevent offset
    const toolElement = clone.firstElementChild as HTMLElement | null;

    if (toolElement) {
      toolElement.className = twMerge(toolElement.className, '!m-0');
    }

    preview.appendChild(clone);
    this.element = preview;

    return preview;
  }

  /**
   * Create a stacked preview element for multiple blocks
   * @param blocks - Array of blocks to preview
   * @returns Preview element with stacked blocks
   */
  createMulti(blocks: Block[]): HTMLElement {
    const preview = $.make('div', PREVIEW_STYLES.base);

    // Get block holder dimensions to capture actual spacing
    const blockInfo = blocks.map((block) => {
      const holderRect = block.holder.getBoundingClientRect();
      const contentElement = block.holder.querySelector('[data-blok-element-content]');

      if (!contentElement) {
        return { width: 0, height: 0, element: null, holderHeight: 0 };
      }

      const contentRect = contentElement.getBoundingClientRect();

      return {
        width: contentRect.width,
        height: contentRect.height,
        element: contentElement,
        holderHeight: holderRect.height, // Includes margins/padding
      };
    });

    // Calculate cumulative top positions using actual block holder heights
    const positions = blockInfo.reduce<number[]>((acc, _, index) => {
      if (index === 0) {
        acc.push(0);
      } else {
        const previousTop = acc[index - 1];
        const previousHolderHeight = blockInfo[index - 1].holderHeight;

        acc.push(previousTop + previousHolderHeight);
      }

      return acc;
    }, []);

    // Calculate total dimensions
    const maxWidth = Math.max(...blockInfo.map(info => info.width), 0);
    const lastIndex = blockInfo.length - 1;
    const totalHeight = lastIndex >= 0
      ? positions[lastIndex] + blockInfo[lastIndex].height
      : 0;

    // Create stacked blocks
    blocks.forEach((block, index) => {
      const info = blockInfo[index];

      if (!info.element) {
        return;
      }

      const clone = info.element.cloneNode(true) as HTMLElement;

      clone.className = twMerge(PREVIEW_STYLES.content, block.stretched ? 'max-w-none' : '');

      // Reset margin on the tool's rendered element (first child) to prevent offset
      const toolElement = clone.firstElementChild as HTMLElement | null;

      if (toolElement) {
        toolElement.className = twMerge(toolElement.className, '!m-0');
      }

      // Position with cumulative offset
      clone.style.position = 'absolute';
      clone.style.top = `${positions[index]}px`;
      clone.style.left = '0';
      clone.style.zIndex = `${blocks.length - index}`;

      preview.appendChild(clone);
    });

    // Set explicit dimensions on the preview container
    // This is necessary because absolutely positioned children don't contribute to parent size
    preview.style.width = `${maxWidth}px`;
    preview.style.height = `${totalHeight}px`;

    this.element = preview;

    return preview;
  }

  /**
   * Update preview position based on cursor coordinates
   * @param clientX - Cursor X position
   * @param clientY - Cursor Y position
   */
  updatePosition(clientX: number, clientY: number): void {
    if (!this.element) {
      return;
    }

    this.element.style.left = `${clientX + DRAG_CONFIG.previewOffsetX}px`;
    this.element.style.top = `${clientY + DRAG_CONFIG.previewOffsetY}px`;
  }

  /**
   * Show the preview element
   */
  show(): void {
    if (!this.element) {
      return;
    }

    this.element.style.display = 'block';
  }

  /**
   * Hide the preview element (without removing from DOM)
   */
  hide(): void {
    if (!this.element) {
      return;
    }

    this.element.style.display = 'none';
  }

  /**
   * Get the preview element
   */
  getElement(): HTMLElement | null {
    return this.element;
  }

  /**
   * Check if preview exists
   */
  exists(): boolean {
    return this.element !== null;
  }

  /**
   * Remove the preview element from DOM and clean up
   */
  destroy(): void {
    if (this.element && this.element.parentNode) {
      this.element.remove();
    }

    this.element = null;
  }
}
