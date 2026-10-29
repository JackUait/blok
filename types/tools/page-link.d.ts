import { SanitizerConfig } from '../configs';
import { BlockTool, BlockToolConstructorOptions, ToolboxPickContext } from './block-tool';
import { BlockToolData } from './block-tool-data';
import { PageConfig } from './page';
import { ToolboxConfig, ToolboxConfigEntry } from './tool-settings';

/** Saved data of a non-owning page reference. */
export interface PageLinkData extends BlockToolData {
  pageId: string;
}

export type PageLinkConstructorOptions = BlockToolConstructorOptions<PageLinkData, PageConfig>;

/** A block that references a host page without owning it. */
export declare class PageLink implements BlockTool {
  static sanitize?: SanitizerConfig;
  static isReadOnlySupported?: boolean;
  static acceptsChildren?: boolean;
  /** "Link to page" in the "/" menu, in Basic blocks. */
  static toolbox?: ToolboxConfig;

  /**
   * Hides "Link to page" unless this tool's config has `search`. "/" reads
   * page-link's config; "@" reads the page tool's.
   */
  static filterToolbox(entries: ToolboxConfigEntry[], config: PageConfig): ToolboxConfigEntry[];

  /**
   * Opens a page picker with its own search field. Resolves with the picked
   * page; rejects when the picker closes any other way. Toolbox only.
   */
  static pickInsert(config: PageConfig, context: ToolboxPickContext): Promise<PageLinkData>;

  constructor(options: PageLinkConstructorOptions);

  render(): HTMLElement;
  rendered(): void;
  save(): PageLinkData;
  validate(data: PageLinkData): boolean;
  setData(data: PageLinkData): boolean;
  setReadOnly(state: boolean): void;
  onNavigationEnter(event: KeyboardEvent): boolean;
  removed(): void;
  destroy(): void;
}
