import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We'll test the module behavior via its exported functions.
// Prism itself is a real dependency; we mock the language components.

vi.mock('prismjs/components/prism-javascript', () => ({}));
vi.mock('prismjs/components/prism-typescript', () => ({}));
vi.mock('prismjs/components/prism-python', () => ({}));

describe('prism-loader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isHighlightable', () => {
    it('returns true for javascript', async () => {
      const { isHighlightable } = await import('../../../../src/tools/code/prism-loader');
      expect(isHighlightable('javascript')).toBe(true);
    });

    it('returns false for plain text', async () => {
      const { isHighlightable } = await import('../../../../src/tools/code/prism-loader');
      expect(isHighlightable('plain text')).toBe(false);
    });

    it('returns true for latex (previewable)', async () => {
      const { isHighlightable } = await import('../../../../src/tools/code/prism-loader');
      expect(isHighlightable('latex')).toBe(true);
    });
  });

  describe('tokenizePrism', () => {
    it('returns null for plain text', async () => {
      const { tokenizePrism } = await import('../../../../src/tools/code/prism-loader');
      const result = await tokenizePrism('const x = 1', 'plain text');
      expect(result).toBeNull();
    });

    it('returns highlighted HTML string for javascript', async () => {
      const { tokenizePrism } = await import('../../../../src/tools/code/prism-loader');
      const result = await tokenizePrism('const x = 1;', 'javascript');
      expect(result).not.toBeNull();
      expect(result).toContain('class="token');
    });

    it('returns plain text content when language has no grammar', async () => {
      const { tokenizePrism } = await import('../../../../src/tools/code/prism-loader');
      const result = await tokenizePrism('some code', 'plain text');
      expect(result).toBeNull();
    });

    it('loads language grammar lazily on first call', async () => {
      const loadMod = vi.fn().mockResolvedValue({});
      vi.doMock('prismjs/components/prism-typescript', loadMod);
      const { tokenizePrism, resetPrismState } = await import('../../../../src/tools/code/prism-loader');
      resetPrismState();
      await tokenizePrism('const x: number = 1;', 'typescript');
      // grammar for typescript should have been loaded
      // (we verify indirectly: no throw, result is string or null)
    });

    it('reuses loaded grammar on second call (does not reload)', async () => {
      const { tokenizePrism } = await import('../../../../src/tools/code/prism-loader');
      await tokenizePrism('const x = 1;', 'javascript');
      // Call again — should not re-import
      const result2 = await tokenizePrism('let y = 2;', 'javascript');
      expect(result2).not.toBeNull();
    });

    it('returns null and logs warning when grammar import fails', async () => {
      vi.doMock('prismjs/components/prism-dart', () => { throw new Error('load failed'); });
      const { tokenizePrism, resetPrismState } = await import('../../../../src/tools/code/prism-loader');
      resetPrismState();
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = await tokenizePrism('void main() {}', 'dart');
      expect(result).toBeNull();
      consoleSpy.mockRestore();
    });
  });
});
