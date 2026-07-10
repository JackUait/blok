import { BlockTool, BlockToolConstructable, BlockToolConstructorOptions } from './block-tool';
import { BlockToolData } from './block-tool-data';
import { MenuConfig } from './menu-config';

/**
 * Header Tool's input and output data format
 */
export interface HeaderData extends BlockToolData {
  /** Header's content */
  text: string;
  /** Header's level from 1 to 6 */
  level: number;
}

/**
 * Level-specific overrides for customization
 */
export interface HeaderLevelConfig {
  /** Custom HTML tag to use (e.g., 'div', 'p', 'span') */
  tag?: string;
  /** Custom display name for this level */
  name?: string;
  /** Custom font size (e.g., '3em', '24px') */
  size?: string;
  /** Custom margin top (e.g., '20px', '1rem') */
  marginTop?: string;
  /** Custom margin bottom (e.g., '10px', '0.5rem') */
  marginBottom?: string;
}

/**
 * Header Tool's configuration
 */
export interface HeaderConfig {
  /** Block's placeholder */
  placeholder?: string;
  /** Heading levels available (1-6) */
  levels?: number[];
  /** Default level */
  defaultLevel?: number;
  /** Level-specific overrides keyed by level number (1-6) */
  levelOverrides?: Record<number, HeaderLevelConfig>;
  /**
   * Opt-in text-derived anchor ids on rendered heading elements (default: off).
   *
   * - `true` — built-in slugifier: strips zero-width characters and punctuation
   *   (Unicode letters and digits survive, case is PRESERVED), collapses
   *   whitespace runs into single hyphens (e.g. «Обучайте команду» →
   *   id "Обучайте-команду").
   * - a function `(text, blockId) => string` — consumer-provided id generator;
   *   an empty-string return means "no id".
   *
   * The id is kept in sync when the heading text changes and survives level
   * changes and re-renders. Toggle headings get ids through the same path.
   *
   * NOTE: cross-block duplicate deduplication is explicitly OUT of scope —
   * consumers that need unique ids must dedup themselves.
   */
  anchorIds?: boolean | ((text: string, blockId: string) => string);
}

/**
 * Header Tool for the Blok Editor
 * Provides Headings Blocks (H1-H6)
 */
export interface Header extends BlockTool {
  /**
   * Return Tool's view
   */
  render(): HTMLHeadingElement;

  /**
   * Returns header block tunes config
   */
  renderSettings(): MenuConfig;

  /**
   * Method that specified how to merge two Header blocks.
   * Called by Editor by backspace at the beginning of the Block
   */
  merge(data: HeaderData): void;

  /**
   * Validate Header block data
   */
  validate(blockData: HeaderData): boolean;

  /**
   * Extract Tool's data from the view
   */
  save(toolsContent: HTMLHeadingElement): HeaderData;

  /**
   * Get current Tool's data
   */
  data: HeaderData;
}

/**
 * Header Tool constructor
 */
export interface HeaderConstructable extends BlockToolConstructable {
  new(config: BlockToolConstructorOptions<HeaderData, HeaderConfig>): Header;
}
