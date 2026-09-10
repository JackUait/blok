/**
 * Mutation tests for `src/markdown/mdast-to-blocks.ts`.
 *
 * Fixtures always use DISTINCT text: Markdown import compares markup, so two
 * paragraphs with the same words hide a wrong-node mutant.
 *
 * PROVEN EQUIVALENT (no test can distinguish these; each was also checked by
 * replaying 3000 randomized trees x 5 configs through a mutated copy of the
 * module and diffing the normalized block output):
 *
 * - L163 `node.type === 'html'` -> `false` / `'html'` -> `""` / body -> `{}`:
 *   the raw-html branch is an indirection only. Skipping it drops `convertNode`
 *   into its own fall-through, which calls the same `onUnknownNode` hook and
 *   otherwise emits the same paragraph from the same `escapeHtml(node.value)`,
 *   consuming the same single id.
 * - L518 the whole `handleFallback` body -> `{}`: `handleBuiltInNode` then
 *   returns `undefined`, so `convertNode` takes that same fall-through.
 * - L525 `result === null` -> `false`, and its body -> `{}`: both arms end in
 *   `return result`, and `result` is null in the arm the guard protects.
 * - L297/L305 `textNodes.length > 0` -> `true` / `>= 0`: an extra
 *   `{ type: 'text', nodes: [] }` segment is pushed, and `if (text)` drops it
 *   because `phrasingToHtml([])` is `''`.
 * - L298/L306 `'text'` -> `""`: the segment's `type` is only ever compared
 *   with `'math'`, so a renamed label still takes the text path.
 * - L289 the `textNodes` initializer -> `['Stryker was here']`: the injected
 *   string is a node with no `type`, so `phrasingToHtml` serializes it to `''`
 *   (its `default` branch), and the all-string segment it forces is dropped by
 *   the same `if (text)`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Root } from 'mdast';
import type { MarkdownImportConfig } from '../../../src/markdown/types';
import { mdastToBlocks } from '../../../src/markdown/mdast-to-blocks';

/**
 * Root from children the published mdast map does not describe but a parser or
 * an mdast extension can produce: a missing `value`, a non-array `children`.
 */
function looseRoot(...children: unknown[]): Root {
  return { type: 'root', children } as unknown as Root;
}

describe('mdastToBlocks — generated ids', () => {
  it('numbers one conversion sequentially from zero', () => {
    const tree: Root = {
      type: 'root',
      children: [
        { type: 'paragraph', children: [{ type: 'text', value: 'Alpha paragraph' }] },
        { type: 'paragraph', children: [{ type: 'text', value: 'Beta paragraph' }] },
        { type: 'paragraph', children: [{ type: 'text', value: 'Gamma paragraph' }] },
      ],
    };

    const blocks = mdastToBlocks(tree);
    const prefix = String(blocks[0].id).slice(0, -2);

    expect(blocks[0].id).toBe(`${prefix}-0`);
    expect(blocks[1].id).toBe(`${prefix}-1`);
    expect(blocks[2].id).toBe(`${prefix}-2`);
  });
});

describe('mdastToBlocks — nodes no handler knows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('turns a value-bearing node into an escaped paragraph', () => {
    const tree: Root = {
      type: 'root',
      children: [{ type: 'yaml', value: 'title: A & B <tag> "quoted"' }],
    };

    const blocks = mdastToBlocks(tree);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('paragraph');
    expect(blocks[0].data.text).toBe('title: A &amp; B &lt;tag&gt; &quot;quoted&quot;');
  });

  it('drops a node that carries no string value', () => {
    const tree: Root = {
      type: 'root',
      children: [{ type: 'definition', identifier: 'lonely', url: 'https://example.com/lonely', title: null }],
    };

    expect(mdastToBlocks(tree)).toStrictEqual([]);
  });

  it('drops a node whose value is not a string', () => {
    expect(mdastToBlocks(looseRoot({ type: 'yaml', value: 42 }))).toStrictEqual([]);
  });

  it('lets onUnknownNode claim a node no built-in handler knows', () => {
    const tree: Root = {
      type: 'root',
      children: [{ type: 'yaml', value: 'title: Hook target' }],
    };

    const blocks = mdastToBlocks(tree, {
      onUnknownNode: (node) => (node.type === 'yaml' ? [{ type: 'custom-raw', data: { source: 'hook' } }] : null),
    });

    expect(blocks).toStrictEqual([{ type: 'custom-raw', data: { source: 'hook' } }]);
  });

  it('skips the node when onUnknownNode returns null', () => {
    const tree: Root = {
      type: 'root',
      children: [{ type: 'yaml', value: 'title: Skipped by hook' }],
    };
    const hook = vi.fn(() => null);

    expect(mdastToBlocks(tree, { onUnknownNode: hook })).toStrictEqual([]);
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it('warns with the node type and skips the node when onUnknownNode throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const boom = new Error('hook exploded');
    const tree: Root = {
      type: 'root',
      children: [{ type: 'yaml', value: 'title: Throwing hook' }],
    };

    const blocks = mdastToBlocks(tree, {
      onUnknownNode: () => {
        throw boom;
      },
    });

    expect(warn).toHaveBeenCalledWith('markdownToBlocks: onUnknownNode threw for node type "yaml"', boom);
    expect(blocks).toStrictEqual([]);
  });
});

describe('mdastToBlocks — math', () => {
  it('converts a math block to a latex code block', () => {
    const tree: Root = {
      type: 'root',
      children: [{ type: 'math', value: 'E = mc^2' }],
    };

    const blocks = mdastToBlocks(tree);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toStrictEqual({
      id: expect.any(String),
      type: 'code',
      data: { code: 'E = mc^2', language: 'latex' },
    });
  });
});

describe('mdastToBlocks — code fences', () => {
  it('keeps an unknown fence label instead of collapsing it to plain text', () => {
    const tree: Root = {
      type: 'root',
      children: [{ type: 'code', value: 'SELECT 1;', lang: 'weirdlang' }],
    };

    expect(mdastToBlocks(tree)[0]).toStrictEqual({
      id: expect.any(String),
      type: 'code',
      data: { code: 'SELECT 1;', language: 'weirdlang' },
    });
  });
});

describe('mdastToBlocks — raw html', () => {
  it('escapes raw html into a paragraph', () => {
    const tree: Root = {
      type: 'root',
      children: [{ type: 'html', value: '<div class="probe">raw</div>' }],
    };

    const blocks = mdastToBlocks(tree);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].data).toStrictEqual({ text: '&lt;div class=&quot;probe&quot;&gt;raw&lt;/div&gt;' });
  });

  it('lets onUnknownNode claim a raw html node', () => {
    const tree: Root = {
      type: 'root',
      children: [{ type: 'html', value: '<custom-widget data-id="w1" />' }],
    };

    const blocks = mdastToBlocks(tree, {
      onUnknownNode: () => [{ type: 'widget', data: { kind: 'from-hook' } }],
    });

    expect(blocks).toStrictEqual([{ type: 'widget', data: { kind: 'from-hook' } }]);
  });
});

describe('mdastToBlocks — standalone images', () => {
  it('writes the alt text into caption and alt', () => {
    const tree: Root = {
      type: 'root',
      children: [{
        type: 'paragraph',
        children: [{ type: 'image', url: 'https://example.com/pic-one.png', alt: 'A blue square' }],
      }],
    };

    expect(mdastToBlocks(tree)[0]).toStrictEqual({
      id: expect.any(String),
      type: 'image',
      data: { url: 'https://example.com/pic-one.png', caption: 'A blue square', alt: 'A blue square' },
    });
  });

  it('omits caption and alt when the image carries no alt text', () => {
    const tree: Root = {
      type: 'root',
      children: [{
        type: 'paragraph',
        children: [{ type: 'image', url: 'https://example.com/pic-two.png' }],
      }],
    };

    const blocks = mdastToBlocks(tree);

    expect(Object.keys(blocks[0].data)).toStrictEqual(['url']);
    expect(blocks[0].data).toStrictEqual({ url: 'https://example.com/pic-two.png' });
  });

  it('omits caption and alt when the alt text is null', () => {
    const tree: Root = {
      type: 'root',
      children: [{
        type: 'paragraph',
        children: [{ type: 'image', url: 'https://example.com/pic-three.png', alt: null }],
      }],
    };

    expect(mdastToBlocks(tree)[0].data).toStrictEqual({ url: 'https://example.com/pic-three.png' });
  });

  it('keeps a paragraph whose image URL has an unsafe scheme', () => {
    const tree: Root = {
      type: 'root',
      children: [{
        type: 'paragraph',
        children: [
          { type: 'text', value: 'before ' },
          { type: 'image', url: 'javascript:alert(1)', alt: 'Unsafe image alt' },
          { type: 'text', value: ' after' },
        ],
      }],
    };

    const blocks = mdastToBlocks(tree);

    expect(blocks[0].type).toBe('paragraph');
    expect(blocks[0].data.text).toBe('before  after');
  });

  it('resolves a reference image against a definition', () => {
    const tree: Root = {
      type: 'root',
      children: [
        { type: 'definition', identifier: 'badge-ref', url: 'https://example.com/badge.svg', title: null },
        {
          type: 'paragraph',
          children: [{ type: 'imageReference', identifier: 'badge-ref', referenceType: 'full', alt: 'Badge art' }],
        },
      ],
    };

    expect(mdastToBlocks(tree)[0]).toStrictEqual({
      id: expect.any(String),
      type: 'image',
      data: { url: 'https://example.com/badge.svg', caption: 'Badge art', alt: 'Badge art' },
    });
  });

  it('falls back to a paragraph when a reference image has no definition', () => {
    const tree: Root = {
      type: 'root',
      children: [{
        type: 'paragraph',
        children: [{ type: 'imageReference', identifier: 'missing-ref', referenceType: 'full', alt: 'Ghost' }],
      }],
    };

    const blocks = mdastToBlocks(tree);

    expect(blocks[0].type).toBe('paragraph');
    expect(blocks[0].data.text).toBe('![Ghost][missing-ref]');
  });
});

describe('mdastToBlocks — paragraphs around images', () => {
  it('keeps a whitespace-only paragraph as a paragraph', () => {
    const tree: Root = {
      type: 'root',
      children: [{ type: 'paragraph', children: [{ type: 'text', value: '   ' }] }],
    };

    const blocks = mdastToBlocks(tree);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('paragraph');
    expect(blocks[0].data).toStrictEqual({ text: '   ' });
  });

  it('keeps a paragraph whose image is followed by text', () => {
    const tree: Root = {
      type: 'root',
      children: [{
        type: 'paragraph',
        children: [
          { type: 'image', url: 'https://example.com/lead.png', alt: 'Lead picture' },
          { type: 'text', value: ' trailing words' },
        ],
      }],
    };

    const blocks = mdastToBlocks(tree);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('paragraph');
    expect(blocks[0].data.text).toBe('<img src="https://example.com/lead.png" alt="Lead picture"> trailing words');
  });
});

describe('mdastToBlocks — inline math', () => {
  it('splits a paragraph into text and latex blocks', () => {
    const tree: Root = {
      type: 'root',
      children: [
        { type: 'definition', identifier: 'guide-ref', url: 'https://example.com/guide', title: null },
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'See ' },
            { type: 'linkReference', identifier: 'guide-ref', referenceType: 'full', children: [{ type: 'text', value: 'the guide' }] },
            { type: 'inlineMath', value: 'x^2 + y^2' },
          ],
        },
      ],
    };

    const blocks = mdastToBlocks(tree);

    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe('paragraph');
    expect(blocks[0].data.text).toBe(
      'See <a href="https://example.com/guide" target="_blank" rel="noopener noreferrer nofollow">the guide</a>',
    );
    expect(blocks[1]).toStrictEqual({ id: expect.any(String), type: 'code', data: { code: 'x^2 + y^2', language: 'latex' } });
  });

  it('trims the text around an inline math span', () => {
    const tree: Root = {
      type: 'root',
      children: [{
        type: 'paragraph',
        children: [
          { type: 'text', value: '  spaced words  ' },
          { type: 'inlineMath', value: 'z' },
        ],
      }],
    };

    const blocks = mdastToBlocks(tree);

    expect(blocks[0].data).toStrictEqual({ text: 'spaced words' });
    expect(blocks[1].data).toStrictEqual({ code: 'z', language: 'latex' });
  });

  it('emits no block for a text run that is only whitespace', () => {
    const tree: Root = {
      type: 'root',
      children: [{
        type: 'paragraph',
        children: [
          { type: 'inlineMath', value: 'a+b' },
          { type: 'text', value: '   ' },
        ],
      }],
    };

    const blocks = mdastToBlocks(tree);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].data).toStrictEqual({ code: 'a+b', language: 'latex' });
  });

  it('turns an inline math span without a value into an empty latex block', () => {
    const blocks = mdastToBlocks(looseRoot({
      type: 'paragraph',
      children: [
        { type: 'text', value: 'before ' },
        { type: 'inlineMath' },
      ],
    }));

    expect(blocks).toHaveLength(2);
    expect(blocks[0].data).toStrictEqual({ text: 'before' });
    expect(blocks[1].data).toStrictEqual({ code: '', language: 'latex' });
  });
});

describe('mdastToBlocks — blockquote', () => {
  it('keeps a line break inside a quoted paragraph', () => {
    const tree: Root = {
      type: 'root',
      children: [{
        type: 'blockquote',
        children: [{
          type: 'paragraph',
          children: [{ type: 'text', value: 'Alpha' }, { type: 'break' }, { type: 'text', value: 'Beta' }],
        }],
      }],
    };

    const blocks = mdastToBlocks(tree);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].data).toStrictEqual({ text: 'Alpha<br>Beta', size: 'default' });
  });

  it('quotes a heading that is not a paragraph, dropping its line break', () => {
    const tree: Root = {
      type: 'root',
      children: [{
        type: 'blockquote',
        children: [
          { type: 'paragraph', children: [{ type: 'text', value: 'Para one' }] },
          { type: 'heading', depth: 2, children: [{ type: 'text', value: 'Head' }, { type: 'break' }, { type: 'text', value: 'Tail' }] },
        ],
      }],
    };

    expect(mdastToBlocks(tree)[0].data.text).toBe('Para one<br>HeadTail');
  });

  it('keeps inline markup inside a quoted heading', () => {
    const tree: Root = {
      type: 'root',
      children: [{
        type: 'blockquote',
        children: [{
          type: 'heading',
          depth: 2,
          children: [{ type: 'text', value: 'Bold ' }, { type: 'strong', children: [{ type: 'text', value: 'lead' }] }],
        }],
      }],
    };

    expect(mdastToBlocks(tree)[0].data.text).toBe('Bold <strong>lead</strong>');
  });

  it('adds no separator for a quoted heading with no quotable text', () => {
    const tree: Root = {
      type: 'root',
      children: [{
        type: 'blockquote',
        children: [
          { type: 'paragraph', children: [{ type: 'text', value: 'Para one' }] },
          { type: 'heading', depth: 3, children: [{ type: 'break' }] },
        ],
      }],
    };

    expect(mdastToBlocks(tree)[0].data.text).toBe('Para one');
  });

  it('skips a child whose children key is not an array', () => {
    const blocks = mdastToBlocks(looseRoot({
      type: 'blockquote',
      children: [
        { type: 'definition', identifier: 'null-children', url: 'https://example.com/null', title: null, children: null },
        { type: 'paragraph', children: [{ type: 'text', value: 'Quoted body' }] },
      ],
    }));

    expect(blocks).toHaveLength(1);
    expect(blocks[0].data.text).toBe('Quoted body');
  });

  it('collects a definition nested inside a blockquote', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'blockquote',
          children: [{
            type: 'paragraph',
            children: [{ type: 'linkReference', identifier: 'nested-ref', referenceType: 'full', children: [{ type: 'text', value: 'nested link' }] }],
          }],
        },
        { type: 'definition', identifier: 'nested-ref', url: 'https://example.com/nested', title: null },
      ],
    };

    expect(mdastToBlocks(tree)[0].data.text).toBe(
      '<a href="https://example.com/nested" target="_blank" rel="noopener noreferrer nofollow">nested link</a>',
    );
  });
});

describe('mdastToBlocks — list items', () => {
  it('writes no checked or start key for a plain unordered item', () => {
    const tree: Root = {
      type: 'root',
      children: [{
        type: 'list',
        ordered: false,
        children: [{
          type: 'listItem',
          checked: null,
          children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Plain item' }] }],
        }],
      }],
    };

    const blocks = mdastToBlocks(tree);

    expect(Object.keys(blocks[0].data)).toStrictEqual(['text', 'style', 'depth']);
    expect(blocks[0].data).toStrictEqual({ text: 'Plain item', style: 'unordered', depth: 0 });
  });

  it('writes checked for a checklist item, including an unchecked one', () => {
    const tree: Root = {
      type: 'root',
      children: [{
        type: 'list',
        ordered: false,
        children: [
          { type: 'listItem', checked: true, children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Done task' }] }] },
          { type: 'listItem', checked: false, children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Open task' }] }] },
        ],
      }],
    };

    const blocks = mdastToBlocks(tree);

    expect(blocks[0].data).toStrictEqual({ text: 'Done task', style: 'checklist', depth: 0, checked: true });
    expect(blocks[1].data).toStrictEqual({ text: 'Open task', style: 'checklist', depth: 0, checked: false });
  });

  it('leaves start off the first item of an ordered list that starts at one', () => {
    const tree: Root = {
      type: 'root',
      children: [{
        type: 'list',
        ordered: true,
        children: [
          { type: 'listItem', checked: null, children: [{ type: 'paragraph', children: [{ type: 'text', value: 'First numbered' }] }] },
          { type: 'listItem', checked: null, children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Second numbered' }] }] },
        ],
      }],
    };

    const blocks = mdastToBlocks(tree);

    expect(Object.keys(blocks[0].data)).toStrictEqual(['text', 'style', 'depth']);
    expect(blocks[1].data).toStrictEqual({ text: 'Second numbered', style: 'ordered', depth: 0 });
  });

  it('carries an explicit start on the first item and none on the rest', () => {
    const tree: Root = {
      type: 'root',
      children: [{
        type: 'list',
        ordered: true,
        start: 3,
        children: [
          { type: 'listItem', checked: null, children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Third numbered' }] }] },
          { type: 'listItem', checked: null, children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Fourth numbered' }] }] },
        ],
      }],
    };

    const blocks = mdastToBlocks(tree);

    expect(blocks[0].data).toStrictEqual({ text: 'Third numbered', style: 'ordered', depth: 0, start: 3 });
    expect(blocks[1].data).toStrictEqual({ text: 'Fourth numbered', style: 'ordered', depth: 0 });
  });

  it('restarts numbering after a foreign block interrupts the run', () => {
    const tree: Root = {
      type: 'root',
      children: [{
        type: 'list',
        ordered: true,
        children: [
          {
            type: 'listItem',
            checked: null,
            children: [
              { type: 'paragraph', children: [{ type: 'text', value: 'First numbered' }] },
              { type: 'code', lang: 'bash', value: 'echo interrupted' },
            ],
          },
          { type: 'listItem', checked: null, children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Second numbered' }] }] },
        ],
      }],
    };

    const blocks = mdastToBlocks(tree);

    expect(blocks).toHaveLength(3);
    expect(blocks[2].data).toStrictEqual({ text: 'Second numbered', style: 'ordered', depth: 0, start: 2 });
  });

  it('indents a nested list one level deeper', () => {
    const tree: Root = {
      type: 'root',
      children: [{
        type: 'list',
        ordered: false,
        children: [{
          type: 'listItem',
          checked: null,
          children: [
            { type: 'paragraph', children: [{ type: 'text', value: 'Parent item' }] },
            {
              type: 'list',
              ordered: false,
              children: [{
                type: 'listItem',
                checked: null,
                children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Child item' }] }],
              }],
            },
          ],
        }],
      }],
    };

    const blocks = mdastToBlocks(tree);

    expect(blocks[0].data.depth).toBe(0);
    expect(blocks[1].data).toStrictEqual({ text: 'Child item', style: 'unordered', depth: 1 });
  });

  it('keeps a second paragraph of an item and drops the child that converts to nothing', () => {
    const tree: Root = {
      type: 'root',
      children: [{
        type: 'list',
        ordered: false,
        children: [{
          type: 'listItem',
          checked: null,
          children: [
            { type: 'paragraph', children: [{ type: 'text', value: 'Item body' }] },
            { type: 'definition', identifier: 'item-def', url: 'https://example.com/item', title: null },
            { type: 'paragraph', children: [{ type: 'text', value: 'Second item paragraph' }] },
          ],
        }],
      }],
    };

    const blocks = mdastToBlocks(tree);

    expect(blocks).toHaveLength(2);
    expect(blocks[0].data.text).toBe('Item body');
    expect(blocks[1].data.text).toBe('Second item paragraph');
  });
});

describe('mdastToBlocks — tables', () => {
  it('marks a single-row table as having no headings', () => {
    const tree: Root = {
      type: 'root',
      children: [{
        type: 'table',
        children: [{
          type: 'tableRow',
          children: [
            { type: 'tableCell', children: [{ type: 'text', value: 'Solo cell one' }] },
            { type: 'tableCell', children: [{ type: 'text', value: 'Solo cell two' }] },
          ],
        }],
      }],
    };

    const blocks = mdastToBlocks(tree);

    expect(blocks[0].type).toBe('table');
    expect(blocks[0].data.withHeadings).toBe(false);
    expect(blocks[0].data.withHeadingColumn).toBe(false);
  });

  it('gives every cell a paragraph block parented to the table', () => {
    const tree: Root = {
      type: 'root',
      children: [{
        type: 'table',
        children: [
          {
            type: 'tableRow',
            children: [
              { type: 'tableCell', children: [{ type: 'text', value: 'Header name' }] },
              { type: 'tableCell', children: [{ type: 'text', value: 'Header age' }] },
            ],
          },
          {
            type: 'tableRow',
            children: [
              { type: 'tableCell', children: [{ type: 'text', value: 'Alice value' }] },
              { type: 'tableCell', children: [{ type: 'text', value: 'Thirty value' }] },
            ],
          },
        ],
      }],
    };

    const blocks = mdastToBlocks(tree);
    const tableBlock = blocks[0];
    const content = tableBlock.data.content as Array<Array<{ blocks: string[] }>>;

    expect(blocks).toHaveLength(5);
    expect(tableBlock.data.withHeadings).toBe(true);
    expect(content).toHaveLength(2);
    expect(blocks.slice(1).map((block) => block.parent)).toStrictEqual([
      tableBlock.id, tableBlock.id, tableBlock.id, tableBlock.id,
    ]);
    expect(content[1][0].blocks).toStrictEqual([blocks[3].id]);
  });
});

describe('mdastToBlocks — toolMap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits the mapped block for a node the toolMap claims', () => {
    const tree: Root = {
      type: 'root',
      children: [{ type: 'yaml', value: 'title: Mapped node' }],
    };

    const blocks = mdastToBlocks(tree, {
      toolMap: {
        yaml: {
          tool: 'custom-frontmatter',
          data: () => ({ raw: 'Mapped node raw' }),
        },
      },
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('custom-frontmatter');
    expect(blocks[0].data).toStrictEqual({ raw: 'Mapped node raw' });
  });

  it('lets a toolMap entry convert its children through the converter', () => {
    const tree: Root = {
      type: 'root',
      children: [{
        type: 'blockquote',
        children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Child paragraph text' }] }],
      }],
    };

    const blocks = mdastToBlocks(tree, {
      toolMap: {
        blockquote: {
          tool: 'custom-callout',
          data: () => ({ tone: 'info' }),
          children: (node, convert) => {
            const container = node as { children: unknown[] };

            return convert(container.children as Parameters<typeof convert>[0]);
          },
        },
      },
    });

    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe('custom-callout');
    expect(blocks[1].type).toBe('paragraph');
    expect(blocks[1].data.text).toBe('Child paragraph text');
  });

  it('returns no blocks without warning when the toolMap is gone by handler time', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let reads = 0;
    const config: MarkdownImportConfig = {
      // The dispatcher reads `toolMap` once to route the node, then the handler
      // reads it again — a getter is the only way to see the second read.
      get toolMap() {
        reads += 1;

        return reads === 1
          ? { yaml: { tool: 'custom-frontmatter', data: () => ({ raw: 'first read' }) } }
          : undefined;
      },
    };
    const tree: Root = {
      type: 'root',
      children: [{ type: 'yaml', value: 'title: Vanishing map' }],
    };

    const blocks = mdastToBlocks(tree, config);

    expect(warn).not.toHaveBeenCalled();
    expect(blocks).toStrictEqual([]);
  });

  it('warns and drops the node when a toolMap handler throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const boom = new Error('toolMap data exploded');
    const tree: Root = {
      type: 'root',
      children: [{ type: 'yaml', value: 'title: Throwing toolMap' }],
    };

    const blocks = mdastToBlocks(tree, {
      toolMap: {
        yaml: {
          tool: 'custom-frontmatter',
          data: () => {
            throw boom;
          },
        },
      },
    });

    expect(warn).toHaveBeenCalledWith('markdownToBlocks: toolMap handler threw for node type "yaml"', boom);
    expect(blocks).toStrictEqual([]);
  });
});
