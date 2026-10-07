import type { PageIcon } from '../tools/page';

/** What changed the title or icon. `user`: typing, paste, the icon picker. `api`: `blok.title.set`. */
export interface TitleChange {
  source: 'user' | 'undo' | 'redo' | 'remote' | 'api';
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
}

/** The page title and icon. The value lives in the document and is saved with it. */
export interface Title {
  get(): string;
  /** One undo step. Fires `onChange` with source `api`. */
  set(text: string): void;
  focus(position?: 'start' | 'end'): void;
  /** Moves the title into `holder`. Focus and caret are kept. */
  mount(holder: HTMLElement | string): void;
  readonly icon: {
    get(): PageIcon | null;
    /** One undo step. Fires `onIconChange` with source `api`. */
    set(icon: PageIcon | null): void;
  };
}
