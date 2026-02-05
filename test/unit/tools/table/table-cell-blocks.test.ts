import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('TableCellBlocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isInCellBlock', () => {
    it('should return true when element is inside a cell block container', async () => {
      // Create DOM structure: cell > container > block > content
      const cell = document.createElement('div');
      cell.setAttribute('data-blok-table-cell', '');

      const container = document.createElement('div');
      container.setAttribute('data-blok-table-cell-blocks', '');
      cell.appendChild(container);

      const block = document.createElement('div');
      block.setAttribute('data-blok-block', 'block-1');
      container.appendChild(block);

      const content = document.createElement('div');
      content.setAttribute('contenteditable', 'true');
      block.appendChild(content);

      // Import after setting up DOM
      const { isInCellBlock } = await import('../../../../src/tools/table/table-cell-blocks');

      expect(isInCellBlock(content)).toBe(true);
    });

    it('should return false when element is in plain text cell', async () => {
      const cell = document.createElement('div');
      cell.setAttribute('data-blok-table-cell', '');
      cell.setAttribute('contenteditable', 'true');

      const { isInCellBlock } = await import('../../../../src/tools/table/table-cell-blocks');

      expect(isInCellBlock(cell)).toBe(false);
    });
  });

  describe('getCellFromElement', () => {
    it('should return the cell element containing the given element', async () => {
      const cell = document.createElement('div');
      cell.setAttribute('data-blok-table-cell', '');

      const nested = document.createElement('span');
      cell.appendChild(nested);

      const { getCellFromElement } = await import('../../../../src/tools/table/table-cell-blocks');

      expect(getCellFromElement(nested)).toBe(cell);
    });

    it('should return null when element is not inside a cell', async () => {
      const div = document.createElement('div');

      const { getCellFromElement } = await import('../../../../src/tools/table/table-cell-blocks');

      expect(getCellFromElement(div)).toBeNull();
    });
  });

  describe('detectMarkdownListTrigger', () => {
    it('should detect unordered list trigger "- "', async () => {
      const { detectMarkdownListTrigger } = await import(
        '../../../../src/tools/table/table-cell-blocks'
      );

      const result = detectMarkdownListTrigger('- ');
      expect(result).toEqual({ style: 'unordered', textAfter: '' });
    });

    it('should detect ordered list trigger "1. "', async () => {
      const { detectMarkdownListTrigger } = await import(
        '../../../../src/tools/table/table-cell-blocks'
      );

      const result = detectMarkdownListTrigger('1. ');
      expect(result).toEqual({ style: 'ordered', textAfter: '' });
    });

    it('should detect checklist trigger "[] "', async () => {
      const { detectMarkdownListTrigger } = await import(
        '../../../../src/tools/table/table-cell-blocks'
      );

      const result = detectMarkdownListTrigger('[] ');
      expect(result).toEqual({ style: 'checklist', textAfter: '' });
    });

    it('should capture text after trigger', async () => {
      const { detectMarkdownListTrigger } = await import(
        '../../../../src/tools/table/table-cell-blocks'
      );

      const result = detectMarkdownListTrigger('- Hello world');
      expect(result).toEqual({ style: 'unordered', textAfter: 'Hello world' });
    });

    it('should return null for non-matching content', async () => {
      const { detectMarkdownListTrigger } = await import(
        '../../../../src/tools/table/table-cell-blocks'
      );

      expect(detectMarkdownListTrigger('Hello world')).toBeNull();
      expect(detectMarkdownListTrigger('--')).toBeNull();
      expect(detectMarkdownListTrigger('2. ')).toBeNull(); // Only "1. " triggers
    });
  });
});
