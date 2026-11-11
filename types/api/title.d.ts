import type { PageCover, PageIcon } from '../tools/page';

/** What changed the title or icon. `user`: typing, paste, the icon picker. `api`: `blok.title.set`. */
export interface TitleChange {
  source: 'user' | 'undo' | 'redo' | 'remote' | 'api';
  /** Present only for `blok.title.set(..., { record: false })`, `icon.set(..., { record: false })` and `cover.set(..., { record: false })`. */
  record?: false;
}

export interface TitleSetOptions {
  /**
   * False: no undo step. Peers still get the write.
   * Undo does not go past this value until the next recorded change to the same field.
   * After that, undo can bring back a value from before it.
   * To make the value a floor, call `history.clear()` right after the write.
   * A typing run that goes on after it stays one step, and undo goes back to this value, not to the one before the run.
   */
  record?: boolean;
}

export interface TitleConfig {
  /** Element or selector to draw the title in. Omitted: above the first block. */
  holder?: HTMLElement | string;
  /** Shown while the title is empty. Default: the `title.placeholder` message. */
  placeholder?: string;
  /** False hides the icon and "Add icon". Default true. */
  icon?: boolean;
  /** Every change, from any source. Save on `user`, `undo`, `redo` and `api`. */
  onChange?(title: string, change: TitleChange): void;
  /** Every icon change, from any source. `null`: removed. */
  onIconChange?(icon: PageIcon | null, change: TitleChange): void;
  /**
   * True draws the page cover above the title, and "Add cover" in the row over it.
   * Default false. The cover is saved and loaded either way.
   */
  cover?: boolean;
  /** Every cover change, from any source. `null`: removed. */
  onCoverChange?(cover: PageCover | null, change: TitleChange): void;
}

/** The page title, icon and cover. The value lives in the document and is saved with it. */
export interface Title {
  get(): string;
  /** One undo step, unless `record` is false. Fires `onChange` with source `api`. */
  set(text: string, options?: TitleSetOptions): void;
  focus(position?: 'start' | 'end'): void;
  /** Moves the title into `holder`. Focus and caret are kept. `null`: back above the first block. */
  mount(holder: HTMLElement | string | null): void;
  readonly icon: {
    get(): PageIcon | null;
    /** One undo step, unless `record` is false. Fires `onIconChange` with source `api`. */
    set(icon: PageIcon | null, options?: TitleSetOptions): void;
  };
  /** The page cover. Works with `TitleConfig.cover` off too; the flag only draws it. */
  readonly cover: {
    get(): PageCover | null;
    /** One undo step, unless `record` is false. Fires `onCoverChange` with source `api`. */
    set(cover: PageCover | null, options?: TitleSetOptions): void;
  };
}
