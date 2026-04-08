import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mocks for CSS Custom Highlight API (not available in jsdom)
class MockHighlight {
  ranges = new Set<Range>();
  priority = 0;
  add(range: Range): void { this.ranges.add(range); }
  delete(range: Range): boolean { return this.ranges.delete(range); }
  get size(): number { return this.ranges.size; }
}

function setupHighlightMocks(): Map<string, MockHighlight> {
  const highlights = new Map<string, MockHighlight>();

  Object.defineProperty(globalThis, 'CSS', {
    value: { highlights },
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'Highlight', {
    value: MockHighlight,
    writable: true,
    configurable: true,
  });

  const mockStylesheet = {
    cssRules: [] as Array<{ cssText: string }>,
    insertRule(rule: string, index: number): number {
      this.cssRules.splice(index, 0, { cssText: rule });
      return index;
    },
  };

  Object.defineProperty(globalThis, 'CSSStyleSheet', {
    value: function MockCSSStyleSheet() { return mockStylesheet; },
    writable: true,
    configurable: true,
  });
  Object.defineProperty(document, 'adoptedStyleSheets', {
    value: [],
    writable: true,
    configurable: true,
  });

  return highlights;
}

function teardownHighlightMocks(): void {
  (globalThis as Record<string, unknown>).CSS = undefined;
  (globalThis as Record<string, unknown>).Highlight = undefined;
}

describe('highlight-applier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    teardownHighlightMocks();
  });

  describe('isHighlightingSupported()', () => {
    it('returns false when CSS.highlights is not available', async () => {
      const { isHighlightingSupported } = await import('../../../../src/tools/code/highlight-applier');
      expect(isHighlightingSupported()).toBe(false);
    });

    it('returns true when CSS.highlights is available', async () => {
      setupHighlightMocks();
      const { isHighlightingSupported } = await import('../../../../src/tools/code/highlight-applier');
      expect(isHighlightingSupported()).toBe(true);
    });
  });

  describe('applyHighlights()', () => {
    it('creates Highlight objects and CSS rules for token colors', async () => {
      const highlights = setupHighlightMocks();
      const { applyHighlights } = await import('../../../../src/tools/code/highlight-applier');

      const element = document.createElement('code');
      element.textContent = 'const x = 1';

      const tokens = {
        light: {
          tokens: [[
            { content: 'const', color: '#A626A4', offset: 0 },
            { content: ' x ', color: '#383A42', offset: 5 },
            { content: '=', color: '#0184BC', offset: 8 },
            { content: ' 1', color: '#986801', offset: 9 },
          ]],
          fg: '#383A42',
        },
        dark: {
          tokens: [[
            { content: 'const', color: '#4FC1FF', offset: 0 },
            { content: ' x ', color: '#D4D4D4', offset: 5 },
            { content: '=', color: '#D4D4D4', offset: 8 },
            { content: ' 1', color: '#B5CEA8', offset: 9 },
          ]],
          fg: '#D4D4D4',
        },
      };

      applyHighlights(element, tokens);

      expect(highlights.size).toBeGreaterThan(0);
      expect(highlights.has('blok-l-a626a4')).toBe(true);
      expect(highlights.has('blok-d-4fc1ff')).toBe(true);

      const darkHl = highlights.get('blok-d-4fc1ff')!;
      expect(darkHl.priority).toBe(1);
    });

    it('creates correct Range boundaries for tokens', async () => {
      const highlights = setupHighlightMocks();
      const { applyHighlights } = await import('../../../../src/tools/code/highlight-applier');

      const element = document.createElement('code');
      element.textContent = 'hello';

      applyHighlights(element, {
        light: {
          tokens: [[{ content: 'hello', color: '#FF0000', offset: 0 }]],
          fg: '#000000',
        },
        dark: {
          tokens: [[{ content: 'hello', color: '#00FF00', offset: 0 }]],
          fg: '#FFFFFF',
        },
      });

      const lightHl = highlights.get('blok-l-ff0000')!;
      expect(lightHl.size).toBe(1);
      const range = [...lightHl.ranges][0];
      expect(range.startOffset).toBe(0);
      expect(range.endOffset).toBe(5);
    });

    it('handles multi-line tokens with correct document offsets', async () => {
      const highlights = setupHighlightMocks();
      const { applyHighlights } = await import('../../../../src/tools/code/highlight-applier');

      const element = document.createElement('code');
      element.textContent = 'ab\ncd';

      applyHighlights(element, {
        light: {
          tokens: [
            [{ content: 'ab', color: '#FF0000', offset: 0 }],
            [{ content: 'cd', color: '#00FF00', offset: 0 }],
          ],
          fg: '#000000',
        },
        dark: {
          tokens: [
            [{ content: 'ab', color: '#FF0000', offset: 0 }],
            [{ content: 'cd', color: '#00FF00', offset: 0 }],
          ],
          fg: '#FFFFFF',
        },
      });

      const greenHl = highlights.get('blok-l-00ff00')!;
      expect(greenHl.size).toBe(1);
      const range = [...greenHl.ranges][0];
      expect(range.startOffset).toBe(3);
      expect(range.endOffset).toBe(5);
    });

    it('returns a cleanup function that removes highlights', async () => {
      const highlights = setupHighlightMocks();
      const { applyHighlights } = await import('../../../../src/tools/code/highlight-applier');

      const element = document.createElement('code');
      element.textContent = 'test';

      const cleanup = applyHighlights(element, {
        light: { tokens: [[{ content: 'test', color: '#FF0000', offset: 0 }]], fg: '#000000' },
        dark: { tokens: [[{ content: 'test', color: '#00FF00', offset: 0 }]], fg: '#FFFFFF' },
      });

      expect(highlights.size).toBeGreaterThan(0);
      cleanup();
      expect(highlights.size).toBe(0);
    });

    it('returns no-op cleanup when highlighting is not supported', async () => {
      const { applyHighlights } = await import('../../../../src/tools/code/highlight-applier');

      const element = document.createElement('code');
      element.textContent = 'test';

      const cleanup = applyHighlights(element, {
        light: { tokens: [[{ content: 'test', color: '#FF0000', offset: 0 }]], fg: '#000000' },
        dark: { tokens: [[{ content: 'test', color: '#00FF00', offset: 0 }]], fg: '#FFFFFF' },
      });

      expect(() => cleanup()).not.toThrow();
    });

    it('skips whitespace-only tokens', async () => {
      const highlights = setupHighlightMocks();
      const { applyHighlights } = await import('../../../../src/tools/code/highlight-applier');

      const element = document.createElement('code');
      element.textContent = 'a b';

      applyHighlights(element, {
        light: {
          tokens: [[
            { content: 'a', color: '#FF0000', offset: 0 },
            { content: ' ', color: '#000000', offset: 1 },
            { content: 'b', color: '#00FF00', offset: 2 },
          ]],
          fg: '#000000',
        },
        dark: {
          tokens: [[
            { content: 'a', color: '#FF0000', offset: 0 },
            { content: ' ', color: '#FFFFFF', offset: 1 },
            { content: 'b', color: '#00FF00', offset: 2 },
          ]],
          fg: '#FFFFFF',
        },
      });

      expect(highlights.has('blok-l-000000')).toBe(false);
    });
  });

  describe('disposeAllHighlights()', () => {
    it('removes all blok highlights and stylesheet', async () => {
      const highlights = setupHighlightMocks();
      const { applyHighlights, disposeAllHighlights } = await import('../../../../src/tools/code/highlight-applier');

      const element = document.createElement('code');
      element.textContent = 'test';
      applyHighlights(element, {
        light: { tokens: [[{ content: 'test', color: '#FF0000', offset: 0 }]], fg: '#000000' },
        dark: { tokens: [[{ content: 'test', color: '#00FF00', offset: 0 }]], fg: '#FFFFFF' },
      });

      expect(highlights.size).toBeGreaterThan(0);
      disposeAllHighlights();
      expect(highlights.size).toBe(0);
    });
  });
});
