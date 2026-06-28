import { describe, it, expect } from 'vitest';
import { blocksToMarkdown } from '../../../src/markdown/blocks-to-markdown';

describe('blocksToMarkdown', () => {
  it('serializes a paragraph as plain text', () => {
    expect(blocksToMarkdown([{ tool: 'paragraph', data: { text: 'Hello world' } }])).toBe('Hello world');
  });

  it('serializes inline bold, italic, code, strikethrough and links as markdown', () => {
    const html = 'a <b>bold</b> <i>italic</i> <code>c</code> <s>gone</s> <a href="https://x.com">link</a>';

    expect(blocksToMarkdown([{ tool: 'paragraph', data: { text: html } }])).toBe(
      'a **bold** *italic* `c` ~~gone~~ [link](https://x.com)'
    );
  });

  it('serializes headings with the right number of hashes', () => {
    expect(blocksToMarkdown([{ tool: 'header', data: { text: 'Title', level: 1 } }])).toBe('# Title');
    expect(blocksToMarkdown([{ tool: 'header', data: { text: 'Sub', level: 2 } }])).toBe('## Sub');
    expect(blocksToMarkdown([{ tool: 'header', data: { text: 'Small', level: 3 } }])).toBe('### Small');
  });

  it('serializes unordered, ordered and checklist list items', () => {
    expect(blocksToMarkdown([{ tool: 'list', data: { text: 'a', style: 'unordered' } }])).toBe('- a');
    expect(blocksToMarkdown([{ tool: 'list', data: { text: 'a', style: 'ordered' } }])).toBe('1. a');
    expect(blocksToMarkdown([{ tool: 'list', data: { text: 'a', style: 'checklist', checked: false } }])).toBe('- [ ] a');
    expect(blocksToMarkdown([{ tool: 'list', data: { text: 'a', style: 'checklist', checked: true } }])).toBe('- [x] a');
  });

  it('indents nested list items by their depth', () => {
    expect(blocksToMarkdown([{ tool: 'list', data: { text: 'child', style: 'unordered', depth: 1 } }])).toBe('    - child');
  });

  it('indents nested list items by their STRUCTURAL indent (parentId chain), not data.depth', () => {
    // A keyboard/drag-nested list item carries its nesting via the structural
    // tree, serialized as `indent` (the parentId-chain depth) — mirroring how
    // Tab-nested text/headers serialize. data.depth is no longer required.
    expect(blocksToMarkdown([{ tool: 'list', data: { text: 'child', style: 'unordered' }, indent: 1 }])).toBe('    - child');
    expect(blocksToMarkdown([{ tool: 'list', data: { text: 'deep', style: 'ordered' }, indent: 2 }])).toBe('        1. deep');
  });

  it('indents flat-indented (Tab-nested) non-list blocks by their indent level', () => {
    expect(blocksToMarkdown([{ tool: 'paragraph', data: { text: 'nested' }, indent: 1 }])).toBe('    nested');
    expect(blocksToMarkdown([{ tool: 'header', data: { text: 'Sub', level: 2 }, indent: 1 }])).toBe('    ## Sub');
    expect(blocksToMarkdown([{ tool: 'paragraph', data: { text: 'deep' }, indent: 2 }])).toBe('        deep');
  });

  it('serializes quote, divider and code blocks', () => {
    expect(blocksToMarkdown([{ tool: 'quote', data: { text: 'wisdom' } }])).toBe('> wisdom');
    expect(blocksToMarkdown([{ tool: 'divider', data: {} }])).toBe('---');
    expect(blocksToMarkdown([{ tool: 'code', data: { code: 'const a = 1;' } }])).toBe('```\nconst a = 1;\n```');
  });

  it('joins paragraphs with blank lines but consecutive list items with single newlines', () => {
    const md = blocksToMarkdown([
      { tool: 'header', data: { text: 'Title', level: 1 } },
      { tool: 'paragraph', data: { text: 'Intro' } },
      { tool: 'list', data: { text: 'one', style: 'unordered' } },
      { tool: 'list', data: { text: 'two', style: 'unordered' } },
    ]);

    expect(md).toBe('# Title\n\nIntro\n\n- one\n- two');
  });

  it('drops the link syntax when an anchor has no href', () => {
    expect(blocksToMarkdown([{ tool: 'paragraph', data: { text: '<a>bare</a>' } }])).toBe('bare');
  });
});
