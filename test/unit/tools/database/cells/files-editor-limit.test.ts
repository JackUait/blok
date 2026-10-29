import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { openCellEditor } from '../../../../../src/tools/database/cells';
import type { CellEditorContext } from '../../../../../src/tools/database/cells/types';
import { PopoverRegistry } from '../../../../../src/components/utils/popover/popover-registry';
import type { FileValue, PropertyDefinition } from '../../../../../src/tools/database/types';
import { editorRoot, makeAnchor, makeEditorContext, makeProperty } from './helpers';

const OLD: FileValue = { id: 'f0', name: 'old.pdf', url: 'https://cdn.example.com/old.pdf' };

const q = <T extends Element = HTMLElement>(selector: string): T => {
  const el = editorRoot()?.querySelector<T>(selector);

  if (el === null || el === undefined) throw new Error(`missing ${selector}`);

  return el;
};

const lastCommit = (ctx: CellEditorContext): unknown => vi.mocked(ctx.onCommit).mock.calls.at(-1)?.[0];

const addLink = (url: string): void => {
  q<HTMLInputElement>('[data-blok-database-files-link-input]').value = url;
  q('[data-blok-database-files-link-submit]').click();
};

/** The add row's label: the one element whose own text is a files add key. */
const addLabel = (): string | undefined =>
  [...(editorRoot()?.querySelectorAll('*') ?? [])]
    .map((el) => el.textContent)
    .find((text) => text === 'tools.database.filesAdd' || text === 'tools.database.filesReplace');

// notion-spec-2 §20.7: with Limit "1 file" and a file present, the row reads "Replace a file or image" and adding replaces.
describe('files cell editor with Limit 1 file', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    PopoverRegistry.resetForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const open = (property: PropertyDefinition, value: FileValue[], overrides: Partial<CellEditorContext> = {}): CellEditorContext => {
    const ctx = makeEditorContext(overrides);

    openCellEditor(property, value, makeAnchor(), ctx);

    return ctx;
  };
  const oneFile = (): PropertyDefinition => ({ ...makeProperty('files'), files: { limit: 1 } });

  it('reads Replace a file or image when a file is present', () => {
    open(oneFile(), [OLD]);

    expect(addLabel()).toBe('tools.database.filesReplace');
  });

  it('reads Add a file or image on an empty cell, then Replace once a file is added', () => {
    open(oneFile(), []);
    expect(addLabel()).toBe('tools.database.filesAdd');

    addLink('https://example.com/a.pdf');

    expect(addLabel()).toBe('tools.database.filesReplace');
  });

  it('a link replaces the file', () => {
    const ctx = open(oneFile(), [OLD]);

    addLink('https://example.com/a.pdf');

    expect(lastCommit(ctx)).toEqual([expect.objectContaining({ name: 'a.pdf', url: 'https://example.com/a.pdf' })]);
  });

  it('an upload replaces the file', async () => {
    const uploadFile = vi.fn((file: File) => Promise.resolve({ url: `https://cdn.example.com/${file.name}`, name: file.name }));
    const ctx = open(oneFile(), [OLD], { uploadFile });
    const input = q<HTMLInputElement>('[data-blok-database-files-input]');

    Object.defineProperty(input, 'files', { value: [new File(['x'], 'new.png', { type: 'image/png' })] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(ctx.onCommit).toHaveBeenCalled());

    expect(lastCommit(ctx)).toEqual([expect.objectContaining({ name: 'new.png', url: 'https://cdn.example.com/new.png' })]);
  });

  it('without a limit keeps adding and reads Add', () => {
    const ctx = open(makeProperty('files'), [OLD]);

    expect(addLabel()).toBe('tools.database.filesAdd');
    addLink('https://example.com/a.pdf');

    expect(lastCommit(ctx)).toEqual([OLD, expect.objectContaining({ name: 'a.pdf' })]);
  });
});
