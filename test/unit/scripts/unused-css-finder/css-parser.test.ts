/**
 * Tests for CSS Parser
 * Tests the extraction of CSS selectors and class names from CSS content
 */

import { describe, it, expect } from 'vitest';
import { extractClassNames, extractSelectors, parseCSS } from '../../../../scripts/unused-css-finder/css-parser';

describe('CSS Parser', () => {
  describe('extractClassNames', () => {
    it('should extract simple class names', () => {
      const css = '.my-class { color: red; }';
      const result = extractClassNames(css);
      expect(result).toEqual(['my-class']);
    });

    it('should extract multiple class names', () => {
      const css = `
        .class-one { color: red; }
        .class-two { background: blue; }
        .class-three { font-size: 12px; }
      `;
      const result = extractClassNames(css);
      expect(result).toEqual(['class-one', 'class-two', 'class-three']);
    });

    it('should handle class names with modifiers (BEM-style)', () => {
      const css = `
        .blok-button { color: red; }
        .blok-button--active { background: blue; }
        .blok-button__icon { width: 10px; }
      `;
      const result = extractClassNames(css);
      expect(result).toEqual(['blok-button', 'blok-button--active', 'blok-button__icon']);
    });

    it('should handle multiple classes in same selector', () => {
      const css = '.class-a.class-b { color: red; }';
      const result = extractClassNames(css);
      expect(result).toEqual(['class-a', 'class-b']);
    });

    it('should handle element selectors with classes', () => {
      const css = 'div.my-class { color: red; }';
      const result = extractClassNames(css);
      expect(result).toEqual(['my-class']);
    });

    it('should handle attribute selectors with class values', () => {
      const css = '[data-blok-selected="true"] { background: red; }';
      const result = extractClassNames(css);
      expect(result).toEqual([]);
    });

    it('should handle pseudo-classes', () => {
      const css = `
        .my-class:hover { color: red; }
        .my-class:focus { background: blue; }
        .my-class::before { content: ''; }
      `;
      const result = extractClassNames(css);
      expect(result).toEqual(['my-class']);
    });

    it('should handle @layer directives', () => {
      const css = `
        @layer components {
          .blok-block { padding: 10px; }
          .blok-input { width: 100%; }
        }
      `;
      const result = extractClassNames(css);
      expect(result).toEqual(['blok-block', 'blok-input']);
    });

    it('should handle @media queries', () => {
      const css = `
        @media (hover: hover) {
          [data-blok-item-name="delete"]:hover { color: red; }
        }
      `;
      const result = extractClassNames(css);
      expect(result).toEqual([]);
    });

    it('should handle @import directives', () => {
      const css = `
        @import 'tailwindcss/base';
        .my-class { color: red; }
      `;
      const result = extractClassNames(css);
      expect(result).toEqual(['my-class']);
    });

    it('should handle descendant selectors', () => {
      const css = '.parent .child { color: red; }';
      const result = extractClassNames(css);
      expect(result).toEqual(['parent', 'child']);
    });

    it('should handle child selectors', () => {
      const css = '.parent > .child { color: red; }';
      const result = extractClassNames(css);
      expect(result).toEqual(['parent', 'child']);
    });

    it('should handle adjacent sibling selectors', () => {
      const css = '.prev + .next { color: red; }';
      const result = extractClassNames(css);
      expect(result).toEqual(['prev', 'next']);
    });

    it('should handle general sibling selectors', () => {
      const css = '.prev ~ .next { color: red; }';
      const result = extractClassNames(css);
      expect(result).toEqual(['prev', 'next']);
    });

    it('should handle :has() pseudo-class', () => {
      const css = '[data-blok-selected="true"] [data-blok-element-content]:has([data-list-style]) { background: transparent; }';
      const result = extractClassNames(css);
      expect(result).toEqual([]);
    });

    it('should ignore comments', () => {
      const css = `
        /* This is a comment with .fake-class */
        .real-class { color: red; }
        /* Another comment .another-fake */
      `;
      const result = extractClassNames(css);
      expect(result).toEqual(['real-class']);
    });

    it('should handle complex selectors from blok main.css', () => {
      const css = `
        @layer components {
          .blok-block {
            padding: 3px 2px;
          }

          .blok-inline-tool-button {
            display: flex;
          }

          .blok-inline-tool-button--active {
            background: #f0f0f0;
          }
        }

        [data-blok-navigation-focused="true"] {
          background: #f0f0f0;
        }

        @media (hover: hover) {
          [data-blok-item-name="delete"]:hover {
            color: red;
          }
        }
      `;
      const result = extractClassNames(css);
      expect(result).toEqual([
        'blok-block',
        'blok-inline-tool-button',
        'blok-inline-tool-button--active',
      ]);
    });

    it('should return empty array for CSS with no classes', () => {
      const css = `
        body { margin: 0; }
        div { display: block; }
      `;
      const result = extractClassNames(css);
      expect(result).toEqual([]);
    });

    it('should return empty array for empty input', () => {
      const result = extractClassNames('');
      expect(result).toEqual([]);
    });
  });

  describe('extractSelectors', () => {
    it('should extract class selectors', () => {
      const css = '.my-class { color: red; }';
      const result = extractSelectors(css);
      expect(result).toContainEqual({ type: 'class', value: 'my-class', raw: '.my-class' });
    });

    it('should extract attribute selectors', () => {
      const css = '[data-blok-selected="true"] { background: red; }';
      const result = extractSelectors(css);
      expect(result).toContainEqual({
        type: 'attribute',
        value: 'data-blok-selected',
        raw: '[data-blok-selected="true"]',
      });
    });

    it('should extract element selectors', () => {
      const css = 'div { display: block; }';
      const result = extractSelectors(css);
      expect(result).toContainEqual({ type: 'element', value: 'div', raw: 'div' });
    });
  });

  describe('parseCSS', () => {
    it('should parse CSS file and return structured data', () => {
      const css = `
        @import 'tailwindcss/base';

        @layer components {
          .blok-button { padding: 10px; }
        }

        [data-blok-selected="true"] { background: red; }
      `;
      const result = parseCSS(css, 'test.css');

      expect(result).toEqual({
        filePath: 'test.css',
        classes: ['blok-button'],
        attributes: ['data-blok-selected'],
        elements: [],
      });
    });

    it('should handle empty CSS', () => {
      const result = parseCSS('', 'empty.css');
      expect(result).toEqual({
        filePath: 'empty.css',
        classes: [],
        attributes: [],
        elements: [],
      });
    });
  });
});
