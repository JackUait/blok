/**
 * A row (or an inline database) opened as a full page takes over its whole
 * editor, like Notion's `/p/<id>`: the rest of the document and the page header
 * hide, and the URL names it (`#<id>?full`), so Back closes it and a reload
 * reopens it. It stays a block in this document; only the view changes.
 */

import { DATA_ATTR } from '../../components/constants/data-attributes';

interface TakeoverMarks {
  editor: string;
  path: string;
  /** The innermost holder on the path: the opened block's own. */
  target?: string;
}

// Each kind has its own marks, so a row page opened over a database page unmarks only its own.
const ROW_MARKS: TakeoverMarks = { editor: 'data-blok-database-row-page', path: 'data-blok-database-row-page-path' };
const DATABASE_MARKS: TakeoverMarks = {
  editor: 'data-blok-database-full-open',
  path: 'data-blok-database-full-open-path',
  target: 'data-blok-database-full-open-target',
};

export interface RowPageHash {
  rowId: string;
  full: boolean;
  tabId: string | null;
}

/** The row a `#rowId`, `#rowId?v=tab` or `#rowId?full` fragment names, or null without one. */
export const readRowPageHash = (): RowPageHash | null => {
  const hash = window.location.hash.slice(1);

  if (hash === '') return null;
  // Split before decoding: an encoded "?" in a row id is not the separator.
  const split = hash.indexOf('?');
  const params = new URLSearchParams(split === -1 ? '' : hash.slice(split + 1));

  try {
    return { rowId: decodeURIComponent(split === -1 ? hash : hash.slice(0, split)), full: params.has('full'), tabId: params.get('v') };
  } catch {
    // A malformed escape in someone else's hash.
    return null;
  }
};

const pageHash = (id: string): string => `#${encodeURIComponent(id)}?full`;

const urlWithout = (): string => `${window.location.pathname}${window.location.search}`;

class PageTakeover {
  private marked: HTMLElement[] = [];
  /** Holders this takeover took the controls from; one that had none already keeps it. */
  private controlsTaken: HTMLElement[] = [];
  private header: HTMLElement | null = null;
  private hash: string | null = null;
  private pushed = false;

  constructor(private readonly wrapper: HTMLElement, private readonly marks: TakeoverMarks) {}

  public get isOpen(): boolean {
    return this.marked.length > 0;
  }

  public enter(id: string): void {
    this.unmark();
    const editor = this.wrapper.closest<HTMLElement>('[data-blok-editor]');

    if (editor === null) return;
    editor.setAttribute(this.marks.editor, '');
    this.marked.push(editor);
    // Holders only: a write inside another block's tool would read as its edit.
    editor.querySelectorAll<HTMLElement>(`[${DATA_ATTR.element}]`).forEach((el) => {
      if (!el.contains(this.wrapper)) return;
      el.setAttribute(this.marks.path, '');
      // The page's own blocks keep theirs; the blocks around it are not on the page.
      if (!el.hasAttribute(DATA_ATTR.noControls)) {
        el.setAttribute(DATA_ATTR.noControls, '');
        this.controlsTaken.push(el);
      }
      this.marked.push(el);
    });
    const target = this.marks.target;

    if (target !== undefined) this.wrapper.closest<HTMLElement>(`[${DATA_ATTR.element}]`)?.setAttribute(target, '');
    const instance = editor.getAttribute('data-blok-instance');
    // A host may mount the page title outside the editor; the instance pairs them.
    const header = instance === null ? null : document.querySelector<HTMLElement>(`[data-blok-page-header][data-blok-instance="${CSS.escape(instance)}"]`);

    if (header !== null && !header.hidden) {
      header.hidden = true;
      this.header = header;
    }
    // The page starts at its top bar, like any page just opened.
    if (this.hash === null) this.wrapper.scrollIntoView?.({ block: 'start' });

    const hash = pageHash(id);

    if (this.hash === hash) return;
    this.hash = hash;
    this.pushed = window.location.hash !== hash;
    if (this.pushed) history.pushState(history.state, '', `${urlWithout()}${hash}`);
  }

  public leave(): void {
    this.unmark();
    const hash = this.hash;

    this.hash = null;
    // The user went back (or elsewhere) already: the entry is not ours to drop.
    if (hash === null || window.location.hash !== hash) return;
    if (this.pushed) {
      history.back();
    } else {
      history.replaceState(history.state, '', urlWithout());
    }
  }

  /** Torn down, not closed (a re-render, the editor going away): the URL still names the page. */
  public release(): void {
    this.unmark();
    this.hash = null;
  }

  private unmark(): void {
    this.marked.forEach((el) => {
      el.removeAttribute(this.marks.editor);
      el.removeAttribute(this.marks.path);
      if (this.marks.target !== undefined) el.removeAttribute(this.marks.target);
    });
    this.controlsTaken.forEach((el) => el.removeAttribute(DATA_ATTR.noControls));
    this.marked = [];
    this.controlsTaken = [];
    if (this.header !== null) this.header.hidden = false;
    this.header = null;
  }
}

export class RowPageTakeover extends PageTakeover {
  constructor(wrapper: HTMLElement) {
    super(wrapper, ROW_MARKS);
  }
}

export class DatabasePageTakeover extends PageTakeover {
  constructor(wrapper: HTMLElement) {
    super(wrapper, DATABASE_MARKS);
  }
}
