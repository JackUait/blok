import { afterEach, describe, expect, it, vi } from 'vitest';
import type { API, OutputBlockData, OutputData } from '../../../../../types';
import { Image } from '../../../../../src/tools';
import { allTexts, boot, settle, type Booted } from './roundtrip-harness';

/**
 * A child whose `parent` is the table but which no cell lists. Whatever mode
 * the document is opened in, a ghost with content moves to the root right
 * after the table; an empty one is dropped.
 */
const withGhost = (ghostText = 'Unreferenced text'): OutputData => ({
  blocks: [
    { id: 't', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['a'] }, { blocks: ['b'] }]] } },
    { id: 'a', type: 'paragraph', parent: 't', data: { text: 'A' } },
    { id: 'b', type: 'paragraph', parent: 't', data: { text: 'B' } },
    { id: 'ghost', type: 'paragraph', parent: 't', data: { text: ghostText } },
    { id: 'after', type: 'paragraph', data: { text: 'After' } },
  ] as OutputBlockData[],
});

interface Internals {
  history: API['history'];
  module: { yjsManager: { toJSON: () => OutputBlockData[] } };
}

const internals = (b: Booted): Internals => b.editor as unknown as Internals;

/** Root block ids in output order. */
const rootIds = (out: OutputData | undefined): string[] =>
  (out?.blocks ?? []).filter(block => block.parent === undefined || block.parent === null).map(block => block.id ?? '');

const ghostHolder = (b: Booted): HTMLElement | null => b.holder.querySelector('[data-blok-id="ghost"]');

describe('an unreferenced table child keeps its text on load', () => {
  let booted: Booted | null = null;

  afterEach(() => {
    booted?.editor.destroy();
    booted?.holder.remove();
    booted = null;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('read-only boot → edit → save keeps it (reference behaviour)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    booted = await boot(withGhost(), { readOnly: true });
    await booted.editor.readOnly.set(false);
    await settle();

    expect(allTexts(await booted.editor.save())).toContain('paragraph:Unreferenced text');
  });

  it('edit boot → save keeps it', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    booted = await boot(withGhost());

    expect(allTexts(await booted.editor.save())).toContain('paragraph:Unreferenced text');
  });

  it('edit boot moves it to the root right after the table, on screen and in the shared doc', async () => {
    booted = await boot(withGhost());

    const out = await booted.editor.save();

    expect(rootIds(out)).toEqual(['t', 'ghost', 'after']);
    expect(ghostHolder(booted)?.isConnected).toBe(true);
    expect(ghostHolder(booted)?.closest('[data-blok-table-cell-blocks]')).toBeNull();

    const yGhost = internals(booted).module.yjsManager.toJSON().find(block => block.id === 'ghost');

    expect(yGhost?.parent ?? null).toBeNull();
  });

  it('read-only boot → edit → save while the holder is detached keeps it', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    booted = await boot(withGhost(), { readOnly: true });
    booted.holder.remove();
    await booted.editor.readOnly.set(false);
    await settle();

    expect(allTexts(await booted.editor.save())).toContain('paragraph:Unreferenced text');
  });

  it('read-only boot → edit moves it to the root right after the table', async () => {
    booted = await boot(withGhost(), { readOnly: true });
    await booted.editor.readOnly.set(false);
    await settle();

    expect(rootIds(await booted.editor.save())).toEqual(['t', 'ghost', 'after']);
    expect(ghostHolder(booted)?.isConnected).toBe(true);
  });

  it('several ghosts keep their order after the table', async () => {
    const data = withGhost();

    data.blocks.splice(4, 0, { id: 'ghost2', type: 'paragraph', parent: 't', data: { text: 'Second' } });
    booted = await boot(data);

    expect(rootIds(await booted.editor.save())).toEqual(['t', 'ghost', 'ghost2', 'after']);
  });

  it('the move is a repair, not an undo step', async () => {
    booted = await boot(withGhost());
    await settle();

    expect(internals(booted).history.canUndo()).toBe(false);

    booted.editor.destroy();
    booted.holder.remove();

    booted = await boot(withGhost(), { readOnly: true });
    await booted.editor.readOnly.set(false);
    await settle();

    expect(internals(booted).history.canUndo()).toBe(false);
  });

  it('a table inserted with a ghost: one undo takes the insert back, ghost included', async () => {
    booted = await boot({ blocks: [{ id: 'after', type: 'paragraph', data: { text: 'After' } }] });
    const { history } = internals(booted);

    booted.editor.blocks.insertMany(withGhost().blocks.slice(0, 4), 0);
    await settle();

    expect(rootIds(await booted.editor.save())).toEqual(['t', 'ghost', 'after']);

    history.undo();
    await settle();

    expect(rootIds(await booted.editor.save())).toEqual(['after']);
  });

  it('an image ghost with no text counts as content and is kept', async () => {
    const data = withGhost();

    data.blocks[3] = { id: 'ghost', type: 'image', parent: 't', data: { url: 'https://example.com/pic.png' } };
    booted = await boot(data, { tools: { image: Image } });

    const out = await booted.editor.save();

    expect(out?.blocks.find(block => block.id === 'ghost')?.data).toEqual(expect.objectContaining({ url: 'https://example.com/pic.png' }));
    expect(rootIds(out)).toEqual(['t', 'ghost', 'after']);
  });

  it('an empty ghost is still dropped on edit boot', async () => {
    booted = await boot(withGhost(''));

    const out = await booted.editor.save();

    expect(out?.blocks.map(block => block.id)).not.toContain('ghost');
    expect(rootIds(out)).toEqual(['t', 'after']);
  });

  it('an empty ghost is dropped on read-only boot → edit', async () => {
    booted = await boot(withGhost(''), { readOnly: true });
    await booted.editor.readOnly.set(false);
    await settle();

    const out = await booted.editor.save();

    expect(out?.blocks.map(block => block.id)).not.toContain('ghost');
  });
});
