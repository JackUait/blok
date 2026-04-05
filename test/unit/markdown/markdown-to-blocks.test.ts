import { describe, it, expect } from 'vitest';
import { markdownToBlocks } from '../../../src/markdown/index';

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
});
