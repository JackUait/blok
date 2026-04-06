import { describe, it, expect } from 'vitest';
import { sanitize } from '../../../../../src/cli/commands/convert-html/sanitizer';

function run(html: string): string {
  const dom = new DOMParser().parseFromString(html, 'text/html');

  sanitize(dom.body);

  return dom.body.innerHTML;
}

describe('sanitize', () => {
  describe('inline tags', () => {
    it('preserves <b>', () => {
      expect(run('<p><b>bold</b></p>')).toBe('<p><b>bold</b></p>');
    });

    it('preserves <strong> as-is', () => {
      expect(run('<p><strong>bold</strong></p>')).toBe('<p><strong>bold</strong></p>');
    });

    it('preserves <i>', () => {
      expect(run('<p><i>italic</i></p>')).toBe('<p><i>italic</i></p>');
    });

    it('preserves <em> as-is', () => {
      expect(run('<p><em>italic</em></p>')).toBe('<p><em>italic</em></p>');
    });

    it('preserves <a> with href only', () => {
      expect(run('<p><a href="https://example.com" class="link" target="_blank">link</a></p>'))
        .toBe('<p><a href="https://example.com">link</a></p>');
    });

    it('preserves <s>', () => {
      expect(run('<p><s>struck</s></p>')).toBe('<p><s>struck</s></p>');
    });

    it('preserves <u>', () => {
      expect(run('<p><u>underlined</u></p>')).toBe('<p><u>underlined</u></p>');
    });

    it('preserves <code>', () => {
      expect(run('<p><code>code</code></p>')).toBe('<p><code>code</code></p>');
    });

    it('preserves <br>', () => {
      expect(run('<p>a<br>b</p>')).toContain('<br>');
    });
  });

  describe('disallowed tags', () => {
    it('unwraps <font> preserving children', () => {
      expect(run('<p><font color="red">text</font></p>')).toBe('<p>text</p>');
    });

    it('unwraps <span> preserving children', () => {
      expect(run('<p><span class="x">text</span></p>')).toBe('<p>text</p>');
    });

    it('unwraps nested disallowed tags', () => {
      expect(run('<p><font><span><b>bold</b></span></font></p>'))
        .toBe('<p><b>bold</b></p>');
    });
  });

  describe('structural tags', () => {
    it('preserves <table> structure', () => {
      const result = run('<table><tr><td>cell</td></tr></table>');

      expect(result).toContain('<table>');
      expect(result).toContain('<td>');
    });

    it('preserves style on <td>', () => {
      const result = run('<table><tr><td style="background-color: red; font-size: 12px;">cell</td></tr></table>');

      expect(result).toContain('background-color');
    });

    it('preserves <aside> with style', () => {
      const result = run('<aside style="background-color: rgb(200,200,200);">note</aside>');

      expect(result).toContain('<aside');
      expect(result).toContain('background-color');
    });

    it('preserves <img> with src', () => {
      const result = run('<img src="https://example.com/img.png" alt="pic" class="x">');

      expect(result).toContain('src="https://example.com/img.png"');
      expect(result).not.toContain('alt=');
      expect(result).not.toContain('class=');
    });

    it('preserves aria-level on <li>', () => {
      const result = run('<ul><li aria-level="2" class="x">item</li></ul>');

      expect(result).toContain('aria-level="2"');
      expect(result).not.toContain('class=');
    });
  });

  describe('attribute stripping', () => {
    it('strips class from <p>', () => {
      expect(run('<p class="fancy">text</p>')).toBe('<p>text</p>');
    });

    it('strips style from <p>', () => {
      expect(run('<p style="color: red;">text</p>')).toBe('<p>text</p>');
    });
  });
});
