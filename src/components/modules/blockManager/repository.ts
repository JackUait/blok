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
   * Blocks that live at the document root (no parent container).
   *
   * The flat store is NOT the document: nested-block tools (table, columns,
   * toggle, callout) keep their children in the same array, appended at its
   * TAIL. Anything that means "the document's blocks" must read this, never
   * the raw array.
   * @returns {Block[]} top-level blocks in document order
   */
  public get topLevelBlocks(): Block[] {
    return this.blocksStore.array.filter((block) => block.parentId === null);
  }

  /**
   * Returns the last TOP-LEVEL Block, i.e. the last block of the document.
   *
   * Deliberately NOT the tail of the flat store: a document ending in a table
   * has that table's bottom-right cell paragraph as the flat tail, and every
   * consumer of `lastBlock` (bottom-zone click, Caret.setToTheLastBlock,
   * api.caret.setToLastBlock, the toolbar's trailing-paragraph guard) means the
   * end of the DOCUMENT, not the end of the store.
   * @returns {Block | undefined}
   */
  public get lastBlock(): Block | undefined {
    const topLevel = this.topLevelBlocks;

    return topLevel[topLevel.length - 1];
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

    const firstLevelBlock = normalizedElement.closest(createSelector(DATA_ATTR.element));

    if (!firstLevelBlock) {
      return undefined;
    }

    return this.blocks.find((block) => block.holder === firstLevelBlock);
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
   * Walks up the parentId chain and returns the top-level (root) block.
   * If the block has no parent, returns it as-is.
   * Used by selection modules to treat hierarchical blocks (e.g. table cells)
   * as a single unit rather than selecting child blocks individually.
   * @param block - the block to resolve
   * @returns {Block} the root ancestor block
   */
  public resolveToRootBlock(block: Block): Block {
    if (block.parentId === null) {
      return block;
    }

    const parent = this.getBlockById(block.parentId);

    if (parent === undefined) {
      return block;
    }

    return this.resolveToRootBlock(parent);
  }

  /**
   * The block a selection gesture aimed at `block` actually targets.
   *
   * The model twin of the toolbar's pointer→block resolution
   * (`resolveHoveredBlockWrapper`, src/components/modules/uiControllers/
   * hovered-block-resolution.ts): the DEEPEST block owns the row, except that a
   * block living inside a tool-owned container is represented by that container.
   * `tool.ownsChildren` names exactly those containers — a table's `contentIds`
   * ARE its cell blocks — while a toggle's, callout's or column's children are
   * plain user content and stay first-class.
   *
   * This is NOT {@link resolveToRootBlock}: a table nested in a toggle heading
   * resolves to the TABLE, not to the heading. Resolving to the top-level
   * ancestor is what made a lasso beside a table select the whole toggle
   * section, while the ⠿ handle on the same row pointed at the table.
   *
   * Column layout is the exception: `column_list` owns its columns, but a
   * column's children are the selectable units, so the walk stops there (and
   * {@link isSelectionUnit} rejects the two containers outright).
   * @param block - the block a gesture landed on
   * @returns {Block} the block that owns the gesture
   */
  public resolveToSelectableBlock(block: Block): Block {
    if (block.parentId === null) {
      return block;
    }

    const parent = this.getBlockById(block.parentId);

    if (parent === undefined || !parent.tool.ownsChildren || BlockRepository.isColumnLayout(parent)) {
      return block;
    }

    return this.resolveToSelectableBlock(parent);
  }

  /**
   * Whether the block is a unit a selection gesture may target on its own.
   * @param block - the block to test
   * @returns {boolean}
   */
  public isSelectionUnit(block: Block): boolean {
    return this.resolveToSelectableBlock(block) === block && !BlockRepository.isColumnLayout(block);
  }

  /**
   * The blocks a range gesture (Shift+Click, cross-block drag, Shift+Arrow)
   * spanning `anchor`→`target` selects.
   *
   * Both endpoints are resolved to selection units and then lifted to SIBLINGS
   * under their lowest common ancestor, and the run between those siblings is
   * returned. Walking the flat array between two indices instead selects every
   * block stored in between — which, for a range that crosses a container,
   * means the container AND its children, so Duplicate duplicates the subtree
   * twice and Delete removes blocks the user never highlighted.
   *
   * When one endpoint contains the other, the container alone is returned: it
   * already represents its whole subtree.
   * @param anchor - the block the gesture started on
   * @param target - the block the gesture currently reaches
   * @returns {Block[]} the blocks to select, in document order
   */
  public getSelectionSiblingRange(anchor: Block, target: Block): Block[] {
    const from = this.resolveToSelectableBlock(anchor);
    const to = this.resolveToSelectableBlock(target);

    if (from === to) {
      return this.expandToSelectionUnits(from);
    }

    const fromChain = this.ancestorChain(from);
    const toChain = this.ancestorChain(to);

    if (toChain.includes(from)) {
      return this.expandToSelectionUnits(from);
    }

    if (fromChain.includes(to)) {
      return this.expandToSelectionUnits(to);
    }

    const toIds = new Set(toChain.map((block) => block.id));
    const commonAncestor = fromChain.find((block) => toIds.has(block.id)) ?? null;

    const fromSibling = BlockRepository.siblingUnder(fromChain, commonAncestor);
    const toSibling = BlockRepository.siblingUnder(toChain, commonAncestor);
    const siblings = this.blocks.filter((block) => block.parentId === (commonAncestor?.id ?? null));

    const fromIndex = siblings.indexOf(fromSibling);
    const toIndex = siblings.indexOf(toSibling);

    if (fromIndex === -1 || toIndex === -1) {
      return [...this.expandToSelectionUnits(from), ...this.expandToSelectionUnits(to)];
    }

    return siblings
      .slice(Math.min(fromIndex, toIndex), Math.max(fromIndex, toIndex) + 1)
      .flatMap((block) => this.expandToSelectionUnits(block));
  }

  /**
   * The block on `chain` that is a direct child of `commonAncestor` (or the
   * chain's outermost block when the two endpoints share no ancestor).
   * @param chain - a block's ancestor chain, innermost first
   * @param commonAncestor - the lowest ancestor both endpoints share, or null for the document root
   */
  private static siblingUnder(chain: Block[], commonAncestor: Block | null): Block {
    if (commonAncestor === null) {
      return chain[chain.length - 1];
    }

    return chain[chain.indexOf(commonAncestor) - 1];
  }

  /**
   * The block itself when it is a selection unit, otherwise the units it holds
   * — a column layout container is never selected, its blocks are.
   * @param block - the block to expand
   */
  private expandToSelectionUnits(block: Block): Block[] {
    if (this.isSelectionUnit(block)) {
      return [block];
    }

    return this.blocks
      .filter((candidate) => candidate.parentId === block.id)
      .flatMap((candidate) => this.expandToSelectionUnits(candidate));
  }

  /**
   * A block and its ancestors, innermost first. Guards against a corrupted
   * parentId cycle by never visiting a block twice.
   * @param block - the block to walk up from
   */
  private ancestorChain(block: Block, seen: Set<string> = new Set<string>()): Block[] {
    if (seen.has(block.id)) {
      return [];
    }

    seen.add(block.id);

    const parent = block.parentId === null ? undefined : this.getBlockById(block.parentId);

    return parent === undefined ? [block] : [block, ...this.ancestorChain(parent, seen)];
  }

  /**
   * Column layout containers, which never own a toolbar, a drag handle or a
   * selection — only the blocks inside a column do. Mirrors
   * `BlockHoverController.isColumnContainer`.
   * @param block - the block to test
   */
  private static isColumnLayout(block: Block): boolean {
    return block.name === 'column' || block.name === 'column_list';
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
