import { describe, it, expect } from 'vitest';
import { preprocessNotionHtml } from '../../../../../src/components/modules/paste/notion-preprocessor';

describe('preprocessNotionHtml', () => {
  /** Wraps inline HTML in a minimal Notion signature container (bulleted list). */
  const notion = (html: string): string => `<ul class="bulleted-list"><li>${html}</li></ul>`;

  describe('signature detection (no-op safety)', () => {
    it('should return non-Notion HTML unchanged', () => {
      const html = '<p>just a paragraph</p>';

      expect(preprocessNotionHtml(html)).toBe(html);
    });

    it('should return browser-clipboard span HTML unchanged (no Notion signature)', () => {
      /**
       * A bare browser-copied span carries no Notion class signature and must
       * pass through untouched so other paste sources never regress.
       */
      const html = '<span style="color: rgb(0, 0, 0); background-color: rgb(255, 255, 255);">text</span>';

      expect(preprocessNotionHtml(html)).toBe(html);
    });

    it('should rewrite content when a Notion signature is present', () => {
      const html = notion('<del>gone</del>');

      expect(preprocessNotionHtml(html)).not.toBe(html);
    });
  });

  describe('inline marks', () => {
    it('should rewrite <del> to <s> (Blok sanitize allows <s>, strips <del>)', () => {
      const result = preprocessNotionHtml(notion('<del>gone</del>'));

      expect(result).toContain('<s>gone</s>');
      expect(result).not.toContain('<del>');
    });

    it('should rewrite <strike> to <s>', () => {
      const result = preprocessNotionHtml(notion('<strike>gone</strike>'));

      expect(result).toContain('<s>gone</s>');
      expect(result).not.toContain('<strike>');
    });

    it('should preserve the surrounding Notion list markup while rewriting marks', () => {
      const result = preprocessNotionHtml(notion('keep <del>cut</del>'));

      expect(result).toContain('class="bulleted-list"');
      expect(result).toContain('keep <s>cut</s>');
    });
  });
});
