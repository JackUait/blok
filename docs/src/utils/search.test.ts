import { describe, it, expect } from 'vitest';
import { buildSearchIndex, getSearchIndex, search } from './search';

describe('search', () => {
  it('should not index any recipe entries', () => {
    const index = getSearchIndex();
    const recipeItems = index.filter(item => item.category === 'recipe');
    expect(recipeItems).toHaveLength(0);
  });

  it('should not include any /recipes paths', () => {
    const index = getSearchIndex();
    const recipePaths = index.filter(item => item.path === '/recipes');
    expect(recipePaths).toHaveLength(0);
  });

  describe('result kind and section', () => {
    it('tags every indexed item with a known kind', () => {
      const index = getSearchIndex();
      const allowed = new Set(['method', 'property', 'option', 'section', 'page']);

      expect(index.length).toBeGreaterThan(0);
      for (const item of index) {
        expect(allowed.has(item.kind)).toBe(true);
      }
    });

    it('tags method entries as "method" and gives them a parent section', () => {
      const methods = getSearchIndex().filter(item => item.kind === 'method');

      expect(methods.length).toBeGreaterThan(0);
      for (const method of methods) {
        expect(method.section).toBeTruthy();
      }
    });

    it('tags config-option entries as "option" with their section', () => {
      const options = getSearchIndex().filter(item => item.kind === 'option');

      expect(options.length).toBeGreaterThan(0);
      for (const option of options) {
        expect(option.section).toBeTruthy();
      }
    });

    it('tags property entries as "property"', () => {
      const properties = getSearchIndex().filter(item => item.kind === 'property');

      expect(properties.length).toBeGreaterThan(0);
    });

    it('tags top-level pages as "page"', () => {
      const pages = getSearchIndex().filter(item => item.module === 'Page');

      expect(pages.length).toBeGreaterThan(0);
      for (const page of pages) {
        expect(page.kind).toBe('page');
      }
    });

    it('tags section overview entries as "section"', () => {
      const sections = getSearchIndex().filter(item => item.kind === 'section');

      expect(sections.length).toBeGreaterThan(0);
    });

    it('carries kind and section through search results', () => {
      const results = search('block', getSearchIndex());

      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect(result.kind).toBeTruthy();
      }
    });
  });

  describe('search index routing', () => {
    it('method results route to the module page with a deep anchor', () => {
      const index = buildSearchIndex();
      const focus = index.find((i) => i.kind === 'method' && i.title.startsWith('caret.focus'));
      expect(focus?.path).toBe('/docs/caret-api');
      expect(focus?.hash).toBe('caret-api-caret-focus');
    });

    it('section results route to the module page without a hash', () => {
      const index = buildSearchIndex();
      const caret = index.find((i) => i.kind === 'section' && i.id === 'caret-api');
      expect(caret?.path).toBe('/docs/caret-api');
      expect(caret?.hash).toBeUndefined();
    });

    it('config option result deep-links', () => {
      const index = buildSearchIndex();
      const holder = index.find((i) => i.kind === 'option' && i.title === 'holder');
      expect(holder?.path).toBe('/docs/config');
      expect(holder?.hash).toBe('config-holder');
    });
  });
});
