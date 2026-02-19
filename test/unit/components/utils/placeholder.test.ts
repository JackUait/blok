import { describe, it, expect } from 'vitest';
import {
  PLACEHOLDER_EMPTY_EDITOR_CLASSES,
  PLACEHOLDER_FOCUS_ONLY_CLASSES,
} from '../../../../src/components/utils/placeholder';

describe('Placeholder utilities', () => {
  describe('PLACEHOLDER_EMPTY_EDITOR_CLASSES', () => {
    it('is an array of strings', () => {
      expect(Array.isArray(PLACEHOLDER_EMPTY_EDITOR_CLASSES)).toBe(true);
      expect(PLACEHOLDER_EMPTY_EDITOR_CLASSES.length).toBeGreaterThan(0);
      PLACEHOLDER_EMPTY_EDITOR_CLASSES.forEach((cls) => {
        expect(typeof cls).toBe('string');
      });
    });

    it('targets data-blok-empty ancestor for before pseudo-element', () => {
      const joined = PLACEHOLDER_EMPTY_EDITOR_CLASSES.join(' ');

      expect(joined).toContain('data-blok-empty');
      expect(joined).toContain('before:');
      expect(joined).toContain('content-[attr(data-blok-placeholder-active)]');
    });

    it('does NOT require :focus for visibility', () => {
      PLACEHOLDER_EMPTY_EDITOR_CLASSES.forEach((cls) => {
        expect(cls).not.toContain(':focus');
      });
    });

    it('includes pointer-events-none, text color, and cursor styles', () => {
      const joined = PLACEHOLDER_EMPTY_EDITOR_CLASSES.join(' ');

      expect(joined).toContain('pointer-events-none');
      expect(joined).toContain('text-gray-text');
      expect(joined).toContain('cursor-text');
    });
  });

  describe('PLACEHOLDER_FOCUS_ONLY_CLASSES', () => {
    it('requires :focus for visibility', () => {
      PLACEHOLDER_FOCUS_ONLY_CLASSES.forEach((cls) => {
        expect(cls).toContain('focus');
      });
    });
  });
});
