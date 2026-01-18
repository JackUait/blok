import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { InlineSelectionValidator } from '../../../../../src/components/modules/toolbar/inline/index';
import { SelectionUtils } from '../../../../../src/components/selection';
import type { InlineToolAdapter } from '../../../../../src/components/tools/inline';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

vi.mock('../../../../../src/components/dom', () => ({
  Dom: {
    isElement: vi.fn((node: unknown) => node instanceof HTMLElement),
  },
}));

describe('InlineSelectionValidator', () => {
  let validator: InlineSelectionValidator;
  let mockBlok: BlokModules;

  const createMockInlineToolAdapter = (name: string): InlineToolAdapter => {
    return {
      name,
      title: name,
      shortcut: undefined,
      isReadOnlySupported: true,
      create: () => ({ render: () => document.createElement('button') }),
    } as unknown as InlineToolAdapter;
  };

  const createMockSelection = (
    anchorNode: Node | null,
    isCollapsed: boolean = false
  ): Selection => {
    return {
      anchorNode,
      isCollapsed,
      rangeCount: 1,
      getRangeAt: () => document.createRange(),
    } as unknown as Selection;
  };

  const createMockBlock = (): {
    tool: {
      inlineTools: Map<string, InlineToolAdapter>;
    };
    holder: HTMLElement;
  } => {
    const holder = document.createElement('div');
    holder.setAttribute('contenteditable', 'true');

    return {
      tool: {
        inlineTools: new Map([['bold', createMockInlineToolAdapter('bold')]]),
      },
      holder,
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();

    mockBlok = {
      BlockManager: {
        getBlock: vi.fn(),
        currentBlock: undefined,
      },
      ReadOnly: {
        isEnabled: false,
      },
      Tools: {
        inlineTools: new Map([['bold', createMockInlineToolAdapter('bold')]]),
      },
    } as unknown as BlokModules;

    const getBlok = () => mockBlok;
    validator = new InlineSelectionValidator(getBlok);

    // Setup default DOM
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('canShow', () => {
    it('should return false when selection is null', () => {
      vi.spyOn(SelectionUtils, 'get').mockReturnValue(null);

      const result = validator.canShow();

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Selection is null');
    });

    it('should return false when selection has no anchor node', () => {
      vi.spyOn(SelectionUtils, 'get').mockReturnValue({
        anchorNode: null,
      } as unknown as Selection);

      const result = validator.canShow();

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Selection is null');
    });

    it('should return false when selection is collapsed', () => {
      const textNode = document.createTextNode('test');
      document.body.appendChild(textNode);

      const selection = createMockSelection(textNode, true);
      vi.spyOn(SelectionUtils, 'get').mockReturnValue(selection);
      vi.spyOn(SelectionUtils, 'text', 'get').mockReturnValue('');

      const result = validator.canShow();

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('collapsed');
    });

    it('should return false when selected text is empty', () => {
      const textNode = document.createTextNode('test');
      document.body.appendChild(textNode);

      const selection = createMockSelection(textNode, false);
      vi.spyOn(SelectionUtils, 'get').mockReturnValue(selection);
      vi.spyOn(SelectionUtils, 'text', 'get').mockReturnValue('');

      const result = validator.canShow();

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('empty');
    });

    it('should return false when target element is IMG', () => {
      const img = document.createElement('img');
      document.body.appendChild(img);

      const selection = createMockSelection(img, false);
      vi.spyOn(SelectionUtils, 'get').mockReturnValue(selection);
      vi.spyOn(SelectionUtils, 'text', 'get').mockReturnValue('test');

      const result = validator.canShow();

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('IMG');
    });

    it('should return false when target element is INPUT', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);

      const selection = createMockSelection(input, false);
      vi.spyOn(SelectionUtils, 'get').mockReturnValue(selection);
      vi.spyOn(SelectionUtils, 'text', 'get').mockReturnValue('test');

      const result = validator.canShow();

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('INPUT');
    });

    it('should return false when no current block exists', () => {
      const textNode = document.createTextNode('test');
      document.body.appendChild(textNode);

      const selection = createMockSelection(textNode, false);
      vi.spyOn(SelectionUtils, 'get').mockReturnValue(selection);
      vi.spyOn(SelectionUtils, 'text', 'get').mockReturnValue('test');

      mockBlok.BlockManager.currentBlock = undefined;
      (mockBlok.BlockManager.getBlock as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

      const result = validator.canShow();

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('block');
    });

    it('should return false when no tools available for current block', () => {
      const textNode = document.createTextNode('test');
      const contentEditable = document.createElement('div');
      contentEditable.setAttribute('contenteditable', 'true');
      contentEditable.appendChild(textNode);
      document.body.appendChild(contentEditable);

      const mockBlock = createMockBlock();
      // Clear inline tools to make none available
      mockBlock.tool.inlineTools.clear();

      mockBlok.BlockManager.currentBlock = mockBlock as unknown as typeof mockBlok.BlockManager.currentBlock;
      (mockBlok.BlockManager.getBlock as ReturnType<typeof vi.fn>).mockReturnValue(mockBlock as never);

      const selection = createMockSelection(textNode, false);
      vi.spyOn(SelectionUtils, 'get').mockReturnValue(selection);
      vi.spyOn(SelectionUtils, 'text', 'get').mockReturnValue('test');

      const result = validator.canShow();

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('tool');
    });

    it('should return true when target is contenteditable', () => {
      const textNode = document.createTextNode('test');
      const contentEditable = document.createElement('div');
      contentEditable.setAttribute('contenteditable', 'true');
      contentEditable.appendChild(textNode);
      document.body.appendChild(contentEditable);

      const mockBlock = createMockBlock();
      mockBlok.BlockManager.currentBlock = mockBlock as unknown as typeof mockBlok.BlockManager.currentBlock;
      (mockBlok.BlockManager.getBlock as ReturnType<typeof vi.fn>).mockReturnValue(mockBlock as never);

      const selection = createMockSelection(textNode, false);
      vi.spyOn(SelectionUtils, 'get').mockReturnValue(selection);
      vi.spyOn(SelectionUtils, 'text', 'get').mockReturnValue('test');

      const result = validator.canShow();

      expect(result.allowed).toBe(true);
    });

    it('should return true when in read-only mode with valid selection', () => {
      const textNode = document.createTextNode('test');
      const contentEditable = document.createElement('div');
      contentEditable.setAttribute('contenteditable', 'true');
      contentEditable.appendChild(textNode);
      document.body.appendChild(contentEditable);

      const mockBlock = createMockBlock();
      mockBlok.BlockManager.currentBlock = mockBlock as unknown as typeof mockBlok.BlockManager.currentBlock;
      (mockBlok.BlockManager.getBlock as ReturnType<typeof vi.fn>).mockReturnValue(mockBlock as never);

      // Create a new Blok mock with read-only enabled
      mockBlok = {
        ...mockBlok,
        ReadOnly: {
          isEnabled: true,
        },
      } as unknown as BlokModules;

      // Re-create validator with new mock
      const getBlok = () => mockBlok;
      validator = new InlineSelectionValidator(getBlok);

      const selection = createMockSelection(textNode, false);
      vi.spyOn(SelectionUtils, 'get').mockReturnValue(selection);
      vi.spyOn(SelectionUtils, 'text', 'get').mockReturnValue('test');

      const result = validator.canShow();

      expect(result.allowed).toBe(true);
    });

    it('should return false when in read-only mode and selection not at blok', () => {
      const textNode = document.createTextNode('test');
      document.body.appendChild(textNode);

      const selection = createMockSelection(textNode, false);
      vi.spyOn(SelectionUtils, 'get').mockReturnValue(selection);
      vi.spyOn(SelectionUtils, 'text', 'get').mockReturnValue('test');
      vi.spyOn(SelectionUtils, 'isSelectionAtBlok').mockReturnValue(false);

      // Create a new Blok mock with read-only enabled and no current block
      mockBlok = {
        ...mockBlok,
        ReadOnly: {
          isEnabled: true,
        },
        BlockManager: {
          ...mockBlok.BlockManager,
          currentBlock: undefined,
          getBlock: vi.fn(() => undefined),
        },
      } as unknown as BlokModules;

      // Re-create validator with new mock
      const getBlok = () => mockBlok;
      validator = new InlineSelectionValidator(getBlok);

      const result = validator.canShow();

      expect(result.allowed).toBe(false);
      // Returns false because there's no current block (checked before read-only logic)
      expect(result.reason).toContain('block');
    });
  });
});
