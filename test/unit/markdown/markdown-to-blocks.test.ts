import { describe, it, expect } from 'vitest';
import { markdownToBlocks } from '../../../src/markdown/index';

describe('markdownToBlocks', () => {
  it('converts a full markdown document to blocks', () => {
    const md = `# Hello World

This is a paragraph with **bold** and *italic*.

- Item one
- Item two

---

> A blockquote
`;

    const blocks = markdownToBlocks(md);

    expect(blocks[0]).toMatchObject({ type: 'header', data: { text: 'Hello World', level: 1 } });
    expect(blocks[1]).toMatchObject({ type: 'paragraph', data: { text: 'This is a paragraph with <strong>bold</strong> and <i>italic</i>.' } });
    expect(blocks[2]).toMatchObject({ type: 'list', data: { text: 'Item one', style: 'unordered' } });
    expect(blocks[3]).toMatchObject({ type: 'list', data: { text: 'Item two', style: 'unordered' } });
    expect(blocks[4]).toMatchObject({ type: 'divider', data: {} });
    expect(blocks[5]).toMatchObject({ type: 'quote', data: { text: 'A blockquote' } });
  });

  it('converts GFM tables by default', () => {
    const md = `| A | B |
| --- | --- |
| 1 | 2 |`;

    const blocks = markdownToBlocks(md);
    const tableBlock = blocks.find(b => b.type === 'table');

    expect(tableBlock).toBeDefined();
    expect(tableBlock!.data.content).toHaveLength(2);
  });

  it('converts GFM task lists by default', () => {
    const md = `- [x] Done
- [ ] Todo`;

    const blocks = markdownToBlocks(md);

    expect(blocks[0]).toMatchObject({ type: 'list', data: { style: 'checklist', checked: true } });
    expect(blocks[1]).toMatchObject({ type: 'list', data: { style: 'checklist', checked: false } });
  });

  it('converts GFM strikethrough by default', () => {
    const md = `This has ~~deleted~~ text.`;

    const blocks = markdownToBlocks(md);

    expect(blocks[0].data.text).toBe('This has <s>deleted</s> text.');
  });

  it('disables GFM when gfm: false', () => {
    const md = `~~not strikethrough~~`;

    const blocks = markdownToBlocks(md, { gfm: false });

    // Without GFM, ~~ is literal text
    expect(blocks[0].data.text).not.toContain('<s>');
  });

  it('returns empty array for empty string', () => {
    expect(markdownToBlocks('')).toEqual([]);
  });

  it('returns empty array for whitespace-only string', () => {
    expect(markdownToBlocks('   \n\n  ')).toEqual([]);
  });

  it('passes config through to mdastToBlocks', () => {
    const md = '```js\nconsole.log("hi")\n```';

    const blocks = markdownToBlocks(md, {
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

  it('accepts additional micromark/mdast extensions', () => {
    // Verify extensions option is accepted without errors
    const blocks = markdownToBlocks('Hello', { extensions: [], mdastExtensions: [] });

    expect(blocks).toHaveLength(1);
  });
});
