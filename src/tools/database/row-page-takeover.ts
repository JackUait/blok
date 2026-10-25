/**
 * A row opened as a full page takes over its whole editor, like Notion's
 * `/p/<row>`: the rest of the document and the page header hide, and the URL
 * names the row (`#<rowId>?full`), so Back closes it and a reload reopens it.
 * The row stays a block in this document; only the view changes.
 */

import { DATA_ATTR } from '../../components/constants/data-attributes';

const EDITOR_MARK = 'data-blok-database-row-page';
const PATH_MARK = 'data-blok-database-row-page-path';

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

const rowPageHash = (rowId: string): string => `#${encodeURIComponent(rowId)}?full`;

const urlWithout = (): string => `${window.location.pathname}${window.location.search}`;

export class RowPageTakeover {
  private marked: HTMLElement[] = [];
  private header: HTMLElement | null = null;
  private hash: string | null = null;
  private pushed = false;

  constructor(private readonly wrapper: HTMLElement) {}

  public enter(rowId: string): void {
    this.unmark();
    const editor = this.wrapper.closest<HTMLElement>('[data-blok-editor]');

    if (editor === null) return;
    editor.setAttribute(EDITOR_MARK, '');
    this.marked.push(editor);
    // Holders only: a write inside another block's tool would read as its edit.
    editor.querySelectorAll<HTMLElement>(`[${DATA_ATTR.element}]`).forEach((el) => {
      if (!el.contains(this.wrapper)) return;
      el.setAttribute(PATH_MARK, '');
      // The page's own blocks keep theirs; the blocks around it are not on the page.
      el.setAttribute(DATA_ATTR.noControls, '');
      this.marked.push(el);
    });
    const instance = editor.getAttribute('data-blok-instance');
    // A host may mount the page title outside the editor; the instance pairs them.
    const header = instance === null ? null : document.querySelector<HTMLElement>(`[data-blok-page-header][data-blok-instance="${CSS.escape(instance)}"]`);

    if (header !== null && !header.hidden) {
      header.hidden = true;
      this.header = header;
    }
    // The page starts at its top bar, like any page just opened.
    if (this.hash === null) this.wrapper.scrollIntoView?.({ block: 'start' });

    const hash = rowPageHash(rowId);

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

  /** Torn down, not closed (a re-render, the editor going away): the URL still names the row. */
  public release(): void {
    this.unmark();
    this.hash = null;
  }

  private unmark(): void {
    this.marked.forEach((el) => {
      el.removeAttribute(EDITOR_MARK);
      el.removeAttribute(PATH_MARK);
      el.removeAttribute(DATA_ATTR.noControls);
    });
    this.marked = [];
    if (this.header !== null) this.header.hidden = false;
    this.header = null;
  }
}
