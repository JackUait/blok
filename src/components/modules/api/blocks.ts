import type { BlockAPI as BlockAPIInterface, Blocks } from '../../../../types/api';
import type { BlockToolData, OutputBlockData, OutputData, ToolConfig } from '../../../../types';
import { logLabeled } from './../../utils';
import { BlockAPI } from '../../block/api';
import { Module } from '../../__module';
import { Block } from '../../block';
import { capitalize } from '../../utils';
import type { BlockTuneData } from '../../../../types/block-tunes/block-tune-data';

/**
 * @class BlocksAPI
 * provides with methods working with Block
 */
export class BlocksAPI extends Module {
  /**
   * Available methods
   * @returns {Blocks}
   */
  public get methods(): Blocks {
    return {
      clear: (): Promise<void> => this.clear(),
      render: (data: OutputData): Promise<void> => this.render(data),
      renderFromHTML: (data: string): Promise<void> => this.renderFromHTML(data),
      delete: (index?: number): Promise<void> => this.delete(index),
      move: (toIndex: number, fromIndex?: number): void => this.move(toIndex, fromIndex),
      getBlockByIndex: (index: number): BlockAPIInterface | undefined => this.getBlockByIndex(index),
      getById: (id: string): BlockAPIInterface | null => this.getById(id),
      getCurrentBlockIndex: (): number => this.getCurrentBlockIndex(),
      getBlockIndex: (id: string): number | undefined => this.getBlockIndex(id),
      getBlocksCount: (): number => this.getBlocksCount(),
      getBlockByElement: (element: HTMLElement) => this.getBlockByElement(element),
      getChildren: (parentId: string): BlockAPIInterface[] => this.getChildren(parentId),
      insert: this.insert,
      insertMany: this.insertMany,
      update: this.update,
      composeBlockData: this.composeBlockData,
      convert: this.convert,
      stopBlockMutationWatching: (index: number): void => this.stopBlockMutationWatching(index),
      splitBlock: this.splitBlock,
    };
  }

  /**
   * Returns Blocks count
   * @returns {number}
   */
  public getBlocksCount(): number {
    return this.Blok.BlockManager.blocks.length;
  }

  /**
   * Returns current block index
   * @returns {number}
   */
  public getCurrentBlockIndex(): number {
    return this.Blok.BlockManager.currentBlockIndex;
  }

  /**
   * Returns the index of Block by id;
   * @param id - block id
   */
  public getBlockIndex(id: string): number | undefined {
    const block = this.Blok.BlockManager.getBlockById(id);

    if (!block) {
      logLabeled('There is no block with id `' + id + '`', 'warn');

      return;
    }

    return this.Blok.BlockManager.getBlockIndex(block);
  }

  /**
   * Returns BlockAPI object by Block index
   * @param {number} index - index to get
   */
  public getBlockByIndex(index: number): BlockAPIInterface | undefined {
    const block = this.Blok.BlockManager.getBlockByIndex(index);

    if (block === undefined) {
      logLabeled('There is no block at index `' + index + '`', 'warn');

      return;
    }

    return new BlockAPI(block);
  }

  /**
   * Returns BlockAPI object by Block id
   * @param id - id of block to get
   */
  public getById(id: string): BlockAPIInterface | null {
    const block = this.Blok.BlockManager.getBlockById(id);

    if (block === undefined) {
      logLabeled('There is no block with id `' + id + '`', 'warn');

      return null;
    }

    return new BlockAPI(block);
  }

  /**
   * Get Block API object by any child html element
   * @param element - html element to get Block by
   */
  public getBlockByElement(element: HTMLElement): BlockAPIInterface | undefined {
    const block = this.Blok.BlockManager.getBlock(element);

    if (block === undefined) {
      logLabeled('There is no block corresponding to element `' + element + '`', 'warn');

      return;
    }

    return new BlockAPI(block);
  }

  /**
   * Returns all child blocks of a parent container block
   * @param parentId - id of the parent block
   */
  public getChildren(parentId: string): BlockAPIInterface[] {
    const children = this.Blok.BlockManager.blocks.filter(
      (block) => block.parentId === parentId
    );

    return children.map((block) => new BlockAPI(block));
  }


  /**
   * Move block from one index to another
   * @param {number} toIndex - index to move to
   * @param {number} fromIndex - index to move from
   */
  public move(toIndex: number, fromIndex?: number): void {
    this.Blok.BlockManager.move(toIndex, fromIndex);
  }

  /**
   * Deletes Block
   * @param {number} blockIndex - index of Block to delete
   */
  public async delete(blockIndex: number = this.Blok.BlockManager.currentBlockIndex): Promise<void> {
    const block = this.Blok.BlockManager.getBlockByIndex(blockIndex);

    if (block === undefined) {
      logLabeled(`There is no block at index \`${blockIndex}\``, 'warn');

      return;
    }

    try {
      await this.Blok.BlockManager.removeBlock(block);
    } catch (error: unknown) {
      logLabeled(error as unknown as string, 'warn');

      return;
    }

    /**
     * in case of last block deletion
     * Insert the new default empty block
     */
    if (this.Blok.BlockManager.blocks.length === 0) {
      this.Blok.BlockManager.insert();
    }

    /**
     * After Block deletion currentBlock is updated
     */
    if (this.Blok.BlockManager.currentBlock) {
      this.Blok.Caret.setToBlock(this.Blok.BlockManager.currentBlock, this.Blok.Caret.positions.END);
    }

    this.Blok.Toolbar.close();
  }

  /**
   * Clear Blok's area
   */
  public async clear(): Promise<void> {
    await this.Blok.BlockManager.clear(true);
    this.Blok.InlineToolbar.close();
  }

  /**
   * Fills Blok with Blocks data
   * @param {OutputData} data — Saved Blok data
   */
  public async render(data: OutputData): Promise<void> {
    if (data === undefined || data.blocks === undefined) {
      throw new Error('Incorrect data passed to the render() method');
    }

    /**
     * Semantic meaning of the "render" method: "Display the new document over the existing one that stays unchanged"
     * So we need to disable modifications observer temporarily
     */
    this.Blok.ModificationsObserver.disable();

    await this.Blok.BlockManager.clear();
    await this.Blok.Renderer.render(data.blocks);

    this.Blok.ModificationsObserver.enable();
  }

  /**
   * Render passed HTML string
   * @param {string} data - HTML string to render
   * @returns {Promise<void>}
   */
  public async renderFromHTML(data: string): Promise<void> {
    await this.Blok.BlockManager.clear();

    return this.Blok.Paste.processText(data, true);
  }

  /**
   * Insert new Block and returns it's API
   * @param {string} type — Tool name
   * @param {BlockToolData} data — Tool data to insert
   * @param {ToolConfig} _config — Tool config
   * @param {number?} index — index where to insert new Block
   * @param {boolean?} needToFocus - flag to focus inserted Block
   * @param replace - pass true to replace the Block existed under passed index
   * @param {string} id — An optional id for the new block. If omitted then the new id will be generated
   */
  public insert = (
    type?: string,
    data: BlockToolData = {},
    _config: ToolConfig = {},
    index?: number,
    needToFocus?: boolean,
    replace?: boolean,
    id?: string
  ): BlockAPIInterface => {
    const tool = type ?? (this.config.defaultBlock as string | undefined);

    const insertedBlock = this.Blok.BlockManager.insert({
      id,
      tool,
      data,
      index,
      needToFocus,
      replace,
    });

    return new BlockAPI(insertedBlock);
  };

  /**
   * Creates data of an empty block with a passed type.
   * @param toolName - block tool name
   */
  public composeBlockData = async (toolName: string): Promise<BlockToolData> => {
    const tool = this.Blok.Tools.blockTools.get(toolName);

    if (tool === undefined) {
      throw new Error(`Block Tool with type "${toolName}" not found`);
    }

    const block = new Block({
      tool,
      api: this.Blok.API,
      readOnly: true,
      data: {},
      tunesData: {},
    });

    return block.data;
  };

  /**
   * Updates block data by id
   * @param id - id of the block to update
   * @param data - (optional) the new data
   * @param tunes - (optional) tune data
   */
  public update = async (id: string, data?: Partial<BlockToolData>, tunes?: {[name: string]: BlockTuneData}): Promise<BlockAPIInterface> => {
    const { BlockManager } = this.Blok;
    const block = BlockManager.getBlockById(id);

    if (block === undefined) {
      throw new Error(`Block with id "${id}" not found`);
    }

    const updatedBlock = await BlockManager.update(block, data, tunes);

    return new BlockAPI(updatedBlock);
  };

  /**
   * Converts block to another type. Both blocks should provide the conversionConfig.
   * @param id - id of the existing block to convert. Should provide 'conversionConfig.export' method
   * @param newType - new block type. Should provide 'conversionConfig.import' method
   * @param dataOverrides - optional data overrides for the new block
   * @throws Error if conversion is not possible
   */
  private convert = async (id: string, newType: string, dataOverrides?: BlockToolData): Promise<BlockAPIInterface> => {
    const { BlockManager, Tools } = this.Blok;
    const blockToConvert = BlockManager.getBlockById(id);

    if (!blockToConvert) {
      throw new Error(`Block with id "${id}" not found`);
    }

    const originalBlockTool = Tools.blockTools.get(blockToConvert.name);
    const targetBlockTool = Tools.blockTools.get(newType);

    if (!targetBlockTool) {
      throw new Error(`Block Tool with type "${newType}" not found`);
    }

    const originalBlockConvertable = originalBlockTool?.conversionConfig?.export !== undefined;
    const targetBlockConvertable = targetBlockTool.conversionConfig?.import !== undefined;

    if (originalBlockConvertable && targetBlockConvertable) {
      const newBlock = await BlockManager.convert(blockToConvert, newType, dataOverrides);

      return new BlockAPI(newBlock);
    } else {
      const unsupportedBlockTypes = [
        !originalBlockConvertable ? capitalize(blockToConvert.name) : false,
        !targetBlockConvertable ? capitalize(newType) : false,
      ].filter(Boolean).join(' and ');

      throw new Error(`Conversion from "${blockToConvert.name}" to "${newType}" is not possible. ${unsupportedBlockTypes} tool(s) should provide a "conversionConfig"`);
    }
  };


  /**
   * Inserts several Blocks to a specified index
   * @param blocks - blocks data to insert
   * @param index - index to insert the blocks at
   */
  private insertMany = (
    blocks: OutputBlockData[],
    index: number = this.Blok.BlockManager.blocks.length - 1
  ): BlockAPIInterface[] => {
    this.validateIndex(index);

    const blocksToInsert = blocks.map(({ id, type, data }) => {
      return this.Blok.BlockManager.composeBlock({
        id,
        tool: type || (this.config.defaultBlock as string),
        data,
      });
    });

    this.Blok.BlockManager.insertMany(blocksToInsert, index);

    return blocksToInsert.map((block) => new BlockAPI(block));
  };

  /**
   * Stops mutation watching on a block at the specified index.
   * This is used to prevent spurious block-changed events during block replacement.
   * @param index - index of the block to stop watching
   */
  private stopBlockMutationWatching(index: number): void {
    const block = this.Blok.BlockManager.getBlockByIndex(index);

    if (block !== undefined) {
      block.unwatchBlockMutations();
    }
  }

  /**
   * Atomically splits a block by updating the current block's data and inserting a new block.
   * Both operations are grouped into a single undo entry.
   *
   * @param currentBlockId - id of the block to update
   * @param currentBlockData - new data for the current block (typically truncated content)
   * @param newBlockType - tool type for the new block
   * @param newBlockData - data for the new block (typically extracted content)
   * @param insertIndex - index where to insert the new block
   * @returns the newly created block
   */
  private splitBlock = (
    currentBlockId: string,
    currentBlockData: Partial<BlockToolData>,
    newBlockType: string,
    newBlockData: BlockToolData,
    insertIndex: number
  ): BlockAPIInterface => {
    // Force new undo group so block split is separate from previous typing.
    this.Blok.YjsManager.stopCapturing();

    const newBlock = this.Blok.BlockManager.splitBlockWithData(
      currentBlockId,
      currentBlockData,
      newBlockType,
      newBlockData,
      insertIndex
    );

    // Use requestAnimationFrame to delay stopCapturing until after MutationObserver callbacks
    // have been processed. This ensures any DOM sync operations from the split complete first,
    // keeping them in the same undo entry as the split itself.
    requestAnimationFrame(() => {
      this.Blok.YjsManager.stopCapturing();
    });

    return new BlockAPI(newBlock);
  };

  /**
   * Validated block index and throws an error if it's invalid
   * @param index - index to validate
   */
  private validateIndex(index: unknown): void {
    if (typeof index !== 'number') {
      throw new Error('Index should be a number');
    }

    if (index < 0) {
      throw new Error(`Index should be greater than or equal to 0`);
    }
  }
}
