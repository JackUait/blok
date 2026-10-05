import type { BlockToolData, OutputBlockData } from '../../../types';

/** What `create` may answer: the id the host gave the page, or nothing to keep Blok's. */
export type PageCreateResult = void | { pageId: string };

/** A page's icon: an emoji, or an image at a URL. */
export type PageIcon = { type: 'emoji'; value: string } | { type: 'image'; url: string };

/** Legacy input metadata, ignored by the page tool. */
export interface PageCache {
  title?: string;
  icon?: PageIcon;
}

/**
 * Saved data of a page block. It points at a page; it does not hold it.
 * There is no top-level `title`: that key merges per character in collab.
 */
export interface PageData extends BlockToolData {
  pageId: string;
  /** Block text color preset, e.g. 'red'. Lives in the parent document, not the page. */
  textColor?: string;
  /** Block background color preset. */
  backgroundColor?: string;
  /** @deprecated Written only by pre-release builds; ignored on input and never saved. */
  cache?: PageCache;
}

/**
 * What the host knows about a page right now. A missing field means the page
 * has none. `access: 'none'` means this user may not see it.
 */
export interface PageInfo {
  title?: string;
  icon?: PageIcon;
  access?: 'none';
  /** Titles of the pages above this one, top first. Shown in the hover preview. */
  path?: string[];
}

/** A page the host offers for an inline reference. */
export interface PageSearchResult {
  pageId: string;
  title?: string;
  icon?: PageIcon;
  access?: 'none';
}

/** Page tool config. Every hook is optional. */
export interface PageConfig {
  /** Searches visible pages for an inline reference. */
  search?(query: string): Promise<readonly PageSearchResult[]>;
  /** The page's URL. Without it the link has no href. */
  href?(pageId: string): string;
  /** Opens the page on a plain click. Without it the link navigates to `href`. */
  open?(pageId: string, ctx: { event?: MouseEvent | KeyboardEvent }): void;
  /** Authorized metadata. `null` means missing; `undefined` means unresolved. */
  resolve?(pageId: string): PageInfo | null | undefined | Promise<PageInfo | null | undefined>;
  /** Makes the page a new page block points at. May answer with the host's own id. */
  create?(init: { pageId: string }): PageCreateResult | Promise<PageCreateResult>;
  /** Calls `onChange` for local-tab and remote metadata or access changes. */
  subscribe?(pageId: string, onChange: () => void): (() => void) | void;
  /** Saves a new title from the block menu's Rename. */
  rename?(pageId: string, title: string): void | Promise<void>;
  /** Saves a new icon from the block menu's Edit icon; `null` removes it. */
  setIcon?(pageId: string, icon: PageIcon | null): void | Promise<void>;
  /** Opens the page in a side panel, from the menu or Alt+click. */
  peek?(pageId: string, ctx: { event?: MouseEvent }): void;
  /** Copies `sourcePageId` into a new page with the id Blok minted, for Duplicate and Alt-drag. */
  duplicate?(init: { sourcePageId: string; pageId: string }): void | Promise<void>;
  /** The page's opening blocks, for the hover preview. */
  preview?(pageId: string): OutputBlockData[] | null | undefined | Promise<OutputBlockData[] | null | undefined>;
}
