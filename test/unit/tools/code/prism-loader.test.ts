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

    it('reuses loaded grammar on second call (does not reload)', async () => {
      const { tokenizePrism } = await import('../../../../src/tools/code/prism-loader');
      await tokenizePrism('const x = 1;', 'javascript');
      // Call again — should not re-import
      const result2 = await tokenizePrism('let y = 2;', 'javascript');
      expect(result2).not.toBeNull();
    });

    describe('mermaid', () => {
      it('returns highlighted HTML for mermaid code', async () => {
        const { tokenizePrism } = await import('../../../../src/tools/code/prism-loader');
        const result = await tokenizePrism('flowchart TD\n  A --> B', 'mermaid');
        expect(result).not.toBeNull();
        expect(result).toContain('class="token');
      });

      it('highlights %% comments with token comment', async () => {
        const { tokenizePrism } = await import('../../../../src/tools/code/prism-loader');
        const result = await tokenizePrism('%% this is a comment', 'mermaid');
        expect(result).toContain('token comment');
      });

      it('highlights %%{...}%% directives with token directive', async () => {
        const { tokenizePrism } = await import('../../../../src/tools/code/prism-loader');
        const result = await tokenizePrism("%%{init: {'theme': 'base'}}%%", 'mermaid');
        expect(result).toContain('token directive');
      });

      // Diagram type keywords (graph, flowchart, sequenceDiagram, etc.)
      // get token diagram-name so they can be colored differently (cyan) from
      // structural keywords like subgraph/end (which stay token keyword)
      it('highlights diagram type keyword (graph) with token diagram-name', async () => {
        const { tokenizePrism } = await import('../../../../src/tools/code/prism-loader');
        const result = await tokenizePrism('graph TD', 'mermaid');
        expect(result).toContain('token diagram-name');
      });

      it('highlights diagram type keyword (flowchart) with token diagram-name', async () => {
        const { tokenizePrism } = await import('../../../../src/tools/code/prism-loader');
        const result = await tokenizePrism('flowchart LR', 'mermaid');
        expect(result).toContain('token diagram-name');
      });

      it('highlights direction (TD, LR) with token keyword', async () => {
        const { tokenizePrism } = await import('../../../../src/tools/code/prism-loader');
        const result = await tokenizePrism('graph TD', 'mermaid');
        expect(result).toContain('token keyword');
      });

      // Node IDs like A, B, myNode get token variable (yellow)
      it('highlights node IDs with token variable', async () => {
        const { tokenizePrism } = await import('../../../../src/tools/code/prism-loader');
        const result = await tokenizePrism('graph TD\n  A --> B', 'mermaid');
        expect(result).toContain('token variable');
      });

      // Node shape brackets [ ] { } ( ) get token node-bracket (cyan)
      it('highlights node label opening bracket with token node-bracket', async () => {
        const { tokenizePrism } = await import('../../../../src/tools/code/prism-loader');
        const result = await tokenizePrism('A[Start]', 'mermaid');
        expect(result).toContain('token node-bracket');
      });

      it('highlights node label content with token string', async () => {
        const { tokenizePrism } = await import('../../../../src/tools/code/prism-loader');
        const result = await tokenizePrism('A[Start]', 'mermaid');
        expect(result).toContain('token string');
      });

      // Arrows --> get token operator (white)
      it('highlights --> arrow with token operator', async () => {
        const { tokenizePrism } = await import('../../../../src/tools/code/prism-loader');
        const result = await tokenizePrism('A --> B', 'mermaid');
        expect(result).toContain('token operator');
      });

      it('highlights -.-> dotted arrow with token operator', async () => {
        const { tokenizePrism } = await import('../../../../src/tools/code/prism-loader');
        const result = await tokenizePrism('A -.-> B', 'mermaid');
        expect(result).toContain('token operator');
      });

      // Edge label delimiters |text| get token edge-delimiter (cyan)
      it('highlights edge label pipe delimiters with token edge-delimiter', async () => {
        const { tokenizePrism } = await import('../../../../src/tools/code/prism-loader');
        const result = await tokenizePrism('B -->|Yes| C', 'mermaid');
        expect(result).toContain('token edge-delimiter');
      });

      // Edge label text gets token edge-label (green)
      it('highlights edge label text with token edge-label', async () => {
        const { tokenizePrism } = await import('../../../../src/tools/code/prism-loader');
        const result = await tokenizePrism('B -->|Yes| C', 'mermaid');
        expect(result).toContain('token edge-label');
      });

      // Structural keywords subgraph/end/participant get token keyword
      it('highlights subgraph keyword with token keyword', async () => {
        const { tokenizePrism } = await import('../../../../src/tools/code/prism-loader');
        const result = await tokenizePrism('subgraph MyGroup', 'mermaid');
        expect(result).toContain('token keyword');
      });
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
