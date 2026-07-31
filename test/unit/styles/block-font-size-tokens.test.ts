/**
 * Per-block font-size contract.
 *
 * `config.style.fontSize` writes one `--blok-*-font-size` custom property per
 * text scenario (see src/components/utils/font-size-tokens.ts). That config is
 * inert unless the rendering side READS the token — these tests pin the read
 * side, and pin each block's historical size as the `var()` fallback so an
 * editor with no fontSize config renders exactly as it did before.
 */
import { describe, expect, it } from 'vitest';

import { CALLOUT_WRAPPER_CLASSES } from '../../../src/shared/tool-classes/callout';
import { CODE_AREA_CLASSES } from '../../../src/shared/tool-classes/code';
import { LIST_ITEM_CLASSES } from '../../../src/shared/tool-classes/list';
import { PARAGRAPH_CLASSES } from '../../../src/shared/tool-classes/paragraph';
import { quoteClasses } from '../../../src/shared/tool-classes/quote';
import { TOGGLE_CONTENT_CLASSES } from '../../../src/shared/tool-classes/toggle';

import { readMainCss } from './helpers/read-main-css';

const css = readMainCss();

/** Tailwind arbitrary-value font-size utility for a token + fallback. */
const sizeUtility = (token: string, fallback: string): string =>
  `text-[length:var(${token},${fallback})]`;

describe('per-block font-size tokens', () => {
  describe('blocks sized by a Tailwind class', () => {
    it('paragraph reads --blok-paragraph-font-size, inheriting by default', () => {
      expect(PARAGRAPH_CLASSES).toContain(sizeUtility('--blok-paragraph-font-size', 'inherit'));
    });

    it('list items read --blok-list-font-size, inheriting by default', () => {
      expect(LIST_ITEM_CLASSES).toContain(sizeUtility('--blok-list-font-size', 'inherit'));
    });

    it('callout reads --blok-callout-font-size, falling back to the paragraph token then inherit', () => {
      /**
       * The whole callout → paragraph → inherit chain lives in this ONE
       * declaration. Naming the token again on the child paragraph squared any
       * relative value, so `calc(1em * 1.5)` gave a 24px wrapper 36px text.
       */
      expect(CALLOUT_WRAPPER_CLASSES).toContain(
        sizeUtility('--blok-callout-font-size', 'var(--blok-paragraph-font-size,inherit)')
      );
    });

    it('toggle title reads --blok-toggle-font-size, inheriting by default', () => {
      expect(TOGGLE_CONTENT_CLASSES).toContain(sizeUtility('--blok-toggle-font-size', 'inherit'));
    });

    it('code keeps its text-sm scale as the fallback', () => {
      expect(CODE_AREA_CLASSES).toContain(sizeUtility('--blok-code-font-size', '0.875rem'));
      expect(CODE_AREA_CLASSES).not.toContain('text-sm');
    });

    it('quote sizes each variant from its own token, keeping 1.2em for large', () => {
      expect(quoteClasses('default')).toContain(sizeUtility('--blok-quote-font-size', 'inherit'));
      expect(quoteClasses('large')).toContain(sizeUtility('--blok-quote-large-font-size', '1.2em'));

      /**
       * The variants are mutually exclusive: two font-size utilities on one
       * element would make the rendered size depend on generated-utility
       * source order rather than on the saved size.
       */
      expect(quoteClasses('large')).not.toContain(sizeUtility('--blok-quote-font-size', 'inherit'));
      expect(quoteClasses('default')).not.toContain(
        sizeUtility('--blok-quote-large-font-size', '1.2em')
      );
    });
  });

  describe('blocks sized by an authored CSS rule', () => {
    it.each([
      ['checklist items', 'var(--blok-checklist-font-size, var(--blok-list-font-size, inherit))'],
      ['compact table cells', 'var(--blok-table-font-size, 0.875rem)'],
      ['comfortable table cells', 'var(--blok-table-comfortable-font-size, 1rem)'],
      ['image caption', 'var(--blok-image-caption-font-size, 12px)'],
      ['video caption', 'var(--blok-video-caption-font-size, 13.5px)'],
      ['audio caption', 'var(--blok-audio-caption-font-size, var(--blok-font-size-ui-label))'],
      ['file caption', 'var(--blok-file-caption-font-size, var(--blok-font-size-ui-label))'],
      ['embed caption', 'var(--blok-embed-caption-font-size, 0.875em)'],
      ['bookmark title', 'var(--blok-bookmark-title-font-size, 14px)'],
      ['bookmark description', 'var(--blok-bookmark-description-font-size, 12px)'],
      ['bookmark link row', 'var(--blok-bookmark-link-font-size, 12px)'],
    ])('%s read their token with the historical size as fallback', (_scenario, declaration) => {
      expect(css).toContain(`font-size: ${declaration}`);
    });

    it('lets the callout body inherit the wrapper size instead of re-reading the token', () => {
      /**
       * A callout renders its text as a CHILD paragraph block, so the
       * paragraph's own size utility would otherwise win and a host that set
       * both `fontSize.callout` and `fontSize.paragraph` could never make
       * callout text differ from body text — the callout scenario would only
       * size the emoji row. This rule still beats that utility, but resolves to
       * `inherit`: the wrapper has already applied the callout → paragraph →
       * inherit chain, and naming a relative token twice down one inheritance
       * chain squares it.
       */
      expect(css).toContain('[data-blok-tool="callout"] [data-blok-tool="paragraph"] {\n  font-size: inherit;');
    });

    it('keeps the six heading levels on their pre-existing tokens', () => {
      for (const level of [1, 2, 3, 4, 5, 6]) {
        expect(css).toContain(`font-size: var(--blok-heading-${level}-font-size,`);
      }
    });
  });
});
