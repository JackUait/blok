import { ConversionConfig, SanitizerConfig } from '../configs';
import { BlockTool, BlockToolConstructorOptions } from './block-tool';
import { BlockToolData } from './block-tool-data';
import { OutputBlockData } from '../data-formats/output-data';
import { ToolboxConfig } from './tool-settings';

/** What `create` may answer: the id the host gave the page, or nothing to keep Blok's. */
export type PageCreateResult = void | { pageId: string };

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
  /** Block text color preset name, e.g. `'red'`. Set from the block menu's Color. */
  textColor?: string;
  /** Block background color preset name. Set from the block menu's Color. */
  backgroundColor?: string;
  /** @deprecated Written only by pre-release builds; ignored on input and never saved. */
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
   * Makes the page for a new page block. Called once per new page, with an id
   * Blok minted. Never called on load, undo, redo or a collaborator's change.
   *
   * From the toolbox, Blok waits for it and shows the item as busy, then
   * inserts the block. Return `{ pageId }` to use your backend's id instead of
   * Blok's. If it throws, no block is inserted; show the error yourself.
   *
   * From `blocks.insert('page')` without a `pageId`, the block is inserted
   * first, so it keeps Blok's id and a returned id is ignored with a warning.
   * Pass your own `pageId` to `insert` instead. If it throws, the block shows
   * "Page not found" until `resolve` finds the page.
   */
  create?(init: { pageId: string }): PageCreateResult | Promise<PageCreateResult>;
  /**
   * Saves a new title. Called by the block menu's Rename and Cmd/Ctrl+Shift+R
   * on the selected block. Without it, Rename is not offered. Blok shows the
   * new title at once, then asks `resolve` again; a rejection brings back the
   * host's title.
   */
  rename?(pageId: string, title: string): void | Promise<void>;
  /**
   * Saves a new icon picked in the block menu's Edit icon. `null` removes it.
   * Without it, Edit icon is not offered. Settles like `rename`.
   */
  setIcon?(pageId: string, icon: PageIcon | null): void | Promise<void>;
  /**
   * Opens the page in a side panel. Called by the block menu's
   * "Open in side peek" and by Alt+click on the block. Without it, the item
   * is not offered and Alt+click keeps the browser's meaning.
   */
  peek?(pageId: string, ctx: { event?: MouseEvent }): void;
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

  /** Page ID uses plain-text sanitization. */
  static sanitize?: SanitizerConfig;

  /** Exports a neutral label, never a title. */
  static conversionConfig?: ConversionConfig;

  /**
   * Always false: the page body lives in another document, so nothing nests under the block
   */
  static acceptsChildren?: boolean;

  /**
   * A link to the page with neutral text. A paste outside the page's own
   * document, and other apps, get it. In that document, paste, Duplicate and
   * Alt-drag make another block for the same page. Null without `href`.
   */
  static copyAsLink(data: PageData, config: PageConfig): { url: string; text: string } | null;

  /** A titled "Page" menu with Turn into first; Delete reads "Move to Trash". */
  static blockMenu?: { titled: boolean; trash: boolean };

  /** Asks `config.create` for a new page, for the toolbox to insert. */
  static prepareInsert(config: PageConfig): Promise<PageData>;

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
