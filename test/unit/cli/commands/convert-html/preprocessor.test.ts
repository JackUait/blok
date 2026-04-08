import { describe, it, expect } from 'vitest';
import { preprocess } from '../../../../../src/cli/commands/convert-html/preprocessor';

/** Helper: run preprocess on HTML string, return resulting innerHTML */
function run(html: string): string {
  const dom = new DOMParser().parseFromString(html, 'text/html');

  preprocess(dom.body);

  return dom.body.innerHTML;
}

describe('preprocess', () => {
  describe('convertStrikethroughTags', () => {
    it('converts <del> to <s>', () => {
      expect(run('<del>removed</del>')).toBe('<s>removed</s>');
    });

    it('converts <strike> to <s>', () => {
      expect(run('<strike>old</strike>')).toBe('<s>old</s>');
    });

    it('preserves nested HTML inside strikethrough', () => {
      expect(run('<del>text with <b>bold</b> inside</del>'))
        .toBe('<s>text with <b>bold</b> inside</s>');
    });

    it('leaves existing <s> tags alone', () => {
      expect(run('<s>already correct</s>')).toBe('<s>already correct</s>');
    });
  });

  describe('convertBulletParagraphsToLists', () => {
    it('converts bullet paragraphs to unordered list', () => {
      const result = run('<p>\u2022 item 1</p><p>\u2022 item 2</p>');

      expect(result).toBe('<ul><li>item 1</li><li>item 2</li></ul>');
    });

    it('converts middle dot paragraphs', () => {
      const result = run('<p>\u00B7 item</p>');

      expect(result).toBe('<ul><li>item</li></ul>');
    });

    it('converts hyphen-space paragraphs', () => {
      const result = run('<p>- item</p>');

      expect(result).toBe('<ul><li>item</li></ul>');
    });

    it('splits non-consecutive bullet groups into separate lists', () => {
      const result = run('<p>\u2022 a</p><h2>break</h2><p>\u2022 b</p>');

      expect(result).toContain('<ul><li>a</li></ul>');
      expect(result).toContain('<h2>break</h2>');
      expect(result).toContain('<ul><li>b</li></ul>');
    });

    it('preserves non-bullet paragraphs', () => {
      expect(run('<p>normal text</p>')).toBe('<p>normal text</p>');
    });

    it('preserves inline HTML inside bullet items', () => {
      const result = run('<p>\u2022 <b>bold</b> text</p>');

      expect(result).toBe('<ul><li><b>bold</b> text</li></ul>');
    });
  });

  describe('convertTableCellParagraphs', () => {
    it('converts multiple <p> in cells to <br> separated content', () => {
      const result = run('<table><tr><td><p>Line 1</p><p>Line 2</p></td></tr></table>');

      expect(result).toContain('Line 1<br>Line 2');
    });

    it('removes empty/nbsp paragraphs in cells', () => {
      const result = run('<table><tr><td><p>&nbsp;</p><p>content</p></td></tr></table>');

      expect(result).toContain('content');
      expect(result).not.toContain('&nbsp;');
    });

    it('does not add trailing <br>', () => {
      const result = run('<table><tr><td><p>only one</p></td></tr></table>');
      const cell = result.match(/<td>(.*?)<\/td>/)?.[1] ?? '';

      expect(cell).not.toMatch(/<br\s*\/?>$/);
    });
  });

  describe('stripNbspOnlyParagraphs', () => {
    it('removes <p>&nbsp;</p>', () => {
      expect(run('<p>&nbsp;</p>')).toBe('');
    });

    it('removes <p> with only whitespace', () => {
      expect(run('<p>   </p>')).toBe('');
    });

    it('preserves <p> with real content', () => {
      // jsdom serialises \u00a0 as &nbsp; in innerHTML
      expect(run('<p>Content with &nbsp; inside</p>'))
        .toBe('<p>Content with &nbsp; inside</p>');
    });
  });

  describe('stripSpuriousBackgroundColors', () => {
    it('strips white background-color', () => {
      const result = run('<span style="background-color: rgb(255, 255, 255);">text</span>');

      expect(result).not.toContain('background-color');
    });

    it('strips transparent background-color', () => {
      const result = run('<span style="background-color: transparent;">text</span>');

      expect(result).not.toContain('background-color');
    });

    it('strips rgba with zero alpha', () => {
      const result = run('<span style="background-color: rgba(0, 0, 0, 0);">text</span>');

      expect(result).not.toContain('background-color');
    });

    it('preserves meaningful background colors', () => {
      const result = run('<span style="background-color: rgb(214, 239, 214);">text</span>');

      expect(result).toContain('background-color');
    });
  });

  describe('convertBackgroundDivsToCallouts', () => {
    it('converts div with background color to <aside>', () => {
      const result = run('<div style="background-color: rgb(242, 240, 240);"><p>note</p></div>');

      expect(result).toContain('<aside');
      expect(result).toContain('background-color');
      expect(result).toContain('note');
      expect(result).not.toContain('<div');
    });

    it('skips divs inside tables', () => {
      const result = run('<table><tr><td><div style="background-color: rgb(200,200,200);"><p>cell</p></div></td></tr></table>');

      expect(result).toContain('<div');
      expect(result).not.toContain('<aside');
    });

    it('skips white/transparent background divs', () => {
      const result = run('<div style="background-color: rgb(255, 255, 255);"><p>white</p></div>');

      expect(result).not.toContain('<aside');
    });

    it('unwraps bare div wrappers inside aside', () => {
      const result = run('<div style="background-color: rgb(200, 200, 200);"><div><p>inner</p></div></div>');

      expect(result).toContain('<aside');
      expect(result).toContain('<p>inner</p>');
      // The bare inner div should be unwrapped
      const asideContent = result.match(/<aside[^>]*>([\s\S]*)<\/aside>/)?.[1] ?? '';

      expect(asideContent).not.toContain('<div');
    });
  });

  describe('empty input', () => {
    it('handles empty string', () => {
      expect(run('')).toBe('');
    });
  });
});
