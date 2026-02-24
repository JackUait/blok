/**
 * Tests for paste handler table cell restriction enforcement.
 *
 * Verifies that the paste handler uses getRestrictedTools() (which includes
 * user-configured restrictedTools) instead of a hardcoded set.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerAdditionalRestrictedTools, clearAdditionalRestrictedTools, getRestrictedTools } from '../../../../../src/tools/table/table-restrictions';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

describe('Paste handler table cell restrictions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAdditionalRestrictedTools();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearAdditionalRestrictedTools();
  });

  it('should use getRestrictedTools() for paste restrictions, including user-configured tools', async () => {
    // Register 'list' as an additional restricted tool (simulating user config)
    const cleanup = registerAdditionalRestrictedTools(['list']);

    // Verify the central registry includes 'list'
    const restricted = getRestrictedTools();

    expect(restricted).toContain('list');
    expect(restricted).toContain('header');
    expect(restricted).toContain('table');

    /**
     * Create a mock BasePasteHandler subclass to test redirectToTableParentIfNeeded.
     * After the fix, it should call getRestrictedTools() which includes 'list'.
     */
    const { BasePasteHandler } = await import('../../../../../src/components/modules/paste/handlers/base');

    // Verify the handler no longer has a static hardcoded TOOLS_RESTRICTED_IN_TABLE_CELLS set
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = BasePasteHandler as Record<string, unknown>;
    const staticSet = handler['TOOLS_RESTRICTED_IN_TABLE_CELLS'];

    // After the fix, the static set should be removed (undefined)
    expect(staticSet).toBeUndefined();

    // Create a concrete subclass for testing the protected method
    class TestHandler extends BasePasteHandler {
      canHandle(): number { return 0; }
      async handle(): Promise<boolean> { return false; }

      // Expose the protected method for testing
      async testInsertPasteData(data: Parameters<typeof this.insertPasteData>[0], canReplace: boolean): Promise<void> {
        return this.insertPasteData(data, canReplace);
      }
    }

    // Set up a basic mock context where we're inside a table cell
    const tableCellBlocks = document.createElement('div');
    tableCellBlocks.setAttribute('data-blok-table-cell-blocks', '');

    const tableToolWrapper = document.createElement('div');
    tableToolWrapper.setAttribute('data-blok-tool', 'table');
    const tableHolder = document.createElement('div');
    tableHolder.setAttribute('data-blok-element', '');
    tableHolder.appendChild(tableToolWrapper);
    tableToolWrapper.appendChild(tableCellBlocks);

    const blockHolder = document.createElement('div');
    tableCellBlocks.appendChild(blockHolder);
    document.body.appendChild(tableHolder);

    const setCurrentBlockByChildNode = vi.fn();
    const mockBlok = {
      BlockManager: {
        currentBlock: {
          holder: blockHolder,
          tool: { isDefault: true },
          isEmpty: true,
        },
        currentBlockIndex: 0,
        insert: vi.fn().mockReturnValue({ id: 'test' }),
        paste: vi.fn().mockResolvedValue({ id: 'test' }),
        setCurrentBlockByChildNode,
      },
      Caret: {
        setToBlock: vi.fn(),
        positions: { END: 'end' },
        insertContentAtCaretPosition: vi.fn(),
      },
      YjsManager: {
        stopCapturing: vi.fn(),
      },
    } as unknown as BlokModules;

    const testHandler = new TestHandler(mockBlok, {} as never, {} as never);

    // Paste data with 'list' tool (which is user-configured restricted)
    const pasteData = [
      { tool: 'list', content: document.createElement('div'), isBlock: true, event: new CustomEvent('paste') },
      { tool: 'paragraph', content: document.createElement('div'), isBlock: true, event: new CustomEvent('paste') },
    ];

    await testHandler.testInsertPasteData(pasteData as never, false);

    // The redirect should have been called because 'list' is restricted
    expect(setCurrentBlockByChildNode).toHaveBeenCalledWith(tableHolder);

    // Clean up
    document.body.removeChild(tableHolder);
    cleanup();
  });
});
