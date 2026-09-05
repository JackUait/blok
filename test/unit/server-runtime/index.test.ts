// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getBlokVersion } from '../../../src/components/utils/version';
import { invoke } from '../../../src/view/server-runtime';

describe('server runtime boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs through one global boundary without DOM globals', () => {
    expect(typeof document).toBe('undefined');
    expect(typeof window).toBe('undefined');
    expect(Reflect.get(globalThis, 'blokServerInvoke')).toBe(invoke);
  });

  it('converts Markdown into a serialized OutputData envelope', async () => {
    const output = JSON.parse(await invoke('markdownToBlocks', '{"markdown":"# Hello"}')) as unknown;

    expect(output).toMatchObject({
      blocks: [{ type: 'header', data: { text: 'Hello', level: 1 } }],
    });
  });

  it('loads the inlined math extensions', async () => {
    const output = JSON.parse(await invoke('markdownToBlocks', '{"markdown":"$$E = mc^2$$"}')) as unknown;

    expect(output).toMatchObject({
      blocks: [{ type: 'code', data: { code: 'E = mc^2', language: 'latex' } }],
    });
  });

  it('renders a serialized document to HTML', async () => {
    const html = await invoke(
      'blocksToHtml',
      '{"blocks":[{"type":"paragraph","data":{"text":"Hi <b>there</b>"}}]}'
    );

    expect(html).toBe('<p>Hi <b>there</b></p>');
  });

  it('preserves the renderer parentId hierarchy alias', async () => {
    const html = await invoke(
      'blocksToHtml',
      JSON.stringify({
        blocks: [
          { id: 'toggle', type: 'toggle', data: { text: 'Parent', isOpen: true } },
          { id: 'child', type: 'paragraph', parentId: 'toggle', data: { text: 'Child' } },
        ],
      })
    );

    expect(html).toBe('<details open><summary>Parent</summary><p>Child</p></details>');
  });

  it('renders a serialized document to plain text', async () => {
    const plainText = await invoke(
      'blocksToPlainText',
      '{"blocks":[{"type":"paragraph","data":{"text":"Hi <b>there</b>"}}]}'
    );

    expect(plainText).toBe('Hi there');
  });

  it('refuses a document without a blocks array', async () => {
    await expect(invoke('blocksToHtml', '{"wrong":[]}')).rejects.toThrow('`blocks` array');
  });

  /**
   * This case used to assert the opposite — that a malformed block is refused
   * rather than silently dropped. The objection was to the SILENCE, not to the
   * dropping: a document conversion reports one now. HTML and plain text carry
   * no report channel, so for those two the skip is still silent, which is the
   * price of not losing a whole stored article to one bad entry.
   */
  it('skips a malformed block instead of failing the whole document', async () => {
    const html = await invoke('blocksToHtml', '{"blocks":[{"type":42,"data":{"text":"lost"}}]}');

    expect(html).toBe('');
  });

  it('skips a block that is not an object and reports it', async () => {
    const output = await invoke('blocksToMarkdown', JSON.stringify({
      blocks: [
        { id: 'p1', type: 'paragraph', data: { text: 'Kept' } },
        7,
      ],
    }));
    const result = JSON.parse(output) as { markdown: string; warnings: unknown[] };

    expect(result.markdown).toBe('Kept');
    expect(result.warnings).toEqual([
      { construct: 'block', action: 'dropped', detail: '1 malformed block was skipped' },
    ]);
  });

  it('skips a block whose type is missing', async () => {
    const output = await invoke('blocksToMarkdown', JSON.stringify({
      blocks: [{ id: 'x', data: { text: 'Orphan' } }],
    }));
    const result = JSON.parse(output) as { markdown: string; warnings: unknown[] };

    expect(result.markdown).toBe('');
    expect(result.warnings).toHaveLength(1);
  });

  it('reports several malformed blocks as one degradation', async () => {
    const output = await invoke('blocksToMarkdown', JSON.stringify({
      blocks: [null, { type: 'paragraph', data: { text: 'Kept' } }, 'nope'],
    }));
    const result = JSON.parse(output) as { warnings: Array<{ detail: string }> };

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].detail).toBe('2 malformed blocks were skipped');
  });

  it('still rejects input that is not a document at all', async () => {
    await expect(invoke('blocksToMarkdown', JSON.stringify({ notBlocks: [] })))
      .rejects.toThrow(TypeError);
  });

  it('skips malformed blocks for plain text too', async () => {
    const output = await invoke('blocksToPlainText', JSON.stringify({
      blocks: [{ type: 'paragraph', data: { text: 'Kept' } }, null],
    }));

    expect(output).toContain('Kept');
  });

  it('hands out the saved format as JSON Schema', async () => {
    const schema = JSON.parse(await invoke('schema', '{}')) as Record<string, Record<string, unknown>>;

    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.$defs.paragraph).toBeDefined();
  });

  it('extracts a document\'s translatable strings', async () => {
    const output = JSON.parse(await invoke('extractTexts', JSON.stringify({
      document: {
        blocks: [
          { id: 'h', type: 'header', data: { text: 'Title' } },
          { id: 'i', type: 'image', data: { url: 'u', caption: 'A cat' } },
          { id: 'c', type: 'code', data: { code: 'const a = 1;' } },
        ],
      },
    }))) as unknown;

    expect(output).toEqual(['Title', 'A cat']);
  });

  it('includes code only when asked', async () => {
    const document = { blocks: [{ id: 'c', type: 'code', data: { code: 'const a = 1;' } }] };

    expect(JSON.parse(await invoke('extractTexts', JSON.stringify({ document, includeCode: true }))))
      .toEqual(['const a = 1;']);
  });

  /**
   * The one operation whose output is STORED. `parseDocument` drops a block it
   * cannot read, which is right for the read-only operations and would be a
   * silently deleted block here — so this one never goes through it.
   */
  it('injects translations without dropping a block it cannot read', async () => {
    const output = JSON.parse(await invoke('injectTexts', JSON.stringify({
      document: {
        time: 1700000000000,
        version: '1.12.0',
        blocks: [
          { id: 'p', type: 'paragraph', data: { text: 'Hello' } },
          7,
          { id: 'n', data: { text: 'No type' } },
        ],
      },
      texts: ['Привет'],
    }))) as unknown;

    expect(output).toEqual({
      document: {
        time: 1700000000000,
        version: '1.12.0',
        blocks: [
          { id: 'p', type: 'paragraph', data: { text: 'Привет' } },
          7,
          { id: 'n', data: { text: 'No type' } },
        ],
      },
    });
  });

  it('reports a translation list that does not match the document', async () => {
    const output = JSON.parse(await invoke('injectTexts', JSON.stringify({
      document: { blocks: [{ id: 'p', type: 'paragraph', data: { text: 'Hello' } }] },
      texts: ['Привет', 'Лишнее'],
    }))) as unknown;

    expect(output).toEqual({ mismatch: { expected: 1, received: 2 } });
  });

  /**
   * Compared against the editor's own function, not a literal: the point of the
   * operation is that both sides stamp the SAME version, and a literal here
   * would keep passing while they drifted apart.
   */
  it('reports the same version the editor stamps into a saved document', async () => {
    expect(await invoke('version', '{}')).toBe(getBlokVersion());
  });

  it('refuses an unknown operation', async () => {
    await expect(invoke('unknown', '{}')).rejects.toThrow('Unsupported Blok runtime operation');
  });

  /**
   * Plain text now takes either shape: a bare document (what every caller sent
   * before the flag existed) or an envelope carrying the options beside it.
   * A saved document always has `blocks`, so the two never collide.
   */
  it('reads plain text from a bare document, as before', async () => {
    const output = await invoke('blocksToPlainText', JSON.stringify({
      blocks: [{ type: 'image', data: { url: 'https://x.y/a.png', caption: 'Cap', alt: 'A tabby cat' } }],
    }));

    expect(output).toBe('Cap');
  });

  it('reads plain text from an envelope without the flag', async () => {
    const output = await invoke('blocksToPlainText', JSON.stringify({
      document: { blocks: [{ type: 'image', data: { url: 'https://x.y/a.png', caption: 'Cap', alt: 'A tabby cat' } }] },
    }));

    expect(output).toBe('Cap');
  });

  it('includes hidden text only when the envelope asks', async () => {
    const output = await invoke('blocksToPlainText', JSON.stringify({
      document: { blocks: [{ type: 'image', data: { url: 'https://x.y/a.png', caption: 'Cap', alt: 'A tabby cat' } }] },
      includeHiddenText: true,
    }));

    expect(output).toBe('Cap\nA tabby cat');
  });

  it('still skips malformed blocks inside an envelope', async () => {
    const output = await invoke('blocksToPlainText', JSON.stringify({
      document: { blocks: [{ type: 'paragraph', data: { text: 'Kept' } }, null] },
      includeHiddenText: true,
    }));

    expect(output).toBe('Kept');
  });

  it('rejects an envelope whose document is not a document', async () => {
    await expect(invoke('blocksToPlainText', JSON.stringify({ document: { notBlocks: [] } })))
      .rejects.toThrow(TypeError);
  });
});
