import { describe, it, expect } from 'vitest';

import { CODE_AREA_CLASSES, CODE_WRAPPER_CLASSES } from '../../../src/shared/tool-classes/code';
import { DIVIDER_WRAPPER_CLASSES, DIVIDER_RULE_CLASSES } from '../../../src/shared/tool-classes/divider';
import { SPACER_WRAPPER_CLASSES } from '../../../src/shared/tool-classes/spacer';
import {
  TOGGLE_WRAPPER_CLASSES,
  TOGGLE_HEADER_ROW_CLASSES,
  TOGGLE_CONTENT_CLASSES,
  TOGGLE_CHILDREN_CLASSES,
} from '../../../src/shared/tool-classes/toggle';

const lists = {
  CODE_AREA_CLASSES,
  CODE_WRAPPER_CLASSES,
  DIVIDER_WRAPPER_CLASSES,
  DIVIDER_RULE_CLASSES,
  SPACER_WRAPPER_CLASSES,
  TOGGLE_WRAPPER_CLASSES,
  TOGGLE_HEADER_ROW_CLASSES,
  TOGGLE_CONTENT_CLASSES,
  TOGGLE_CHILDREN_CLASSES,
};

describe('shared tool classes mutants', () => {
  describe('every list', () => {
    it.each(Object.entries(lists))('%s holds only non-empty, unique class names', (_name, classes) => {
      expect(classes.length).toBeGreaterThan(0);
      expect(new Set(classes).size).toBe(classes.length);

      for (const className of classes) {
        expect(className).not.toBe('');
        expect(className).not.toMatch(/\s/);
      }
    });
  });

  describe('code block', () => {
    it('gives the code area its full set', () => {
      expect(CODE_AREA_CLASSES).toStrictEqual([
        'block',
        'px-4',
        'py-3',
        'font-mono',
        'text-[length:var(--blok-code-font-size,0.875rem)]',
        'leading-relaxed',
        'whitespace-pre-wrap',
        'overflow-x-auto',
        'min-h-[1.5em]',
      ]);
    });

    it('gives the wrapper its full set', () => {
      expect(CODE_WRAPPER_CLASSES).toStrictEqual([
        'flex',
        'flex-col',
        'rounded-xl',
        'border',
        'border-border-secondary',
        'bg-bg-secondary',
        'overflow-hidden',
        'my-2',
      ]);
    });

    it('reads its font size from the host hook, so per-block sizing reaches it', () => {
      expect(CODE_AREA_CLASSES).toContain('text-[length:var(--blok-code-font-size,0.875rem)]');
    });

    it('keeps the monospace font and the wrap behaviour a static render would lose', () => {
      expect(CODE_AREA_CLASSES).toContain('font-mono');
      expect(CODE_AREA_CLASSES).toContain('whitespace-pre-wrap');
      expect(CODE_AREA_CLASSES).toContain('overflow-x-auto');
    });

    it('leaves the editor-only group hook at the call site', () => {
      expect(CODE_WRAPPER_CLASSES).not.toContain('group/code');
      expect(CODE_AREA_CLASSES).not.toContain('outline-hidden');
      expect(CODE_AREA_CLASSES).not.toContain('caret-text-primary');
    });
  });

  describe('divider', () => {
    it('puts the spacing and line box on the wrapper, not the rule', () => {
      expect(DIVIDER_WRAPPER_CLASSES).toStrictEqual(['py-3', 'leading-[1px]']);
      expect(DIVIDER_RULE_CLASSES).not.toContain('py-3');
    });

    it('draws only a top border, and names the theme variable directly', () => {
      expect(DIVIDER_RULE_CLASSES).toStrictEqual([
        'border-t',
        'border-(--blok-border-primary)',
        'border-b-0',
        'border-l-0',
        'border-r-0',
      ]);
      expect(DIVIDER_RULE_CLASSES).not.toContain('border-border-primary');
    });
  });

  describe('spacer', () => {
    it('carries no height, because the size is an inline style', () => {
      expect(SPACER_WRAPPER_CLASSES).toStrictEqual(['relative', 'rounded-md']);

      for (const className of SPACER_WRAPPER_CLASSES) {
        expect(className).not.toMatch(/^h-|^min-h-|^max-h-/);
      }
    });

    it('leaves the editor-only group hook at the call site', () => {
      expect(SPACER_WRAPPER_CLASSES).not.toContain('group/spacer');
    });
  });

  describe('toggle', () => {
    it('gives the wrapper its block padding hooks', () => {
      expect(TOGGLE_WRAPPER_CLASSES).toStrictEqual([
        'pt-[var(--blok-block-padding-top,7px)]',
        'pb-[var(--blok-block-padding-bottom,7px)]',
        'mt-[2px]',
        'mb-px',
      ]);
    });

    it('aligns the arrow to the first line of a wrapping title', () => {
      expect(TOGGLE_HEADER_ROW_CLASSES).toStrictEqual(['flex', 'items-start']);
      expect(TOGGLE_HEADER_ROW_CLASSES).not.toContain('items-center');
    });

    it('lets the title fill the row so the arrow keeps its own column', () => {
      expect(TOGGLE_CONTENT_CLASSES).toStrictEqual([
        'text-[length:var(--blok-toggle-font-size,inherit)]',
        'pl-0.5',
        'leading-[1.5]',
        'flex-1',
        'min-w-0',
      ]);
    });

    it('indents the children container', () => {
      expect(TOGGLE_CHILDREN_CLASSES).toStrictEqual(['pl-7']);
    });

    it('leaves the contenteditable focus-ring suppression at the call site', () => {
      expect(TOGGLE_WRAPPER_CLASSES).not.toContain('outline-hidden');
      expect(TOGGLE_CONTENT_CLASSES).not.toContain('outline-hidden');
    });
  });
});
