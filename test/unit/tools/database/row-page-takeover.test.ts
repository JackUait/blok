import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RowPageTakeover, readRowPageHash } from '../../../../src/tools/database/row-page-takeover';

/** Editor 0 holds paragraph A and the database; its page header is mounted outside it, like a host title. */
const buildPage = (): { wrapper: HTMLElement; editor: HTMLElement; header: HTMLElement; other: HTMLElement; holder: HTMLElement } => {
  document.body.innerHTML = `
    <div data-blok-page-header data-blok-instance="0" id="header"></div>
    <div data-blok-page-header data-blok-instance="1" id="other-header"></div>
    <div data-blok-editor data-blok-instance="0" id="editor">
      <div data-blok-redactor>
        <div data-blok-element id="other"><div data-blok-element-content></div></div>
        <div data-blok-element id="holder"><div data-blok-element-content><div id="wrapper"></div></div></div>
      </div>
    </div>`;
  const get = (id: string): HTMLElement => {
    const el = document.getElementById(id);

    if (el === null) throw new Error(`no #${id}`);

    return el;
  };

  return { wrapper: get('wrapper'), editor: get('editor'), header: get('header'), other: get('other'), holder: get('holder') };
};

describe('RowPageTakeover — a full row page takes over its editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    history.replaceState(null, '', '/editor');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    history.replaceState(null, '', '/editor');
  });

  it('marks its editor and the holders around the database, hides its page header, and names the row in the URL', () => {
    const { wrapper, editor, header, other, holder } = buildPage();
    const takeover = new RowPageTakeover(wrapper);

    takeover.enter('row 1');

    expect(editor.hasAttribute('data-blok-database-row-page')).toBe(true);
    expect(holder.hasAttribute('data-blok-database-row-page-path')).toBe(true);
    expect(holder.hasAttribute('data-blok-no-controls')).toBe(true);
    expect(other.hasAttribute('data-blok-database-row-page-path')).toBe(false);
    expect(header.hidden).toBe(true);
    expect(document.getElementById('other-header')?.hidden).toBe(false);
    expect(window.location.hash).toBe('#row%201?full');
    expect(readRowPageHash()).toEqual({ rowId: 'row 1', full: true, tabId: null });
  });

  it('undoes every mark on leave and takes its URL entry back', () => {
    const { wrapper, editor, header, holder } = buildPage();
    const takeover = new RowPageTakeover(wrapper);
    const back = vi.spyOn(history, 'back').mockImplementation(() => {
      history.replaceState(null, '', '/editor');
    });

    takeover.enter('r1');
    takeover.leave();

    expect(editor.hasAttribute('data-blok-database-row-page')).toBe(false);
    expect(holder.hasAttribute('data-blok-database-row-page-path')).toBe(false);
    expect(holder.hasAttribute('data-blok-no-controls')).toBe(false);
    expect(header.hidden).toBe(false);
    expect(back).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('');
  });

  it('opened from its own URL (a reload), leaves by clearing the hash, not by going back', () => {
    const { wrapper } = buildPage();
    const back = vi.spyOn(history, 'back');

    history.replaceState(null, '', '/editor#r1?full');
    const takeover = new RowPageTakeover(wrapper);

    takeover.enter('r1');
    takeover.leave();

    expect(back).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/editor');
  });

  it('leaves the URL alone when the user already went back', () => {
    const { wrapper } = buildPage();
    const back = vi.spyOn(history, 'back');
    const takeover = new RowPageTakeover(wrapper);

    takeover.enter('r1');
    history.replaceState(null, '', '/editor');
    takeover.leave();

    expect(back).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('');
  });

  it('on release (a re-render, not a close) unmarks but keeps the URL naming the row', () => {
    const { wrapper, editor } = buildPage();
    const back = vi.spyOn(history, 'back');
    const takeover = new RowPageTakeover(wrapper);

    takeover.enter('r1');
    takeover.release();

    expect(editor.hasAttribute('data-blok-database-row-page')).toBe(false);
    expect(back).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('#r1?full');
  });

  it('reads a plain row link and a view link as not full', () => {
    history.replaceState(null, '', '/editor#r1?v=t1');

    expect(readRowPageHash()).toEqual({ rowId: 'r1', full: false, tabId: 't1' });
    history.replaceState(null, '', '/editor#view-v1');
    expect(readRowPageHash()?.full).toBe(false);
  });
});
