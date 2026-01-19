import { describe, it, expect } from 'vitest';
import { stripFakeBackgroundElements } from '../../../../src/components/utils/html';

describe('html', () => {
  describe('stripFakeBackgroundElements', () => {
    it('should return empty string as-is', () => {
      expect(stripFakeBackgroundElements('')).toBe('');
    });

    it('should return HTML without fake background markers unchanged', () => {
      const html = '<p>Hello <strong>world</strong></p>';
      expect(stripFakeBackgroundElements(html)).toBe(html);
    });

    it('should strip single fake background element', () => {
      const html = '<p>Hello <span data-blok-fake-background="true">world</span></p>';
      const expected = '<p>Hello world</p>';
      expect(stripFakeBackgroundElements(html)).toBe(expected);
    });

    it('should strip multiple fake background elements', () => {
      const html = '<p><span data-blok-fake-background="true">Hello</span> <span data-blok-fake-background="true">world</span></p>';
      const expected = '<p>Hello world</p>';
      expect(stripFakeBackgroundElements(html)).toBe(expected);
    });

    it('should preserve nested content within fake background', () => {
      const html = '<p><span data-blok-fake-background="true"><strong>Hello</strong> world</span></p>';
      const expected = '<p><strong>Hello</strong> world</p>';
      expect(stripFakeBackgroundElements(html)).toBe(expected);
    });

    it('should handle fake background with complex nesting', () => {
      const html = '<div><span data-blok-fake-background="true"><em>text</em><span>nested</span></span></div>';
      const expected = '<div><em>text</em><span>nested</span></div>';
      expect(stripFakeBackgroundElements(html)).toBe(expected);
    });

    it('should handle fake background at the start', () => {
      const html = '<span data-blok-fake-background="true">Start</span> of text';
      const expected = 'Start of text';
      expect(stripFakeBackgroundElements(html)).toBe(expected);
    });

    it('should handle fake background at the end', () => {
      const html = 'End of <span data-blok-fake-background="true">text</span>';
      const expected = 'End of text';
      expect(stripFakeBackgroundElements(html)).toBe(expected);
    });

    it('should handle consecutive fake backgrounds', () => {
      const html = '<span data-blok-fake-background="true">A</span><span data-blok-fake-background="true">B</span><span data-blok-fake-background="true">C</span>';
      const expected = 'ABC';
      expect(stripFakeBackgroundElements(html)).toBe(expected);
    });

    it('should preserve other data-blok attributes', () => {
      const html = '<p data-blok-selected="true">text</p>';
      expect(stripFakeBackgroundElements(html)).toBe(html);
    });

    it('should handle false value for data-blok-fake-background', () => {
      const html = '<span data-blok-fake-background="false">text</span>';
      expect(stripFakeBackgroundElements(html)).toBe(html);
    });

    it('should handle mixed content with fake backgrounds', () => {
      const html = '<p>Before <span data-blok-fake-background="true">highlighted</span> after</p>';
      const expected = '<p>Before highlighted after</p>';
      expect(stripFakeBackgroundElements(html)).toBe(expected);
    });

    it('should handle empty fake background element', () => {
      const html = '<p>Text<span data-blok-fake-background="true"></span>more</p>';
      const expected = '<p>Textmore</p>';
      expect(stripFakeBackgroundElements(html)).toBe(expected);
    });

    it('should return null or undefined as-is', () => {
      expect(stripFakeBackgroundElements(null as unknown as string)).toBe(null);
      expect(stripFakeBackgroundElements(undefined as unknown as string)).toBe(undefined);
    });
  });
});
