/**
 * @class BlockManager
 * @classdesc Manage blok`s blocks storage and appearance
 * @module BlockManager
 * @version 2.0.0
 */
import { Block, BlockToolAPI } from '../block';
import { Module } from '../__module';
import { Dom as $ } from '../dom';
import * as _ from '../utils';
import { Blocks } from '../blocks';
import type { BlockToolData, PasteEvent, SanitizerConfig } from '../../../types';
import type { BlockTuneData } from '../../../types/block-tunes/block-tune-data';
import { BlockAPI } from '../block/api';
import type { BlockMutationEventMap, BlockMutationType } from '../../../types/events/block';
import { BlockRemovedMutationType } from '../../../types/events/block/BlockRemoved';
import { BlockAddedMutationType } from '../../../types/events/block/BlockAdded';
import { BlockMovedMutationType } from '../../../types/events/block/BlockMoved';
import { BlockChangedMutationType } from '../../../types/events/block/BlockChanged';
import { BlockChanged } from '../events';
import { clean, composeSanitizerConfig, sanitizeBlocks } from '../utils/sanitizer';
import { convertStringToBlockData, isBlockConvertable } from '../utils/blocks';
import { PromiseQueue } from '../utils/promise-queue';
import { DATA_ATTR, createSelector } from '../constants';
import { Shortcuts } from '../utils/shortcuts';
import { announce } from '../utils/announcer';

type BlocksStore = Blocks & {
  [index: number]: Block | undefined;
};

/**
 * @typedef {BlockManager} BlockManager
 * @property {number} currentBlockIndex - Index of current working block
 * @property {Proxy} _blocks - Proxy for Blocks instance {@link Blocks}
 */
export class BlockManager extends Module {
  /**
   * Returns current Block index
   * @returns {number}
   */
  public get currentBlockIndex(): number {
    return this._currentBlockIndex;
  }

  /**
   * Set current Block index and fire Block lifecycle callbacks
   * @param {number} newIndex - index of Block to set as current
   */
  public set currentBlockIndex(newIndex: number) {
    this._currentBlockIndex = newIndex;
  }

  /**
   * returns first Block
   * @returns {Block}
   */
  public get firstBlock(): Block | undefined {
    return this.blocksStore[0];
  }

  /**
   * returns last Block
   * @returns {Block}
   */
  public get lastBlock(): Block | undefined {
    return this.blocksStore[this.blocksStore.length - 1];
  }

  /**
   * Get current Block instance
   * @returns {Block}
   */
  public get currentBlock(): Block | undefined {
    return this.blocksStore[this.currentBlockIndex];
  }

  /**
   * Set passed Block as a current
   * @param block - block to set as a current
   */
  public set currentBlock(block: Block | undefined) {
    if (block === undefined) {
      this.unsetCurrentBlock();

      return;
    }

    this.currentBlockIndex = this.getBlockIndex(block);
  }

  /**
   * Returns next Block instance
   * @returns {Block|null}
   */
  public get nextBlock(): Block | null {
    const isLastBlock = this.currentBlockIndex === (this.blocksStore.length - 1);

    if (isLastBlock) {
      return null;
    }

    const nextBlock = this.blocksStore[this.currentBlockIndex + 1];

    return nextBlock ?? null;
  }

  /**
   * Return first Block with inputs after current Block
   * @returns {Block | undefined}
   */
  public get nextContentfulBlock(): Block | undefined {
    const nextBlocks = this.blocks.slice(this.currentBlockIndex + 1);

    return nextBlocks.find((block) => !!block.inputs.length);
  }

  /**
   * Return first Block with inputs before current Block
   * @returns {Block | undefined}
   */
  public get previousContentfulBlock(): Block | undefined {
    const previousBlocks = this.blocks.slice(0, this.currentBlockIndex).reverse();

    return previousBlocks.find((block) => !!block.inputs.length);
  }

  /**
   * Returns previous Block instance
   * @returns {Block|null}
   */
  public get previousBlock(): Block | null {
    const isFirstBlock = this.currentBlockIndex === 0;

    if (isFirstBlock) {
      return null;
    }

    const previousBlock = this.blocksStore[this.currentBlockIndex - 1];

    return previousBlock ?? null;
  }

  /**
   * Get array of Block instances
   * @returns {Block[]} {@link Blocks#array}
   */
  public get blocks(): Block[] {
    return this.blocksStore.array;
  }

  /**
   * Check if each Block is empty
   * @returns {boolean}
   */
  public get isBlokEmpty(): boolean {
    return this.blocks.every((block) => block.isEmpty);
  }

  /**
   * Index of current working block
   * @type {number}
   */
  private _currentBlockIndex = -1;

  /**
   * Proxy for Blocks instance {@link Blocks}
   * @type {Proxy}
   * @private
   */
  private _blocks: BlocksStore | null = null;

  /**
   * Registered keyboard shortcut names for cleanup
   */
  private registeredShortcuts: string[] = [];

  /**
   * Should be called after Blok.UI preparation
   * Define this._blocks property
   */
  public prepare(): void {
    const blocks = new Blocks(this.Blok.UI.nodes.redactor);
    /**
     * We need to use Proxy to overload set/get [] operator.
     * So we can use array-like syntax to access blocks
     * @example
     * this._blocks[0] = new Block(...);
     *
     * block = this._blocks[0];
     * @todo proxy the enumerate method
     * @type {Proxy}
     * @private
     */
    this._blocks = new Proxy(blocks, {
      set: Blocks.set,
      get: Blocks.get,
    }) as BlocksStore;

    /** Copy event */
    this.listeners.on(
      document,
      'copy',
      (event: Event) => {
        this.Blok.BlockEvents.handleCommandC(event as ClipboardEvent);
      }
    );

    this.setupKeyboardShortcuts();
  }

  /**
   * Toggle read-only state
   *
   * If readOnly is true:
   * - Unbind event handlers from created Blocks
   *
   * if readOnly is false:
   * - Bind event handlers to all existing Blocks
   * @param {boolean} readOnlyEnabled - "read only" state
   */
  public toggleReadOnly(readOnlyEnabled: boolean): void {
    if (!readOnlyEnabled) {
      this.enableModuleBindings();
    } else {
      this.disableModuleBindings();
    }
  }

  /**
   * Creates Block instance by tool name
   * @param {object} options - block creation options
   * @param {string} options.tool - tools passed in blok config {@link BlokConfig#tools}
   * @param {string} [options.id] - unique id for this block
   * @param {BlockToolData} [options.data] - constructor params
   * @param {string} [options.parentId] - parent block id for hierarchical structure
   * @param {string[]} [options.contentIds] - array of child block ids
   * @returns {Block}
   */
  public composeBlock({
    tool: name,
    data = {},
    id = undefined,
    tunes: tunesData = {},
    parentId,
    contentIds,
  }: {
    tool: string;
    id?: string;
    data?: BlockToolData;
    tunes?: {[name: string]: BlockTuneData};
    parentId?: string;
    contentIds?: string[];
  }): Block {
    const readOnly = this.Blok.ReadOnly.isEnabled;
    const tool = this.Blok.Tools.blockTools.get(name);

    if (tool === undefined) {
      throw new Error(`Could not compose Block. Tool «${name}» not found.`);
    }

    const block = new Block({
      id,
      data,
      tool,
      api: this.Blok.API,
      readOnly,
      tunesData,
      parentId,
      contentIds,
    }, this.eventsDispatcher);

    if (!readOnly) {
      window.requestIdleCallback(() => {
        this.bindBlockEvents(block);
      }, { timeout: 2000 });
    }

    return block;
  }

  /**
   * Insert new block into _blocks
   * @param {object} options - insert options
   * @param {string} [options.id] - block's unique id
   * @param {string} [options.tool] - plugin name, by default method inserts the default block type
   * @param {object} [options.data] - plugin data
   * @param {number} [options.index] - index where to insert new Block
   * @param {boolean} [options.needToFocus] - flag shows if needed to update current Block index
   * @param {boolean} [options.replace] - flag shows if block by passed index should be replaced with inserted one
   * @returns {Block}
   */
  public insert({
    id = undefined,
    tool,
    data,
    index,
    needToFocus = true,
    replace = false,
    tunes,
  }: {
    id?: string;
    tool?: string;
    data?: BlockToolData;
    index?: number;
    needToFocus?: boolean;
    replace?: boolean;
    tunes?: {[name: string]: BlockTuneData};
  } = {}): Block {
    const targetIndex = index ?? this.currentBlockIndex + (replace ? 0 : 1);
    const toolName = tool ?? this.config.defaultBlock;

    if (toolName === undefined) {
      throw new Error('Could not insert Block. Tool name is not specified.');
    }

    const composeOptions: {
      tool: string;
      id?: string;
      data?: BlockToolData;
      tunes?: {[name: string]: BlockTuneData};
    } = {
      tool: toolName,
    };

    if (id !== undefined) {
      composeOptions.id = id;
    }

    if (data !== undefined) {
      composeOptions.data = data;
    }

    if (tunes !== undefined) {
      composeOptions.tunes = tunes;
    }

    const block = this.composeBlock(composeOptions);

    /**
     * In case of block replacing (Converting OR from Toolbox or Shortcut on empty block OR on-paste to empty block)
     * we need to dispatch the 'block-removing' event for the replacing block
     */
    const blockToReplace = replace ? this.getBlockByIndex(targetIndex) : undefined;

    if (replace && blockToReplace === undefined) {
      throw new Error(`Could not replace Block at index ${targetIndex}. Block not found.`);
    }

    if (replace && blockToReplace !== undefined) {
      this.blockDidMutated(BlockRemovedMutationType, blockToReplace, {
        index: targetIndex,
      });
    }

    this.blocksStore.insert(targetIndex, block, replace);

    /**
     * Force call of didMutated event on Block insertion
     */
    this.blockDidMutated(BlockAddedMutationType, block, {
      index: targetIndex,
    });

    if (needToFocus) {
      this.currentBlockIndex = targetIndex;
    }

    if (!needToFocus && targetIndex <= this.currentBlockIndex) {
      this.currentBlockIndex++;
    }

    return block;
  }

  /**
   * Inserts several blocks at once
   * @param blocks - blocks to insert
   * @param index - index where to insert
   */
  public insertMany(blocks: Block[], index = 0): void {
    this.blocksStore.insertMany(blocks, index);

    // Apply indentation for blocks with parentId (hierarchical structure)
    blocks.forEach(block => {
      if (block.parentId !== null) {
        this.updateBlockIndentation(block);
      }
    });
  }

  /**
   * Update Block data.
   *
   * Currently we don't have an 'update' method in the Tools API, so we just create a new block with the same id and type
   * Should not trigger 'block-removed' or 'block-added' events.
   *
   * If neither data nor tunes is provided, return the provided block instead.
   * @param block - block to update
   * @param data - (optional) new data
   * @param tunes - (optional) tune data
   */
  public async update(block: Block, data?: Partial<BlockToolData>, tunes?: {[name: string]: BlockTuneData}): Promise<Block> {
    if (!data && !tunes) {
      return block;
    }

    const existingData = await block.data;

    const newBlock = this.composeBlock({
      id: block.id,
      tool: block.name,
      data: Object.assign({}, existingData, data ?? {}),
      tunes: tunes ?? block.tunes,
    });

    const blockIndex = this.getBlockIndex(block);

    this.blocksStore.replace(blockIndex, newBlock);

    this.blockDidMutated(BlockChangedMutationType, newBlock, {
      index: blockIndex,
    });

    return newBlock;
  }

  /**
   * Replace passed Block with the new one with specified Tool and data
   * @param block - block to replace
   * @param newTool - new Tool name
   * @param data - new Tool data
   */
  public replace(block: Block, newTool: string, data: BlockToolData): Block {
    const blockIndex = this.getBlockIndex(block);

    return this.insert({
      tool: newTool,
      data,
      index: blockIndex,
      replace: true,
    });
  }

  /**
   * Returns the proxied Blocks storage ensuring it is initialized.
   * @throws {Error} if the storage is not prepared.
   */
  private get blocksStore(): BlocksStore {
    if (this._blocks === null) {
      throw new Error('BlockManager: blocks store is not initialized. Call prepare() before accessing blocks.');
    }

    return this._blocks;
  }

  /**
   * Insert pasted content. Call onPaste callback after insert.
   * @param {string} toolName - name of Tool to insert
   * @param {PasteEvent} pasteEvent - pasted data
   * @param {boolean} replace - should replace current block
   */
  public async paste(
    toolName: string,
    pasteEvent: PasteEvent,
    replace = false
  ): Promise<Block> {
    const block = this.insert({
      tool: toolName,
      replace,
    });

    try {
      /**
       * We need to call onPaste after Block will be ready
       * because onPaste could change tool's root element, and we need to do that after block.watchBlockMutations() bound
       * to detect tool root element change
       * @todo make this.insert() awaitable and remove requestIdleCallback
       */
      await block.ready;
      block.call(BlockToolAPI.ON_PASTE, pasteEvent);

      /**
       * onPaste might cause the tool to replace its root element (e.g., Header changing level).
       * Since mutation observers are set up asynchronously via requestIdleCallback,
       * we need to manually refresh the tool element reference here.
       */
      block.refreshToolRootElement();
    } catch (e) {
      _.log(`${toolName}: onPaste callback call is failed`, 'error', e);
    }

    return block;
  }

  /**
   * Insert new default block at passed index
   * @param {number} index - index where Block should be inserted
   * @param {boolean} needToFocus - if true, updates current Block index
   *
   * TODO: Remove method and use insert() with index instead (?)
   * @returns {Block} inserted Block
   */
  public insertDefaultBlockAtIndex(index: number, needToFocus = false): Block {
    const defaultTool = this.config.defaultBlock;

    if (defaultTool === undefined) {
      throw new Error('Could not insert default Block. Default block tool is not defined in the configuration.');
    }

    return this.insert({
      tool: defaultTool,
      index,
      needToFocus,
    });
  }

  /**
   * Always inserts at the end
   * @returns {Block}
   */
  public insertAtEnd(): Block {
    /**
     * Define new value for current block index
     */
    this.currentBlockIndex = this.blocks.length - 1;

    /**
     * Insert the default typed block
     */
    return this.insert();
  }

  /**
   * Merge two blocks
   * @param {Block} targetBlock - previous block will be append to this block
   * @param {Block} blockToMerge - block that will be merged with target block
   * @returns {Promise} - the sequence that can be continued
   */
  public async mergeBlocks(targetBlock: Block, blockToMerge: Block): Promise<void> {
    const completeMerge = async (data: BlockToolData): Promise<void> => {
      await targetBlock.mergeWith(data);
      await this.removeBlock(blockToMerge);
      this.currentBlockIndex = this.blocksStore.indexOf(targetBlock);
    };

    /**
     * We can merge:
     * 1) Blocks with the same Tool if tool provides merge method
     */
    const canMergeBlocksDirectly = targetBlock.name === blockToMerge.name && targetBlock.mergeable;
    const blockToMergeDataRaw = canMergeBlocksDirectly ? await blockToMerge.data : undefined;

    if (canMergeBlocksDirectly && _.isEmpty(blockToMergeDataRaw)) {
      console.error('Could not merge Block. Failed to extract original Block data.');

      return;
    }

    if (canMergeBlocksDirectly && blockToMergeDataRaw !== undefined) {
      const [ cleanBlock ] = sanitizeBlocks(
        [ { data: blockToMergeDataRaw,
          tool: blockToMerge.name } ],
        targetBlock.tool.sanitizeConfig,
        this.config.sanitizer as SanitizerConfig
      );

      await completeMerge(cleanBlock.data);

      return;
    }

    /**
     * 2) Blocks with different Tools if they provides conversionConfig
     */
    if (targetBlock.mergeable && isBlockConvertable(blockToMerge, 'export') && isBlockConvertable(targetBlock, 'import')) {
      const blockToMergeDataStringified = await blockToMerge.exportDataAsString();

      /**
       * Extract the field-specific sanitize rules for the field that will receive the imported content.
       */
      const importProp = targetBlock.tool.conversionConfig?.import;
      const fieldSanitizeConfig = _.isString(importProp) && _.isObject(targetBlock.tool.sanitizeConfig[importProp])
        ? targetBlock.tool.sanitizeConfig[importProp] as SanitizerConfig
        : targetBlock.tool.sanitizeConfig;

      const cleanData = clean(blockToMergeDataStringified, fieldSanitizeConfig);
      const blockToMergeData = convertStringToBlockData(cleanData, targetBlock.tool.conversionConfig);

      await completeMerge(blockToMergeData);
    }
  }

  /**
   * Remove passed Block
   * @param block - Block to remove
   * @param addLastBlock - if true, adds new default block at the end. @todo remove this logic and use event-bus instead
   */
  public removeBlock(block: Block, addLastBlock = true): Promise<void> {
    return new Promise((resolve) => {
      const index = this.blocksStore.indexOf(block);

      /**
       * If index is not passed and there is no block selected, show a warning
       */
      if (!this.validateIndex(index)) {
        throw new Error('Can\'t find a Block to remove');
      }

      this.blocksStore.remove(index);
      block.destroy();

      /**
       * Force call of didMutated event on Block removal
       */
      this.blockDidMutated(BlockRemovedMutationType, block, {
        index,
      });

      if (this.currentBlockIndex >= index) {
        this.currentBlockIndex--;
      }

      /**
       * If first Block was removed, insert new Initial Block and set focus on it`s first input
       */
      const noBlocksLeft = this.blocks.length === 0;

      if (noBlocksLeft) {
        this.unsetCurrentBlock();
      }

      if (noBlocksLeft && addLastBlock) {
        this.insert();
      }

      if (!noBlocksLeft && index === 0) {
        this.currentBlockIndex = 0;
      }

      resolve();
    });
  }

  /**
   * Remove only selected Blocks
   * and returns first Block index where started removing...
   * @returns {number|undefined}
   */
  public removeSelectedBlocks(): number | undefined {
    const selectedBlockEntries = this.blocks
      .map((block, index) => ({
        block,
        index,
      }))
      .filter(({ block }) => block.selected)
      .sort((first, second) => second.index - first.index);

    selectedBlockEntries.forEach(({ block }) => {
      void this.removeBlock(block, false);
    });

    return selectedBlockEntries.length > 0
      ? selectedBlockEntries[selectedBlockEntries.length - 1].index
      : undefined;
  }

  /**
   * Attention!
   * After removing insert the new default typed Block and focus on it
   * Removes all blocks
   */
  public removeAllBlocks(): void {
    const removeBlockByIndex = (index: number): void => {
      if (index < 0) {
        return;
      }

      this.blocksStore.remove(index);
      removeBlockByIndex(index - 1);
    };

    removeBlockByIndex(this.blocksStore.length - 1);

    this.unsetCurrentBlock();
    this.insert();
    const currentBlock = this.currentBlock;
    const firstInput = currentBlock?.firstInput;

    if (firstInput !== undefined) {
      firstInput.focus();
    }
  }

  /**
   * Split current Block
   * 1. Extract content from Caret position to the Block`s end
   * 2. Insert a new Block below current one with extracted content
   * @returns {Block}
   */
  public split(): Block {
    const extractedFragment = this.Blok.Caret.extractFragmentFromCaretPosition();
    const wrapper = $.make('div');

    wrapper.appendChild(extractedFragment as DocumentFragment);

    /**
     * @todo make object in accordance with Tool
     */
    const data = {
      text: $.isEmpty(wrapper) ? '' : wrapper.innerHTML,
    };

    /**
     * Renew current Block
     * @type {Block}
     */
    return this.insert({ data });
  }

  /**
   * Returns Block by passed index
   *
   * If we pass -1 as index, the last block will be returned
   * There shouldn't be a case when there is no blocks at all — at least one always should exist
   */
  public getBlockByIndex(index: -1): Block;

  /**
   * Returns Block by passed index.
   *
   * Could return undefined if there is no block with such index
   */
  public getBlockByIndex(index: number): Block | undefined;

  /**
   * Returns Block by passed index
   * @param {number} index - index to get. -1 to get last
   * @returns {Block}
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
   */
  public getBlockIndex(block: Block): number {
    return this.blocksStore.indexOf(block);
  }

  /**
   * Returns the Block by passed id
   * @param id - id of block to get
   * @returns {Block}
   */
  public getBlockById(id: string): Block | undefined {
    return this.blocksStore.array.find((block) => block.id === id);
  }

  /**
   * Returns the depth (nesting level) of a block in the hierarchy.
   * Root-level blocks have depth 0.
   * @param block - the block to get depth for
   * @returns {number} - depth level (0 for root, 1 for first level children, etc.)
   */
  public getBlockDepth(block: Block): number {
    const calculateDepth = (parentId: string | null, currentDepth: number): number => {
      if (parentId === null) {
        return currentDepth;
      }

      const parentBlock = this.getBlockById(parentId);

      if (parentBlock === undefined) {
        return currentDepth;
      }

      return calculateDepth(parentBlock.parentId, currentDepth + 1);
    };

    return calculateDepth(block.parentId, 0);
  }

  /**
   * Sets the parent of a block, updating both the block's parentId and the parent's contentIds.
   * @param block - the block to reparent
   * @param newParentId - the new parent block id, or null for root level
   */
  public setBlockParent(block: Block, newParentId: string | null): void {
    const oldParentId = block.parentId;

    // Remove from old parent's contentIds
    const oldParent = oldParentId !== null ? this.getBlockById(oldParentId) : undefined;

    if (oldParent !== undefined) {
      oldParent.contentIds = oldParent.contentIds.filter(id => id !== block.id);
    }

    // Add to new parent's contentIds
    const newParent = newParentId !== null ? this.getBlockById(newParentId) : undefined;
    const shouldAddToNewParent = newParent !== undefined && !newParent.contentIds.includes(block.id);

    if (shouldAddToNewParent) {
      newParent.contentIds.push(block.id);
    }

    // Update block's parentId - parentId is a public mutable property on Block
    // eslint-disable-next-line no-param-reassign
    block.parentId = newParentId;

    // Update visual indentation
    this.updateBlockIndentation(block);
  }

  /**
   * Updates the visual indentation of a block based on its depth in the hierarchy.
   * @param block - the block to update indentation for
   */
  public updateBlockIndentation(block: Block): void {
    const depth = this.getBlockDepth(block);
    const indentationPx = depth * 24; // 24px per level
    const { holder } = block;

    holder.style.marginLeft = indentationPx > 0 ? `${indentationPx}px` : '';
    holder.setAttribute('data-blok-depth', depth.toString());
  }

  /**
   * Get Block instance by html element
   * @param {Node} element - html element to get Block by
   */
  public getBlock(element: HTMLElement): Block | undefined {
    const normalizedElement = (($.isElement(element) as boolean) ? element : element.parentNode) as HTMLElement | null;

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
   * 1) Find first-level Block from passed child Node
   * 2) Mark it as current
   * @param {Node} childNode - look ahead from this node.
   * @returns {Block | undefined} can return undefined in case when the passed child note is not a part of the current blok instance
   */
  public setCurrentBlockByChildNode(childNode: Node): Block | undefined {
    /**
     * If node is Text TextNode
     */
    const normalizedChildNode = ($.isElement(childNode) ? childNode : childNode.parentNode) as HTMLElement | null;

    if (!normalizedChildNode) {
      return undefined;
    }

    const parentFirstLevelBlock = normalizedChildNode.closest(createSelector(DATA_ATTR.element));

    if (!parentFirstLevelBlock) {
      return undefined;
    }

    /**
     * Support multiple Blok instances,
     * by checking whether the found block belongs to the current instance
     * @see {@link Ui#documentTouched}
     */
    const blokWrapper = parentFirstLevelBlock.closest(createSelector(DATA_ATTR.editor));
    const isBlockBelongsToCurrentInstance = blokWrapper?.isEqualNode(this.Blok.UI.nodes.wrapper);

    if (!isBlockBelongsToCurrentInstance) {
      return undefined;
    }

    /**
     * Update current Block's index
     * @type {number}
     */
    if (!(parentFirstLevelBlock instanceof HTMLElement)) {
      return undefined;
    }

    this.currentBlockIndex = this.blocksStore.nodes.indexOf(parentFirstLevelBlock);

    /**
     * Update current block active input
     */
    const currentBlock = this.currentBlock;

    currentBlock?.updateCurrentInput();

    return currentBlock;
  }

  /**
   * Return block which contents passed node
   * @param {Node} childNode - node to get Block by
   * @returns {Block}
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
   * Move a block to a new index
   * @param {number} toIndex - index where to move Block
   * @param {number} fromIndex - index of Block to move
   * @param {boolean} skipDOM - if true, do not manipulate DOM
   */
  public move(toIndex: number, fromIndex: number = this.currentBlockIndex, skipDOM = false): void {
    // make sure indexes are valid and within a valid range
    if (isNaN(toIndex) || isNaN(fromIndex)) {
      _.log(`Warning during 'move' call: incorrect indices provided.`, 'warn');

      return;
    }

    if (!this.validateIndex(toIndex) || !this.validateIndex(fromIndex)) {
      _.log(`Warning during 'move' call: indices cannot be lower than 0 or greater than the amount of blocks.`, 'warn');

      return;
    }

    /** Move up current Block */
    this.blocksStore.move(toIndex, fromIndex, skipDOM);

    /** Now actual block moved so that current block index changed */
    this.currentBlockIndex = toIndex;
    const movedBlock = this.currentBlock;

    if (movedBlock === undefined) {
      throw new Error(`Could not move Block. Block at index ${toIndex} is not available.`);
    }

    /**
     * Force call of didMutated event on Block movement
     */
    this.blockDidMutated(BlockMovedMutationType, movedBlock, {
      fromIndex,
      toIndex,
    });
  }

  /**
   * Converts passed Block to the new Tool
   * Uses Conversion Config
   * @param blockToConvert - Block that should be converted
   * @param targetToolName - name of the Tool to convert to
   * @param blockDataOverrides - optional new Block data overrides
   */
  public async convert(blockToConvert: Block, targetToolName: string, blockDataOverrides?: BlockToolData): Promise<Block> {
    /**
     * At first, we get current Block data
     */
    const savedBlock = await blockToConvert.save();

    if (!savedBlock || savedBlock.data === undefined) {
      throw new Error('Could not convert Block. Failed to extract original Block data.');
    }

    /**
     * Getting a class of the replacing Tool
     */
    const replacingTool = this.Blok.Tools.blockTools.get(targetToolName);

    if (!replacingTool) {
      throw new Error(`Could not convert Block. Tool «${targetToolName}» not found.`);
    }

    /**
     * Using Conversion Config "export" we get a stringified version of the Block data
     */
    const exportedData = await blockToConvert.exportDataAsString();

    /**
     * Clean exported data with replacing sanitizer config.
     * We need to extract the field-specific sanitize rules for the field that will receive the imported content.
     * The tool's sanitizeConfig has the format { fieldName: { tagRules } }, but clean() expects just { tagRules }.
     */
    const importProp = replacingTool.conversionConfig?.import;
    const fieldSanitizeConfig = _.isString(importProp) && _.isObject(replacingTool.sanitizeConfig[importProp])
      ? replacingTool.sanitizeConfig[importProp] as SanitizerConfig
      : replacingTool.sanitizeConfig;

    const cleanData: string = clean(
      exportedData,
      composeSanitizerConfig(this.config.sanitizer as SanitizerConfig, fieldSanitizeConfig)
    );

    /**
     * Now using Conversion Config "import" we compose a new Block data
     */
    const baseBlockData = convertStringToBlockData(cleanData, replacingTool.conversionConfig, replacingTool.settings);

    const newBlockData = blockDataOverrides
      ? Object.assign(baseBlockData, blockDataOverrides)
      : baseBlockData;

    return this.replace(blockToConvert, replacingTool.name, newBlockData);
  }

  /**
   * Sets current Block Index -1 which means unknown
   * and clear highlights
   */
  public unsetCurrentBlock(): void {
    this.currentBlockIndex = -1;
  }

  /**
   * Clears Blok
   * @param {boolean} needToAddDefaultBlock - 1) in internal calls (for example, in api.blocks.render)
   *                                             we don't need to add an empty default block
   *                                        2) in api.blocks.clear we should add empty block
   */
  public async clear(needToAddDefaultBlock = false): Promise<void> {
    const queue = new PromiseQueue();

    // Create a copy of the blocks array to avoid issues with array modification during iteration
    const blocksToRemove = [ ...this.blocks ];

    blocksToRemove.forEach((block) => {
      void queue.add(async () => {
        await this.removeBlock(block, false);
      });
    });

    await queue.completed;

    this.unsetCurrentBlock();

    if (needToAddDefaultBlock) {
      this.insert();
    }

    /**
     * Add empty modifier
     */
    this.Blok.UI.checkEmptiness();
  }

  /**
   * Moves the current block up by one position
   * Does nothing if the block is already at the top
   */
  public moveCurrentBlockUp(): void {
    const currentIndex = this.currentBlockIndex;

    if (currentIndex <= 0) {
      // Announce boundary condition
      announce(
        this.Blok.I18n.t('a11y.atTop'),
        { politeness: 'polite' }
      );

      return;
    }

    this.move(currentIndex - 1, currentIndex);
    this.refocusCurrentBlock();

    // Announce successful move (currentBlockIndex is now updated to new position)
    const newPosition = this.currentBlockIndex + 1; // Convert to 1-indexed for user
    const total = this.blocksStore.length;
    const message = this.Blok.I18n.t('a11y.movedUp', {
      position: newPosition,
      total,
    });

    announce(message, { politeness: 'assertive' });
  }

  /**
   * Moves the current block down by one position
   * Does nothing if the block is already at the bottom
   */
  public moveCurrentBlockDown(): void {
    const currentIndex = this.currentBlockIndex;

    if (currentIndex < 0 || currentIndex >= this.blocksStore.length - 1) {
      // Announce boundary condition
      announce(
        this.Blok.I18n.t('a11y.atBottom'),
        { politeness: 'polite' }
      );

      return;
    }

    this.move(currentIndex + 1, currentIndex);
    this.refocusCurrentBlock();

    // Announce successful move (currentBlockIndex is now updated to new position)
    const newPosition = this.currentBlockIndex + 1; // Convert to 1-indexed for user
    const total = this.blocksStore.length;
    const message = this.Blok.I18n.t('a11y.movedDown', {
      position: newPosition,
      total,
    });

    announce(message, { politeness: 'assertive' });
  }

  /**
   * Refocuses the current block at the end position
   * Used after block movement to allow consecutive moves
   */
  private refocusCurrentBlock(): void {
    const block = this.currentBlock;

    if (block !== undefined) {
      this.Blok.Caret.setToBlock(block, this.Blok.Caret.positions.END);
    }
  }

  /**
   * Sets up keyboard shortcuts for block movement
   * CMD+SHIFT+UP: Move current block up
   * CMD+SHIFT+DOWN: Move current block down
   */
  private setupKeyboardShortcuts(): void {
    // Wait for UI to be ready (same pattern as History module)
    setTimeout(() => {
      const shortcutNames = ['CMD+SHIFT+UP', 'CMD+SHIFT+DOWN'];

      // Clear any existing shortcuts to avoid duplicate registration errors
      shortcutNames.forEach(name => Shortcuts.remove(document, name));

      // Move block up: Cmd+Shift+ArrowUp (Mac) / Ctrl+Shift+ArrowUp (Windows/Linux)
      Shortcuts.add({
        name: 'CMD+SHIFT+UP',
        on: document,
        handler: (event: KeyboardEvent) => {
          if (!this.shouldHandleShortcut(event)) {
            return;
          }
          event.preventDefault();
          this.moveCurrentBlockUp();
        },
      });
      this.registeredShortcuts.push('CMD+SHIFT+UP');

      // Move block down: Cmd+Shift+ArrowDown (Mac) / Ctrl+Shift+ArrowDown (Windows/Linux)
      Shortcuts.add({
        name: 'CMD+SHIFT+DOWN',
        on: document,
        handler: (event: KeyboardEvent) => {
          if (!this.shouldHandleShortcut(event)) {
            return;
          }
          event.preventDefault();
          this.moveCurrentBlockDown();
        },
      });
      this.registeredShortcuts.push('CMD+SHIFT+DOWN');
    }, 0);
  }

  /**
   * Determines whether the block movement shortcut should be handled
   * Only handles shortcuts when focus is inside the editor
   * @param event - the keyboard event
   * @returns true if the shortcut should be handled
   */
  private shouldHandleShortcut(event: KeyboardEvent): boolean {
    const target = event.target;

    return target instanceof HTMLElement &&
      this.Blok.UI?.nodes?.wrapper?.contains(target) === true;
  }

  /**
   * Cleans up all the block tools' resources
   * This is called when blok is destroyed
   */
  public async destroy(): Promise<void> {
    // Remove registered keyboard shortcuts
    for (const name of this.registeredShortcuts) {
      Shortcuts.remove(document, name);
    }
    this.registeredShortcuts = [];

    await Promise.all(this.blocks.map((block) => {
      return block.destroy();
    }));
  }

  /**
   * Bind Block events
   * @param {Block} block - Block to which event should be bound
   */
  private bindBlockEvents(block: Block): void {
    const { BlockEvents } = this.Blok;

    this.readOnlyMutableListeners.on(block.holder, 'keydown', (event: Event) => {
      if (event instanceof KeyboardEvent) {
        BlockEvents.keydown(event);
      }
    });

    this.readOnlyMutableListeners.on(block.holder, 'keyup', (event: Event) => {
      if (event instanceof KeyboardEvent) {
        BlockEvents.keyup(event);
      }
    });

    this.readOnlyMutableListeners.on(block.holder, 'input', (event: Event) => {
      if (event instanceof InputEvent) {
        BlockEvents.input(event);
      }
    });

    block.on('didMutated', (affectedBlock: Block) => {
      return this.blockDidMutated(BlockChangedMutationType, affectedBlock, {
        index: this.getBlockIndex(affectedBlock),
      });
    });
  }

  /**
   * Disable mutable handlers and bindings
   */
  private disableModuleBindings(): void {
    this.readOnlyMutableListeners.clearAll();
  }

  /**
   * Enables all module handlers and bindings for all Blocks
   */
  private enableModuleBindings(): void {
    /** Cut event */
    this.readOnlyMutableListeners.on(
      document,
      'cut',
      (event: Event) => {
        this.Blok.BlockEvents.handleCommandX(event as ClipboardEvent);
      }
    );

    this.blocks.forEach((block: Block) => {
      this.bindBlockEvents(block);
    });
  }

  /**
   * Validates that the given index is not lower than 0 or higher than the amount of blocks
   * @param {number} index - index of blocks array to validate
   * @returns {boolean}
   */
  private validateIndex(index: number): boolean {
    return !(index < 0 || index >= this.blocksStore.length);
  }

  /**
   * Block mutation callback
   * @param mutationType - what happened with block
   * @param block - mutated block
   * @param detailData - additional data to pass with change event
   */
  private blockDidMutated<Type extends BlockMutationType>(mutationType: Type, block: Block, detailData: BlockMutationEventDetailWithoutTarget<Type>): Block {
    const eventDetail = {
      target: new BlockAPI(block),
      ...detailData as BlockMutationEventDetailWithoutTarget<Type>,
    };

    const event = new CustomEvent(mutationType, {
      detail: {
        ...eventDetail,
      },
    });

    /**
     * The CustomEvent#type getter is not enumerable by default, so it gets lost during structured cloning.
     * Define it explicitly to keep the type available for consumers like Playwright tests.
     */
    if (!Object.prototype.propertyIsEnumerable.call(event, 'type')) {
      Object.defineProperty(event, 'type', {
        value: mutationType,
        enumerable: true,
        configurable: true,
      });
    }

    /**
     * CustomEvent#detail is also non-enumerable, so preserve it for consumers outside of the browser context.
     */
    if (!Object.prototype.propertyIsEnumerable.call(event, 'detail')) {
      Object.defineProperty(event, 'detail', {
        value: eventDetail,
        enumerable: true,
        configurable: true,
      });
    }

    this.eventsDispatcher.emit(BlockChanged, {
      event: event as BlockMutationEventMap[Type],
    });

    return block;
  }
}

/**
 * Type alias for Block Mutation event without 'target' field, used in 'blockDidMutated' method
 */
type BlockMutationEventDetailWithoutTarget<Type extends BlockMutationType> = Omit<BlockMutationEventMap[Type]['detail'], 'target'>;
