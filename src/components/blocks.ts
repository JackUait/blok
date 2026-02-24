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
  public move(toIndex: number, fromIndex: number, skipDOM = false): void {
    /**
     * cut out the block, move the DOM element and insert at the desired index
     * again (the shifting within the blocks array will happen automatically).
     * @see https://stackoverflow.com/a/44932690/1238150
     */
    const block = this.blocks.splice(fromIndex, 1)[0];

    if (!skipDOM) {
      const previousBlockIndex = Math.max(0, toIndex - 1);
      const position: InsertPosition = toIndex > 0 ? 'afterend' : 'beforebegin';

      this.moveHolderInDOM(block, this.blocks[previousBlockIndex].holder, position);
    }

    // move in array
    this.blocks.splice(toIndex, 0, block);

    // invoke hook
    block.call(BlockToolAPI.MOVED, {
      fromIndex,
      toIndex,
    });
  }

  /**
   * Insert new Block at passed index
   * @param {number} index — index to insert Block
   * @param {Block} block — Block to insert
   * @param {boolean} replace — it true, replace block on given index
   */
  public insert(index: number, block: Block, replace = false, appendToWorkingArea = false): void {
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

    prevBlock.holder.replaceWith(block.holder);
    prevBlock.call(BlockToolAPI.REMOVED);

    this.blocks[index] = block;

    block.call(BlockToolAPI.RENDERED);
  }

  /**
   * Inserts several blocks at once
   * @param blocks - blocks to insert
   * @param index - index to insert blocks at
   */
  public insertMany(blocks: Block[], index: number ): void {
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

      previousBlock.holder.after(fragment);
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
    this.workingArea.innerHTML = '';

    this.blocks.forEach((block) => block.call(BlockToolAPI.REMOVED));

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

    const referenceNode = this.findWorkingAreaChild(target.holder);

    if (referenceNode !== null) {
      referenceNode.insertAdjacentElement(position, block.holder);
    } else {
      this.workingArea.appendChild(block.holder);
    }

    block.call(BlockToolAPI.RENDERED);
  }

  /**
   * Walk from an element up to find the ancestor that is a direct child of workingArea.
   * If the element itself is a direct child, returns the element.
   * Returns null if the element is not inside workingArea.
   *
   * @param element - Starting element to walk up from
   * @returns Direct child of workingArea, or null
   */
  /**
   * Move a block's holder in the DOM relative to a reference element.
   * If the reference is nested inside a container (e.g. a table cell),
   * walks up to find the workingArea-level ancestor and inserts relative to that.
   *
   * @param block - Block whose holder to move
   * @param referenceHolder - The reference element to position relative to
   * @param position - Where to insert relative to the reference
   */
  private moveHolderInDOM(block: Block, referenceHolder: Element, position: InsertPosition): void {
    const referenceNode = this.findWorkingAreaChild(referenceHolder);

    if (referenceNode !== null) {
      referenceNode.insertAdjacentElement(position, block.holder);
    } else {
      this.workingArea.appendChild(block.holder);
    }

    block.call(BlockToolAPI.RENDERED);
  }

  private findWorkingAreaChild(element: Element): Element | null {
    if (element.parentElement === this.workingArea) {
      return element;
    }

    if (element.parentElement === null) {
      return null;
    }

    return this.findWorkingAreaChild(element.parentElement);
  }
}
