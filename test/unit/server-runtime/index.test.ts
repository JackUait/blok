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
});
