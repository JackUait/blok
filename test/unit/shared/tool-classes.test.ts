// @vitest-environment node
import { readFile } from 'fs/promises';

import { describe, expect, it } from 'vitest';

import { ALL_STATIC_CLASSES, classesFor } from '../../../src/shared/tool-classes';
import { headerClasses } from '../../../src/shared/tool-classes/header';
import { PARAGRAPH_CLASSES } from '../../../src/shared/tool-classes/paragraph';
import { quoteClasses } from '../../../src/shared/tool-classes/quote';

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

  describe('header', () => {
    it('routes padding through the public block-padding tokens', () => {
      expect(headerClasses(1)).toContain('pt-[var(--blok-block-padding-top,7px)]');
    });

    it('varies typography by level', () => {
      expect(headerClasses(1)).not.toEqual(headerClasses(3));
      expect(headerClasses(1)).toContain('text-3xl');
      expect(headerClasses(3)).toContain('text-xl');
    });

    it('falls back to level 1 typography for an out-of-range level', () => {
      expect(headerClasses(99)).toEqual(headerClasses(1));
      expect(headerClasses(0)).toEqual(headerClasses(1));
    });

    it('reserves arrow room only for toggleable headings', () => {
      expect(headerClasses(2, true)).toContain('pl-8');
      expect(headerClasses(2, false)).not.toContain('pl-8');
    });

    it('is the single source for the tool level config', async () => {
      /**
       * Header.DEFAULT_LEVELS builds its `styles` strings from
       * HEADER_LEVEL_CLASSES. If someone reintroduces literals there, the
       * editor and the view can disagree about what an H3 looks like.
       */
      const source = await readFile(
        new URL('../../../src/tools/header/index.ts', import.meta.url),
        'utf-8'
      );

      expect(source).not.toMatch(/styles: 'text-(?:xs|sm|base|lg|xl|\dxl)/);
      expect(source).toContain('HEADER_LEVEL_CLASSES[1].join(\' \')');
    });
  });

  describe('quote', () => {
    it('adds the large modifier only for size large', () => {
      expect(quoteClasses('large')).toContain('text-[1.2em]');
      expect(quoteClasses('default')).not.toContain('text-[1.2em]');
    });

    it('keeps blok-block first so its padding overrides win by source order', () => {
      expect(quoteClasses('default')[0]).toBe('blok-block');
    });
  });

  describe('relocated tool constants', () => {
    it.each([
      ['code'],
      ['callout'],
      ['toggle'],
      ['divider'],
      ['spacer'],
    ])('%s resolves a non-empty class list', (tool) => {
      expect(classesFor(tool, {}).length).toBeGreaterThan(0);
    });

    it('excludes Tailwind group markers, which only drive edit-chrome hover rules', () => {
      expect(classesFor('code', {})).not.toContain('group/code');
      expect(classesFor('spacer', {})).not.toContain('group/spacer');
    });

    it('excludes the toggle focus-ring suppression', () => {
      expect(classesFor('toggle', {})).not.toContain('outline-hidden');
    });

    /**
     * The tools' own `*_STYLES` constants must DERIVE from the shared arrays.
     * A second literal copy would drift silently — the class-parity harness only
     * catches divergence once a fixture exercises it.
     */
    it('keeps the tool constants derived from the shared source, not copied', async () => {
      const [codeShared, codeTool] = await Promise.all([
        import('../../../src/shared/tool-classes/code'),
        import('../../../src/tools/code/constants'),
      ]);

      expect(codeTool.WRAPPER_STYLES).toBe(['group/code', ...codeShared.CODE_WRAPPER_CLASSES].join(' '));

      const [calloutShared, calloutTool] = await Promise.all([
        import('../../../src/shared/tool-classes/callout'),
        import('../../../src/tools/callout/constants'),
      ]);

      expect(calloutTool.WRAPPER_STYLES).toBe(calloutShared.CALLOUT_WRAPPER_CLASSES.join(' '));
      expect(calloutTool.CHILDREN_STYLES).toBe(calloutShared.CALLOUT_CHILDREN_CLASSES.join(' '));

      const [toggleShared, toggleTool] = await Promise.all([
        import('../../../src/shared/tool-classes/toggle'),
        import('../../../src/tools/toggle/constants'),
      ]);

      expect(toggleTool.BASE_STYLES).toBe(['outline-hidden', ...toggleShared.TOGGLE_WRAPPER_CLASSES].join(' '));
    });
  });

  describe('classesFor', () => {
    it('resolves classes by tool type', () => {
      expect(classesFor('paragraph', {})).toEqual(PARAGRAPH_CLASSES);
    });

    it('returns an empty list for an unknown tool rather than throwing', () => {
      expect(classesFor('not-a-tool', {})).toEqual([]);
    });

    it('dispatches data-dependent tools through their factory', () => {
      expect(classesFor('header', { level: 2 })).toEqual(headerClasses(2));
      expect(classesFor('header', { level: 2, isToggleable: true })).toEqual(headerClasses(2, true));
      expect(classesFor('quote', { size: 'large' })).toEqual(quoteClasses('large'));
    });

    it('tolerates missing or wrongly-typed data fields', () => {
      /** Saved documents are wire data; a viewer must never throw on a malformed block. */
      expect(classesFor('header', {})).toEqual(headerClasses(1));
      expect(classesFor('header', { level: 'two' })).toEqual(headerClasses(1));
      expect(classesFor('quote', {})).toEqual(quoteClasses('default'));
      expect(classesFor('quote', { size: 42 })).toEqual(quoteClasses('default'));
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
