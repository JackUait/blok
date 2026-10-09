import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { openCellEditor } from '../../../../../src/tools/database/cells';
import type { CellEditorContext } from '../../../../../src/tools/database/cells/types';
import { PopoverRegistry } from '../../../../../src/components/utils/popover/popover-registry';
import type { PropertyValue } from '../../../../../src/tools/database/types';
import { editorRoot, makeAnchor, makeEditorContext, makeProperty, press } from './helpers';

const PEOPLE = [
  { id: 'u1', name: 'Ada Lovelace' },
  { id: 'u2', name: 'Grace Hopper' },
  { id: 'me', name: 'Jack' },
];

const q = <T extends Element = HTMLElement>(selector: string): T => {
  const el = editorRoot()?.querySelector<T>(selector);

  if (el === null || el === undefined) {
    throw new Error(`missing ${selector}`);
  }

  return el;
};

const lastCommit = (ctx: CellEditorContext): PropertyValue | undefined => {
  const calls = vi.mocked(ctx.onCommit).mock.calls;

  return calls[calls.length - 1]?.[0];
};

describe('person cell editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    PopoverRegistry.resetForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const open = (value: PropertyValue, overrides: Partial<CellEditorContext> = {}): CellEditorContext => {
    const ctx = makeEditorContext({ people: PEOPLE, me: 'me', ...overrides });

    openCellEditor(makeProperty('person'), value, makeAnchor(), ctx);

    return ctx;
  };

  const rows = (): string[] =>
    [...(editorRoot()?.querySelectorAll('[data-blok-database-person-option]') ?? [])].map((r) => r.getAttribute('data-blok-database-person-option') ?? '');

  it('lists the current user first, then everyone else', () => {
    open([]);

    expect(rows()).toEqual(['me', 'u1', 'u2']);
  });

  it('adds a person on click and commits the whole list of {id} objects', () => {
    const ctx = open([{ id: 'u1' }]);

    q('[data-blok-database-person-option="u2"]').click();

    expect(lastCommit(ctx)).toEqual([{ id: 'u1' }, { id: 'u2' }]);
  });

  it('removes a person from its chip', () => {
    const ctx = open([{ id: 'u1' }, { id: 'u2' }]);

    q('[data-blok-database-person-chip="u1"] [data-blok-database-person-remove]').click();

    expect(lastCommit(ctx)).toEqual([{ id: 'u2' }]);
  });

  it('filters by name as you type and picks the highlighted person with Enter', () => {
    const ctx = open([]);
    const search = q<HTMLInputElement>('[data-blok-database-person-search]');

    search.value = 'grace';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    expect(rows()).toEqual(['u2']);
    press(search, 'Enter');
    expect(lastCommit(ctx)).toEqual([{ id: 'u2' }]);
  });

  it('opens nothing without a people directory', () => {
    const ctx = makeEditorContext();
    const handle = openCellEditor(makeProperty('person'), [], makeAnchor(), ctx);

    expect(handle.isOpen).toBe(false);
  });

  it('closes on Escape without committing more', () => {
    const ctx = open([]);

    press(q('[data-blok-database-person-search]'), 'Escape');

    expect(editorRoot()).toBeNull();
    expect(ctx.onCommit).not.toHaveBeenCalled();
    expect(ctx.onClose).toHaveBeenCalled();
  });
});

describe('files cell editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    PopoverRegistry.resetForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const open = (value: PropertyValue, overrides: Partial<CellEditorContext> = {}): CellEditorContext => {
    const ctx = makeEditorContext({ ...overrides });

    openCellEditor(makeProperty('files'), value, makeAnchor(), ctx);

    return ctx;
  };

  it('embeds a link as a file named after its last path segment', () => {
    const ctx = open([]);
    const link = q<HTMLInputElement>('[data-blok-database-files-link-input]');

    link.value = 'https://cdn.example.com/docs/brief%20v2.pdf?x=1';
    q('[data-blok-database-files-link-submit]').click();

    const value = lastCommit(ctx) as Array<{ id: string; name: string; url: string }>;

    expect(value).toHaveLength(1);
    expect(value[0]).toMatchObject({ name: 'brief v2.pdf', url: 'https://cdn.example.com/docs/brief%20v2.pdf?x=1' });
    expect(value[0].id).toMatch(/.+/);
  });

  it('refuses a link with an unsafe scheme', () => {
    const ctx = open([]);
    const link = q<HTMLInputElement>('[data-blok-database-files-link-input]');

    link.value = 'javascript:alert(1)';
    q('[data-blok-database-files-link-submit]').click();

    expect(ctx.onCommit).not.toHaveBeenCalled();
    expect(link.getAttribute('aria-invalid')).toBe('true');
  });

  it('uploads picked files through the host uploader and adds each one', async () => {
    const uploadFile = vi.fn((file: File) => Promise.resolve({ url: `https://cdn.example.com/${file.name}`, name: file.name }));
    const ctx = open([{ id: 'f0', name: 'old.pdf', url: 'https://cdn.example.com/old.pdf' }], { uploadFile });
    const input = q<HTMLInputElement>('[data-blok-database-files-input]');
    const file = new File(['x'], 'new.png', { type: 'image/png' });

    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(ctx.onCommit).toHaveBeenCalled());

    expect(uploadFile).toHaveBeenCalledWith(file);
    expect(lastCommit(ctx)).toEqual([
      { id: 'f0', name: 'old.pdf', url: 'https://cdn.example.com/old.pdf' },
      expect.objectContaining({ name: 'new.png', url: 'https://cdn.example.com/new.png' }),
    ]);
  });

  it('hides the upload tab without an uploader', () => {
    open([]);

    expect(editorRoot()?.querySelector('[data-blok-database-files-input]')).toBeNull();
  });

  it('removes a file', () => {
    const ctx = open([{ id: 'f0', name: 'a.pdf', url: 'https://x.io/a.pdf' }, { id: 'f1', name: 'b.pdf', url: 'https://x.io/b.pdf' }]);

    q('[data-blok-database-file-row="f0"] [data-blok-database-file-remove]').click();

    expect(lastCommit(ctx)).toEqual([{ id: 'f1', name: 'b.pdf', url: 'https://x.io/b.pdf' }]);
  });
});
