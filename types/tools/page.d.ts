import { ConversionConfig, SanitizerConfig } from '../configs';
import { BlockTool, BlockToolConstructorOptions } from './block-tool';
import { BlockToolData } from './block-tool-data';
import { ToolboxConfig } from './tool-settings';

/**
 * A page's icon: an emoji, or an image at a URL.
 */
export type PageIcon = { type: 'emoji'; value: string } | { type: 'image'; url: string };

/**
 * A display copy of the page's title and icon.
 * The page itself holds the real ones; this copy can be stale.
 */
export interface PageCache {
  title?: string;
  icon?: PageIcon;
}

/**
 * Page Tool's saved data. The block points at a page; it does not hold it.
 *
 * There is no top-level `title`. Top-level string keys merge per character
 * in collaboration, so two clients refreshing the same copy could double it.
 */
export interface PageData extends BlockToolData {
  /** Id of the page this block points at. Blok mints it for a new page. */
  pageId: string;
  /** Display copy, refreshed from `PageConfig.resolve`. */
  cache?: PageCache;
}

/**
 * What the host knows about a page right now.
 *
 * Return the full picture: a missing `title` or `icon` means the page has none,
 * and the block's cached copy loses it.
 */
export interface PageInfo {
  title?: string;
  icon?: PageIcon;
  /** `'none'`: this user may not see the page. The block shows "No access" and hides the cached title. */
  access?: 'none';
  /**
   * Titles of the pages above this one, top first, e.g. `['Home', 'Plans']`.
   * The hover preview shows them as a path above the title. Never saved.
   */
  path?: string[];
}

/**
 * Page Tool's configuration. The host owns pages; Blok only links to them.
 */
export interface PageConfig {
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
   * Fresh title and icon, asked once when the block renders.
   * - `null`: the page does not exist. The block shows "Page not found" and stays.
   * - `undefined`: nothing known. The cached copy stays.
   * - `{ access: 'none' }`: no access.
   * The cached copy is saved only when it changed. Read-only mode shows it
   * and saves it once editing turns on.
   */
  resolve?(pageId: string): PageInfo | null | undefined | Promise<PageInfo | null | undefined>;
  /**
   * Makes the page for a new page block. Called once, when a page block is
   * inserted without a `pageId`, with the id Blok minted. Never called on load,
   * undo, redo or a collaborator's change. If it throws, the block shows
   * "Page not found" until `resolve` finds the page.
   */
  create?(init: { pageId: string }): void | Promise<void>;
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

  /**
   * Cached text and ids, declared PLAINTEXT so load and save never parse them as HTML
   */
  static sanitize?: SanitizerConfig;

  /**
   * Exports the cached title, so a page can be turned into text
   */
  static conversionConfig?: ConversionConfig;

  /**
   * Always false: the page body lives in another document, so nothing nests under the block
   */
  static acceptsChildren?: boolean;

  /**
   * A link to the page: the absolute `config.href` url and the cached title.
   * Copy, Duplicate and Alt-drag carry it instead of a second block for the
   * same page. Null without `href`.
   */
  static copyAsLink(data: PageData, config: PageConfig): { url: string; text: string } | null;

  constructor(options: PageConstructorOptions);

  /**
   * Return Tool's view
   */
  render(): HTMLElement;

  /**
   * Starts creating a new page, or refreshes the cached copy
   */
  rendered(): void;

  /**
   * Extract Tool's data
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
