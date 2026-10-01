import type { BlockToolData, OutputBlockData } from '../../../types';

/** A page's icon: an emoji, or an image at a URL. */
export type PageIcon = { type: 'emoji'; value: string } | { type: 'image'; url: string };

/** A display copy of the page's title and icon. The page itself holds the real ones. */
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

/** Page tool config. Every hook is optional. */
export interface PageConfig {
  /** The page's URL. Without it the link has no href. */
  href?(pageId: string): string;
  /** Opens the page on a plain click. Without it the link navigates to `href`. */
  open?(pageId: string, ctx: { event?: MouseEvent | KeyboardEvent }): void;
  /** Fresh title and icon. `null` means the page does not exist. */
  resolve?(pageId: string): PageInfo | null | undefined | Promise<PageInfo | null | undefined>;
  /** Makes the page a new page block points at. */
  create?(init: { pageId: string }): void | Promise<void>;
  /** The page's opening blocks, for the hover preview. */
  preview?(pageId: string): OutputBlockData[] | null | undefined | Promise<OutputBlockData[] | null | undefined>;
}
