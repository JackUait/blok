/**
 * @class BlockRepository
 * @classdesc Query methods for accessing blocks - read-only operations
 * @module BlockRepository
 */
import type { Block } from '../../block';
import { DATA_ATTR, createSelector } from '../../constants';
import { Dom as $ } from '../../dom';

import type { BlocksStore } from './types';

/**
 * BlockRepository provides read-only access to blocks
 * All methods are queries without side effects
 */
export class BlockRepository {
  /**
   * The proxied Blocks storage
   */
  private _blocks: BlocksStore | null = null;

  /**
   * Initialize the repository with a blocks store
   * @param blocks - The blocks store to query
   */
  public initialize(blocks: BlocksStore): void {
    this._blocks = blocks;
  }

  /**
   * Returns the proxied Blocks storage ensuring it is initialized.
   * @throws {Error} if the storage is not initialized.
   */
  private get blocksStore(): BlocksStore {
    if (this._blocks === null) {
      throw new Error('BlockRepository: blocks store is not initialized. Call initialize() before accessing blocks.');
    }
    return this._blocks;
  }

  /**
   * Get array of Block instances
   * @returns {Block[]} Array of all blocks
   */
  public get blocks(): Block[] {
    return this.blocksStore.array;
  }

  /**
   * Returns first Block
   * @returns {Block | undefined}
   */
  public get firstBlock(): Block | undefined {
    return this.blocksStore[0];
  }

  /**
   * Returns last Block
   * @returns {Block | undefined}
   */
  public get lastBlock(): Block | undefined {
    return this.blocksStore[this.blocksStore.length - 1];
  }

  /**
   * Get the length of the blocks array
   * @returns {number}
   */
  public get length(): number {
    return this.blocksStore.length;
  }

  /**
   * Returns Block by passed index
   * @param index - index to get. -1 to get last
   * @returns {Block | undefined}
   */
  public getBlockByIndex(index: number): Block | undefined {
    const targetIndex = index === -1
      ? this.blocksStore.length - 1
      : index;

    return this.blocksStore[targetIndex];
  }

  /**
   * Returns an index for passed Block
   * @param block - block to find index
   * @returns {number} index of the block, or -1 if not found
   */
  public getBlockIndex(block: Block): number {
    return this.blocksStore.indexOf(block);
  }

  /**
   * Returns the Block by passed id
   * @param id - id of block to get
   * @returns {Block | undefined}
   */
  public getBlockById(id: string): Block | undefined {
    return this.blocksStore.array.find((block) => block.id === id);
  }

  /**
   * Get Block instance by html element
   * @param element - html element to get Block by
   * @returns {Block | undefined}
   */
  public getBlock(element: HTMLElement | null | undefined): Block | undefined {
    if (!element) {
      return undefined;
    }

    const normalizedElement = ($.isElement(element) ? element : (element as Node).parentNode) as HTMLElement | null;

    if (!normalizedElement) {
      return undefined;
    }

    const nodes = this.blocksStore.nodes;

    const firstLevelBlock = normalizedElement.closest(createSelector(DATA_ATTR.element));

    if (!firstLevelBlock) {
      return undefined;
    }

    const index = nodes.indexOf(firstLevelBlock as HTMLElement);

    if (index >= 0) {
      return this.blocksStore[index];
    }

    return undefined;
  }

  /**
   * Return block which contents passed node
   * @param childNode - node to get Block by
   * @returns {Block | undefined}
   */
  public getBlockByChildNode(childNode: Node): Block | undefined {
    if (!(childNode instanceof Node)) {
      return undefined;
    }

    /**
     * If node is Text TextNode
     */
    const normalizedChildNode = ($.isElement(childNode) ? childNode : childNode.parentNode) as HTMLElement | null;

    if (!normalizedChildNode) {
      return undefined;
    }

    const firstLevelBlock = normalizedChildNode.closest(createSelector(DATA_ATTR.element));

    if (!firstLevelBlock) {
      return undefined;
    }

    return this.blocks.find((block) => block.holder === firstLevelBlock);
  }

  /**
   * Check if the given index is valid
   * @param index - index of blocks array to validate
   * @returns {boolean}
   */
  public validateIndex(index: number): boolean {
    return !(index < 0 || index >= this.blocksStore.length);
  }

  /**
   * Check if each Block is empty
   * @returns {boolean}
   */
  public isBlokEmpty(): boolean {
    return this.blocks.every((block) => block.isEmpty);
  }

  /**
   * Return first Block with inputs after current Block
   * @param currentBlockIndex - current block index
   * @returns {Block | undefined}
   */
  public getNextContentfulBlock(currentBlockIndex: number): Block | undefined {
    const nextBlocks = this.blocks.slice(currentBlockIndex + 1);

    return nextBlocks.find((block) => !!block.inputs.length);
  }

  /**
   * Return first Block with inputs before current Block
   * @param currentBlockIndex - current block index
   * @returns {Block | undefined}
   */
  public getPreviousContentfulBlock(currentBlockIndex: number): Block | undefined {
    const previousBlocks = this.blocks.slice(0, currentBlockIndex).reverse();

    return previousBlocks.find((block) => !!block.inputs.length);
  }

  /**
   * Get block at a specific index from the blocks store nodes array
   * @param index - the index
   * @returns {Block | undefined}
   */
  public getBlockAtNodeIndex(index: number): Block | undefined {
    return this.blocksStore[index];
  }
}
