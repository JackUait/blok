import { ConversionConfig, SanitizerConfig } from '../configs';
import { BlockTool, BlockToolConstructorOptions } from './block-tool';
import { BlockToolData } from './block-tool-data';
import { OutputBlockData } from '../data-formats/output-data';
import { ToolboxConfig } from './tool-settings';

/**
 * A page's icon: an emoji, or an image at a URL.
 */
export type PageIcon = { type: 'emoji'; value: string } | { type: 'image'; url: string };

/** Legacy input metadata, ignored by the page tool. */
export interface PageCache {
  title?: string;
  icon?: PageIcon;
}

/** Page pointer data. New saves contain only `pageId`. */
export interface PageData extends BlockToolData {
  /** Id of the page this block points at. Blok mints it for a new page. */
  pageId: string;
  /** @deprecated Legacy input only. New saves omit this field. */
  cache?: PageCache;
}

/** Authorized metadata from the host. Missing fields mean the page has none. */
export interface PageInfo {
  title?: string;
  icon?: PageIcon;
  /** `'none'`: this user may not see the page. The block shows “No access”. */
  access?: 'none';
  /**
   * Titles of the pages above this one, top first, e.g. `['Home', 'Plans']`.
   * The hover preview shows them as a path above the title. Never saved.
   */
  path?: string[];
}

/** A page the host offers for an inline reference. */
export interface PageSearchResult {
  pageId: string;
  title?: string;
  icon?: PageIcon;
  access?: 'none';
}

/**
 * Page Tool's configuration. The host owns pages; Blok only links to them.
 */
export interface PageConfig {
  /** Searches visible pages for an inline reference. */
  search?(query: string): Promise<readonly PageSearchResult[]>;
  /**
   * The page's URL. Used for the link, middle click and Cmd/Ctrl click.
   * Without it the link has no href. Unsafe schemes (`javascript:` and the like) are dropped.
   */
  href?(pageId: string): string;
  /**
   * Opens the page on a plain left click, or on Enter when the block is selected.
   * Without it the link navigates to `href`. Also called once after the user
   * inserts a new page from the toolbox and `create` succeeds.
   */
  open?(pageId: string, ctx: { event?: MouseEvent | KeyboardEvent }): void;
  /**
   * Authorized metadata, asked on render and on each `subscribe` change.
   * `null` means missing; `undefined` means unresolved; `access: 'none'` means denied.
   * Old metadata is hidden while a new access check is pending. Metadata is never saved.
   */
  resolve?(pageId: string): PageInfo | null | undefined | Promise<PageInfo | null | undefined>;
  /**
   * Hears about metadata and access changes, including in the same tab.
   * Call `onChange` to recheck access. Return a function that stops it when
   * the block goes away or points at another page.
   */
  subscribe?(pageId: string, onChange: () => void): (() => void) | void;
  /**
   * Makes the page for a new page block. Called once, when a page block is
   * inserted without a `pageId`, with the id Blok minted. Never called on load,
   * undo, redo or a collaborator's change. If it throws, the block shows
   * "Page not found" until `resolve` finds the page.
   */
  create?(init: { pageId: string }): void | Promise<void>;
  /**
   * The page's opening blocks, asked for when a hover on the block starts.
   * The hover preview shows the first few as small lines of text under the
   * title, like Notion. Without it the preview shows only icon, path and title.
   */
  preview?(pageId: string): OutputBlockData[] | null | undefined | Promise<OutputBlockData[] | null | undefined>;
}

/**
 * Page Tool constructor options
 */
export type PageConstructorOptions = BlockToolConstructorOptions<PageData, PageConfig>;

/**
 * Page Tool for the Blok Editor.
 * A one-line link to another page, like Notion's sub-page block.
 */
export declare class Page implements BlockTool {
  /**
   * Tool's Toolbox settings
   */
  static toolbox?: ToolboxConfig;

  /**
   * Is Tool supports read-only mode
   */
  static isReadOnlySupported?: boolean;

  /** Page ID and legacy cache use plain-text sanitization. */
  static sanitize?: SanitizerConfig;

  /** Does not export legacy cached metadata. */
  static conversionConfig?: ConversionConfig;

  /**
   * Always false: the page body lives in another document, so nothing nests under the block
   */
  static acceptsChildren?: boolean;

  /**
   * A link to the page with neutral text; legacy cached titles are ignored.
   * Copy, Duplicate and Alt-drag carry it instead of a second block.
   * Null without `href`.
   */
  static copyAsLink(data: PageData, config: PageConfig): { url: string; text: string } | null;

  constructor(options: PageConstructorOptions);

  /**
   * Return Tool's view
   */
  render(): HTMLElement;

  /**
   * Starts creating a new page or resolving its metadata
   */
  rendered(): void;

  /**
   * Saves only the page ID
   */
  save(): PageData;

  /**
   * A page block needs a non-empty pageId
   */
  validate(data: PageData): boolean;

  /**
   * Toggle read-only mode
   */
  setReadOnly(state: boolean): void;

  /**
   * Called when the block is removed
   */
  removed(): void;
}
