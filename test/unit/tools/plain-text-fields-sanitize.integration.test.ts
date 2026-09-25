/**
 * Tools without a `sanitize` config get the inline tools' tag map applied to
 * EVERY string field on load and save. These tools store plain text and bare
 * URLs, so an HTML parse truncates text at `<` and turns `&` into `&amp;`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../src/blok';
import * as Tools from '../../../src/tools';
import type { OutputData } from '../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
}

const TEXT = 'if (a<b) { } 5 < 6 && x </div> y L1<br>L2 <b>bold</b>';
const URL = 'https://ex.com/a.png?b=1&c=2';

const cases: Array<[string, unknown, Record<string, unknown>]> = [
  ['image', Tools.Image, { url: URL, caption: TEXT, alt: TEXT, fileName: TEXT }],
  ['file', Tools.File, { url: URL, caption: TEXT, fileName: TEXT, mimeType: 'text/plain' }],
  ['audio', Tools.Audio, { url: URL, caption: TEXT, title: TEXT, artist: TEXT, coverUrl: URL, fileName: TEXT }],
  ['video', Tools.Video, { url: URL, caption: TEXT, fileName: TEXT }],
  ['embed', Tools.Embed, {
    service: 'youtube',
    source: 'https://www.youtube.com/watch?v=abc&t=1',
    embed: 'https://www.youtube.com/embed/abc?a=1&b=2',
    caption: TEXT,
  }],
  ['bookmark', Tools.Bookmark, { url: URL, title: TEXT, description: TEXT, image: URL, favicon: URL, domain: 'ex.com' }],
  ['databaseRow', Tools.DatabaseRow, { title: TEXT, properties: { t: TEXT, n: 'x&y' }, position: 'a0' }],
  ['database', Tools.Database, {
    title: TEXT,
    schema: [
      { id: 'p-title', name: TEXT, type: 'title', position: 'a0' },
      {
        id: 'p-status',
        name: TEXT,
        type: 'select',
        position: 'a1',
        config: { options: [{ id: 'o1', label: TEXT, position: 'a0' }] },
      },
    ],
    views: [
      { id: 'v1', name: TEXT, type: 'board', position: 'a0', groupBy: 'p-status', sorts: [], filters: [], visibleProperties: [] },
    ],
    activeViewId: 'v1',
  }],
];

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

describe('plain-text and URL fields survive load and save with inline tools enabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    vi.restoreAllMocks();
  });

  it.each(cases)('%s keeps every field byte-identical', async (name, tool, data) => {
    editor = new Blok({
      holder,
      tools: {
        bold: Tools.Bold,
        italic: Tools.Italic,
        link: Tools.Link,
        [name]: tool as never,
      },
      data: { blocks: [{ id: 'x', type: name, data }] },
    }) as unknown as TestEditor;
    await editor.isReady;

    const saved = (await editor.save()).blocks[0]?.data;

    expect(saved).toMatchObject(data);
  });
});
