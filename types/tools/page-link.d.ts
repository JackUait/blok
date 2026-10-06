import { SanitizerConfig } from '../configs';
import { BlockTool, BlockToolConstructorOptions } from './block-tool';
import { BlockToolData } from './block-tool-data';
import { PageConfig } from './page';

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
