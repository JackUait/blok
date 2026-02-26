/**
 * Blok Saver
 * @module Saver
 * @author Blok Team
 * @version 2.0.0
 */
import type { OutputData, SanitizerConfig } from '../../../types';
import type { BlockTuneData } from '../../../types/block-tunes/block-tune-data';
import type { SavedData, ValidatedData } from '../../../types/data-formats';
import { Module } from '../__module';
import type { Block } from '../block';
import { getBlokVersion, isEmpty, isObject, log, logLabeled } from '../utils';
import { collapseToLegacy, shouldCollapseToLegacy } from '../utils/data-model-transform';
import { sanitizeBlocks } from '../utils/sanitizer';
import { normalizeInlineImages } from './normalizeInlineImages';

type SaverValidatedData = ValidatedData & {
  tunes?: Record<string, BlockTuneData>;
  /**
   * Parent block id for hierarchical structure (Notion-like flat-with-references model)
   */
  parentId?: string | null;
  /**
   * Array of child block ids (Notion-like flat-with-references model)
   */
  contentIds?: string[];
};

type SanitizableBlockData = SaverValidatedData & Pick<SavedData, 'data' | 'tool'>;

/**
 * @classdesc This method reduces all Blocks asyncronically and calls Block's save method to extract data
 * @typedef {Saver} Saver
 * @property {Element} html - Blok HTML content
 * @property {string} json - Blok JSON output
 */
export class Saver extends Module {
  /**
   * Stores the last error raised during save attempt
   */
  private lastSaveError?: unknown;

  /**
   * Stores the in-flight save promise for deduplication.
   * If a save is already in progress, subsequent calls return the same promise.
   */
  private pendingSave: Promise<OutputData | undefined> | null = null;

  /**
   * Composes new chain of Promises to fire them alternatelly.
   * Deduplicates concurrent calls — if a save is already in-flight, returns the same promise.
   * @returns {OutputData | undefined}
   */
  public async save(): Promise<OutputData | undefined> {
    if (this.isDestroyed) {
      return undefined;
    }

    if (this.pendingSave !== null) {
      return this.pendingSave;
    }

    this.pendingSave = this.doSave();

    try {
      return await this.pendingSave;
    } finally {
      this.pendingSave = null;
    }
  }

  /**
   * Internal save implementation.
   * Waits for any pending render to complete before reading blocks.
   * @returns {OutputData | undefined}
   */
  private async doSave(): Promise<OutputData | undefined> {
    // Wait for any in-progress render to complete before reading blocks
    const pendingRender = this.Blok.Renderer?.pendingRender;

    if (pendingRender !== null && pendingRender !== undefined) {
      await pendingRender;
    }

    // Check again after awaiting — editor may have been destroyed during the wait
    if (this.isDestroyed) {
      return undefined;
    }

    const { BlockManager, Tools } = this.Blok;
    const blocks = BlockManager.blocks;

    /**
     * If there is only one block and it is empty and it's the default tool, return empty blocks array.
     * Non-default blocks (like headers or lists created via shortcuts) should be preserved even when empty.
     */
    const shouldFilterSingleBlock = blocks.length === 1 && blocks[0].isEmpty && blocks[0].tool.isDefault;

    if (shouldFilterSingleBlock) {
      return {
        time: +new Date(),
        blocks: [],
        version: getBlokVersion(),
      };
    }

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

      const normalizedData = normalizeInlineImages(sanitizedData);

      // Check destruction one more time after async block.save() operations
      if (this.isDestroyed) {
        return undefined;
      }

      return this.makeOutput(normalizedData);
    } catch (error: unknown) {
      this.lastSaveError = error;

      const normalizedError = error instanceof Error ? error : new Error(String(error));

      logLabeled(`Saving failed due to the Error %o`, 'error', normalizedError);

      return undefined;
    }
  }

  /**
   * Saves and validates
   * @param {Block} block - Blok's Tool
   * @returns {ValidatedData} - Tool's validated data
   */
  private async getSavedData(block: Block): Promise<SaverValidatedData> {
    const blockData = await block.save();
    const toolName = block.name;
    const normalizedData = blockData?.data !== undefined
      ? blockData
      : this.getPreservedSavedData(block);

    if (normalizedData === undefined) {
      return {
        tool: toolName,
        isValid: false,
      };
    }

    const isValid = await block.validate(normalizedData.data);

    return {
      ...normalizedData,
      isValid,
      parentId: block.parentId,
      contentIds: block.contentIds,
    };
  }

  /**
   * Creates output object with saved data, time and version of blok
   * @param {ValidatedData} allExtractedData - data extracted from Blocks
   * @returns {OutputData}
   */
  private makeOutput(allExtractedData: SaverValidatedData[]): OutputData {
    const extractedBlocks: OutputData['blocks'] = [];

    allExtractedData.forEach(({ id, tool, data, tunes, isValid, parentId, contentIds }) => {
      const hasParent = parentId !== undefined && parentId !== null;

      if (!isValid && !hasParent) {
        log(`Block «${tool}» skipped because saved data is invalid`);

        return;
      }

      if (tool === undefined || data === undefined) {
        log('Block skipped because saved data is missing required fields');

        return;
      }

      /** If it was stub Block, get original data */
      if (tool === this.Blok.Tools.stubTool && this.isStubSavedData(data)) {
        extractedBlocks.push(data);

        return;
      }

      if (tool === this.Blok.Tools.stubTool) {
        log('Stub block data is malformed and was skipped');

        return;
      }

      const isTunesEmpty = tunes === undefined || isEmpty(tunes);
      const hasContent = contentIds !== undefined && contentIds.length > 0;

      const output: OutputData['blocks'][number] = {
        id,
        type: tool,
        data,
        ...!isTunesEmpty && {
          tunes,
        },
        ...hasParent && {
          parent: parentId,
        },
        ...hasContent && {
          content: contentIds,
        },
      };

      extractedBlocks.push(output);
    });

    // Apply data model transformation if needed
    const dataModelConfig = this.config.dataModel || 'auto';
    const detectedInputFormat = this.Blok.Renderer?.getDetectedInputFormat?.() ?? 'flat';

    const finalBlocks = shouldCollapseToLegacy(dataModelConfig, detectedInputFormat)
      ? collapseToLegacy(extractedBlocks)
      : extractedBlocks;

    return {
      time: +new Date(),
      blocks: finalBlocks,
      version: getBlokVersion(),
    };
  }

  /**
   * Sanitizes extracted block data in-place
   * @param extractedData - collection of saved block data
   * @param getToolSanitizeConfig - resolver for tool-specific sanitize config
   * @param globalSanitizer - global sanitizer config specified in blok settings
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
   * @param blockData - data to check
   */
  private hasSanitizableData(blockData: SaverValidatedData): blockData is SanitizableBlockData {
    return blockData.data !== undefined && typeof blockData.tool === 'string';
  }

  /**
   * Check that stub data matches OutputBlockData format
   * @param data - saved stub data that should represent original block payload
   */
  private isStubSavedData(data: unknown): data is OutputData['blocks'][number] {
    if (!isObject(data)) {
      return false;
    }

    const candidate = data;

    return typeof candidate.type === 'string' && candidate.data !== undefined;
  }

  /**
   * Returns the last error raised during save attempt
   */
  public getLastSaveError(): unknown {
    return this.lastSaveError;
  }

  /**
   * Returns the last successfully extracted data for the provided block, if any.
   * @param block - block whose preserved data should be returned
   */
  private getPreservedSavedData(block: Block): (SavedData & { tunes?: Record<string, BlockTuneData> }) | undefined {
    const preservedData = block.preservedData;

    if (isEmpty(preservedData)) {
      return undefined;
    }

    const preservedTunes = block.preservedTunes;

    return {
      id: block.id,
      tool: block.name,
      data: preservedData,
      ...( isEmpty(preservedTunes) ? {} : { tunes: preservedTunes }),
      time: 0,
    };
  }
}
