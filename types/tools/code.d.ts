import { ConversionConfig, PasteConfig, SanitizerConfig } from '../configs';
import { BlockTool, BlockToolConstructorOptions } from './block-tool';
import { BlockToolData } from './block-tool-data';
import { MenuConfig } from './menu-config';
import { PasteEvent } from './paste-events';
import { ToolboxConfig } from './tool-settings';

/**
 * Code block tool data format.
 */
export interface CodeData extends BlockToolData {
  /** Raw code text (not HTML) */
  code: string;
  /** Language identifier, e.g. "javascript", "plain text" */
  language: string;
  /** Whether to show line numbers in the gutter */
  lineNumbers?: boolean;
}

/**
 * Code Tool constructor options
 */
export type CodeConstructorOptions = BlockToolConstructorOptions<CodeData>;

/**
 * Code Tool for the Blok Editor
 * Provides syntax-highlighted Code Blocks
 */
export declare class Code implements BlockTool {
  /**
   * Tool's Toolbox settings
   */
  static toolbox?: ToolboxConfig;

  /**
   * Sanitizer rules description
   */
  static sanitize?: SanitizerConfig;

  /**
   * Paste substitutions configuration
   */
  static pasteConfig?: PasteConfig | false;

  /**
   * Rules that specified how this Tool can be converted into/from another Tool
   */
  static conversionConfig?: ConversionConfig;

  /**
   * Is Tool supports read-only mode
   */
  static isReadOnlySupported?: boolean;

  /**
   * Enter inside the code block inserts a newline, not a new block
   */
  static enableLineBreaks?: boolean;

  constructor(options: CodeConstructorOptions);

  /**
   * Return Tool's view
   */
  render(): HTMLElement;

  /**
   * Extract Tool's data from the view
   */
  save(blockContent: HTMLElement): CodeData;

  /**
   * Replace the block's data in place. Returns false when the payload is invalid.
   */
  setData(newData: CodeData): boolean;

  /**
   * Validate Code block data
   */
  validate(savedData: CodeData): boolean;

  /**
   * Method that specified how to merge two Code blocks
   */
  merge(data: CodeData): void;

  /**
   * Returns code block tunes config
   */
  renderSettings(): MenuConfig;

  /**
   * Handle pasted code fences and <pre> tags
   */
  onPaste(event: PasteEvent): void;

  /**
   * Toggle read-only mode
   */
  setReadOnly(state: boolean): void;
}
