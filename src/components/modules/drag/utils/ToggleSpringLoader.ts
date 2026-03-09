import type { Block } from '../../../block';

const SPRING_LOAD_DELAY_MS = 500;
const SPRING_LOADING_ATTR = 'data-blok-spring-loading';

function isClosedToggle(block: Block): boolean {
  return block.holder.querySelector('[data-blok-toggle-open="false"]') !== null;
}

/**
 * Manages the spring-loading hover timer for collapsed toggle blocks during drag.
 * After SPRING_LOAD_DELAY_MS of hovering over a closed toggle, it auto-expands it.
 */
export class ToggleSpringLoader {
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private currentBlock: Block | null = null;

  /**
   * Called on every mousemove during drag with the current hovered block (or null).
   * Starts/resets/cancels the spring-load timer as appropriate.
   */
  public update(block: Block | null): void {
    if (block === this.currentBlock) {
      return; // Same block — don't restart timer
    }

    this.clearTimer();

    if (block === null || !isClosedToggle(block)) {
      this.currentBlock = null;
      return;
    }

    this.currentBlock = block;
    block.holder.setAttribute(SPRING_LOADING_ATTR, '');

    this.timerId = setTimeout(() => {
      this.timerId = null;
      if (this.currentBlock) {
        this.currentBlock.holder.removeAttribute(SPRING_LOADING_ATTR);
        this.currentBlock.call('expand');
        this.currentBlock = null;
      }
    }, SPRING_LOAD_DELAY_MS);
  }

  /**
   * Cancels any pending spring-load timer and cleans up visual state.
   * Call on drag end / cleanup.
   */
  public cancel(): void {
    this.clearTimer();
    this.currentBlock = null;
  }

  private clearTimer(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    if (this.currentBlock) {
      this.currentBlock.holder.removeAttribute(SPRING_LOADING_ATTR);
      this.currentBlock = null;
    }
  }
}
