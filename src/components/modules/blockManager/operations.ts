/**
 * @class BlockOperations
 * @classdesc Handles state-changing operations on blocks
 * @module BlockOperations
 */
import type { BlockToolData, PasteEvent, SanitizerConfig , BlokConfig } from '../../../../types';
import type { BlockTuneData } from '../../../../types/block-tunes/block-tune-data';
import type { BlockMutationType } from '../../../../types/events/block';
import { BlockAddedMutationType } from '../../../../types/events/block/BlockAdded';
import { BlockChangedMutationType } from '../../../../types/events/block/BlockChanged';
import { BlockMovedMutationType } from '../../../../types/events/block/BlockMoved';
import { BlockRemovedMutationType } from '../../../../types/events/block/BlockRemoved';
import type { Block } from '../../block';
import { BlockToolAPI } from '../../block';
import { Dom as $ } from '../../dom';
import type { BlokEventMap } from '../../events';
import { isEmpty, isObject, isString, log, generateBlockId } from '../../utils';
import { announce } from '../../utils/announcer';
import { convertStringToBlockData, isBlockConvertable } from '../../utils/blocks';
import type { EventsDispatcher } from '../../utils/events';
import { sanitizeBlocks, clean, composeSanitizerConfig } from '../../utils/sanitizer';
import { isInsideTableCell, isRestrictedInTableCell } from '../../../tools/table/table-restrictions';
import type { Caret } from '../caret';
import type { I18n } from '../i18n';
import type { YjsManager } from '../yjs';
import type { BlockFactory } from './factory';
import type { BlockHierarchy } from './hierarchy';
import type { BlockRepository } from './repository';
import type { InsertBlockOptions, BlockMutationEventDetailWithoutTarget, BlocksStore } from './types';
import type { BlockYjsSync } from './yjs-sync';

/**
 * Dependencies needed by BlockOperations
 */
export interface BlockOperationsDependencies {
  /** Blok configuration */
  config: BlokConfig;
  /** YjsManager instance */
  YjsManager: YjsManager;
  /** Caret module */
  Caret: Caret;
  /** I18n module */
  I18n: I18n;
  /** Events dispatcher */
  eventsDispatcher: EventsDispatcher<BlokEventMap>;
}

/**
 * Block mutation callback signature
 */
export type BlockDidMutated = <Type extends BlockMutationType>(
  mutationType: Type,
  block: Block,
  detailData: BlockMutationEventDetailWithoutTarget<Type>
) => Block;

/**
 * BlockOperations handles all state-changing operations on blocks
 */
export class BlockOperations {
  private readonly dependencies: BlockOperationsDependencies;
  private readonly repository: BlockRepository;
  private readonly factory: BlockFactory;
  private readonly hierarchy: BlockHierarchy;
  private yjsSync!: BlockYjsSync; // Set via setter after initialization
  private readonly blockDidMutated: BlockDidMutated;

  /**
   * Current block index state (managed externally, passed in for operations)
   */
  private currentBlockIndex: number;

  /**
   * Flag to suppress stopCapturing during atomic operations (like split)
   * This prevents breaking undo grouping when currentBlockIndex changes
   */
  public suppressStopCapturing = false;

  /**
   * @param dependencies - Required dependencies
   * @param repository - BlockRepository for block lookups
   * @param factory - BlockFactory for creating blocks
   * @param hierarchy - BlockHierarchy for parent/child operations
   * @param blockDidMutated - Callback for block mutations
   * @param initialCurrentBlockIndex - Initial current block index
   */
  constructor(
    dependencies: BlockOperationsDependencies,
    repository: BlockRepository,
    factory: BlockFactory,
    hierarchy: BlockHierarchy,
    blockDidMutated: BlockDidMutated,
    initialCurrentBlockIndex: number = -1
  ) {
    this.dependencies = dependencies;
    this.repository = repository;
    this.factory = factory;
    this.hierarchy = hierarchy;
    this.blockDidMutated = blockDidMutated;
    this.currentBlockIndex = initialCurrentBlockIndex;
  }

  /**
   * Set the YjsSync instance (called after initialization to break circular dependency)
   */
  public setYjsSync(yjsSync: BlockYjsSync): void {
    this.yjsSync = yjsSync;
  }

  /**
   * Get current block index
   */
  public get currentBlockIndexValue(): number {
    return this.currentBlockIndex;
  }

  /**
   * Set current block index (with stopCapturing side effect)
   */
  public set currentBlockIndexValue(newIndex: number) {
    if (this.currentBlockIndex !== newIndex && !this.suppressStopCapturing) {
      this.dependencies.YjsManager?.stopCapturing();
    }
    this.currentBlockIndex = newIndex;
  }

  /**
   * Get current block
   * Returns undefined when no block is selected (currentBlockIndex === -1)
   */
  public get currentBlock(): Block | undefined {
    if (this.currentBlockIndex === -1) {
      return undefined;
    }
    return this.repository.getBlockByIndex(this.currentBlockIndex);
  }

  /**
   * Get next block
   * Returns null when no block is selected or already at the last block
   */
  public get nextBlock(): Block | null {
    if (this.currentBlockIndex === -1) {
      return null;
    }

    const isLastBlock = this.currentBlockIndex === (this.repository.length - 1);

    if (isLastBlock) {
      return null;
    }

    const nextBlock = this.repository.getBlockByIndex(this.currentBlockIndex + 1);

    return nextBlock ?? null;
  }

  /**
   * Get previous block
   * Returns null when no block is selected or already at the first block
   */
  public get previousBlock(): Block | null {
    if (this.currentBlockIndex === -1) {
      return null;
    }

    const isFirstBlock = this.currentBlockIndex === 0;

    if (isFirstBlock) {
      return null;
    }

    const previousBlock = this.repository.getBlockByIndex(this.currentBlockIndex - 1);

    return previousBlock ?? null;
  }

  /**
   * Insert new block
   * @param options - Insert options
   * @param blocksStore - The blocks store to modify
   * @returns The inserted block
   */
  public insert(options: InsertBlockOptions = {}, blocksStore: BlocksStore): Block {
    const {
      id = undefined,
      tool,
      data,
      index,
      needToFocus = true,
      replace = false,
      tunes,
      skipYjsSync = false,
      appendToWorkingArea = false,
    } = options;

    const targetIndex = index ?? this.currentBlockIndex + (replace ? 0 : 1);

    /**
     * If we're replacing a block, stop watching for mutations immediately to prevent
     * spurious block-changed events from DOM manipulations (like focus restoration)
     * that may occur before the block is fully replaced.
     */
    if (replace) {
      this.repository.getBlockByIndex(targetIndex)?.unwatchBlockMutations();
    }

    const resolvedToolName = (() => {
      const name = tool ?? this.dependencies.config.defaultBlock;

      if (name === undefined) {
        throw new Error('Could not insert Block. Tool name is not specified.');
      }

      // Demote restricted tools to paragraph when inserting inside a table cell.
      // For replace: check the block being replaced (new block takes its DOM position).
      // For insert: check the predecessor block (new block is placed after it in the DOM).
      // Using the block AT targetIndex for non-replace inserts is wrong because that
      // block may be a child paragraph inside a table cell that gets displaced, while
      // the new block actually lands at the top level.
      const neighborBlock = replace
        ? this.repository.getBlockByIndex(targetIndex)
        : (this.repository.getBlockByIndex(targetIndex - 1) ?? this.repository.getBlockByIndex(targetIndex));

      if (neighborBlock !== undefined && isInsideTableCell(neighborBlock) && isRestrictedInTableCell(name)) {
        return this.dependencies.config.defaultBlock ?? 'paragraph';
      }

      return name;
    })();

    // Bind events immediately for user-created blocks so mutations are tracked right away
    const block = this.factory.composeBlock({
      tool: resolvedToolName,
      bindEventsImmediately: true,
      ...(id !== undefined && { id }),
      ...(data !== undefined && { data }),
      ...(tunes !== undefined && { tunes }),
    });

    /**
     * In case of block replacing (Converting OR from Toolbox or Shortcut on empty block OR on-paste to empty block)
     * we need to dispatch the 'block-removing' event for the replacing block
     */
    const blockToReplace = replace ? this.repository.getBlockByIndex(targetIndex) : undefined;

    if (replace && blockToReplace === undefined) {
      throw new Error(`Could not replace Block at index ${targetIndex}. Block not found.`);
    }

    if (replace && blockToReplace !== undefined) {
      this.blockDidMutated(BlockRemovedMutationType, blockToReplace, {
        index: targetIndex,
      });
    }

    blocksStore.insert(targetIndex, block, replace, appendToWorkingArea);

    /**
     * Force call of didMutated event on Block insertion
     */
    this.blockDidMutated(BlockAddedMutationType, block, {
      index: targetIndex,
    });

    /**
     * Sync to Yjs data layer (unless caller is handling sync separately,
     * or we're inside an atomic operation like paste where all Yjs sync
     * is deferred until the operation completes)
     */
    if (!skipYjsSync && !this.yjsSync.isSyncingFromYjs) {
      this.dependencies.YjsManager.addBlock({
        id: block.id,
        type: block.name,
        data: block.preservedData,
        parent: block.parentId ?? undefined,
      }, targetIndex);
    }

    if (needToFocus) {
      this.currentBlockIndexValue = targetIndex;
    }

    if (!needToFocus && targetIndex <= this.currentBlockIndex) {
      this.currentBlockIndexValue++;
    }

    return block;
  }

  /**
   * Insert new default block at passed index
   * @param index - Index where Block should be inserted
   * @param needToFocus - If true, updates current Block index
   * @param skipYjsSync - If true, skip syncing to Yjs
   * @param blocksStore - The blocks store to modify
   * @returns Inserted Block
   */
  public insertDefaultBlockAtIndex(index: number, needToFocus = false, skipYjsSync = false, blocksStore: BlocksStore): Block {
    const defaultTool = this.dependencies.config.defaultBlock;

    if (defaultTool === undefined) {
      throw new Error('Could not insert default Block. Default block tool is not defined in the configuration.');
    }

    return this.insert({
      tool: defaultTool,
      index,
      needToFocus,
      skipYjsSync,
    }, blocksStore);
  }

  /**
   * Always inserts at the end
   * @param blocksStore - The blocks store to modify
   * @returns Inserted Block
   */
  public insertAtEnd(blocksStore: BlocksStore): Block {
    this.currentBlockIndexValue = this.repository.length - 1;

    return this.insert({ appendToWorkingArea: true }, blocksStore);
  }

  /**
   * Remove passed Block
   * @param block - Block to remove
   * @param addLastBlock - If true, inserts a new default block when the last block is removed
   * @param skipYjsSync - If true, skip syncing to Yjs
   * @param blocksStore - The blocks store to modify
   */
  public removeBlock(block: Block, addLastBlock = true, skipYjsSync = false, blocksStore: BlocksStore): Promise<void> {
    return new Promise((resolve) => {
      const index = this.repository.getBlockIndex(block);

      /**
       * If index is not passed and there is no block selected, show a warning
       */
      if (!this.repository.validateIndex(index)) {
        throw new Error('Can\'t find a Block to remove');
      }

      // Clean up parent's contentIds before removing the block
      const parentBlock = block.parentId !== null
        ? this.repository.getBlockById(block.parentId)
        : undefined;

      if (parentBlock !== undefined) {
        parentBlock.contentIds = parentBlock.contentIds.filter(id => id !== block.id);
      }

      blocksStore.remove(index);

      /**
       * Force call of didMutated event on Block removal
       */
      this.blockDidMutated(BlockRemovedMutationType, block, {
        index,
      });

      /**
       * Sync to Yjs data layer (unless caller is handling sync separately)
       */
      if (!skipYjsSync) {
        this.dependencies.YjsManager.removeBlock(block.id);
      }

      const noBlocksLeft = this.repository.length === 0;

      // Update currentBlockIndex based on what was removed
      if (this.currentBlockIndex >= index) {
        this.currentBlockIndexValue--;
      }

      /**
       * If all blocks were removed, insert a new default block
       */
      if (noBlocksLeft && addLastBlock) {
        this.insert({}, blocksStore);
      }

      // If all blocks removed, unset current block
      if (noBlocksLeft) {
        this.currentBlockIndexValue = -1;

        resolve();

        return;
      }

      // First block removed and caret was on it: move to new first block
      if (index === 0 && this.currentBlockIndexValue < 0) {
        this.currentBlockIndexValue = 0;
      }

      resolve();
    });
  }

  /**
   * Update Block data
   * @param block - Block to update
   * @param blocksStore - The blocks store to modify
   * @param data - New data
   * @param tunes - New tune data
   */
  public async update(block: Block, blocksStore: BlocksStore, data?: Partial<BlockToolData>, tunes?: { [name: string]: BlockTuneData }): Promise<Block> {
    if (!data && !tunes) {
      return block;
    }

    const existingData = await block.data;

    const newBlock = this.factory.composeBlock({
      id: block.id,
      tool: block.name,
      data: Object.assign({}, existingData, data ?? {}),
      tunes: tunes ?? block.preservedTunes,
      bindEventsImmediately: true,
    });

    const blockIndex = this.repository.getBlockIndex(block);

    blocksStore.replace(blockIndex, newBlock);

    this.blockDidMutated(BlockChangedMutationType, newBlock, {
      index: blockIndex,
    });

    // Sync changed data to Yjs
    if (data !== undefined) {
      for (const [key, value] of Object.entries(data)) {
        this.dependencies.YjsManager.updateBlockData(block.id, key, value);
      }
    }

    // Sync changed tunes to Yjs
    if (tunes !== undefined) {
      for (const [tuneName, tuneData] of Object.entries(tunes)) {
        this.dependencies.YjsManager.updateBlockTune(block.id, tuneName, tuneData);
      }
    }

    return newBlock;
  }

  /**
   * Replace passed Block with the new one with specified Tool and data
   * @param block - Block to replace
   * @param newTool - New Tool name
   * @param data - New Tool data
   * @param blocksStore - The blocks store to modify
   */
  public replace(block: Block, newTool: string, data: BlockToolData, blocksStore: BlocksStore): Block {
    const blockIndex = this.repository.getBlockIndex(block);
    const newBlockId = generateBlockId();

    // Atomic transaction: remove old block + add new block as single undo entry
    this.dependencies.YjsManager.transact(() => {
      this.dependencies.YjsManager.removeBlock(block.id);
      this.dependencies.YjsManager.addBlock({
        id: newBlockId,
        type: newTool,
        data,
      }, blockIndex);
    });

    // DOM update (skip Yjs sync — already done above)
    return this.insert({
      id: newBlockId,
      tool: newTool,
      data,
      index: blockIndex,
      replace: true,
      skipYjsSync: true,
    }, blocksStore);
  }

  /**
   * Move a block to a new index
   * @param toIndex - Index where to move Block
   * @param fromIndex - Index of Block to move
   * @param skipDOM - If true, do not manipulate DOM
   * @param blocksStore - The blocks store to modify
   */
  public move(toIndex: number, fromIndex: number, skipDOM: boolean, blocksStore: BlocksStore): void {
    // Make sure indexes are valid and within a valid range
    if (isNaN(toIndex) || isNaN(fromIndex)) {
      log(`Warning during 'move' call: incorrect indices provided.`, 'warn');

      return;
    }

    if (!this.repository.validateIndex(toIndex) || !this.repository.validateIndex(fromIndex)) {
      log(`Warning during 'move' call: indices cannot be lower than 0 or greater than the amount of blocks.`, 'warn');

      return;
    }

    // Check if the move would place a restricted tool inside a table cell
    const movingBlock = this.repository.getBlockByIndex(fromIndex);
    const neighborBlock = this.repository.getBlockByIndex(toIndex);

    if (movingBlock !== undefined && neighborBlock !== undefined &&
        isInsideTableCell(neighborBlock) && isRestrictedInTableCell(movingBlock.name)) {
      log(`Warning during 'move' call: '${movingBlock.name}' is restricted in table cells.`, 'warn');

      return;
    }

    // Suppress stopCapturing to keep DOM + Yjs move as single undo entry
    this.suppressStopCapturing = true;
    try {
      /** Move up current Block */
      blocksStore.move(toIndex, fromIndex, skipDOM);

      /** Now actual block moved so that current block index changed */
      this.currentBlockIndexValue = toIndex;
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
      } as BlockMutationEventDetailWithoutTarget<typeof BlockMovedMutationType>);

      // Sync to Yjs
      this.dependencies.YjsManager.moveBlock(movedBlock.id, toIndex);
    } finally {
      this.suppressStopCapturing = false;
    }
  }

  /**
   * Merge two blocks
   * @param targetBlock - Previous block will be append to this block
   * @param blockToMerge - Block that will be merged with target block
   * @param blocksStore - The blocks store to modify
   */
  public async mergeBlocks(targetBlock: Block, blockToMerge: Block, blocksStore: BlocksStore): Promise<void> {
    /**
     * Complete the merge operation with the prepared data
     * Syncs to Yjs atomically, then updates DOM without re-syncing
     */
    const completeMerge = async (mergeData: BlockToolData): Promise<void> => {
      // Get current target data to compute merged result for Yjs
      const targetData = await targetBlock.data;
      const mergedData = { ...targetData, ...mergeData };

      // Sync to Yjs atomically: update target + remove source as single undo entry
      this.dependencies.YjsManager.transact(() => {
        for (const [key, value] of Object.entries(mergedData)) {
          this.dependencies.YjsManager.updateBlockData(targetBlock.id, key, value);
        }
        this.dependencies.YjsManager.removeBlock(blockToMerge.id);
      });

      // DOM updates and index change (skip Yjs sync — already done above)
      // The entire operation is wrapped in withAtomicOperation to suppress stopCapturing
      // when currentBlockIndexValue is set at the end
      this.yjsSync.withAtomicOperation(() => {
        void targetBlock.mergeWith(mergeData).then(() => {
          return this.removeBlock(blockToMerge, true, true, blocksStore);
        });

        this.currentBlockIndexValue = this.repository.getBlockIndex(targetBlock);
      });
    };

    /**
     * We can merge:
     * 1) Blocks with the same Tool if tool provides merge method
     */
    const canMergeBlocksDirectly = targetBlock.name === blockToMerge.name && targetBlock.mergeable;
    const blockToMergeDataRaw = canMergeBlocksDirectly ? await blockToMerge.data : undefined;

    if (canMergeBlocksDirectly && isEmpty(blockToMergeDataRaw)) {
      console.error('Could not merge Block. Failed to extract original Block data.');

      return;
    }

    if (canMergeBlocksDirectly && blockToMergeDataRaw !== undefined) {
      const [cleanBlock] = sanitizeBlocks(
        [{ data: blockToMergeDataRaw, tool: blockToMerge.name }],
        targetBlock.tool.sanitizeConfig,
        this.dependencies.config.sanitizer as SanitizerConfig
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
      const fieldSanitizeConfig = isString(importProp) && isObject(targetBlock.tool.sanitizeConfig[importProp])
        ? targetBlock.tool.sanitizeConfig[importProp] as SanitizerConfig
        : targetBlock.tool.sanitizeConfig;

      const cleanData = clean(blockToMergeDataStringified, fieldSanitizeConfig);
      const blockToMergeData = convertStringToBlockData(cleanData, targetBlock.tool.conversionConfig);

      await completeMerge(blockToMergeData);
    }
  }

  /**
   * Split current Block
   * 1. Extract content from Caret position to the Block`s end
   * 2. Insert a new Block below current one with extracted content
   *
   * Uses atomic Yjs transaction to ensure split is a single undo entry.
   * @param blocksStore - The blocks store to modify
   * @returns Split block
   */
  public split(blocksStore: BlocksStore): Block {
    const currentBlock = this.currentBlock;

    if (currentBlock === undefined) {
      throw new Error('Cannot split: no current block');
    }

    // Generate new block ID upfront for the transaction
    const newBlockId = generateBlockId();
    const insertIndex = this.currentBlockIndex + 1;

    return this.yjsSync.withAtomicOperation(() => {
      // Extract fragment (mutates DOM - removes text after caret)
      const extractedFragment = this.dependencies.Caret.extractFragmentFromCaretPosition();
      const wrapper = document.createElement('div');

      wrapper.appendChild(extractedFragment as DocumentFragment);

      const extractedText = $.isEmpty(wrapper) ? '' : wrapper.innerHTML;

      // Get truncated text (what remains in original block after extraction)
      const truncatedText = currentBlock.holder
        .querySelector('[contenteditable="true"]')?.innerHTML ?? '';

      // Atomic Yjs transaction: update original + add new (single undo entry)
      this.dependencies.YjsManager.transact(() => {
        this.dependencies.YjsManager.updateBlockData(currentBlock.id, 'text', truncatedText);
        this.dependencies.YjsManager.addBlock({
          id: newBlockId,
          type: currentBlock.name,
          data: { text: extractedText },
        }, insertIndex);
      });

      // Insert DOM block (skip Yjs sync - already done above)
      return this.insert({
        id: newBlockId,
        tool: currentBlock.name,
        data: { text: extractedText },
        skipYjsSync: true,
      }, blocksStore);
    });
  }

  /**
   * Splits a block by updating the current block's data and inserting a new block.
   * Both operations are grouped into a single undo entry.
   * Used by tools that need to specify exact data for both blocks (e.g., list items).
   *
   * @param currentBlockId - id of the block to update
   * @param currentBlockData - new data for the current block (typically truncated content)
   * @param newBlockType - tool type for the new block
   * @param newBlockData - data for the new block (typically extracted content)
   * @param insertIndex - index where to insert the new block
   * @param blocksStore - The blocks store to modify
   * @returns the newly created block
   */
  public splitBlockWithData(
    currentBlockId: string,
    currentBlockData: Partial<BlockToolData>,
    newBlockType: string,
    newBlockData: BlockToolData,
    insertIndex: number,
    blocksStore: BlocksStore
  ): Block {
    const currentBlock = this.repository.getBlockById(currentBlockId);

    if (currentBlock === undefined) {
      throw new Error(`Block with id "${currentBlockId}" not found`);
    }

    const newBlockId = generateBlockId();

    return this.yjsSync.withAtomicOperation(() => {
      // Atomic Yjs transaction: update original + add new (single undo entry)
      this.dependencies.YjsManager.transact(() => {
        for (const [key, value] of Object.entries(currentBlockData)) {
          this.dependencies.YjsManager.updateBlockData(currentBlockId, key, value);
        }
        this.dependencies.YjsManager.addBlock({
          id: newBlockId,
          type: newBlockType,
          data: newBlockData,
        }, insertIndex);
      });

      // Update DOM for the current block (auto-sync is suppressed by yjsSyncCount)
      const currentContentEl = currentBlock.holder.querySelector('[contenteditable="true"]');

      if (currentContentEl !== null && typeof currentBlockData.text === 'string') {
        currentContentEl.innerHTML = currentBlockData.text;
      }

      // Insert DOM block (skip Yjs sync - already done above)
      return this.insert({
        id: newBlockId,
        tool: newBlockType,
        data: newBlockData,
        index: insertIndex,
        needToFocus: true,
        skipYjsSync: true,
      }, blocksStore);
    });
  }

  /**
   * Converts passed Block to the new Tool
   * Uses Conversion Config
   * @param blockToConvert - Block that should be converted
   * @param targetToolName - Name of the Tool to convert to
   * @param blocksStore - The blocks store to modify
   * @param blockDataOverrides - Optional new Block data overrides
   */
  public async convert(blockToConvert: Block, targetToolName: string, blocksStore: BlocksStore, blockDataOverrides?: BlockToolData): Promise<Block> {
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
    const replacingTool = this.factory.getTool(targetToolName);

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
    const fieldSanitizeConfig = isString(importProp) && isObject(replacingTool.sanitizeConfig[importProp])
      ? replacingTool.sanitizeConfig[importProp] as SanitizerConfig
      : replacingTool.sanitizeConfig;

    const cleanData = clean(
      exportedData,
      composeSanitizerConfig(this.dependencies.config.sanitizer as SanitizerConfig, fieldSanitizeConfig)
    );

    /**
     * Now using Conversion Config "import" we compose a new Block data
     */
    const baseBlockData = convertStringToBlockData(cleanData, replacingTool.conversionConfig, replacingTool.settings);

    const newBlockData = blockDataOverrides
      ? Object.assign(baseBlockData, blockDataOverrides)
      : baseBlockData;

    return this.replace(blockToConvert, replacingTool.name, newBlockData, blocksStore);
  }

  /**
   * Insert pasted content. Call onPaste callback after insert.
   * Syncs final state to Yjs as single operation to ensure single undo entry.
   * @param toolName - Name of Tool to insert
   * @param pasteEvent - Pasted data
   * @param replace - Should replace current block
   * @param blocksStore - The blocks store to modify
   */
  public async paste(
    toolName: string,
    pasteEvent: PasteEvent,
    replace = false,
    blocksStore: BlocksStore
  ): Promise<Block> {
    // Insert block without syncing to Yjs yet.
    // Wrap in atomic operation so that child blocks created during rendered()
    // (e.g., table cell paragraph blocks) also skip Yjs sync.
    const block = this.yjsSync.withAtomicOperation(() => {
      return this.insert({
        tool: toolName,
        replace,
        skipYjsSync: true,
      }, blocksStore);
    });

    // Wait for the block to be fully rendered before calling onPaste,
    // because onPaste may change the tool's root element and needs
    // mutation watchers to be bound first.
    await block.ready;

    // Call onPaste within atomic operation so child blocks created
    // during cell initialization also skip Yjs sync.
    this.yjsSync.withAtomicOperation(() => {
      block.call(BlockToolAPI.ON_PASTE, pasteEvent as unknown as Record<string, unknown>);
      block.refreshToolRootElement();
    });

    // Sync final state to Yjs as single operation
    const savedData = await block.save();

    if (savedData !== undefined) {
      this.dependencies.YjsManager.addBlock({
        id: block.id,
        type: block.name,
        data: savedData.data,
      }, this.repository.getBlockIndex(block));
    }

    return block;
  }

  /**
   * Moves the current block up by one position
   * Does nothing if the block is already at the top
   * @param blocksStore - The blocks store to modify
   */
  public moveCurrentBlockUp(blocksStore: BlocksStore): void {
    const currentIndex = this.currentBlockIndexValue;

    if (currentIndex <= 0) {
      // Announce boundary condition
      announce(
        this.dependencies.I18n.t('a11y.atTop'),
        { politeness: 'polite' }
      );

      return;
    }

    this.move(currentIndex - 1, currentIndex, false, blocksStore);
    this.refocusCurrentBlock();

    // Announce successful move (currentBlockIndex is now updated to new position)
    const newPosition = this.currentBlockIndexValue + 1; // Convert to 1-indexed for user
    const total = this.repository.length;
    const message = this.dependencies.I18n.t('a11y.movedUp', {
      position: newPosition,
      total,
    });

    announce(message, { politeness: 'assertive' });
  }

  /**
   * Moves the current block down by one position
   * Does nothing if the block is already at the bottom
   * @param blocksStore - The blocks store to modify
   */
  public moveCurrentBlockDown(blocksStore: BlocksStore): void {
    const currentIndex = this.currentBlockIndexValue;

    if (currentIndex < 0 || currentIndex >= this.repository.length - 1) {
      // Announce boundary condition
      announce(
        this.dependencies.I18n.t('a11y.atBottom'),
        { politeness: 'polite' }
      );

      return;
    }

    this.move(currentIndex + 1, currentIndex, false, blocksStore);
    this.refocusCurrentBlock();

    // Announce successful move (currentBlockIndex is now updated to new position)
    const newPosition = this.currentBlockIndexValue + 1; // Convert to 1-indexed for user
    const total = this.repository.length;
    const message = this.dependencies.I18n.t('a11y.movedDown', {
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
      this.dependencies.Caret.setToBlock(block, this.dependencies.Caret.positions.END);
    }
  }
}
