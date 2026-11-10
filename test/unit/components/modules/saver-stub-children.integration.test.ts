/**
 * A container whose tool the editor lacks renders as a stub. Its children
 * still belong to it when the editor saves.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import type { OutputData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

describe('Saver — a stub with children in a real editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.append(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    vi.restoreAllMocks();
  });

  it('saves the children of a missing-tool container under it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    editor = new Blok({
      holder,
      tools: { paragraph: Paragraph },
      data: { blocks: [
        { id: 't', type: 'toggle', data: { text: 'Toggle' }, content: ['c'] },
        { id: 'c', type: 'paragraph', parent: 't', data: { text: 'Child' } },
        { id: 'p', type: 'paragraph', data: { text: 'After' } },
      ] },
    }) as unknown as TestEditor;
    await editor.isReady;

    const saved = await editor.save();

    expect(saved.blocks.map(({ id, type, parent, content }) => ({ id, type, parent, content }))).toEqual([
      { id: 't', type: 'toggle', parent: undefined, content: ['c'] },
      { id: 'c', type: 'paragraph', parent: 't', content: undefined },
      { id: 'p', type: 'paragraph', parent: undefined, content: undefined },
    ]);
  });
});
