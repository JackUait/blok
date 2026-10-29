import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { openCellEditor } from '../../../../../src/tools/database/cells';
import type { CellEditorContext } from '../../../../../src/tools/database/cells/types';
import { PopoverRegistry } from '../../../../../src/components/utils/popover/popover-registry';
import type { PropertyValue } from '../../../../../src/tools/database/types';
import { filesOf } from '../../../../../src/tools/database/property-values';
import { makeAnchor, makeEditorContext, makeProperty, press, pressOutside } from './helpers';

const FILE = { id: 'f0', name: 'a-very-long-report-name-that-must-not-be-cut.pdf', url: 'https://x.io/a.pdf' };

const box = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-blok-database-files-editor]');
const panel = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-blok-database-files-panel]');
const tab = (name: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-blok-database-files-tab="${name}"]`);
const must = <T extends Element>(el: T | null, what: string): T => {
  if (el === null) throw new Error(`missing ${what}`);

  return el;
};

const open = (value: PropertyValue, overrides: Partial<CellEditorContext> = {}): CellEditorContext => {
  const ctx = makeEditorContext({ coverCell: true, ...overrides });

  openCellEditor(makeProperty('files'), value, makeAnchor(), ctx);

  return ctx;
};

const upload = (): Promise<{ url: string }> => Promise.resolve({ url: 'https://cdn.example.com/x.png' });

// notion-spec-2 §18.3 (b3-files-*.txt), §19.17, §19.22: a box over the cell, and an Upload / Link panel under it.
describe('files editor in a table cell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    PopoverRegistry.resetForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('opens an empty cell as one "Add a file or image" row, with the panel under it on the Upload tab', () => {
    open([], { uploadFile: upload });

    expect(box()?.querySelector('[data-blok-database-files-add]')?.textContent?.trim()).toBe('tools.database.filesAdd');
    expect(must(panel(), 'panel').getAttribute('role')).toBe('dialog');
    expect(tab('upload')?.getAttribute('aria-selected')).toBe('true');
    expect(tab('link')?.getAttribute('aria-selected')).toBe('false');
    expect(tab('upload')).toHaveFocus();
    expect(panel()?.querySelector('[data-blok-database-files-upload]')?.textContent).toBe('tools.database.filesUpload');
    expect(panel()?.querySelector('[data-blok-database-files-link-input]')).toBeNull();
  });

  it('offers only the Link tab without a host uploader', () => {
    open([]);

    expect(tab('upload')).toBeNull();
    expect(tab('link')?.getAttribute('aria-selected')).toBe('true');
    expect(panel()?.querySelector('[data-blok-database-files-link-input]')).not.toBeNull();
  });

  it('switches to the Link tab and adds a pasted link on Enter, then closes the panel', () => {
    const ctx = open([], { uploadFile: upload });

    must(tab('link'), 'link tab').click();
    expect(tab('link')?.getAttribute('aria-selected')).toBe('true');
    const input = must(panel()?.querySelector<HTMLInputElement>('[data-blok-database-files-link-input]') ?? null, 'link input');

    expect(input).toHaveFocus();
    expect(panel()?.querySelector('[data-blok-database-files-link-submit]')?.textContent).toBe('tools.database.filesTabLink');
    input.value = 'https://example.com/report.pdf';
    press(input, 'Enter');

    expect(vi.mocked(ctx.onCommit).mock.calls.at(-1)?.[0]).toEqual([expect.objectContaining({ name: 'report.pdf' })]);
    expect(panel()).toBeNull();
    expect(box()?.querySelector('[data-blok-database-file-row]')?.textContent).toContain('report.pdf');
  });

  it('opens a filled cell with the panel closed; the Add row opens it', () => {
    open([FILE], { uploadFile: upload });

    expect(panel()).toBeNull();
    expect(box()?.querySelector('[data-blok-database-file-row="f0"]')?.textContent).toContain(FILE.name);
    must(box()?.querySelector<HTMLElement>('[data-blok-database-files-add]') ?? null, 'add row').click();
    expect(panel()).not.toBeNull();
  });

  it('closes the panel on the first Escape with a 0.2s fade, and the box on the second', () => {
    vi.useFakeTimers();
    const ctx = open([], { uploadFile: upload });

    press(must(tab('upload'), 'tab'), 'Escape');
    expect(panel()?.hasAttribute('data-closing')).toBe(true);
    expect(box()).not.toBeNull();
    vi.advanceTimersByTime(200);
    expect(panel()).toBeNull();
    expect(ctx.onClose).not.toHaveBeenCalled();

    press(document.body, 'Escape');
    expect(box()).toBeNull();
    expect(ctx.onClose).toHaveBeenCalledTimes(1);
  });

  it('drops the panel at once when the editor closes on an outside press', () => {
    const ctx = open([], { uploadFile: upload });

    pressOutside();

    expect(panel()).toBeNull();
    expect(ctx.onClose).toHaveBeenCalledTimes(1);
  });

  // notion-spec-2 §21.3 (E7-file-menu.png, E7-rename.png): each file's "⋯" opens View original, Rename, Delete.
  describe('a file\'s menu', () => {
    const PDF = { id: 'f1', name: 'a.pdf', url: 'https://example.com/a.pdf' };
    const menuButton = (id: string): HTMLElement => must(box()?.querySelector<HTMLElement>(`[data-blok-database-file-row="${id}"] [data-blok-database-file-menu]`) ?? null, 'menu button');
    const menu = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-blok-database-file-actions]');
    const item = (action: string): HTMLElement => must(menu()?.querySelector<HTMLElement>(`[data-action="${action}"]`) ?? null, action);
    const commits = (ctx: CellEditorContext): unknown => vi.mocked(ctx.onCommit).mock.calls.at(-1)?.[0];
    const renameTo = (text: string): void => {
      const input = must(document.querySelector<HTMLInputElement>('[data-blok-database-file-rename]'), 'rename input');

      input.value = text;
      press(input, 'Enter');
    };

    it('lists View original, Rename and Delete', () => {
      open([PDF]);
      expect(menuButton('f1').getAttribute('aria-label')).toBe('tools.database.fileMoreActions');
      menuButton('f1').click();

      expect(menu()?.getAttribute('role')).toBe('menu');
      expect([...(menu()?.querySelectorAll('[role="menuitem"]') ?? [])].map((el) => el.textContent)).toEqual([
        'tools.database.filesViewOriginal', 'tools.database.filesRename', 'tools.database.filesDelete',
      ]);
      expect(item('view')).toHaveFocus();
    });

    it('View original opens the file in a new tab', () => {
      const opened = vi.spyOn(window, 'open').mockReturnValue(null);

      open([PDF]);
      menuButton('f1').click();
      item('view').click();

      expect(opened).toHaveBeenCalledWith('https://example.com/a.pdf', '_blank', 'noopener');
      expect(menu()).toBeNull();
    });

    it('Delete removes the file', () => {
      const ctx = open([FILE, PDF]);

      menuButton('f1').click();
      item('delete').click();

      expect(commits(ctx)).toEqual([FILE]);
      expect(menu()).toBeNull();
    });

    it('Rename opens a field with the whole name selected, and keeps the extension', () => {
      const ctx = open([PDF]);

      menuButton('f1').click();
      item('rename').click();
      const input = must(document.querySelector<HTMLInputElement>('[data-blok-database-file-rename]'), 'rename input');

      expect(input).toHaveFocus();
      expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'a.pdf'.length]);
      renameTo('Report');

      expect(commits(ctx)).toEqual([{ ...PDF, name: 'Report.pdf' }]);
      expect(document.querySelector('[data-blok-database-file-rename]')).toBeNull();
      expect(box()?.querySelector('[data-blok-database-file-row="f1"]')?.textContent).toContain('Report.pdf');
    });

    it('Rename does not add the extension twice, and adds none to a name that had none', () => {
      const ctx = open([PDF, { id: 'f2', name: 'notes', url: 'https://example.com/notes' }]);

      menuButton('f1').click();
      item('rename').click();
      renameTo('Report.pdf');
      menuButton('f2').click();
      item('rename').click();
      renameTo('Draft');

      expect(commits(ctx)).toEqual([{ ...PDF, name: 'Report.pdf' }, { id: 'f2', name: 'Draft', url: 'https://example.com/notes' }]);
    });

    it('Escape closes the menu first and keeps the editor open', () => {
      const ctx = open([PDF]);

      menuButton('f1').click();
      press(item('view'), 'Escape');

      expect(menu()).toBeNull();
      expect(box()).not.toBeNull();
      expect(ctx.onClose).not.toHaveBeenCalled();
    });
  });

  describe('placement', () => {
    const at = (left: number, width: number, bottom: number): void => {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        return this.hasAttribute('data-blok-database-files-editor')
          ? new DOMRect(left, bottom - 34, width, 34)
          : new DOMRect(0, 0, 0, 0);
      });
    };

    it('centres the 300-wide panel under the box, top on its bottom edge', () => {
      at(400, 240, 235.4);
      open([], { uploadFile: upload });

      expect(panel()?.style.left).toBe('370px');
      expect(panel()?.style.top).toBe('235.4px');
    });

    it('keeps the panel 12px inside the window', () => {
      at(window.innerWidth - 100, 240, 100);
      open([], { uploadFile: upload });

      expect(panel()?.style.left).toBe(`${window.innerWidth - 12 - 300}px`);
    });
  });

  // notion-spec-2 §19.17, §22.3: each file row starts with a ⋮⋮ grip shown at rest that drags the file to a new place.
  describe('file row grip', () => {
    const TWO = [FILE, { id: 'f1', name: 'b.pdf', url: 'https://x.io/b.pdf' }];
    const committedIds = (ctx: CellEditorContext): string[] => filesOf(vi.mocked(ctx.onCommit).mock.calls.at(-1)?.[0] ?? undefined).map((file) => file.id);
    const grip = (id: string): HTMLElement => must(box()?.querySelector<HTMLElement>(`[data-blok-database-file-row="${id}"] > [data-blok-database-file-grip]`) ?? null, `grip ${id}`);

    it('leads each row with the grip, then the page glyph, the name and the "⋯"', () => {
      open(TWO);
      const row = must(box()?.querySelector('[data-blok-database-file-row="f0"]') ?? null, 'row');

      expect([...row.children].map((child) => [...child.attributes].map((a) => a.name).find((name) => name.startsWith('data-blok')) ?? child.tagName))
        .toEqual(['data-blok-database-file-grip', 'data-blok-database-file-chip-icon', 'SPAN', 'data-blok-database-file-menu']);
      expect(grip('f0').getAttribute('aria-label')).toBe('tools.database.dragOption');
    });

    it('drags the first file below the second and commits the new order', () => {
      const ctx = open(TWO);

      ['f0', 'f1'].forEach((id, index) => {
        const row = must(box()?.querySelector<HTMLElement>(`[data-blok-database-file-row="${id}"]`) ?? null, id);

        vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100 + index * 28, 260, 28));
      });
      grip('f0').dispatchEvent(new PointerEvent('pointerdown', { clientY: 110, button: 0, bubbles: true, cancelable: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientY: 140, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointerup', { clientY: 140, bubbles: true }));

      expect(committedIds(ctx)).toEqual(['f1', 'f0']);
      expect([...(box()?.querySelectorAll('[data-blok-database-file-row]') ?? [])].map((row) => row.getAttribute('data-blok-database-file-row'))).toEqual(['f1', 'f0']);
    });

    it('moves a file with Alt+Arrow on its grip', () => {
      const ctx = open(TWO);

      press(grip('f1'), 'ArrowUp', { altKey: true });

      expect(committedIds(ctx)).toEqual(['f1', 'f0']);
    });
  });
});

// notion-spec-2 §24.2: the side peek's files box is the table's: each file row has a ⋮⋮ grip and a "⋯", then "Add a file or image".
describe('files editor over a side peek value', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    PopoverRegistry.resetForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('draws the grip, glyph, name and "⋯" in each file row, then the add row', () => {
    open([FILE], { coverCell: 'value' });
    const row = must(box()?.querySelector<HTMLElement>('[data-blok-database-file-row="f0"]') ?? null, 'file row');

    expect(box()?.getAttribute('data-layout')).toBe('table');
    expect([...row.children].map((child) => [...child.attributes].map((a) => a.name).find((name) => name.startsWith('data-blok')) ?? child.tagName))
      .toEqual(['data-blok-database-file-grip', 'data-blok-database-file-chip-icon', 'SPAN', 'data-blok-database-file-menu']);
    expect(box()?.querySelector('[data-blok-database-files-add]')?.textContent?.trim()).toBe('tools.database.filesAdd');
    expect(box()?.querySelector('[data-blok-database-file-remove]')).toBeNull();
  });

  it('keeps the row page value look, not the table cell box', () => {
    open([FILE], { coverCell: 'value' });
    const classes = box()?.closest('[data-blok-popover]')?.getAttribute('data-blok-popover-custom-class') ?? '';

    expect(classes.split(' ')).toContain('blok-database-value-editor');
    expect(classes.split(' ')).not.toContain('blok-database-table-cell-editor');
  });
});
