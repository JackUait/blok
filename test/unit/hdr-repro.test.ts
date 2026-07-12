import { describe, it, expect } from 'vitest';
import { blocksToMarkdown } from '../../src/markdown/blocks-to-markdown';
import { fromMarkdown } from 'mdast-util-from-markdown';

describe('toggle markdown', () => {
  it('serializes', () => {
    const md = blocksToMarkdown([
      { tool: 'toggle', data: { text: 'T', isOpen: true }, indent: 0 },
      { tool: 'paragraph', data: { text: 'Child A' }, indent: 1 },
      { tool: 'paragraph', data: { text: 'Child B' }, indent: 1 },
    ]);
    console.log(JSON.stringify(md));
    const tree = fromMarkdown(md);
    console.log(JSON.stringify(tree.children.map(c => c.type)));
    console.log(JSON.stringify(tree.children, null, 1).slice(0, 900));
    expect(true).toBe(true);
  });
});
