// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { ALL_STATIC_CLASSES, classesFor } from '../../../src/shared/tool-classes';
import { PARAGRAPH_CLASSES } from '../../../src/shared/tool-classes/paragraph';

/**
 * These modules are the single source of truth for the presentational classes
 * that both the editor's tools and the view's emitters stamp. The node
 * environment is deliberate: they must be importable without a DOM, since the
 * view renders server-side.
 */
describe('shared tool classes', () => {
  describe('paragraph', () => {
    it('carries the base block class and its typography', () => {
      expect(PARAGRAPH_CLASSES).toContain('blok-block');
      expect(PARAGRAPH_CLASSES).toContain('leading-[1.5]');
    });

    it('omits edit-only placeholder and focus-ring classes', () => {
      expect(PARAGRAPH_CLASSES).not.toContain('outline-hidden');
      expect(PARAGRAPH_CLASSES.some((cls) => cls.includes('placeholder'))).toBe(false);
    });
  });

  describe('classesFor', () => {
    it('resolves classes by tool type', () => {
      expect(classesFor('paragraph', {})).toEqual(PARAGRAPH_CLASSES);
    });

    it('returns an empty list for an unknown tool rather than throwing', () => {
      expect(classesFor('not-a-tool', {})).toEqual([]);
    });
  });

  describe('ALL_STATIC_CLASSES', () => {
    it('is deduped and sorted so generated output is stable', () => {
      expect(ALL_STATIC_CLASSES).toEqual([...new Set(ALL_STATIC_CLASSES)].sort());
    });

    it('reaches every tool module', () => {
      expect(ALL_STATIC_CLASSES).toContain('blok-block');
    });

    it('contains no edit-only classes, which would bloat the generated stylesheet', () => {
      expect(ALL_STATIC_CLASSES.some((cls) => cls.includes(':before:'))).toBe(false);
      expect(ALL_STATIC_CLASSES).not.toContain('outline-hidden');
    });
  });
});
