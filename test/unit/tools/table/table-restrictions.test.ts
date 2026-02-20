import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isInsideTableCell,
  isRestrictedInTableCell,
  convertToParagraph,
  registerAdditionalRestrictedTools,
  clearAdditionalRestrictedTools,
  getRestrictedTools,
} from '../../../../src/tools/table/table-restrictions';
import type { Block } from '../../../../src/components/block';
import type { API } from '../../../../types';

describe('table-restrictions', () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    clearAdditionalRestrictedTools();
    container.remove();
    vi.restoreAllMocks();
  });

  describe('isInsideTableCell', () => {
    it('returns true when block is inside table cell', () => {
      const cellBlocks = document.createElement('div');
      cellBlocks.setAttribute('data-blok-table-cell-blocks', '');

      const holder = document.createElement('div');
      cellBlocks.appendChild(holder);
      container.appendChild(cellBlocks);

      const block = { holder } as Block;

      expect(isInsideTableCell(block)).toBe(true);
    });

    it('returns false when block is outside table cell', () => {
      const holder = document.createElement('div');
      container.appendChild(holder);

      const block = { holder } as Block;

      expect(isInsideTableCell(block)).toBe(false);
    });

    it('returns false when block is null', () => {
      expect(isInsideTableCell(null)).toBe(false);
    });

    it('returns false when block is undefined', () => {
      expect(isInsideTableCell(undefined)).toBe(false);
    });

    it('works with HTMLElement directly', () => {
      const cellBlocks = document.createElement('div');
      cellBlocks.setAttribute('data-blok-table-cell-blocks', '');

      const element = document.createElement('div');
      cellBlocks.appendChild(element);
      container.appendChild(cellBlocks);

      expect(isInsideTableCell(element)).toBe(true);
    });
  });

  describe('isRestrictedInTableCell', () => {
    it('returns true for header tool', () => {
      expect(isRestrictedInTableCell('header')).toBe(true);
    });

    it('returns true for table tool', () => {
      expect(isRestrictedInTableCell('table')).toBe(true);
    });

    it('returns false for paragraph tool', () => {
      expect(isRestrictedInTableCell('paragraph')).toBe(false);
    });

    it('returns false for list tool', () => {
      expect(isRestrictedInTableCell('list')).toBe(false);
    });

    it('returns false for unknown tool', () => {
      expect(isRestrictedInTableCell('unknown-tool')).toBe(false);
    });
  });

  describe('registerAdditionalRestrictedTools', () => {
    it('makes registered tools restricted in table cells', () => {
      registerAdditionalRestrictedTools(['list', 'checklist']);

      expect(isRestrictedInTableCell('list')).toBe(true);
      expect(isRestrictedInTableCell('checklist')).toBe(true);
    });

    it('preserves default restricted tools', () => {
      registerAdditionalRestrictedTools(['list']);

      expect(isRestrictedInTableCell('header')).toBe(true);
      expect(isRestrictedInTableCell('table')).toBe(true);
    });

    it('does not affect non-registered tools', () => {
      registerAdditionalRestrictedTools(['list']);

      expect(isRestrictedInTableCell('paragraph')).toBe(false);
      expect(isRestrictedInTableCell('unknown')).toBe(false);
    });

    it('handles duplicate registrations without issue', () => {
      registerAdditionalRestrictedTools(['list']);
      registerAdditionalRestrictedTools(['list', 'checklist']);

      expect(isRestrictedInTableCell('list')).toBe(true);
      expect(isRestrictedInTableCell('checklist')).toBe(true);
    });

    it('handles empty array', () => {
      registerAdditionalRestrictedTools([]);

      expect(isRestrictedInTableCell('paragraph')).toBe(false);
      expect(isRestrictedInTableCell('header')).toBe(true);
    });
  });

  describe('clearAdditionalRestrictedTools', () => {
    it('removes all registered additional tools', () => {
      registerAdditionalRestrictedTools(['list', 'checklist']);

      expect(isRestrictedInTableCell('list')).toBe(true);

      clearAdditionalRestrictedTools();

      expect(isRestrictedInTableCell('list')).toBe(false);
      expect(isRestrictedInTableCell('checklist')).toBe(false);
    });

    it('does not remove default restricted tools', () => {
      registerAdditionalRestrictedTools(['list']);
      clearAdditionalRestrictedTools();

      expect(isRestrictedInTableCell('header')).toBe(true);
      expect(isRestrictedInTableCell('table')).toBe(true);
    });
  });

  describe('getRestrictedTools', () => {
    it('returns default restricted tools when none registered', () => {
      const tools = getRestrictedTools();

      expect(tools).toContain('header');
      expect(tools).toContain('table');
      expect(tools).toHaveLength(2);
    });

    it('includes additional registered tools', () => {
      registerAdditionalRestrictedTools(['list', 'checklist']);

      const tools = getRestrictedTools();

      expect(tools).toContain('header');
      expect(tools).toContain('table');
      expect(tools).toContain('list');
      expect(tools).toContain('checklist');
      expect(tools).toHaveLength(4);
    });
  });

  describe('convertToParagraph', () => {
    it('converts block to paragraph preserving text', () => {
      const holder = document.createElement('div');
      holder.textContent = 'Hello world';

      const block = {
        id: 'block-123',
        holder,
      } as Block;

      const mockAPI = {
        blocks: {
          getBlockIndex: vi.fn().mockReturnValue(5),
          insert: vi.fn().mockReturnValue({ id: 'new-block' }),
        },
      } as unknown as API;

      convertToParagraph(block, mockAPI);

      expect(mockAPI.blocks.getBlockIndex).toHaveBeenCalledWith('block-123');
      expect(mockAPI.blocks.insert).toHaveBeenCalledWith(
        'paragraph',
        { text: 'Hello world' },
        {},
        5,
        false,
        true,
        'block-123'
      );
    });

    it('handles empty text content', () => {
      const holder = document.createElement('div');
      holder.textContent = '';

      const block = {
        id: 'block-456',
        holder,
      } as Block;

      const mockAPI = {
        blocks: {
          getBlockIndex: vi.fn().mockReturnValue(0),
          insert: vi.fn().mockReturnValue({ id: 'new-block' }),
        },
      } as unknown as API;

      convertToParagraph(block, mockAPI);

      expect(mockAPI.blocks.insert).toHaveBeenCalledWith(
        'paragraph',
        { text: '' },
        {},
        0,
        false,
        true,
        'block-456'
      );
    });

    it('throws error if block index not found', () => {
      const holder = document.createElement('div');
      const block = {
        id: 'block-789',
        holder,
      } as Block;

      const mockAPI = {
        blocks: {
          getBlockIndex: vi.fn().mockReturnValue(undefined),
          insert: vi.fn(),
        },
      } as unknown as API;

      expect(() => convertToParagraph(block, mockAPI)).toThrow('Block index not found');
      expect(mockAPI.blocks.insert).not.toHaveBeenCalled();
    });
  });
});
