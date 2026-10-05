import { BlockTool, BlockToolConstructorOptions, ChildToolRestrictions } from './block-tool';
import { BlockToolData } from './block-tool-data';
import { ToolboxConfig } from './tool-settings';

/**
 * Tabs Tool's input and output data format.
 * The tabs block saves nothing itself: its tabs are its `tab` child blocks
 * (contentIds). Which tab is open is UI state and is never saved.
 */
export interface TabsData extends BlockToolData {}

/**
 * Tabs Tool constructor options
 */
export type TabsConstructorOptions = BlockToolConstructorOptions<TabsData>;

/**
 * Tabs Tool for the Blok Editor
 * Provides the tab strip container block; each tab is a `tab` child block
 */
export declare class TabsTool implements BlockTool {
  /**
   * Tool's Toolbox settings
   */
  static toolbox?: ToolboxConfig;

  /**
   * Is Tool supports read-only mode
   */
  static isReadOnlySupported?: boolean;

  /**
   * The tabs block exclusively manages its own child (tab) blocks
   */
  static ownsChildren?: boolean;

  /**
   * Enter inside a tab never unwraps it — the new line stays in the tab
   */
  static keepsChildrenOnEnter?: boolean;

  /**
   * Deleting the tabs block deletes every tab and its content
   */
  static deletesChildren?: boolean;

  /**
   * Only `tab` blocks may be direct children
   */
  static childTools?: ChildToolRestrictions;

  constructor(options: TabsConstructorOptions);

  /**
   * Return Tool's view
   */
  render(): HTMLElement;

  /**
   * Validate Tabs block data
   */
  validate(data: TabsData): boolean;

  /**
   * Extract Tool's data from the view
   */
  save(): TabsData;

  /**
   * Toggle read-only mode in place
   */
  setReadOnly(state: boolean): void;
}
