import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { buildBlocks } from '../../../../../src/cli/commands/convert-html/block-builder';
import type { OutputBlockData } from '../../../../../src/cli/commands/convert-html/types';

const BULB = '\u{1F4A1}';

const run = (html: string): OutputBlockData[] => {
  const wrapper = document.createElement('div');

  wrapper.innerHTML = html;

  return buildBlocks(wrapper);
};

/**
 * Wrapper made of hand-built nodes. It is the only way to reach the `?? ''`
 * fallbacks: a real DOM never gives an element or a text node a null
 * `textContent`, so those defaults are unreachable through parsed HTML.
 */
const runFake = (children: unknown[]): OutputBlockData[] =>
  buildBlocks({ childNodes: children } as unknown as HTMLElement);

const YELLOW_BG = 'rgb(255, 240, 200)';

describe('convert-html block builder mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('top-level nodes', () => {
    it('trims a bare text node and emits it as a numbered paragraph', () => {
      expect(run('  raw text  <p>p</p>')).toStrictEqual([
        { id: 'paragraph-1', type: 'paragraph', data: { text: 'raw text' } },
        { id: 'paragraph-2', type: 'paragraph', data: { text: 'p' } },
      ]);
    });

    it('drops a whitespace-only text node between two paragraphs', () => {
      expect(run('<p>a</p>   <p>b</p>')).toStrictEqual([
        { id: 'paragraph-1', type: 'paragraph', data: { text: 'a' } },
        { id: 'paragraph-2', type: 'paragraph', data: { text: 'b' } },
      ]);
    });

    it('drops a text node carrying no content at all', () => {
      expect(runFake([{ nodeType: Node.TEXT_NODE, textContent: null }])).toStrictEqual([]);
    });

    it('ignores a comment node', () => {
      expect(run('<!-- c --><p>x</p>')).toStrictEqual([
        { id: 'paragraph-1', type: 'paragraph', data: { text: 'x' } },
      ]);
    });
  });

  describe('simple elements', () => {
    it('converts a heading, keeping its level and its own id counter', () => {
      expect(run('<h2>T</h2>')).toStrictEqual([
        { id: 'header-1', type: 'header', data: { text: 'T', level: 2 } },
      ]);
    });

    it('leaves a tag that merely starts with a heading name as a paragraph', () => {
      expect(run('<h1x>hi</h1x>')).toStrictEqual([
        { id: 'paragraph-1', type: 'paragraph', data: { text: 'hi' } },
      ]);
    });

    it('leaves a tag that merely ends with a heading name as a paragraph', () => {
      expect(run('<x-h1>hi</x-h1>')).toStrictEqual([
        { id: 'paragraph-1', type: 'paragraph', data: { text: 'hi' } },
      ]);
    });

    it('converts a blockquote', () => {
      expect(run('<blockquote>Q</blockquote>')).toStrictEqual([
        { id: 'quote-1', type: 'quote', data: { text: 'Q', size: 'default' } },
      ]);
    });

    it('converts a pre to a plain-text code block', () => {
      expect(run('<pre>a code</pre>')).toStrictEqual([
        { id: 'code-1', type: 'code', data: { code: 'a code', language: 'plain-text' } },
      ]);
    });

    it('gives a code block an empty string when the element has no text content', () => {
      expect(runFake([{ nodeType: Node.ELEMENT_NODE, tagName: 'PRE', textContent: null }])).toStrictEqual([
        { id: 'code-1', type: 'code', data: { code: '', language: 'plain-text' } },
      ]);
    });

    it('converts an hr to a divider', () => {
      expect(run('<hr>')).toStrictEqual([{ id: 'divider-1', type: 'divider', data: {} }]);
    });

    it('converts an image, reading its width out of the style attribute', () => {
      expect(run('<img src="x.png" style="width: 240px">')).toStrictEqual([
        {
          id: 'image-1',
          type: 'image',
          data: { url: 'x.png' },
          stretched: null,
          key: null,
          width: 240,
        },
      ]);
    });

    it('converts an image with neither src nor width', () => {
      expect(run('<img>')).toStrictEqual([
        {
          id: 'image-1',
          type: 'image',
          data: { url: '' },
          stretched: null,
          key: null,
          width: null,
        },
      ]);
    });

    it('converts details to a toggle titled by its summary', () => {
      expect(run('<details><summary>Sum</summary><p>body</p></details>')).toStrictEqual([
        { id: 'toggle-1', type: 'toggle', data: { text: 'Sum' } },
      ]);
    });

    it('falls back to a paragraph for an element with no converter', () => {
      expect(run('<div>plain</div>')).toStrictEqual([
        { id: 'paragraph-1', type: 'paragraph', data: { text: 'plain' } },
      ]);
    });
  });

  describe('lists', () => {
    it('flattens an unordered list', () => {
      expect(run('<ul><li>one</li><li>two</li></ul>')).toStrictEqual([
        {
          id: 'list-1',
          type: 'list',
          data: { text: 'one', style: 'unordered', depth: null, checked: null, start: null },
        },
        {
          id: 'list-2',
          type: 'list',
          data: { text: 'two', style: 'unordered', depth: null, checked: null, start: null },
        },
      ]);
    });

    it('puts an ordered list start on the first item only', () => {
      expect(run('<ol start="5"><li>a</li><li>b</li></ol>')).toStrictEqual([
        {
          id: 'list-1',
          type: 'list',
          data: { text: 'a', style: 'ordered', depth: null, checked: null, start: 5 },
        },
        {
          id: 'list-2',
          type: 'list',
          data: { text: 'b', style: 'ordered', depth: null, checked: null, start: null },
        },
      ]);
    });

    it('skips a list child that is not a list item', () => {
      expect(run('<ul><li>one</li><div>junk</div></ul>')).toStrictEqual([
        {
          id: 'list-1',
          type: 'list',
          data: { text: 'one', style: 'unordered', depth: null, checked: null, start: null },
        },
      ]);
    });

    it('trims the item text', () => {
      expect(run('<ul><li>  padded  </li></ul>')).toStrictEqual([
        {
          id: 'list-1',
          type: 'list',
          data: { text: 'padded', style: 'unordered', depth: null, checked: null, start: null },
        },
      ]);
    });

    it('gives a nested ordered list its own style and depth', () => {
      expect(run('<ul><li>a<ol><li>b</li></ol></li></ul>')).toStrictEqual([
        {
          id: 'list-1',
          type: 'list',
          data: { text: 'a', style: 'unordered', depth: null, checked: null, start: null },
        },
        {
          id: 'list-2',
          type: 'list',
          data: { text: 'b', style: 'ordered', depth: 1, checked: null, start: null },
        },
      ]);
    });

    it('keeps a nested unordered list unordered', () => {
      expect(run('<ul><li>a<ul><li>b</li></ul></li></ul>')).toStrictEqual([
        {
          id: 'list-1',
          type: 'list',
          data: { text: 'a', style: 'unordered', depth: null, checked: null, start: null },
        },
        {
          id: 'list-2',
          type: 'list',
          data: { text: 'b', style: 'unordered', depth: 1, checked: null, start: null },
        },
      ]);
    });
  });

  describe('tables', () => {
    it('emits the table before the paragraphs its cells produced', () => {
      expect(run('<table><tr><td>a</td><td>b</td></tr></table>')).toStrictEqual([
        {
          id: 'table-1',
          type: 'table',
          data: {
            withHeadings: false,
            withHeadingColumn: false,
            content: [
              [
                { blocks: ['paragraph-1'], color: null, textColor: null },
                { blocks: ['paragraph-2'], color: null, textColor: null },
              ],
            ],
          },
        },
        { id: 'paragraph-1', type: 'paragraph', parent: 'table-1', data: { text: 'a' } },
        { id: 'paragraph-2', type: 'paragraph', parent: 'table-1', data: { text: 'b' } },
      ]);
    });

    it('marks headings when only part of the first row is a th', () => {
      expect(run('<table><tr><th>h</th><td>d</td></tr></table>')).toStrictEqual([
        {
          id: 'table-1',
          type: 'table',
          data: {
            withHeadings: true,
            withHeadingColumn: false,
            content: [
              [
                { blocks: ['paragraph-1'], color: null, textColor: null },
                { blocks: ['paragraph-2'], color: null, textColor: null },
              ],
            ],
          },
        },
        { id: 'paragraph-1', type: 'paragraph', parent: 'table-1', data: { text: 'h' } },
        { id: 'paragraph-2', type: 'paragraph', parent: 'table-1', data: { text: 'd' } },
      ]);
    });

    it('leaves a blank cell empty instead of giving it a paragraph', () => {
      expect(run('<table><tr><td>  </td><td>x</td></tr></table>')).toStrictEqual([
        {
          id: 'table-1',
          type: 'table',
          data: {
            withHeadings: false,
            withHeadingColumn: false,
            content: [
              [
                { blocks: [], color: null, textColor: null },
                { blocks: ['paragraph-1'], color: null, textColor: null },
              ],
            ],
          },
        },
        { id: 'paragraph-1', type: 'paragraph', parent: 'table-1', data: { text: 'x' } },
      ]);
    });

    it('reads a column width from the first row', () => {
      expect(run('<table><tr><td style="width: 120px">a</td></tr></table>')).toStrictEqual([
        {
          id: 'table-1',
          type: 'table',
          data: {
            withHeadings: false,
            withHeadingColumn: false,
            content: [[{ blocks: ['paragraph-1'], color: null, textColor: null }]],
            colWidths: [120],
          },
        },
        { id: 'paragraph-1', type: 'paragraph', parent: 'table-1', data: { text: 'a' } },
      ]);
    });

    it('keeps the widths when only one column declares one', () => {
      expect(run('<table><tr><td style="width: 120px">a</td><td>b</td></tr></table>')).toStrictEqual([
        {
          id: 'table-1',
          type: 'table',
          data: {
            withHeadings: false,
            withHeadingColumn: false,
            content: [
              [
                { blocks: ['paragraph-1'], color: null, textColor: null },
                { blocks: ['paragraph-2'], color: null, textColor: null },
              ],
            ],
            colWidths: [120, null],
          },
        },
        { id: 'paragraph-1', type: 'paragraph', parent: 'table-1', data: { text: 'a' } },
        { id: 'paragraph-2', type: 'paragraph', parent: 'table-1', data: { text: 'b' } },
      ]);
    });

    it('maps the cell background and text colours to presets', () => {
      const style = 'background-color: rgb(255, 240, 200); color:  rgb(224, 62, 62)  ;';

      expect(run(`<table><tr><td style="${style}">a</td></tr></table>`)).toStrictEqual([
        {
          id: 'table-1',
          type: 'table',
          data: {
            withHeadings: false,
            withHeadingColumn: false,
            content: [[{ blocks: ['paragraph-1'], color: 'yellow', textColor: 'red' }]],
          },
        },
        { id: 'paragraph-1', type: 'paragraph', parent: 'table-1', data: { text: 'a' } },
      ]);
    });

    it('converts a table with no rows at all', () => {
      expect(run('<table></table>')).toStrictEqual([
        {
          id: 'table-1',
          type: 'table',
          data: { withHeadings: false, withHeadingColumn: false, content: [] },
        },
      ]);
    });

    it('inserts the table after earlier blocks but before its own children', () => {
      expect(run('<p>before</p><table><tr><td>a</td></tr></table>')).toStrictEqual([
        { id: 'paragraph-1', type: 'paragraph', data: { text: 'before' } },
        {
          id: 'table-1',
          type: 'table',
          data: {
            withHeadings: false,
            withHeadingColumn: false,
            content: [[{ blocks: ['paragraph-2'], color: null, textColor: null }]],
          },
        },
        { id: 'paragraph-2', type: 'paragraph', parent: 'table-1', data: { text: 'a' } },
      ]);
    });

    it('appends a childless table after earlier blocks', () => {
      expect(run('<p>before</p><table></table>')).toStrictEqual([
        { id: 'paragraph-1', type: 'paragraph', data: { text: 'before' } },
        {
          id: 'table-1',
          type: 'table',
          data: { withHeadings: false, withHeadingColumn: false, content: [] },
        },
      ]);
    });
  });

  describe('callouts', () => {
    it('emits the callout before its child and maps the background', () => {
      expect(run(`<aside style="background-color: ${YELLOW_BG}"><p>x</p></aside>`)).toStrictEqual([
        {
          id: 'callout-1',
          type: 'callout',
          data: { emoji: BULB, backgroundColor: 'yellow' },
          content: ['paragraph-1'],
        },
        { id: 'paragraph-1', type: 'paragraph', parent: 'callout-1', data: { text: 'x' } },
      ]);
    });

    it('keeps whitespace between children out of the content list', () => {
      expect(run(`<aside style="background-color: ${YELLOW_BG}"> <p>x</p> </aside>`)).toStrictEqual([
        {
          id: 'callout-1',
          type: 'callout',
          data: { emoji: BULB, backgroundColor: 'yellow' },
          content: ['paragraph-1'],
        },
        { id: 'paragraph-1', type: 'paragraph', parent: 'callout-1', data: { text: 'x' } },
      ]);
    });

    it('turns a bare text child into its own trimmed paragraph', () => {
      expect(run(`<aside style="background-color: ${YELLOW_BG}">  raw  <p>x</p></aside>`)).toStrictEqual([
        {
          id: 'callout-1',
          type: 'callout',
          data: { emoji: BULB, backgroundColor: 'yellow' },
          content: ['paragraph-1', 'paragraph-2'],
        },
        { id: 'paragraph-1', type: 'paragraph', parent: 'callout-1', data: { text: 'raw' } },
        { id: 'paragraph-2', type: 'paragraph', parent: 'callout-1', data: { text: 'x' } },
      ]);
    });

    it('ignores a comment child', () => {
      expect(run(`<aside style="background-color: ${YELLOW_BG}"><!-- note --><p>x</p></aside>`)).toStrictEqual([
        {
          id: 'callout-1',
          type: 'callout',
          data: { emoji: BULB, backgroundColor: 'yellow' },
          content: ['paragraph-1'],
        },
        { id: 'paragraph-1', type: 'paragraph', parent: 'callout-1', data: { text: 'x' } },
      ]);
    });

    it('ignores a text child carrying no content at all', () => {
      const aside = {
        nodeType: Node.ELEMENT_NODE,
        tagName: 'ASIDE',
        getAttribute: (_name: string): string | null => null,
        childNodes: [{ nodeType: Node.TEXT_NODE, textContent: null }],
      };

      expect(runFake([aside])).toStrictEqual([
        {
          id: 'callout-1',
          type: 'callout',
          data: { emoji: BULB, backgroundColor: null },
          content: [],
        },
      ]);
    });

    it('leaves the background unset when the aside has no style', () => {
      expect(run('<aside><p>x</p></aside>')).toStrictEqual([
        {
          id: 'callout-1',
          type: 'callout',
          data: { emoji: BULB, backgroundColor: null },
          content: ['paragraph-1'],
        },
        { id: 'paragraph-1', type: 'paragraph', parent: 'callout-1', data: { text: 'x' } },
      ]);
    });

    it.each([
      ['white', 'rgb(255, 255, 255)'],
      ['dark', 'rgb(25, 25, 24)'],
    ])('does not map the default %s page background to a preset', (_name, color) => {
      expect(run(`<aside style="background-color: ${color}"><p>x</p></aside>`)).toStrictEqual([
        {
          id: 'callout-1',
          type: 'callout',
          data: { emoji: BULB, backgroundColor: null },
          content: ['paragraph-1'],
        },
        { id: 'paragraph-1', type: 'paragraph', parent: 'callout-1', data: { text: 'x' } },
      ]);
    });

    it('appends a childless callout after earlier blocks', () => {
      expect(run('<p>before</p><aside></aside>')).toStrictEqual([
        { id: 'paragraph-1', type: 'paragraph', data: { text: 'before' } },
        {
          id: 'callout-1',
          type: 'callout',
          data: { emoji: BULB, backgroundColor: null },
          content: [],
        },
      ]);
    });

    it('inserts the callout after earlier blocks but before its own children', () => {
      expect(run(`<p>before</p><aside style="background-color: ${YELLOW_BG}"><p>x</p></aside>`)).toStrictEqual([
        { id: 'paragraph-1', type: 'paragraph', data: { text: 'before' } },
        {
          id: 'callout-1',
          type: 'callout',
          data: { emoji: BULB, backgroundColor: 'yellow' },
          content: ['paragraph-2'],
        },
        { id: 'paragraph-2', type: 'paragraph', parent: 'callout-1', data: { text: 'x' } },
      ]);
    });
  });
});
