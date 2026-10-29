import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { openCellEditor } from '../../../../../src/tools/database/cells';
import type { CellEditorContext } from '../../../../../src/tools/database/cells/types';
import { PopoverRegistry } from '../../../../../src/components/utils/popover/popover-registry';
import type { PropertyValue } from '../../../../../src/tools/database/types';
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
});
