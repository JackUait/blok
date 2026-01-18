import type {
  BlockTool as IBlockTool,
  ConversionConfig,
} from '../../../types';
import type { BlockTuneData } from '../../../types/block-tunes/block-tune-data';
import type { SavedData } from '../../../types/data-formats';
import { Dom as $ } from '../dom';
import { isEmpty, log } from '../utils';
import { convertBlockDataToString } from '../utils/blocks';

import type { InputManager } from './input-manager';
import type { TunesManager } from './tunes-manager';

/**
 * Result of saving block data with type-safe data field
 */
type BlockSaveResult = Omit<SavedData, 'data'> & {
  data: SafeBlockToolData;
  tunes: { [name: string]: BlockTuneData };
};

/**
 * Type-safe block tool data that doesn't default to `any`
 */
type SafeBlockToolData = Record<string, unknown>;

/**
 * Handles all data extraction, caching, and in-place updates for a Block.
 * Manages the save/setData/validate lifecycle and preserves last saved data.
 */
export class DataPersistenceManager {
  /**
   * Stores last successfully extracted block data
   */
  private lastSavedDataInternal: SafeBlockToolData;

  /**
   * Stores last successfully extracted tunes data
   */
  private lastSavedTunesInternal: { [name: string]: BlockTuneData };

  /**
   * @param toolInstance - The tool class instance
   * @param getToolRenderedElement - Getter for the tool's rendered element
   * @param tunesManager - Tunes manager for extracting tune data
   * @param name - Block tool name
   * @param getIsEmpty - Getter to check if block is empty
   * @param inputManager - Input manager for cache invalidation
   * @param callToolUpdated - Callback to call tool's updated method
   * @param toggleEmptyMark - Callback to toggle empty marks on inputs
   * @param initialData - Initial block data
   * @param initialTunesData - Initial tunes data
   */
  constructor(
    private readonly toolInstance: IBlockTool,
    private readonly getToolRenderedElement: () => HTMLElement | null,
    private readonly tunesManager: TunesManager,
    private readonly name: string,
    private readonly getIsEmpty: () => boolean,
    private readonly inputManager: InputManager,
    private readonly callToolUpdated: () => void,
    private readonly toggleEmptyMark: () => void,
    initialData: SafeBlockToolData,
    initialTunesData: { [name: string]: BlockTuneData }
  ) {
    this.lastSavedDataInternal = initialData;
    this.lastSavedTunesInternal = initialTunesData;
  }

  /**
   * Extracts data from Block, groups Tool's save processing time
   * @returns Saved data object or undefined if extraction fails
   */
  public async save(): Promise<undefined | BlockSaveResult> {
    const extractedBlock = await this.extractToolData();

    if (extractedBlock === undefined) {
      return undefined;
    }

    const measuringStart = window.performance.now();
    const tunesData = this.tunesManager.extractTunesData();

    this.lastSavedDataInternal = extractedBlock;
    this.lastSavedTunesInternal = { ...tunesData };

    const measuringEnd = window.performance.now();

    return {
      id: this.name, // Will be overridden by Block with actual id
      tool: this.name,
      data: extractedBlock,
      tunes: tunesData,
      time: measuringEnd - measuringStart,
    };
  }

  /**
   * Updates the block's data in-place without destroying the DOM element.
   * Preserves focus and caret position during updates like undo/redo.
   * @param newData - the new data to apply to the block
   * @returns true if the update was performed in-place, false if a full re-render is needed
   */
  public async setData(newData: SafeBlockToolData): Promise<boolean> {
    // Check if tool supports setData method
    const toolSetData = (this.toolInstance as { setData?: (data: SafeBlockToolData) => void | Promise<void> }).setData;

    if (typeof toolSetData === 'function') {
      try {
        await toolSetData.call(this.toolInstance, newData);
        this.lastSavedDataInternal = newData;
        return true;
      } catch (e) {
        log(`Tool ${this.name} setData failed: ${e instanceof Error ? e.message : String(e)}`, 'warn');
        return false;
      }
    }

    // For tools without setData, try to update innerHTML directly for simple text-based tools
    const pluginsContent = this.getToolRenderedElement();

    if (!pluginsContent) {
      return false;
    }

    // Handle simple text-based blocks (like paragraph) with a 'text' property
    const isContentEditable = pluginsContent.getAttribute('contenteditable') === 'true';
    const textValue = newData.text;
    const hasTextProperty = typeof textValue === 'string';
    const isEmptyParagraphData = Object.keys(newData).length === 0 && this.name === 'paragraph';

    if (isContentEditable && (hasTextProperty || isEmptyParagraphData)) {
      const newText = hasTextProperty ? textValue : '';

      pluginsContent.innerHTML = newText;
      this.lastSavedDataInternal = newData;
      this.inputManager.dropCache();
      this.toggleEmptyMark();
      this.callToolUpdated();

      return true;
    }

    // For other tools, fall back to full re-render
    return false;
  }

  /**
   * Uses Tool's validation method to check the correctness of output data.
   * Tool's validation method is optional.
   * @param data - data to validate
   * @returns true if data is valid or no validation method exists
   */
  public async validate(data: SafeBlockToolData): Promise<boolean> {
    if (this.toolInstance.validate instanceof Function) {
      return await this.toolInstance.validate(data);
    }

    return true;
  }

  /**
   * Exports Block data as string using conversion config
   * Always uses fresh data by calling save() first.
   * @returns The block data as a string
   */
  public async exportDataAsString(conversionConfig: ConversionConfig): Promise<string> {
    const blockData = await this.data;

    return convertBlockDataToString(blockData, conversionConfig);
  }

  /**
   * Get Block's JSON data
   * @returns Promise resolving to the block data
   */
  public get data(): Promise<SafeBlockToolData> {
    return this.save().then((savedObject) => {
      if (savedObject && !isEmpty(savedObject.data)) {
        return savedObject.data;
      } else {
        return {};
      }
    });
  }

  /**
   * Get last saved data (internal accessor)
   */
  public get lastSavedData(): SafeBlockToolData {
    return this.lastSavedDataInternal;
  }

  /**
   * Get last saved tunes (internal accessor)
   */
  public get lastSavedTunes(): { [name: string]: BlockTuneData } {
    return this.lastSavedTunesInternal;
  }

  /**
   * Returns last successfully extracted block data
   */
  public get preservedData(): SafeBlockToolData {
    return this.lastSavedDataInternal;
  }

  /**
   * Returns last successfully extracted tune data
   */
  public get preservedTunes(): { [name: string]: BlockTuneData } {
    return this.lastSavedTunesInternal;
  }

  /**
   * Safely executes tool.save capturing possible errors without breaking the saver pipeline
   */
  private async extractToolData(): Promise<SafeBlockToolData | undefined> {
    try {
      const pluginsContent = this.getToolRenderedElement();

      if (pluginsContent === null) {
        return undefined;
      }

      // Cast the result from tool.save() to unknown first to avoid the `any` type,
      // then narrow it properly for type safety
      const extracted = await this.toolInstance.save(pluginsContent) as unknown;

      // If the block is not empty, return the extracted data as-is
      // (it could be string, number, etc. for non-object types)
      if (!this.getIsEmpty()) {
        return extracted as SafeBlockToolData;
      }

      // For empty blocks, skip further processing for null/undefined
      if (extracted === null) {
        return undefined;
      }

      if (extracted === undefined) {
        return undefined;
      }

      // For non-object types, return as-is
      if (typeof extracted !== 'object') {
        return extracted as SafeBlockToolData;
      }

      // Normalize empty fields for object types
      const normalized: Record<string, unknown> = { ...(extracted as Record<string, unknown>) };
      this.sanitizeEmptyFields(normalized);

      return normalized;
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));

      log(
        `Saving process for ${this.name} tool failed due to the ${normalizedError}`,
        'log',
        normalizedError
      );

      return undefined;
    }
  }

  /**
   * Sanitize empty string fields in extracted data
   * For empty blocks, converts empty HTML/text fields to empty strings
   */
  private sanitizeEmptyFields(extracted: Record<string, unknown>): void {
    const sanitizeField = (field: string): void => {
      const value = extracted[field];

      if (typeof value !== 'string') {
        return;
      }

      const container = document.createElement('div');
      container.innerHTML = value;

      if ($.isEmpty(container)) {
        // eslint-disable-next-line no-param-reassign
        extracted[field] = '';
      }
    };

    sanitizeField('text');
    sanitizeField('html');
  }
}
