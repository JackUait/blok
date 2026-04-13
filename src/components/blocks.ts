import type { Block } from './block';
import { BlockToolAPI } from './block';


/**
 * @class Blocks
 * @classdesc Class to work with Block instances array
 * @private
 * @property {HTMLElement} workingArea — blok`s working node
 */
export class Blocks {
  /**
   * Array of Block instances in order of addition
   */
  public blocks: Block[];

  /**
   * Blok`s area where to add Block`s HTML
   */
  public workingArea: HTMLElement;

  /**
   * @class
   * @param {HTMLElement} workingArea — blok`s working node
   */
  constructor(workingArea: HTMLElement) {
    this.blocks = [];
    this.workingArea = workingArea;
  }

  /**
   * Get length of Block instances array
   * @returns {number}
   */
  public get length(): number {
    return this.blocks.length;
  }

  /**
   * Get Block instances array
   * @returns {Block[]}
   */
  public get array(): Block[] {
    return this.blocks;
  }

  /**
   * Get blocks html elements array
   * @returns {HTMLElement[]}
   */
  public get nodes(): HTMLElement[] {
    return Array.from(this.workingArea.children) as HTMLElement[];
  }

  /**
   * Proxy trap to implement array-like setter
   * @example
   * blocks[0] = new Block(...)
   * @param {Blocks} instance — Blocks instance
   * @param {PropertyKey} property — block index or any Blocks class property key to set
   * @param {Block} value — value to set
   * @returns {boolean}
   */
  public static set(instance: Blocks, property: PropertyKey, value: unknown): boolean {
    /**
     * If property name is not a number (method or other property, access it via reflect
     */
    if (isNaN(Number(property))) {
      Reflect.set(instance, property, value);

      return true;
    }

    /**
     * If property is number, call insert method to emulate array behaviour
     * @example
     * blocks[0] = new Block();
     */
    instance.insert(+(property as number), value as Block);

    return true;
  }

  /**
   * Proxy trap to implement array-like getter
   * @param {Blocks} instance — Blocks instance
   * @param {PropertyKey} property — Blocks class property key
   * @returns {Block|*}
   */
  public static get(instance: Blocks, property: PropertyKey): unknown {
    /**
     * If property is not a number, get it via Reflect object
     */
    if (isNaN(Number(property))) {
      return Reflect.get(instance, property);
    }

    /**
     * If property is a number (Block index) return Block by passed index
     */
    return instance.get(+(property as number));
  }

  /**
   * Push new Block to the blocks array and append it to working area
   * @param {Block} block - Block to add
   */
  public push(block: Block): void {
    this.blocks.push(block);
    this.insertToDOM(block);
  }

  /**
   * Move a block from one to another index
   * @param {number} toIndex - new index of the block
   * @param {number} fromIndex - block to move
   * @param {boolean} skipDOM - if true, do not manipulate DOM (useful when SortableJS already did it)
   */
  public move(toIndex: number, fromIndex: number, skipDOM = false, skipMovedHook = false): void {
    /**
     * Invalid-index guard (regression: wrong-block-dropped).
     *
     * `Array.splice(-1, 1)` removes the LAST element, and `splice(N, 1)` where
     * N is past the end does nothing — both hide stale-reference bugs as silent
     * data corruption. Every caller in every surface (drag, yjs-sync, API,
     * tool conversion, undo) flows through here, so this is the lowest-level
     * point to reject nonsense indices and keep the "wrong block dropped"
     * class of bug from ever reappearing.
     */
    if (
      fromIndex < 0 ||
      fromIndex >= this.blocks.length ||
      toIndex < 0 ||
      toIndex >= this.blocks.length
    ) {
      return;
    }

    /**
     * cut out the block, move the DOM element and insert at the desired index
     * again (the shifting within the blocks array will happen automatically).
     * @see https://stackoverflow.com/a/44932690/1238150
     */
    const block = this.blocks.splice(fromIndex, 1)[0];

    // Blocks whose holders are nested inside another block's container (e.g., table cell
    // blocks inside the table's rendered container) must not have their DOM position
    // changed — they stay inside the parent container and follow it automatically when
    // the parent block is repositioned. Only direct workingArea children need DOM moves.
    const isNested = block.holder.parentElement !== null &&
      block.holder.parentElement !== this.workingArea;

    if (!skipDOM && !isNested) {
      this.moveHolderInDOM(block, toIndex);
    }

    // move in array
    this.blocks.splice(toIndex, 0, block);

    // Re-sort any nested blocks (whose holders live inside block.holder) so they
    // immediately follow the moved block in the flat array, matching DOM nesting.
    this.resortNestedBlocks(block, this.blocks.indexOf(block));

    // invoke hook (skipped during batch moves — caller re-triggers after all blocks land)
    if (!skipMovedHook) {
      block.call(BlockToolAPI.MOVED, {
        fromIndex,
        toIndex,
      });
    }
  }

  /**
   * Insert new Block at passed index
   * @param {number} index — index to insert Block
   * @param {Block} block — Block to insert
   * @param {boolean} replace — it true, replace block on given index
   */
  public insert(index: number, block: Block, replace = false, appendToWorkingArea = false): void {
    /**
     * Invalid-index guard (regression: wrong-block-dropped via alt+drag).
     *
     * `Array.splice(-1, 0, block)` inserts BEFORE the last element — a silent
     * divergence between the flat blocks array and the DOM that corrupts the
     * next move() operation and drops an unrelated block. Mirrors the guard
     * in Blocks.move so every caller (drag duplicate, yjs-sync, undo, API) is
     * protected at the lowest level.
     */
    if (index < 0) {
      return;
    }

    if (!this.length) {
      this.push(block);

      return;
    }

    const insertIndex = index > this.length ? this.length : index;

    if (replace) {
      const blockToReplace = this.blocks[insertIndex];

      /**
       * Call REMOVED lifecycle hook first, then destroy to unsubscribe from
       * mutation events. Use replaceWith() to swap DOM elements in-place,
       * preserving the replaced block's exact DOM position. This prevents
       * the new block from being misplaced when the previous block in the
       * array is nested inside another element (e.g., a table cell).
       */
      blockToReplace.call(BlockToolAPI.REMOVED);
      blockToReplace.destroy();
      blockToReplace.holder.replaceWith(block.holder);

      this.blocks.splice(insertIndex, 1, block);
      block.call(BlockToolAPI.RENDERED);

      return;
    }

    this.blocks.splice(insertIndex, 0, block);

    /**
     * When appendToWorkingArea is true, always append to the working area
     * as a direct child. This prevents blocks from being placed inside
     * nested containers (e.g., table cells) when the previous block in
     * the flat array happens to be nested.
     */
    if (appendToWorkingArea) {
      this.insertToDOM(block);

      return;
    }

    if (insertIndex > 0) {
      const previousBlock = this.blocks[insertIndex - 1];

      this.insertToDOM(block, 'afterend', previousBlock);

      return;
    }

    const nextBlock = this.blocks[insertIndex + 1] as Block | undefined;

    if (nextBlock) {
      this.insertToDOM(block, 'beforebegin', nextBlock);

      return;
    }

    this.insertToDOM(block);
  }

  /**
   * Replaces block under passed index with passed block
   * @param index - index of existed block
   * @param block - new block
   */
  public replace(index: number, block: Block): void {
    if (!(index in this.blocks)) {
      throw Error('Incorrect index');
    }

    const prevBlock = this.blocks[index];

    prevBlock.call(BlockToolAPI.REMOVED);
    // Destroy releases the drag-handle listener bound to the shared settings
    // toggler; skipping it leaves the orphan Block wired up and dragging it
    // on next mousedown instead of whatever the user intended.
    prevBlock.destroy();
    prevBlock.holder.replaceWith(block.holder);

    this.blocks[index] = block;

    block.call(BlockToolAPI.RENDERED);
  }

  /**
   * Inserts several blocks at once
   * @param blocks - blocks to insert
   * @param index - index to insert blocks at
   */
  public insertMany(blocks: Block[], index: number ): void {
    /**
     * Invalid-index guard (regression: wrong-block-dropped family).
     * Mirrors Blocks.move and Blocks.insert — `splice(-1, 0, ...blocks)`
     * silently inserts BEFORE the last element, diverging array from DOM.
     * Yjs batch-add paths feed this method with computed indices; a stale
     * input would otherwise cause a later move() to drop an unrelated block.
     */
    if (index < 0) {
      return;
    }

    const fragment = new DocumentFragment();

    for (const block of blocks) {
      fragment.appendChild(block.holder);
    }

    if (!this.length) {
      this.blocks.push(...blocks);
      this.workingArea.appendChild(fragment);

      blocks.forEach((block) => block.call(BlockToolAPI.RENDERED));

      return;
    }

    if (index > 0) {
      const previousBlockIndex = Math.min(index - 1, this.length - 1);
      const previousBlock = this.blocks[previousBlockIndex];
      const isDirectChild = previousBlock.holder.parentElement === this.workingArea;

      if (isDirectChild) {
        previousBlock.holder.after(fragment);
      } else {
        this.insertAfterNestedBlock(fragment, index);
      }
    }

    if (index === 0) {
      this.workingArea.prepend(fragment);
    }

    /**
     * Insert blocks to the array at the specified index
     */
    this.blocks.splice(index, 0, ...blocks);

    /**
     * Call Rendered event for each block
     */
    blocks.forEach((block) => block.call(BlockToolAPI.RENDERED));
  }

  /**
   * Remove block
   * @param {number} index - index of Block to remove
   */
  public remove(index: number): void {
    const removeIndex = isNaN(index) ? this.length - 1 : index;
    const blockToRemove = this.blocks[removeIndex];

    /**
     * Call REMOVED lifecycle hook first, then destroy to unsubscribe from
     * mutation events, then remove DOM element. This prevents spurious
     * 'block-changed' events from being fired when the DOM element is removed.
     */
    blockToRemove.call(BlockToolAPI.REMOVED);
    blockToRemove.destroy();
    blockToRemove.holder.remove();

    this.blocks.splice(removeIndex, 1);
  }

  /**
   * Remove all blocks
   */
  public removeAll(): void {
    // Destroy each block so draggable listeners bound to shared DOM handles
    // (e.g. the settings toggler) are released. Skipping destroy leaves stale
    // mousedown handlers on the shared toggler, which later fire for whichever
    // block is hovered and drags the wrong block.
    this.blocks.forEach((block) => {
      block.call(BlockToolAPI.REMOVED);
      block.destroy();
    });

    this.workingArea.innerHTML = '';
    this.blocks.length = 0;
  }

  /**
   * Insert Block after passed target
   * @todo decide if this method is necessary
   * @param {Block} targetBlock — target after which Block should be inserted
   * @param {Block} newBlock — Block to insert
   */
  public insertAfter(targetBlock: Block, newBlock: Block): void {
    const index = this.blocks.indexOf(targetBlock);

    this.insert(index + 1, newBlock);
  }

  /**
   * Get Block by index
   * @param {number} index — Block index
   * @returns {Block}
   */
  public get(index: number): Block | undefined {
    return this.blocks[index];
  }

  /**
   * Return index of passed Block
   * @param {Block} block - Block to find
   * @returns {number}
   */
  public indexOf(block: Block): number {
    return this.blocks.indexOf(block);
  }

  /**
   * Add a block to the internal array at the given index WITHOUT inserting
   * its holder into the DOM. Use {@link activateBlock} later to place it
   * into the DOM and fire the RENDERED lifecycle hook.
   *
   * This is used during batch-add (undo of hierarchical blocks) so that all
   * blocks exist in the array before any lifecycle hooks run.
   */
  public addToArray(index: number, block: Block): void {
    /**
     * Invalid-index guard (regression: wrong-block-dropped family).
     * Same splice(-1, 0) vulnerability as Blocks.move/insert/insertMany.
     * yjs-sync batch-add calls this during undo of hierarchical blocks;
     * negative input would silently corrupt the flat array.
     */
    if (index < 0) {
      return;
    }

    const insertIndex = index > this.length ? this.length : index;

    this.blocks.splice(insertIndex, 0, block);
  }

  /**
   * Activate a block that was previously added via {@link addToArray}.
   *
   * If the block's holder already has a parent element (e.g. a parent tool's
   * `rendered()` moved it into a cell container), only the RENDERED
   * lifecycle hook is called. Otherwise the holder is positioned in the
   * working area relative to the adjacent block in the array.
   */
  public activateBlock(block: Block): void {
    if (block.holder.parentElement !== null) {
      block.call(BlockToolAPI.RENDERED);

      return;
    }

    const index = this.blocks.indexOf(block);

    if (index > 0) {
      const previousBlock = this.blocks[index - 1];

      this.insertToDOM(block, 'afterend', previousBlock);

      return;
    }

    // At index 0: find the first subsequent block whose holder is already
    // in the DOM and insert before it, matching the insert() method logic.
    const nextMounted = this.blocks.slice(index + 1).find(
      (b) => b.holder.parentElement !== null
    );

    if (nextMounted) {
      this.insertToDOM(block, 'beforebegin', nextMounted);

      return;
    }

    this.insertToDOM(block);
  }

  /**
   * Insert new Block into DOM
   * @param {Block} block - Block to insert
   * @param {InsertPosition} position — insert position (if set, will use insertAdjacentElement)
   * @param {Block} target — Block related to position
   */
  private insertToDOM(block: Block, position?: InsertPosition, target?: Block): void {
    if (!position || target === undefined) {
      this.workingArea.appendChild(block.holder);
      block.call(BlockToolAPI.RENDERED);

      return;
    }

    target.holder.insertAdjacentElement(position, block.holder);
    block.call(BlockToolAPI.RENDERED);
  }

  /**
   * When the previous block in the flat array is nested (e.g., a table cell
   * paragraph), inserting after its top-level ancestor would place content
   * mid-article. Instead, find the next top-level block at or after the
   * insertion index and insert before it, or append to workingArea if none.
   */
  private insertAfterNestedBlock(fragment: DocumentFragment, index: number): void {
    const nextTopLevel = this.blocks.slice(index).find(
      (b) => b.holder.parentElement === this.workingArea
    );

    if (nextTopLevel !== undefined) {
      nextTopLevel.holder.before(fragment);

      return;
    }

    this.workingArea.appendChild(fragment);
  }

  /**
   * Move a block's holder in the DOM to the position indicated by toIndex in the
   * post-splice flat array. Inserts directly before the next block's holder
   * (without walking up to the workingArea root), so nested blocks are handled
   * correctly — the moved block lands at the exact DOM position, not after the
   * root-level ancestor of a nested reference block.
   *
   * @param block - Block whose holder to move
   * @param toIndex - Target index in the post-splice blocks array
   */
  private moveHolderInDOM(block: Block, toIndex: number): void {
    const nextBlock = this.blocks[toIndex];

    if (nextBlock === undefined) {
      this.workingArea.appendChild(block.holder);
    } else if (block.holder.contains(nextBlock.holder)) {
      // Self-reference: next block is nested inside the block being moved
      // (e.g. moving a toggle forward; blocks[toIndex] is one of its children).
      // Use the next workingArea sibling to avoid undefined DOM behavior.
      const nextSibling = block.holder.nextElementSibling;

      if (nextSibling !== null) {
        nextSibling.insertAdjacentElement('beforebegin', block.holder);
      }
    } else {
      nextBlock.holder.insertAdjacentElement('beforebegin', block.holder);
    }

    block.call(BlockToolAPI.RENDERED);
  }

  /**
   * After moving a block in the flat array, ensure that any blocks whose holders
   * are physically nested inside the moved block's holder immediately follow it
   * in the flat array. This keeps the array order consistent with DOM nesting.
   *
   * @param block - The block that was just moved
   * @param blockIndex - Current index of the block in this.blocks
   */
  private resortNestedBlocks(block: Block, blockIndex: number): void {
    const nested: Block[] = [];
    const indices: number[] = [];

    this.blocks.forEach((b, i) => {
      if (i !== blockIndex && block.holder.contains(b.holder)) {
        nested.push(b);
        indices.push(i);
      }
    });

    if (nested.length === 0) {
      return;
    }

    // Remove from current positions — highest index first to avoid index shifting
    [...indices].sort((a, b) => b - a).forEach((i) => this.blocks.splice(i, 1));

    // Find block's new index (may have shifted after removals) and re-insert right after it
    const newIdx = this.blocks.indexOf(block);

    this.blocks.splice(newIdx + 1, 0, ...nested);
  }

}
