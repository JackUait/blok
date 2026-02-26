/**
 * Regression tests for BasePasteHandler static imports.
 *
 * Verifies that processInlinePaste() and processSingleBlock() use static
 * imports for `clean` and `Dom` instead of dynamic `await import()`.
 *
 * Dynamic imports in production Rollup builds get transformed into
 * chunk-loading chains with auto-generated export ordinals (e.g. c.aX).
 * These break when chunks are cached across builds or re-bundled
 * downstream, causing:
 *   TypeError: Cannot destructure property 'clean' of '(intermediate value)' as it is undefined
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

describe('BasePasteHandler static imports (regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Helper: creates a concrete subclass of BasePasteHandler that
   * exposes its protected methods for testing.
   */
  async function createTestHandler(blokMock: BlokModules) {
    const { BasePasteHandler } = await import(
      '../../../../../src/components/modules/paste/handlers/base'
    );

    class TestHandler extends BasePasteHandler {
      canHandle(): number {
        return 0;
      }
      async handle(): Promise<boolean> {
        return false;
      }

      /** Expose protected processInlinePaste */
      async testProcessInlinePaste(
        data: Parameters<typeof this.processInlinePaste>[0],
        canReplace: boolean
      ): Promise<void> {
        return this.processInlinePaste(data, canReplace);
      }

      /** Expose protected processSingleBlock */
      async testProcessSingleBlock(
        data: Parameters<typeof this.processSingleBlock>[0],
        canReplace: boolean
      ): Promise<void> {
        return this.processSingleBlock(data, canReplace);
      }
    }

    return new TestHandler(blokMock, {} as never, {} as never);
  }

  /**
   * Helper: builds a minimal BlokModules mock with a currentBlock that
   * has a currentInput, so processInlinePaste follows the inline path.
   */
  function createBlokMock() {
    const insertContentAtCaretPosition = vi.fn();
    const currentInput = document.createElement('div');
    currentInput.contentEditable = 'true';

    return {
      blok: {
        BlockManager: {
          currentBlock: {
            name: 'paragraph',
            tool: {
              isDefault: true,
              baseSanitizeConfig: { b: true, i: true, a: { href: true } },
            },
            isEmpty: false,
            currentInput,
            holder: document.createElement('div'),
          },
          paste: vi.fn().mockResolvedValue({ id: 'pasted-block' }),
          insert: vi.fn().mockReturnValue({ id: 'new-block' }),
          setCurrentBlockByChildNode: vi.fn(),
        },
        Caret: {
          setToBlock: vi.fn(),
          positions: { END: 'end' },
          insertContentAtCaretPosition,
        },
        YjsManager: {
          stopCapturing: vi.fn(),
        },
      } as unknown as BlokModules,
      insertContentAtCaretPosition,
    };
  }

  describe('processInlinePaste', () => {
    it('should sanitize and insert inline content without dynamic import', async () => {
      const { blok, insertContentAtCaretPosition } = createBlokMock();
      const handler = await createTestHandler(blok);

      const content = document.createElement('div');
      content.innerHTML = '<b>bold</b> and <script>evil</script> text';

      const pasteData = {
        tool: 'paragraph',
        content,
        isBlock: false,
        event: new CustomEvent('paste'),
      };

      // This should NOT throw "Cannot destructure property 'clean'"
      await handler.testProcessInlinePaste(pasteData as never, false);

      // Caret.insertContentAtCaretPosition should have been called with sanitized HTML
      expect(insertContentAtCaretPosition).toHaveBeenCalledTimes(1);

      const sanitizedHtml = insertContentAtCaretPosition.mock.calls[0][0] as string;

      // The <b> tag should survive (it's in baseSanitizeConfig)
      expect(sanitizedHtml).toContain('<b>');
      // The <script> tag should be stripped by the sanitizer
      expect(sanitizedHtml).not.toContain('<script>');
    });

    it('should fall back to insertBlock when no currentInput exists', async () => { // eslint-disable-line internal-unit-test/require-behavior-verification
      const { blok } = createBlokMock();

      // Remove currentInput to trigger the fallback path
      const block = (blok as unknown as { BlockManager: { currentBlock: { currentInput: null } } })
        .BlockManager.currentBlock;

      block.currentInput = null;

      const handler = await createTestHandler(blok);

      const content = document.createElement('div');
      content.innerHTML = 'some text';

      const pasteData = {
        tool: 'paragraph',
        content,
        isBlock: false,
        event: new CustomEvent('paste'),
      };

      await handler.testProcessInlinePaste(pasteData as never, false);

      // Should have called paste (insertBlock path) instead of insertContentAtCaretPosition
      expect(blok.BlockManager.paste).toHaveBeenCalled();
    });
  });

  describe('processSingleBlock', () => {
    it('should check inline elements and insert content without dynamic import', async () => {
      const { blok, insertContentAtCaretPosition } = createBlokMock();
      const handler = await createTestHandler(blok);

      // Content with only inline elements and same tool name
      const content = document.createElement('div');
      content.innerHTML = '<b>inline only</b>';

      const pasteData = {
        tool: 'paragraph',
        content,
        isBlock: true,
        event: new CustomEvent('paste'),
      };

      // This should NOT throw "Cannot destructure property 'Dom'"
      await handler.testProcessSingleBlock(pasteData as never, false);

      // Since tool matches and content is purely inline, it should insert at caret
      expect(insertContentAtCaretPosition).toHaveBeenCalledTimes(1);
      expect(insertContentAtCaretPosition.mock.calls[0][0]).toContain('<b>inline only</b>');
    });

    it('should insert as block when tool names differ', async () => { // eslint-disable-line internal-unit-test/require-behavior-verification
      const { blok } = createBlokMock();
      const handler = await createTestHandler(blok);

      const content = document.createElement('div');
      content.innerHTML = 'header text';

      const pasteData = {
        tool: 'header',
        content,
        isBlock: true,
        event: new CustomEvent('paste'),
      };

      await handler.testProcessSingleBlock(pasteData as never, false);

      // Different tool → should insert as block, not inline
      expect(blok.BlockManager.paste).toHaveBeenCalled();
    });
  });

  describe('source code verification', () => {
    it('should NOT have dynamic imports in the base paste handler', async () => {
      /**
       * Verify that base.ts has zero dynamic `await import()` calls.
       *
       * Dynamic imports in production Rollup builds get transformed into
       * chunk-loading chains with auto-generated export ordinals (e.g. c.aX).
       * These break when chunks are cached across builds or re-bundled
       * downstream, causing:
       *   TypeError: Cannot destructure property 'clean' of '(intermediate value)' as it is undefined
       *
       * All imports in base.ts should be static — the modules are already
       * statically imported by sibling handlers in the same paste module.
       */
      const fs = await import('fs');
      const path = await import('path');

      const basePath = path.resolve(
        __dirname,
        '../../../../../src/components/modules/paste/handlers/base.ts'
      );
      const source = fs.readFileSync(basePath, 'utf-8');

      const dynamicImports = source.match(/await\s+import\s*\(/g) ?? [];

      expect(
        dynamicImports.length,
        `base.ts should have 0 dynamic imports but found ${dynamicImports.length}. ` +
        'Convert them to static imports to prevent chunk-loading failures in production builds.'
      ).toBe(0);
    });
  });
});
