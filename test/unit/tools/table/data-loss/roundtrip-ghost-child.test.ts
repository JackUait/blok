import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OutputBlockData, OutputData } from '../../../../../types';
import { allTexts, boot, settle, type Booted } from './roundtrip-harness';

/**
 * A child whose `parent` is the table but which no cell lists. Edit boot
 * deletes it (Table.removeGhostChildren); read-only boot keeps it and the
 * Saver promotes it to the root — so the same document keeps or loses the
 * text depending on the mode it was opened in.
 */
const withGhost = (): OutputData => ({
  blocks: [
    { id: 't', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['a'] }, { blocks: ['b'] }]] } },
    { id: 'a', type: 'paragraph', parent: 't', data: { text: 'A' } },
    { id: 'b', type: 'paragraph', parent: 't', data: { text: 'B' } },
    { id: 'ghost', type: 'paragraph', parent: 't', data: { text: 'Unreferenced text' } },
  ] as OutputBlockData[],
});

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

});
