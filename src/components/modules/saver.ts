/**
 * Editor.js Saver
 *
 * @module Saver
 * @author Codex Team
 * @version 2.0.0
 */
import Module from '../__module';
import type { BlockToolData, OutputData, SanitizerConfig } from '../../../types';
import type { SavedData, ValidatedData } from '../../../types/data-formats';
import type { BlockTuneData } from '../../../types/block-tunes/block-tune-data';
import type Block from '../block';
import * as _ from '../utils';
import { sanitizeBlocks } from '../utils/sanitizer';

type SaverValidatedData = ValidatedData & {
  tunes?: Record<string, BlockTuneData>;
};

type SanitizableBlockData = SaverValidatedData & Pick<SavedData, 'data' | 'tool'>;

/**
 * @classdesc This method reduces all Blocks asyncronically and calls Block's save method to extract data
 * @typedef {Saver} Saver
 * @property {Element} html - Editor HTML content
 * @property {string} json - Editor JSON output
 */
export default class Saver extends Module {
  /**
   * Stores the last error raised during save attempt
   */
  private lastSaveError?: unknown;

  /**
   * Composes new chain of Promises to fire them alternatelly
   *
   * @returns {OutputData | undefined}
   */
  public async save(): Promise<OutputData | undefined> {
    const { BlockManager, Tools } = this.Editor;
    const blocks = BlockManager.blocks;
    const chainData: Array<Promise<SaverValidatedData>> = blocks.map((block: Block) => {
      return this.getSavedData(block);
    });

    this.lastSaveError = undefined;

    try {
      const extractedData = await Promise.all(chainData);
      const sanitizedData = this.sanitizeExtractedData(
        extractedData,
        (name) => Tools.blockTools.get(name)?.sanitizeConfig,
        this.config.sanitizer as SanitizerConfig
      );

      return this.makeOutput(sanitizedData);
    } catch (error: unknown) {
      this.lastSaveError = error;

      const normalizedError = error instanceof Error ? error : new Error(String(error));

      _.logLabeled(`Saving failed due to the Error %o`, 'error', normalizedError);

      return undefined;
    }
  }

  /**
   * Saves and validates
   *
   * @param {Block} block - Editor's Tool
   * @returns {ValidatedData} - Tool's validated data
   */
  private async getSavedData(block: Block): Promise<SaverValidatedData> {
    const blockData = await block.save();
    const toolName = block.name;

    if (blockData === undefined) {
      return {
        tool: toolName,
        isValid: false,
      };
    }

    const isValid = await block.validate(blockData.data);

    return {
      ...blockData,
      isValid,
    };
  }

  /**
   * Creates output object with saved data, time and version of editor
   *
   * @param {ValidatedData} allExtractedData - data extracted from Blocks
   * @returns {OutputData}
   */
  private makeOutput(allExtractedData: SaverValidatedData[]): OutputData {
    const blocks: OutputData['blocks'] = [];

    allExtractedData.forEach(({ id, tool, data, tunes, isValid }) => {
      if (!isValid) {
        _.log(`Block «${tool}» skipped because saved data is invalid`);

        return;
      }

      if (tool === undefined || data === undefined) {
        _.log('Block skipped because saved data is missing required fields');

        return;
      }

      /** If it was stub Block, get original data */
      if (tool === this.Editor.Tools.stubTool && this.isStubSavedData(data)) {
        blocks.push(data);

        return;
      }

      if (tool === this.Editor.Tools.stubTool) {
        _.log('Stub block data is malformed and was skipped');

        return;
      }

      const isTunesEmpty = tunes === undefined || _.isEmpty(tunes);
      const output: OutputData['blocks'][number] = {
        id,
        type: tool,
        data,
        ...!isTunesEmpty && {
          tunes,
        },
      };

      blocks.push(output);
    });

    return {
      time: +new Date(),
      blocks,
      version: _.getEditorVersion(),
    };
  }

  /**
   * Sanitizes extracted block data in-place
   *
   * @param extractedData - collection of saved block data
   * @param getToolSanitizeConfig - resolver for tool-specific sanitize config
   * @param globalSanitizer - global sanitizer config specified in editor settings
   */
  private sanitizeExtractedData(
    extractedData: SaverValidatedData[],
    getToolSanitizeConfig: (toolName: string) => SanitizerConfig | undefined,
    globalSanitizer: SanitizerConfig
  ): SaverValidatedData[] {
    const blocksToSanitize: Array<{ index: number; data: SanitizableBlockData }> = [];

    extractedData.forEach((blockData, index) => {
      if (this.hasSanitizableData(blockData)) {
        blocksToSanitize.push({
          index,
          data: blockData,
        });
      }
    });

    if (blocksToSanitize.length === 0) {
      return extractedData;
    }

    const sanitizedBlocks = sanitizeBlocks(
      blocksToSanitize.map(({ data }) => data),
      getToolSanitizeConfig,
      globalSanitizer
    );

    const updatedData = extractedData.map((blockData) => ({ ...blockData }));

    blocksToSanitize.forEach(({ index }, sanitizedIndex) => {
      const sanitized = sanitizedBlocks[sanitizedIndex];

      updatedData[index] = {
        ...updatedData[index],
        data: sanitized.data,
      };
    });

    return updatedData;
  }

  /**
   * Checks whether block data contains fields required for sanitizing procedure
   *
   * @param blockData - data to check
   */
  private hasSanitizableData(blockData: SaverValidatedData): blockData is SanitizableBlockData {
    return blockData.data !== undefined && typeof blockData.tool === 'string';
  }

  /**
   * Check that stub data matches OutputBlockData format
   *
   * @param data - saved stub data that should represent original block payload
   */
  private isStubSavedData(data: BlockToolData): data is OutputData['blocks'][number] {
    if (!_.isObject(data)) {
      return false;
    }

    const candidate = data as Record<string, unknown>;

    return typeof candidate.type === 'string' && candidate.data !== undefined;
  }

  /**
   * Returns the last error raised during save attempt
   */
  public getLastSaveError(): unknown {
    return this.lastSaveError;
  }
}
