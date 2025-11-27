import type { BlockAPI as BlockAPIInterface, Blocks } from '../../../../types/api';
import type { BlockToolData, OutputBlockData, OutputData, ToolConfig } from '../../../../types';
import * as _ from './../../utils';
import BlockAPI from '../../block/api';
import Module from '../../__module';
import Block from '../../block';
import { capitalize } from '../../utils';
import type { BlockTuneData } from '../../../../types/block-tunes/block-tune-data';

/**
 * @class BlocksAPI
 * provides with methods working with Block
 */
export default class BlocksAPI extends Module {
  /**
   * Available methods
   * @returns {Blocks}
   */
  public get methods(): Blocks {
    return {
      clear: (): Promise<void> => this.clear(),
      render: (data: OutputData): Promise<void> => this.render(data),
      renderFromHTML: (data: string): Promise<void> => this.renderFromHTML(data),
      delete: (index?: number): void => this.delete(index),
      move: (toIndex: number, fromIndex?: number): void => this.move(toIndex, fromIndex),
      getBlockByIndex: (index: number): BlockAPIInterface | undefined => this.getBlockByIndex(index),
      getById: (id: string): BlockAPIInterface | null => this.getById(id),
      getCurrentBlockIndex: (): number => this.getCurrentBlockIndex(),
      getBlockIndex: (id: string): number | undefined => this.getBlockIndex(id),
      getBlocksCount: (): number => this.getBlocksCount(),
      getBlockByElement: (element: HTMLElement) => this.getBlockByElement(element),
      insert: this.insert,
      insertMany: this.insertMany,
      update: this.update,
      composeBlockData: this.composeBlockData,
      convert: this.convert,
      // @ts-expect-error stretchBlock is deprecated
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      stretchBlock: (index: number, status = true): void => this.stretchBlock(index, status),
    };
  }

  /**
   * Returns Blocks count
   * @returns {number}
   */
  public getBlocksCount(): number {
    return this.Editor.BlockManager.blocks.length;
  }

  /**
   * Returns current block index
   * @returns {number}
   */
  public getCurrentBlockIndex(): number {
    return this.Editor.BlockManager.currentBlockIndex;
  }

  /**
   * Returns the index of Block by id;
   * @param id - block id
   */
  public getBlockIndex(id: string): number | undefined {
    const block = this.Editor.BlockManager.getBlockById(id);

    if (!block) {
      _.logLabeled('There is no block with id `' + id + '`', 'warn');

      return;
    }

    return this.Editor.BlockManager.getBlockIndex(block);
  }

  /**
   * Returns BlockAPI object by Block index
   * @param {number} index - index to get
   */
  public getBlockByIndex(index: number): BlockAPIInterface | undefined {
    const block = this.Editor.BlockManager.getBlockByIndex(index);

    if (block === undefined) {
      _.logLabeled('There is no block at index `' + index + '`', 'warn');

      return;
    }

    return new BlockAPI(block);
  }

  /**
   * Returns BlockAPI object by Block id
   * @param id - id of block to get
   */
  public getById(id: string): BlockAPIInterface | null {
    const block = this.Editor.BlockManager.getBlockById(id);

    if (block === undefined) {
      _.logLabeled('There is no block with id `' + id + '`', 'warn');

      return null;
    }

    return new BlockAPI(block);
  }

  /**
   * Get Block API object by any child html element
   * @param element - html element to get Block by
   */
  public getBlockByElement(element: HTMLElement): BlockAPIInterface | undefined {
    const block = this.Editor.BlockManager.getBlock(element);

    if (block === undefined) {
      _.logLabeled('There is no block corresponding to element `' + element + '`', 'warn');

      return;
    }

    return new BlockAPI(block);
  }

  /**
   * Move block from one index to another
   * @param {number} toIndex - index to move to
   * @param {number} fromIndex - index to move from
   */
  public move(toIndex: number, fromIndex?: number): void {
    this.Editor.BlockManager.move(toIndex, fromIndex);
  }

  /**
   * Deletes Block
   * @param {number} blockIndex - index of Block to delete
   */
  public delete(blockIndex: number = this.Editor.BlockManager.currentBlockIndex): void {
    const block = this.Editor.BlockManager.getBlockByIndex(blockIndex);

    if (block === undefined) {
      _.logLabeled(`There is no block at index \`${blockIndex}\``, 'warn');

      return;
    }

    try {
      void this.Editor.BlockManager.removeBlock(block);
    } catch (error: unknown) {
      _.logLabeled(error as unknown as string, 'warn');

      return;
    }

    /**
     * in case of last block deletion
     * Insert the new default empty block
     */
    if (this.Editor.BlockManager.blocks.length === 0) {
      this.Editor.BlockManager.insert();
    }

    /**
     * After Block deletion currentBlock is updated
     */
    if (this.Editor.BlockManager.currentBlock) {
      this.Editor.Caret.setToBlock(this.Editor.BlockManager.currentBlock, this.Editor.Caret.positions.END);
    }

    this.Editor.Toolbar.close();
  }

  /**
   * Clear Editor's area
   */
  public async clear(): Promise<void> {
    await this.Editor.BlockManager.clear(true);
    this.Editor.InlineToolbar.close();
  }

  /**
   * Fills Editor with Blocks data
   * @param {OutputData} data — Saved Editor data
   */
  public async render(data: OutputData): Promise<void> {
    if (data === undefined || data.blocks === undefined) {
      throw new Error('Incorrect data passed to the render() method');
    }

    /**
     * Semantic meaning of the "render" method: "Display the new document over the existing one that stays unchanged"
     * So we need to disable modifications observer temporarily
     */
    this.Editor.ModificationsObserver.disable();

    await this.Editor.BlockManager.clear();
    await this.Editor.Renderer.render(data.blocks);

    this.Editor.ModificationsObserver.enable();
  }

  /**
   * Render passed HTML string
   * @param {string} data - HTML string to render
   * @returns {Promise<void>}
   */
  public async renderFromHTML(data: string): Promise<void> {
    await this.Editor.BlockManager.clear();

    return this.Editor.Paste.processText(data, true);
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

    const insertedBlock = this.Editor.BlockManager.insert({
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
    const tool = this.Editor.Tools.blockTools.get(toolName);

    if (tool === undefined) {
      throw new Error(`Block Tool with type "${toolName}" not found`);
    }

    const block = new Block({
      tool,
      api: this.Editor.API,
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
    const { BlockManager } = this.Editor;
    const block = BlockManager.getBlockById(id);

    if (block === undefined) {
      throw new Error(`Block with id "${id}" not found`);
    }

    const updatedBlock = await BlockManager.update(block, data, tunes);

    return new BlockAPI(updatedBlock);
  };

  /**
   * Stretch Block by index
   * @param index - index of Block to stretch
   * @param status - true to stretch, false to unstretch
   * @deprecated
   */
  public stretchBlock(index: number, status = true): void {
    const block = this.Editor.BlockManager.getBlockByIndex(index);

    if (!block) {
      return;
    }

    block.setStretchState(status);
  }

  /**
   * Converts block to another type. Both blocks should provide the conversionConfig.
   * @param id - id of the existing block to convert. Should provide 'conversionConfig.export' method
   * @param newType - new block type. Should provide 'conversionConfig.import' method
   * @param dataOverrides - optional data overrides for the new block
   * @throws Error if conversion is not possible
   */
  private convert = async (id: string, newType: string, dataOverrides?: BlockToolData): Promise<BlockAPIInterface> => {
    const { BlockManager, Tools } = this.Editor;
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
    index: number = this.Editor.BlockManager.blocks.length - 1
  ): BlockAPIInterface[] => {
    this.validateIndex(index);

    const blocksToInsert = blocks.map(({ id, type, data }) => {
      return this.Editor.BlockManager.composeBlock({
        id,
        tool: type || (this.config.defaultBlock as string),
        data,
      });
    });

    this.Editor.BlockManager.insertMany(blocksToInsert, index);

    return blocksToInsert.map((block) => new BlockAPI(block));
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

    if (index === null) {
      throw new Error(`Index should be greater than or equal to 0`);
    }
  }
}
