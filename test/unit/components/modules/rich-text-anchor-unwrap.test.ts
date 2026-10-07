/**
 * The sanitizer strips an unsafe href and leaves a bare `<a>`. Saved data
 * must hold its text, not a `tag:a` mark no reader can use.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import type { OutputData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
}

let holder: HTMLDivElement | undefined;
let editor: TestEditor | undefined;

describe('an anchor without a safe href', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    holder = undefined;
    vi.restoreAllMocks();
  });

  it.each([
    ['html', 'a <a href="javascript:alert(1)">link</a> b'],
    ['segments', [{ text: 'a ' }, { text: 'link', marks: { link: { href: 'javascript:alert(1)' } } }, { text: ' b' }]],
  ])('saves the text of a sanitizer-stripped javascript: link from %s input', async (_label, text) => {
    editor = new Blok({
      holder,
      tools: { paragraph: Paragraph },
      data: { blocks: [{ id: 'p', type: 'paragraph', data: { text } }] } as OutputData,
    }) as unknown as TestEditor;
    await editor.isReady;

    const saved = await editor.save();

    expect(saved.blocks[0].data.text).toEqual([{ text: 'a link b' }]);
  });
});
