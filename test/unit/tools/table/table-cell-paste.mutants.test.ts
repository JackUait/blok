import { describe, it, expect } from 'vitest';

import {
  parseCellContentToBlocks,
  serializeCellBlocksToHtml,
} from '../../../../src/tools/table/table-cell-paste';

const texts = (html: string): unknown[] =>
  parseCellContentToBlocks(html).map((insert) => [insert.tool, insert.data]);

const paragraph = (text: string): unknown[] => ['paragraph', { text }];

const listItem = (
  text: string,
  { style = 'unordered', checked = false, depth = 0 } = {}
): unknown[] => ['list', { text, style, checked, depth }];

/**
 * Eight survivors are equivalent, in four groups:
 *
 * - widening the break pattern's whitespace class: the splitter never sees the
 *   raw html. Every fragment reaches it through the DOM — an element's
 *   outerHTML, a paragraph's innerHTML, a text node's textContent — so a break
 *   always arrives already serialised as `<br>`, whatever the paste wrote. The
 *   widened class matches that form exactly as the original does. (It does
 *   differ on a literal `<br />`, which is why the test below asserts that form
 *   goes through: the assertion is about the pipeline, not about this mutant.)
 * - the `?? ''` on a non-element node's textContent: a text node's and a
 *   comment node's textContent are both strings, never null.
 * - the two guards inside listItemHtml (`typeof data.text === 'string'` and its
 *   fallback): the only caller filters on exactly that check first.
 * - the empty-run guards in flushParagraphs and the `> 0` half of the
 *   list-flush condition: joining an empty run gives `''`, and pushing `''`
 *   into a list that is later joined with `''` cannot change the result, while
 *   flushing an empty list run returns immediately.
 */
describe('table cell paste mutants', () => {
  describe('inline splitting', () => {
    it('splits on a bare break', () => {
      expect(texts('a<br>b')).toStrictEqual([paragraph('a'), paragraph('b')]);
    });

    it('splits on a self-closing break with a space', () => {
      expect(texts('a<br />b')).toStrictEqual([paragraph('a'), paragraph('b')]);
    });

    it('trims each segment and drops the empty ones', () => {
      expect(texts(' a <br><br> b ')).toStrictEqual([paragraph('a'), paragraph('b')]);
    });

    it('returns one empty paragraph for empty content', () => {
      expect(texts('')).toStrictEqual([paragraph('')]);
    });
  });

  describe('list elements', () => {
    it('emits one insert per item and reads the style off the parent tag', () => {
      expect(texts('<ul><li>one</li><li>two</li></ul>'))
        .toStrictEqual([listItem('one'), listItem('two')]);
      expect(texts('<ol><li>one</li></ol>'))
        .toStrictEqual([listItem('one', { style: 'ordered' })]);
    });

    // An item that is not a direct child of its list has no parent tag to read,
    // so the list element's own tag is the only thing left to go on.
    it('falls back to the list element tag for an indirectly nested item', () => {
      expect(texts('<ol><div><li>x</li></div></ol>'))
        .toStrictEqual([listItem('x', { style: 'ordered' })]);
      expect(texts('<ul><div><li>x</li></div></ul>'))
        .toStrictEqual([listItem('x', { style: 'unordered' })]);
    });

    it('emits a nested item separately and strips it from its parent text', () => {
      expect(texts('<ul><li>a<ul><li>b</li></ul></li></ul>'))
        .toStrictEqual([listItem('a'), listItem('b', { depth: 1 })]);
    });

    it('trims an item down to its text', () => {
      expect(texts('<ul><li> x <br></li></ul>')).toStrictEqual([listItem('x')]);
    });

    it('treats a list element as a list, not as inline markup', () => {
      expect(parseCellContentToBlocks('<ul><li>x</li></ul>')[0].tool).toBe('list');
    });
  });

  describe('block boundaries', () => {
    it('flushes pending inline text before a paragraph', () => {
      expect(texts('a<p>b</p>')).toStrictEqual([paragraph('a'), paragraph('b')]);
    });

    it('flushes a paragraph before whatever follows it', () => {
      expect(texts('<p>a</p>b')).toStrictEqual([paragraph('a'), paragraph('b')]);
    });

    it('flushes pending inline text before a list', () => {
      expect(texts('a<ul><li>b</li></ul>')).toStrictEqual([paragraph('a'), listItem('b')]);
    });
  });

  describe('serializing back', () => {
    it('joins a paragraph run with breaks', () => {
      expect(serializeCellBlocksToHtml([
        { tool: 'paragraph', data: { text: 'a' } },
        { tool: 'paragraph', data: { text: 'b' } },
      ])).toBe('a<br>b');
    });

    it('writes an empty string for a paragraph whose text is not one', () => {
      expect(serializeCellBlocksToHtml([{ tool: 'paragraph', data: { text: 42 } }])).toBe('');
    });

    it('wraps a list run, carrying depth and checked state', () => {
      expect(serializeCellBlocksToHtml([
        { tool: 'list', data: { text: 'a', style: 'checklist', checked: true, depth: 1 } },
        { tool: 'list', data: { text: 'b', style: 'checklist', checked: false, depth: 0 } },
      ])).toBe('<ul><li aria-level="2"><input type="checkbox" checked>a</li>'
        + '<li aria-level="1"><input type="checkbox">b</li></ul>');
    });

    it('keeps consecutive items of one style in a single list', () => {
      expect(serializeCellBlocksToHtml([
        { tool: 'list', data: { text: 'a', style: 'ordered' } },
        { tool: 'list', data: { text: 'b', style: 'ordered' } },
      ])).toBe('<ol><li aria-level="1">a</li><li aria-level="1">b</li></ol>');
    });

    it('opens a new list when the style flips', () => {
      expect(serializeCellBlocksToHtml([
        { tool: 'list', data: { text: 'a', style: 'ordered' } },
        { tool: 'list', data: { text: 'b', style: 'unordered' } },
      ])).toBe('<ol><li aria-level="1">a</li></ol><ul><li aria-level="1">b</li></ul>');
    });

    it('treats a list block whose text is not a string as a paragraph', () => {
      expect(serializeCellBlocksToHtml([{ tool: 'list', data: { text: 42, style: 'ordered' } }])).toBe('');
    });

    it('defaults a depth that is not a number to the first level', () => {
      expect(serializeCellBlocksToHtml([{ tool: 'list', data: { text: 'a', depth: 'deep' } }]))
        .toBe('<ul><li aria-level="1">a</li></ul>');
    });
  });
});
