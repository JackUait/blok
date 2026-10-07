import { ConversionConfig, PasteConfig, SanitizerConfig } from '../configs';
import { BlockTool, BlockToolConstructable, BlockToolConstructorOptions } from './block-tool';
import { BlockToolData } from './block-tool-data';
import { RichText } from '../rich-text';
import { ToolboxConfig } from './tool-settings';

/**
 * A saved paragraph, as the editor hands it to the host.
 */
export interface ParagraphData extends BlockToolData {
  text: RichText;
}

/**
 * The data the Paragraph tool class reads and writes (constructor, `merge`,
 * `validate`, `save`). The editor converts it to {@link ParagraphData} on output.
 */
export interface ParagraphToolData extends BlockToolData {
  /** Inline HTML: <a><b><i> and the other inline tags. */
  text: string;
}

/**
 * Style overrides for paragraph customization
 */
export interface ParagraphStyleConfig {
  /** Custom font size (e.g., '16px', '1rem') */
  size?: string;
  /** Custom line height (e.g., '1.6', '24px') */
  lineHeight?: string;
  /** Custom margin top (e.g., '10px', '0.5rem') */
  marginTop?: string;
  /** Custom margin bottom (e.g., '10px', '0.5rem') */
  marginBottom?: string;
}

/**
 * Paragraph Tool's configuration
 */
export interface ParagraphConfig {
  /** Placeholder for the empty paragraph */
  placeholder?: string;
  /** Whether or not to keep blank paragraphs when saving editor data */
  preserveBlank?: boolean;
  /** Style overrides for paragraph customization */
  styles?: ParagraphStyleConfig;
  /** Custom icon SVG string for the toolbox */
  icon?: string;
}

/**
 * Paragraph Tool constructor options
 */
export type ParagraphConstructorOptions = BlockToolConstructorOptions<ParagraphToolData, ParagraphConfig>;

/**
 * Paragraph Tool for the Blok Editor
 * Provides Text Block
 */
export declare class Paragraph implements BlockTool {
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

  constructor(options: ParagraphConstructorOptions);

  /**
   * Return Tool's view
   */
  render(): HTMLDivElement;

  /**
   * Method that specified how to merge two Paragraph blocks.
   * Called by Editor by backspace at the beginning of the Block
   */
  merge(data: ParagraphToolData): void;

  /**
   * Validate Paragraph block data
   */
  validate(savedData: ParagraphToolData): boolean;

  /**
   * Extract Tool's data from the view
   */
  save(toolsContent: HTMLDivElement): ParagraphToolData;
}

/**
 * Paragraph Tool constructor
 * @deprecated Use `typeof Paragraph` and {@link ParagraphConstructorOptions} instead
 */
export interface ParagraphConstructable extends BlockToolConstructable {
  new(config: ParagraphConstructorOptions): Paragraph;
}
