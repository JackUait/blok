import { SanitizerConfig } from '../configs';
import { BlockTool, BlockToolConstructorOptions, ChildToolRestrictions } from './block-tool';
import { BlockToolData } from './block-tool-data';

/**
 * Tab Tool's input and output data format.
 * The tab's content is its child blocks (contentIds), not part of `data`.
 */
export interface TabData extends BlockToolData {
  /**
   * Plain-text label shown in the tab strip (no HTML)
   */
  title: string;

  /**
   * Optional emoji shown before the title
   */
  icon?: string;
}

/**
 * Tab Tool constructor options
 */
export type TabConstructorOptions = BlockToolConstructorOptions<TabData>;

/**
 * Tab Tool for the Blok Editor
 * Provides a single tab inside a Tabs block
 */
export declare class TabTool implements BlockTool {
  /**
   * Sanitizer rules description
   */
  static sanitize?: SanitizerConfig;

  /**
   * Is Tool supports read-only mode
   */
  static isReadOnlySupported?: boolean;

  /**
   * Enter on a tab's empty last line adds another line to the tab
   * instead of unwrapping it
   */
  static keepsChildrenOnEnter?: boolean;

  /**
   * A tab is a layout piece: no hover toolbar, never a selection unit
   */
  static isLayout?: boolean;

  /**
   * Deleting a tab deletes its content
   */
  static deletesChildren?: boolean;

  /**
   * A tabs block may not be nested inside a tab
   */
  static childTools?: ChildToolRestrictions;

  constructor(options: TabConstructorOptions);

  /**
   * Return Tool's view
   */
  render(): HTMLElement;

  /**
   * Validate Tab block data
   */
  validate(data: TabData): boolean;

  /**
   * Extract Tool's data from the view
   */
  save(): TabData;

  /**
   * Open this tab in its tabs block
   */
  expand(): void;

  /**
   * Toggle read-only mode in place
   */
  setReadOnly(state: boolean): void;
}
