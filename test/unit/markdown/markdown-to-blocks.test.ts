import { describe, it, expect } from 'vitest';
import { markdownToBlocks, markdownToBlocksWithReport } from '../../../src/markdown/index';
import type { OutputBlockData } from '../../../types';

describe('markdownToBlocks', () => {
  it('converts a full markdown document to blocks', async () => {
    const md = `# Hello World

This is a paragraph with **bold** and *italic*.

- Item one
- Item two

---

> A blockquote
`;

    const blocks = await markdownToBlocks(md);

    expect(blocks[0]).toMatchObject({ type: 'header', data: { text: 'Hello World', level: 1 } });
    expect(blocks[1]).toMatchObject({ type: 'paragraph', data: { text: 'This is a paragraph with <strong>bold</strong> and <i>italic</i>.' } });
    expect(blocks[2]).toMatchObject({ type: 'list', data: { text: 'Item one', style: 'unordered' } });
    expect(blocks[3]).toMatchObject({ type: 'list', data: { text: 'Item two', style: 'unordered' } });
    expect(blocks[4]).toMatchObject({ type: 'divider', data: {} });
    expect(blocks[5]).toMatchObject({ type: 'quote', data: { text: 'A blockquote' } });
  });

  it('converts GFM tables by default', async () => {
    const md = `| A | B |
| --- | --- |
| 1 | 2 |`;

    const blocks = await markdownToBlocks(md);
    const tableBlock = blocks.find(b => b.type === 'table');

    expect(tableBlock).toBeDefined();
    expect(tableBlock!.data.content).toHaveLength(2);
  });

  it('converts GFM task lists by default', async () => {
    const md = `- [x] Done
- [ ] Todo`;

    const blocks = await markdownToBlocks(md);

    expect(blocks[0]).toMatchObject({ type: 'list', data: { style: 'checklist', checked: true } });
    expect(blocks[1]).toMatchObject({ type: 'list', data: { style: 'checklist', checked: false } });
  });

  it('converts GFM strikethrough by default', async () => {
    const md = `This has ~~deleted~~ text.`;

    const blocks = await markdownToBlocks(md);

    expect(blocks[0].data.text).toBe('This has <s>deleted</s> text.');
  });

  it('disables GFM when gfm: false', async () => {
    const md = `~~not strikethrough~~`;

    const blocks = await markdownToBlocks(md, { gfm: false });

    // Without GFM, ~~ is literal text
    expect(blocks[0].data.text).not.toContain('<s>');
  });

  it('returns empty array for empty string', async () => {
    expect(await markdownToBlocks('')).toEqual([]);
  });

  it('returns empty array for whitespace-only string', async () => {
    expect(await markdownToBlocks('   \n\n  ')).toEqual([]);
  });

  it('passes config through to mdastToBlocks', async () => {
    const md = '```js\nconsole.log("hi")\n```';

    const blocks = await markdownToBlocks(md, {
      toolMap: {
        code: {
          tool: 'codeBlock',
          data: (node) => ({ code: 'value' in node ? node.value : '', language: 'lang' in node ? node.lang : '' }),
        },
      },
    });

    expect(blocks[0].type).toBe('codeBlock');
    expect(blocks[0].data.code).toBe('console.log("hi")');
  });

  it('accepts additional micromark/mdast extensions', async () => {
    // Verify extensions option is accepted without errors
    const blocks = await markdownToBlocks('Hello', { extensions: [], mdastExtensions: [] });

    expect(blocks).toHaveLength(1);
  });

  it('converts block math ($$) to code blocks with latex language', async () => {
    const md = '$$E = mc^2$$';

    const blocks = await markdownToBlocks(md);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'code', data: { code: 'E = mc^2', language: 'latex' } });
  });

  it('converts inline math ($) within paragraph to separate blocks', async () => {
    const md = 'The equation $E = mc^2$ is famous.';

    const blocks = await markdownToBlocks(md);

    expect(blocks.length).toBeGreaterThanOrEqual(3);
    expect(blocks[0]).toMatchObject({ type: 'paragraph' });
    expect(blocks[0].data.text).toContain('The equation');
    expect(blocks[1]).toMatchObject({ type: 'code', data: { code: 'E = mc^2', language: 'latex' } });
    expect(blocks[2]).toMatchObject({ type: 'paragraph' });
    expect(blocks[2].data.text).toContain('is famous.');
  });

  it('converts multiple math blocks in a document', async () => {
    const md = `# Math

$$\\sum_{i=1}^n i$$

Some text

$$e^{i\\pi} + 1 = 0$$`;

    const blocks = await markdownToBlocks(md);

    const codeBlocks = blocks.filter(b => b.type === 'code');

    expect(codeBlocks).toHaveLength(2);
    expect(codeBlocks[0].data.language).toBe('latex');
    expect(codeBlocks[1].data.language).toBe('latex');
  });

  describe('images', () => {
    it('imports a standalone image line as an image block', async () => {
      const blocks = await markdownToBlocks('![a picture](https://img.com/pic.png)');

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('image');
      expect(blocks[0].data).toEqual({ url: 'https://img.com/pic.png', caption: 'a picture', alt: 'a picture' });
    });

    it('keeps Markdown-decoded characters verbatim in the caption', async () => {
      const blocks = await markdownToBlocks('![a &amp; b](https://img.com/pic.png)');

      expect(blocks[0].data).toEqual({ url: 'https://img.com/pic.png', caption: 'a & b', alt: 'a & b' });
    });

    it('leaves an image mixed with text as a paragraph', async () => {
      const blocks = await markdownToBlocks('before ![pic](https://img.com/pic.png) after');

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('paragraph');
      expect(blocks[0].data.text).toBe('before <img src="https://img.com/pic.png" alt="pic"> after');
    });

    it('imports a reference-style image line as an image block', async () => {
      const md = '![a picture][shot]\n\n[shot]: https://img.com/pic.png';

      const blocks = await markdownToBlocks(md);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('image');
      expect(blocks[0].data).toEqual({ url: 'https://img.com/pic.png', caption: 'a picture', alt: 'a picture' });
    });
  });

  describe('reference-style links', () => {
    it('resolves a reference link against its definition', async () => {
      const md = 'Read [the docs][site] today.\n\n[site]: https://example.com/docs';

      const blocks = await markdownToBlocks(md);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].data.text).toBe(
        'Read <a href="https://example.com/docs" target="_blank" rel="noopener noreferrer nofollow">the docs</a> today.'
      );
    });

    it('resolves a definition that appears before the reference', async () => {
      const md = '[site]: https://example.com/docs\n\nRead [the docs][site].';

      const blocks = await markdownToBlocks(md);

      expect(blocks[0].data.text).toContain('href="https://example.com/docs"');
    });

    it('resolves a shortcut reference', async () => {
      const md = 'Read [site] today.\n\n[site]: https://example.com/docs';

      const blocks = await markdownToBlocks(md);

      expect(blocks[0].data.text).toContain('href="https://example.com/docs"');
    });

    it('drops the definition line itself rather than emitting a block for it', async () => {
      const blocks = await markdownToBlocks('Text.\n\n[site]: https://example.com/docs');

      expect(blocks).toHaveLength(1);
      expect(blocks[0].data.text).toBe('Text.');
    });

    /**
     * micromark resolves references during the flow pass, so a reference with
     * no definition never reaches mdast as `linkReference` — it arrives as a
     * plain text node holding the literal source. Nothing is lost, so there is
     * nothing for the degradation report to say.
     */
    it('keeps an unresolvable reference as its literal source, with no warning', async () => {
      const { blocks, warnings } = await markdownToBlocksWithReport('[the docs][missing]');

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('paragraph');
      expect(blocks[0].data.text).toBe('[the docs][missing]');
      expect(warnings).toEqual([]);
    });
  });
});

describe('markdownToBlocksWithReport', () => {
  it('returns the same blocks as markdownToBlocks', async () => {
    const md = '# Title\n\nBody with **bold**.';
    /** Ids are minted from the clock, so two runs never share them. */
    const withoutIds = (blocks: OutputBlockData[]): unknown[] =>
      blocks.map(({ id: _id, ...rest }) => rest);

    const { blocks } = await markdownToBlocksWithReport(md);

    expect(withoutIds(blocks)).toEqual(withoutIds(await markdownToBlocks(md)));
  });

  it('reports nothing for Markdown that imports losslessly', async () => {
    const { warnings } = await markdownToBlocksWithReport('# Title\n\n- one\n- two');

    expect(warnings).toEqual([]);
  });

  /**
   * Blok has no raw-HTML block, so markup written into Markdown is escaped and
   * stored as literal text. That is the right fallback — it never executes —
   * but it is silent, and a client that round-trips through Markdown would
   * otherwise not learn its `<div>` became visible characters.
   */
  it('reports block-level HTML escaped into a paragraph', async () => {
    const { blocks, warnings } = await markdownToBlocksWithReport('<div class="note">hi</div>');

    expect(blocks[0].type).toBe('paragraph');
    expect(blocks[0].data.text).toBe('&lt;div class=&quot;note&quot;&gt;hi&lt;/div&gt;');
    expect(warnings).toEqual([
      { construct: 'html', action: 'degraded', detail: expect.stringContaining('escaped') },
    ]);
  });

  it('reports inline HTML too, once per run of markup', async () => {
    const { warnings } = await markdownToBlocksWithReport('Text with <b>inline</b> markup.');

    expect(warnings).toHaveLength(2);
    expect(warnings.every((warning) => warning.construct === 'html')).toBe(true);
  });
});

/**
 * The math extensions are loaded only when the source looks like it carries
 * math. A price range trips a naive `$...$` gate, and once the extension is on,
 * `$5-$10` parses as inline math and the paragraph is torn into a latex code
 * block plus two paragraph fragments — silently, at full fidelity.
 */
describe('markdownToBlocks — currency is not math', () => {
  it.each([
    ['цена $5-$10 за штуку'],
    ['цена $5 - $10 за штуку'],
    ['from $1,000-$2,000 per unit'],
    ['Cost: $5 to $10'],
    ['I have $50 and $30'],
  ])('keeps %s as one plain paragraph', async (md) => {
    const { blocks, warnings } = await markdownToBlocksWithReport(md);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('paragraph');
    expect(blocks[0].data.text).toBe(md);
    expect(warnings).toEqual([]);
  });

  it('still parses genuine inline math', async () => {
    const blocks = await markdownToBlocks('The equation $E = mc^2$ is famous.');

    expect(blocks.map(b => b.type)).toEqual(['paragraph', 'code', 'paragraph']);
    expect(blocks[1].data).toMatchObject({ code: 'E = mc^2', language: 'latex' });
  });

  it('still parses a short inline math span', async () => {
    const blocks = await markdownToBlocks('Index $x_i$ here.');

    expect(blocks[1]).toMatchObject({ type: 'code', data: { code: 'x_i', language: 'latex' } });
  });

  it('still parses display math', async () => {
    const blocks = await markdownToBlocks('$$\\int_0^1 x\\,dx$$');

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'code', data: { language: 'latex' } });
  });

  it('reports the paragraph split when inline math does fire', async () => {
    const { warnings } = await markdownToBlocksWithReport('The equation $E = mc^2$ is famous.');

    expect(warnings).toEqual([
      { construct: 'inlineMath', action: 'degraded', detail: expect.stringContaining('paragraph') },
    ]);
  });
});

/**
 * GFM footnotes have no Blok block. The reference serializes to an empty string
 * and the definition has no handler, so both vanish — and the import still
 * reported full fidelity, which a caller gating on `warnings` reads as "safe to
 * overwrite".
 */
describe('markdownToBlocks — footnotes', () => {
  it('reports the dropped reference and definition', async () => {
    const { warnings } = await markdownToBlocksWithReport('Text[^1] here.\n\n[^1]: The note body.');

    expect(warnings).toEqual([
      { construct: 'footnoteReference', action: 'dropped', detail: expect.any(String) },
      { construct: 'footnoteDefinition', action: 'dropped', detail: expect.any(String) },
    ]);
  });
});
