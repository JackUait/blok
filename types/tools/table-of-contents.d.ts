import { SanitizerConfig } from '../configs';
import { BlockTool, BlockToolConstructorOptions } from './block-tool';
import { BlockToolData } from './block-tool-data';
import { MenuConfig } from './menu-config';
import { ToolboxConfig } from './tool-settings';

/**
 * Table of contents block data. Only the block's color is saved: the heading
 * list is read from the page each time.
 */
export interface TableOfContentsData extends BlockToolData {
  /** Block text color, a preset name such as 'red'. Absent = inherit. */
  textColor?: string;
  /** Block background color, a preset name such as 'blue'. Absent = none. */
  backgroundColor?: string;
}

/**
 * Table of contents constructor options
 */
export type TableOfContentsConstructorOptions = BlockToolConstructorOptions<TableOfContentsData>;

/**
 * Table of contents tool for the Blok Editor.
 * Shows a live outline of the page's headings, each one a link to its block.
 */
export declare class TableOfContents implements BlockTool {
  static toolbox?: ToolboxConfig;
  static sanitize?: SanitizerConfig;
  static isReadOnlySupported?: boolean;
  static acceptsChildren?: boolean;

  constructor(options: TableOfContentsConstructorOptions);

  render(): HTMLElement;
  rendered(): void;
  save(): TableOfContentsData;
  validate(data: TableOfContentsData): boolean;
  setData(data: TableOfContentsData): boolean;
  setReadOnly(state: boolean): void;
  renderSettings(): MenuConfig;
  removed(): void;
  destroy(): void;
  onNavigationEnter(): boolean;
}
