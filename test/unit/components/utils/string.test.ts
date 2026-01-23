import { describe, it, expect, afterEach } from 'vitest';
import { capitalize, beautifyShortcut } from '../../../../src/components/utils/string';

describe('string', () => {
  describe('capitalize', () => {
    it('should capitalize first letter of a string', () => {
      expect(capitalize('hello')).toBe('Hello');
      expect(capitalize('world')).toBe('World');
    });

    it('should handle single character strings', () => {
      expect(capitalize('a')).toBe('A');
      expect(capitalize('z')).toBe('Z');
    });

    it('should handle empty string', () => {
      expect(capitalize('')).toBe('');
    });

    it('should not affect already capitalized strings', () => {
      expect(capitalize('Hello')).toBe('Hello');
    });

    it('should only capitalize first letter', () => {
      expect(capitalize('hello world')).toBe('Hello world');
      expect(capitalize('HELLO')).toBe('HELLO');
    });
  });

  describe('beautifyShortcut', () => {
    const originalUserAgent = navigator.userAgent;

    afterEach(() => {
      Object.defineProperty(navigator, 'userAgent', {
        value: originalUserAgent,
        configurable: true,
      });
    });

    it('should replace shift with symbol', () => {
      expect(beautifyShortcut('SHIFT+A')).toContain('⇧');
    });

    it('should replace backspace with symbol', () => {
      expect(beautifyShortcut('BACKSPACE')).toContain('⌫');
    });

    it('should replace enter with symbol', () => {
      expect(beautifyShortcut('ENTER')).toContain('⏎');
    });

    it('should replace arrow keys with symbols', () => {
      const result = beautifyShortcut('UP+LEFT+DOWN+RIGHT');
      expect(result).toContain('↑');
      expect(result).toContain('→');
      expect(result).toContain('↓');
      expect(result).toContain('←');
    });

    it('should replace escape with symbol', () => {
      expect(beautifyShortcut('escape')).toContain('⎋');
    });

    it('should replace delete with symbol', () => {
      expect(beautifyShortcut('DELETE')).toContain('␡');
    });

    it('should replace insert with text', () => {
      expect(beautifyShortcut('INSERT')).toContain('Ins');
    });

    it('should replace plus with space plus space', () => {
      const result = beautifyShortcut('CMD+B');
      expect(result).toContain(' + ');
    });

    it('should use Mac symbols on macOS', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        configurable: true,
      });

      const result = beautifyShortcut('CMD+ALT+CTRL');

      expect(result).toContain('⌘');
      expect(result).toContain('⌥');
    });

    it('should use Windows/Linux symbols on non-Mac', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Windows NT 10.0)',
        configurable: true,
      });

      const result = beautifyShortcut('CMD');

      expect(result).toContain('Ctrl');
    });

    it('should handle complex shortcuts', () => {
      const result = beautifyShortcut('CMD+SHIFT+ENTER');

      expect(result).toContain('⇧');
      expect(result).toContain('⏎');
      expect(result).toContain(' + ');
    });

    it('should replace windows with WIN on non-Mac', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Windows NT 10.0)',
        configurable: true,
      });

      const result = beautifyShortcut('WINDOWS');

      expect(result).toContain('WIN');
    });
  });
});
