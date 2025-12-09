import { describe, it, expect, vi } from 'vitest';
import type { BlockAPI, ToolConfig } from '../../../types';
import type { ConversionConfig } from '../../../types/configs/conversion-config';
import type { SavedData } from '../../../types/data-formats';
import type { BlockToolData } from '../../../types/tools/block-tool-data';
import type Block from '../../../src/components/block';
import type BlockToolAdapter from '../../../src/components/tools/block';
import {
  isBlockConvertable,
  isSameBlockData,
  getConvertibleToolsForBlock,
  getConvertibleToolsForBlocks,
  areBlocksMergeable,
  convertBlockDataToString,
  convertStringToBlockData
} from '../../../src/components/utils/blocks';

// Mock VERSION global variable
declare global {

  var VERSION: string;
}


(globalThis as { VERSION?: string }).VERSION = 'test-version';

/**
 * Unit tests for blocks.ts utility functions
 *
 * Tests edge cases and internal functionality not covered by E2E tests
 */
describe('blocks utilities', () => {
  describe('isBlockConvertable', () => {
    it('should return true when block tool has valid export conversion config (string)', () => {
      const mockTool = {
        conversionConfig: {
          export: 'text',
        },
      } as unknown as BlockToolAdapter;

      const mockBlock = {
        tool: mockTool,
      } as Block;

      expect(isBlockConvertable(mockBlock, 'export')).toBe(true);
    });

    it('should return true when block tool has valid export conversion config (function)', () => {
      const mockTool = {
        conversionConfig: {
          export: (data: BlockToolData) => String(data),
        },
      } as unknown as BlockToolAdapter;

      const mockBlock = {
        tool: mockTool,
      } as Block;

      expect(isBlockConvertable(mockBlock, 'export')).toBe(true);
    });

    it('should return true when block tool has valid import conversion config (string)', () => {
      const mockTool = {
        conversionConfig: {
          import: 'text',
        },
      } as unknown as BlockToolAdapter;

      const mockBlock = {
        tool: mockTool,
      } as Block;

      expect(isBlockConvertable(mockBlock, 'import')).toBe(true);
    });

    it('should return true when block tool has valid import conversion config (function)', () => {
      const mockTool = {
        conversionConfig: {
          import: (_data: string, _config?: ToolConfig) => ({}),
        },
      } as unknown as BlockToolAdapter;

      const mockBlock = {
        tool: mockTool,
      } as Block;

      expect(isBlockConvertable(mockBlock, 'import')).toBe(true);
    });

    it('should return false when block tool has no conversion config', () => {
      const mockTool = {
        conversionConfig: undefined,
      } as unknown as BlockToolAdapter;

      const mockBlock = {
        tool: mockTool,
      } as Block;

      expect(isBlockConvertable(mockBlock, 'export')).toBe(false);
      expect(isBlockConvertable(mockBlock, 'import')).toBe(false);
    });

    it('should return false when block tool has conversion config but missing export', () => {
      const mockTool = {
        conversionConfig: {
          import: 'text',
        },
      } as unknown as BlockToolAdapter;

      const mockBlock = {
        tool: mockTool,
      } as Block;

      expect(isBlockConvertable(mockBlock, 'export')).toBe(false);
    });

    it('should return false when block tool has conversion config but missing import', () => {
      const mockTool = {
        conversionConfig: {
          export: 'text',
        },
      } as unknown as BlockToolAdapter;

      const mockBlock = {
        tool: mockTool,
      } as Block;

      expect(isBlockConvertable(mockBlock, 'import')).toBe(false);
    });

    it('should return false when block tool has invalid export type', () => {
      const mockTool = {
        conversionConfig: {
          export: 123, // Invalid type
        },
      } as unknown as BlockToolAdapter;

      const mockBlock = {
        tool: mockTool,
      } as Block;

      expect(isBlockConvertable(mockBlock, 'export')).toBe(false);
    });
  });

  describe('isSameBlockData', () => {
    it('should return true when all properties of data1 exist in data2 with same values', () => {
      const data1: BlockToolData = { level: 1 };
      const data2: BlockToolData = {
        text: 'Heading text',
        level: 1,
      };

      expect(isSameBlockData(data1, data2)).toBe(true);
    });

    it('should return true when data1 has multiple properties that match data2', () => {
      const data1: BlockToolData = {
        level: 1,
        text: 'Heading',
      };
      const data2: BlockToolData = {
        text: 'Heading',
        level: 1,
        extra: 'property',
      };

      expect(isSameBlockData(data1, data2)).toBe(true);
    });

    it('should return true when data1 has property that does not exist in data2 but other properties match', () => {
      const data1: BlockToolData = {
        level: 1,
        text: 'Heading',
      };
      const data2: BlockToolData = {
        level: 1,
      };

      // isSameBlockData uses .some(), so it returns true if ANY property matches
      expect(isSameBlockData(data1, data2)).toBe(true);
    });

    it('should return false when data1 has property with different value in data2', () => {
      const data1: BlockToolData = { level: 1 };
      const data2: BlockToolData = {
        text: 'Heading text',
        level: 2,
      };

      expect(isSameBlockData(data1, data2)).toBe(false);
    });

    it('should return false when data1 has property that exists in data2 but value is undefined', () => {
      const data1: BlockToolData = { level: 1 };
      const data2: BlockToolData = {
        text: 'Heading text',
        level: undefined,
      };

      expect(isSameBlockData(data1, data2)).toBe(false);
    });

    it('should return true when data1 is empty object', () => {
      const data1: BlockToolData = {};
      const data2: BlockToolData = {
        text: 'Heading text',
        level: 1,
      };

      // Empty object has no entries, so some() returns false
      expect(isSameBlockData(data1, data2)).toBe(false);
    });

    it('should handle nested objects correctly', () => {
      const data1: BlockToolData = {
        config: {
          level: 1,
        },
      };
      const data2: BlockToolData = {
        text: 'Heading',
        config: {
          level: 1,
        },
      };

      expect(isSameBlockData(data1, data2)).toBe(true);
    });

    it('should handle arrays correctly', () => {
      const arrayLength = 3;
      const data1: BlockToolData = {
        items: [1, 2, arrayLength],
      };
      const data2: BlockToolData = {
        text: 'Heading',
        items: [1, 2, arrayLength],
      };

      expect(isSameBlockData(data1, data2)).toBe(true);
    });

    it('should return false when arrays have different values', () => {
      const arrayLength = 3;
      const differentValue = 4;
      const data1: BlockToolData = {
        items: [1, 2, arrayLength],
      };
      const data2: BlockToolData = {
        text: 'Heading',
        items: [1, 2, differentValue],
      };

      expect(isSameBlockData(data1, data2)).toBe(false);
    });
  });

  describe('getConvertibleToolsForBlock', () => {
    const mockSave = vi.fn();
    const createMockBlock = (name: string): BlockAPI => ({
      id: 'block-1',
      name,
      save: mockSave,
    } as unknown as BlockAPI);

    it('should return empty array when block tool has no export conversion config', async () => {
      const mockTool = {
        name: 'paragraph',
        conversionConfig: {
          import: 'text',
        },
      } as unknown as BlockToolAdapter;

      const allBlockTools: BlockToolAdapter[] = [ mockTool ];
      const mockBlock = createMockBlock('paragraph');

      mockSave.mockResolvedValue({
        tool: 'paragraph',
        data: { text: 'Test' },
      } as SavedData);

      const result = await getConvertibleToolsForBlock(mockBlock, allBlockTools);

      expect(result).toEqual([]);
    });

    it('should return tools with valid import conversion config and toolbox', async () => {
      const mockTool1 = {
        name: 'header',
        conversionConfig: {
          import: 'text',
        },
        toolbox: [
          {
            icon: 'H',
            title: 'Header',
          },
        ],
      } as unknown as BlockToolAdapter;

      const mockTool2 = {
        name: 'list',
        conversionConfig: {
          import: 'text',
        },
        toolbox: [
          {
            icon: '•',
            title: 'List',
          },
        ],
      } as unknown as BlockToolAdapter;

      const allBlockTools: BlockToolAdapter[] = [mockTool1, mockTool2];
      const mockBlock = createMockBlock('paragraph');

      mockSave.mockResolvedValue({
        tool: 'paragraph',
        data: { text: 'Test' },
      } as SavedData);

      const result = await getConvertibleToolsForBlock(mockBlock, allBlockTools);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('header');
      expect(result[1].name).toBe('list');
    });

    it('should filter out tools without import conversion config', async () => {
      const mockTool1 = {
        name: 'header',
        conversionConfig: {
          import: 'text',
        },
        toolbox: [
          {
            icon: 'H',
            title: 'Header',
          },
        ],
      } as unknown as BlockToolAdapter;

      const mockTool2 = {
        name: 'list',
        conversionConfig: {
          export: 'text', // Only export, no import
        },
        toolbox: [
          {
            icon: '•',
            title: 'List',
          },
        ],
      } as unknown as BlockToolAdapter;

      const allBlockTools: BlockToolAdapter[] = [mockTool1, mockTool2];
      const mockBlock = createMockBlock('paragraph');

      mockSave.mockResolvedValue({
        tool: 'paragraph',
        data: { text: 'Test' },
      } as SavedData);

      const result = await getConvertibleToolsForBlock(mockBlock, allBlockTools);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('header');
    });

    it('should filter out tools without toolbox', async () => {
      const mockTool1 = {
        name: 'header',
        conversionConfig: {
          import: 'text',
        },
        toolbox: [
          {
            icon: 'H',
            title: 'Header',
          },
        ],
      } as unknown as BlockToolAdapter;

      const mockTool2 = {
        name: 'list',
        conversionConfig: {
          import: 'text',
        },
        toolbox: undefined,
      } as unknown as BlockToolAdapter;

      const allBlockTools: BlockToolAdapter[] = [mockTool1, mockTool2];
      const mockBlock = createMockBlock('paragraph');

      mockSave.mockResolvedValue({
        tool: 'paragraph',
        data: { text: 'Test' },
      } as SavedData);

      const result = await getConvertibleToolsForBlock(mockBlock, allBlockTools);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('header');
    });

    it('should filter out toolbox items without icon', async () => {
      const mockTool = {
        name: 'header',
        conversionConfig: {
          import: 'text',
        },
        toolbox: [
          {
            icon: 'H',
            title: 'Header',
          },
          {
            title: 'Header without icon',
          },
        ],
      } as unknown as BlockToolAdapter;

      const allBlockTools: BlockToolAdapter[] = [ mockTool ];
      const mockBlock = createMockBlock('paragraph');

      mockSave.mockResolvedValue({
        tool: 'paragraph',
        data: { text: 'Test' },
      } as SavedData);

      const result = await getConvertibleToolsForBlock(mockBlock, allBlockTools);

      expect(result).toHaveLength(1);
      expect(result[0].toolbox).toHaveLength(1);
      expect(result[0].toolbox?.[0].icon).toBe('H');
    });

    it('should filter out toolbox items with same data as block', async () => {
      const mockTool = {
        name: 'header',
        conversionConfig: {
          import: 'text',
        },
        toolbox: [
          {
            icon: 'H1',
            title: 'Header 1',
            data: {
              level: 1,
            },
          },
          {
            icon: 'H2',
            title: 'Header 2',
            data: {
              level: 2,
            },
          },
        ],
      } as unknown as BlockToolAdapter;

      const allBlockTools: BlockToolAdapter[] = [ mockTool ];
      const mockBlock = createMockBlock('paragraph');

      mockSave.mockResolvedValue({
        tool: 'paragraph',
        data: { level: 1 },
      } as SavedData);

      const result = await getConvertibleToolsForBlock(mockBlock, allBlockTools);

      expect(result).toHaveLength(1);
      expect(result[0].toolbox).toHaveLength(1);
      expect(result[0].toolbox?.[0].icon).toBe('H2');
    });

    it('should filter out tool with same name as block when toolbox item has no data', async () => {
      const mockTool = {
        name: 'paragraph',
        conversionConfig: {
          import: 'text',
        },
        toolbox: [
          {
            icon: 'P',
            title: 'Paragraph',
          },
        ],
      } as unknown as BlockToolAdapter;

      const allBlockTools: BlockToolAdapter[] = [ mockTool ];
      const mockBlock = createMockBlock('paragraph');

      mockSave.mockResolvedValue({
        tool: 'paragraph',
        data: { text: 'Test' },
      } as SavedData);

      const result = await getConvertibleToolsForBlock(mockBlock, allBlockTools);

      expect(result).toHaveLength(0);
    });

    it('should include tool with same name if toolbox item has different data', async () => {
      const mockTool = {
        name: 'header',
        conversionConfig: {
          export: 'text', // Need export config for the block tool
          import: 'text',
        },
        toolbox: [
          {
            icon: 'H1',
            title: 'Header 1',
            data: {
              level: 1,
            },
          },
          {
            icon: 'H2',
            title: 'Header 2',
            data: {
              level: 2,
            },
          },
        ],
      } as unknown as BlockToolAdapter;

      const allBlockTools: BlockToolAdapter[] = [ mockTool ];
      const mockBlock = createMockBlock('header');

      mockSave.mockResolvedValue({
        tool: 'header',
        data: { level: 1 },
      } as SavedData);

      const result = await getConvertibleToolsForBlock(mockBlock, allBlockTools);

      expect(result).toHaveLength(1);
      expect(result[0].toolbox).toHaveLength(1);
      expect(result[0].toolbox?.[0].icon).toBe('H2');
    });

    it('should filter out empty toolbox items', async () => {
      const mockTool = {
        name: 'header',
        conversionConfig: {
          import: 'text',
        },
        toolbox: [
          {
            icon: 'H',
            title: 'Header',
          },
          {},
        ],
      } as unknown as BlockToolAdapter;

      const allBlockTools: BlockToolAdapter[] = [ mockTool ];
      const mockBlock = createMockBlock('paragraph');

      mockSave.mockResolvedValue({
        tool: 'paragraph',
        data: { text: 'Test' },
      } as SavedData);

      const result = await getConvertibleToolsForBlock(mockBlock, allBlockTools);

      expect(result).toHaveLength(1);
      expect(result[0].toolbox).toHaveLength(1);
    });

    it('should return empty array when block tool is not found but has no export config', async () => {
      const mockTool = {
        name: 'header',
        conversionConfig: {
          import: 'text',
        },
        toolbox: [
          {
            icon: 'H',
            title: 'Header',
          },
        ],
      } as unknown as BlockToolAdapter;

      const allBlockTools: BlockToolAdapter[] = [ mockTool ];
      const mockBlock = createMockBlock('unknown-tool');

      mockSave.mockResolvedValue({
        tool: 'unknown-tool',
        data: { text: 'Test' },
      } as SavedData);

      const result = await getConvertibleToolsForBlock(mockBlock, allBlockTools);

      // Should still return tools since block tool is not found (undefined)
      expect(result).toHaveLength(1);
    });
  });

  describe('areBlocksMergeable', () => {
    it('should return true when blocks have same name and target is mergeable', () => {
      const mockTool = {
        name: 'paragraph',
      } as unknown as BlockToolAdapter;

      const targetBlock = {
        name: 'paragraph',
        mergeable: true,
        tool: mockTool,
      } as Block;

      const blockToMerge = {
        name: 'paragraph',
        tool: mockTool,
      } as Block;

      expect(areBlocksMergeable(targetBlock, blockToMerge)).toBe(true);
    });

    it('should return false when target block is not mergeable', () => {
      const mockTool = {
        name: 'paragraph',
      } as unknown as BlockToolAdapter;

      const targetBlock = {
        name: 'paragraph',
        mergeable: false,
        tool: mockTool,
      } as Block;

      const blockToMerge = {
        name: 'paragraph',
        tool: mockTool,
      } as Block;

      expect(areBlocksMergeable(targetBlock, blockToMerge)).toBe(false);
    });

    it('should return true when blocks have different names but valid conversion configs', () => {
      const mockTool1 = {
        name: 'paragraph',
        conversionConfig: {
          export: 'text',
        },
      } as unknown as BlockToolAdapter;

      const mockTool2 = {
        name: 'header',
        conversionConfig: {
          import: 'text',
        },
      } as unknown as BlockToolAdapter;

      const targetBlock = {
        name: 'header',
        mergeable: true,
        tool: mockTool2,
      } as Block;

      const blockToMerge = {
        name: 'paragraph',
        tool: mockTool1,
      } as Block;

      expect(areBlocksMergeable(targetBlock, blockToMerge)).toBe(true);
    });

    it('should return false when blocks have different names and blockToMerge has no export config', () => {
      const mockTool1 = {
        name: 'paragraph',
        conversionConfig: undefined,
      } as unknown as BlockToolAdapter;

      const mockTool2 = {
        name: 'header',
        conversionConfig: {
          import: 'text',
        },
      } as unknown as BlockToolAdapter;

      const targetBlock = {
        name: 'header',
        mergeable: true,
        tool: mockTool2,
      } as Block;

      const blockToMerge = {
        name: 'paragraph',
        tool: mockTool1,
      } as Block;

      expect(areBlocksMergeable(targetBlock, blockToMerge)).toBe(false);
    });

    it('should return false when blocks have different names and target has no import config', () => {
      const mockTool1 = {
        name: 'paragraph',
        conversionConfig: {
          export: 'text',
        },
      } as unknown as BlockToolAdapter;

      const mockTool2 = {
        name: 'header',
        conversionConfig: undefined,
      } as unknown as BlockToolAdapter;

      const targetBlock = {
        name: 'header',
        mergeable: true,
        tool: mockTool2,
      } as Block;

      const blockToMerge = {
        name: 'paragraph',
        tool: mockTool1,
      } as Block;

      expect(areBlocksMergeable(targetBlock, blockToMerge)).toBe(false);
    });

    it('should return false when blocks have different names and both have invalid conversion configs', () => {
      const mockTool1 = {
        name: 'paragraph',
        conversionConfig: {
          export: 123, // Invalid type
        },
      } as unknown as BlockToolAdapter;

      const mockTool2 = {
        name: 'header',
        conversionConfig: {
          import: 123, // Invalid type
        },
      } as unknown as BlockToolAdapter;

      const targetBlock = {
        name: 'header',
        mergeable: true,
        tool: mockTool2,
      } as Block;

      const blockToMerge = {
        name: 'paragraph',
        tool: mockTool1,
      } as Block;

      expect(areBlocksMergeable(targetBlock, blockToMerge)).toBe(false);
    });
  });

  describe('convertBlockDataToString', () => {
    it('should convert block data to string using function export', () => {
      const blockData: BlockToolData = {
        text: 'Hello',
        level: 1,
      };

      const conversionConfig: ConversionConfig = {
        export: (data: BlockToolData) => {
          return String(data.text);
        },
      };

      const result = convertBlockDataToString(blockData, conversionConfig);

      expect(result).toBe('Hello');
    });

    it('should convert block data to string using string export', () => {
      const blockData: BlockToolData = {
        text: 'Hello',
        level: 1,
      };

      const conversionConfig: ConversionConfig = {
        export: 'text',
      };

      const result = convertBlockDataToString(blockData, conversionConfig);

      expect(result).toBe('Hello');
    });

    it('should return empty string when conversion config is undefined', () => {
      const blockData: BlockToolData = {
        text: 'Hello',
      };

      const result = convertBlockDataToString(blockData);

      expect(result).toBe('');
    });

    it('should return empty string when export is undefined', () => {
      const blockData: BlockToolData = {
        text: 'Hello',
      };

      const conversionConfig: ConversionConfig = {
        import: 'text',
      };

      const result = convertBlockDataToString(blockData, conversionConfig);

      expect(result).toBe('');
    });

    it('should return empty string and log warning when export has invalid type', () => {
      const blockData: BlockToolData = {
        text: 'Hello',
      };

      const conversionConfig = {
        export: 123, // Invalid type
      } as unknown as ConversionConfig;

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = convertBlockDataToString(blockData, conversionConfig);

      expect(result).toBe('');
      expect(logSpy).toHaveBeenCalled();

      logSpy.mockRestore();
    });

    it('should handle function export with complex data', () => {
      const itemCount = 3;
      const blockData: BlockToolData = {
        items: ['a', 'b', 'c'],
        count: itemCount,
      };

      const conversionConfig: ConversionConfig = {
        export: (data: BlockToolData) => {
          const items = (data.items as string[]) || [];

          return items.join(', ');
        },
      };

      const result = convertBlockDataToString(blockData, conversionConfig);

      expect(result).toBe('a, b, c');
    });

    it('should handle string export with nested property', () => {
      const blockData: BlockToolData = {
        content: {
          text: 'Hello',
        },
      };

      const conversionConfig: ConversionConfig = {
        export: 'content',
      };

      const result = convertBlockDataToString(blockData, conversionConfig);

      expect(result).toEqual({ text: 'Hello' });
    });
  });

  describe('convertStringToBlockData', () => {
    it('should convert string to block data using function import', () => {
      const stringToImport = 'Hello';
      const conversionConfig: ConversionConfig = {
        import: (content: string) => {
          return {
            text: content,
          };
        },
      };

      const result = convertStringToBlockData(stringToImport, conversionConfig);

      expect(result).toEqual({ text: 'Hello' });
    });

    it('should convert string to block data using function import with tool config', () => {
      const stringToImport = 'Hello';
      const toolConfig: ToolConfig = {
        placeholder: 'Enter text',
      };

      const conversionConfig: ConversionConfig = {
        import: (content: string, config?: ToolConfig) => {
          return {
            text: content,
            placeholder: config?.placeholder,
          };
        },
      };

      const result = convertStringToBlockData(stringToImport, conversionConfig, toolConfig);

      expect(result).toEqual({
        text: 'Hello',
        placeholder: 'Enter text',
      });
    });

    it('should convert string to block data using string import', () => {
      const stringToImport = 'Hello';
      const conversionConfig: ConversionConfig = {
        import: 'text',
      };

      const result = convertStringToBlockData(stringToImport, conversionConfig);

      expect(result).toEqual({ text: 'Hello' });
    });

    it('should return empty object when conversion config is undefined', () => {
      const stringToImport = 'Hello';

      const result = convertStringToBlockData(stringToImport);

      expect(result).toEqual({});
    });

    it('should return empty object when import is undefined', () => {
      const stringToImport = 'Hello';

      const conversionConfig: ConversionConfig = {
        export: 'text',
      };

      const result = convertStringToBlockData(stringToImport, conversionConfig);

      expect(result).toEqual({});
    });

    it('should return empty object and log warning when import has invalid type', () => {
      const stringToImport = 'Hello';

      const conversionConfig = {
        import: 123, // Invalid type
      } as unknown as ConversionConfig;

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = convertStringToBlockData(stringToImport, conversionConfig);

      expect(result).toEqual({});
      expect(logSpy).toHaveBeenCalled();

      logSpy.mockRestore();
    });

    it('should handle function import with complex transformation', () => {
      const stringToImport = 'a, b, c';

      const conversionConfig: ConversionConfig = {
        import: (content: string) => {
          return {
            items: content.split(', '),
            count: content.split(', ').length,
          };
        },
      };

      const result = convertStringToBlockData(stringToImport, conversionConfig);

      expect(result).toEqual({
        items: ['a', 'b', 'c'],
        count: 3,
      });
    });

    it('should handle function import without tool config', () => {
      const stringToImport = 'Hello';

      const conversionConfig: ConversionConfig = {
        import: (content: string, config?: ToolConfig) => {
          return {
            text: content,
            hasConfig: config !== undefined,
          };
        },
      };

      const result = convertStringToBlockData(stringToImport, conversionConfig);

      expect(result).toEqual({
        text: 'Hello',
        hasConfig: false,
      });
    });
  });

  describe('getConvertibleToolsForBlocks', () => {
    const mockSave = vi.fn();
    const createMockBlock = (name: string): BlockAPI => ({
      id: `block-${name}`,
      name,
      save: mockSave,
    } as unknown as BlockAPI);

    it('should return empty array when no blocks are provided', async () => {
      const allBlockTools: BlockToolAdapter[] = [];

      const result = await getConvertibleToolsForBlocks([], allBlockTools);

      expect(result).toEqual([]);
    });

    it('should delegate to getConvertibleToolsForBlock when only one block is provided', async () => {
      const mockTool = {
        name: 'header',
        conversionConfig: {
          import: 'text',
        },
        toolbox: [
          {
            icon: 'H',
            title: 'Header',
          },
        ],
      } as unknown as BlockToolAdapter;

      const allBlockTools: BlockToolAdapter[] = [mockTool];
      const mockBlock = createMockBlock('paragraph');

      mockSave.mockResolvedValue({
        tool: 'paragraph',
        data: { text: 'Test' },
      } as SavedData);

      const result = await getConvertibleToolsForBlocks([mockBlock], allBlockTools);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('header');
    });

    it('should return tools that all blocks can convert to', async () => {
      const mockTool1 = {
        name: 'header',
        conversionConfig: {
          export: 'text',
          import: 'text',
        },
        toolbox: [
          {
            icon: 'H',
            title: 'Header',
          },
        ],
      } as unknown as BlockToolAdapter;

      const mockTool2 = {
        name: 'paragraph',
        conversionConfig: {
          export: 'text',
          import: 'text',
        },
        toolbox: [
          {
            icon: 'P',
            title: 'Paragraph',
          },
        ],
      } as unknown as BlockToolAdapter;

      const allBlockTools: BlockToolAdapter[] = [mockTool1, mockTool2];
      const mockBlock1 = createMockBlock('paragraph');
      const mockBlock2 = createMockBlock('paragraph');

      const result = await getConvertibleToolsForBlocks([mockBlock1, mockBlock2], allBlockTools);

      // Should return header since both blocks are paragraphs and can convert to header
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('header');
    });

    it('should return empty array when any block has no export conversion config', async () => {
      const mockTool1 = {
        name: 'header',
        conversionConfig: {
          import: 'text',
        },
        toolbox: [
          {
            icon: 'H',
            title: 'Header',
          },
        ],
      } as unknown as BlockToolAdapter;

      const mockTool2 = {
        name: 'paragraph',
        conversionConfig: {
          import: 'text',
          // No export config
        },
        toolbox: [
          {
            icon: 'P',
            title: 'Paragraph',
          },
        ],
      } as unknown as BlockToolAdapter;

      const allBlockTools: BlockToolAdapter[] = [mockTool1, mockTool2];
      const mockBlock1 = createMockBlock('paragraph');
      const mockBlock2 = createMockBlock('paragraph');

      const result = await getConvertibleToolsForBlocks([mockBlock1, mockBlock2], allBlockTools);

      expect(result).toEqual([]);
    });

    it('should filter out tools without import conversion config', async () => {
      const mockTool1 = {
        name: 'header',
        conversionConfig: {
          export: 'text',
          import: 'text',
        },
        toolbox: [
          {
            icon: 'H',
            title: 'Header',
          },
        ],
      } as unknown as BlockToolAdapter;

      const mockTool2 = {
        name: 'list',
        conversionConfig: {
          export: 'text',
          // No import config
        },
        toolbox: [
          {
            icon: '•',
            title: 'List',
          },
        ],
      } as unknown as BlockToolAdapter;

      const mockTool3 = {
        name: 'paragraph',
        conversionConfig: {
          export: 'text',
          import: 'text',
        },
        toolbox: [
          {
            icon: 'P',
            title: 'Paragraph',
          },
        ],
      } as unknown as BlockToolAdapter;

      const allBlockTools: BlockToolAdapter[] = [mockTool1, mockTool2, mockTool3];
      const mockBlock1 = createMockBlock('paragraph');
      const mockBlock2 = createMockBlock('paragraph');

      const result = await getConvertibleToolsForBlocks([mockBlock1, mockBlock2], allBlockTools);

      // Should only return header since list has no import config
      // paragraph is excluded because all blocks are already paragraphs
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('header');
    });

    it('should exclude tool when all selected blocks are already of that type', async () => {
      const mockTool = {
        name: 'paragraph',
        conversionConfig: {
          export: 'text',
          import: 'text',
        },
        toolbox: [
          {
            icon: 'P',
            title: 'Paragraph',
          },
        ],
      } as unknown as BlockToolAdapter;

      const allBlockTools: BlockToolAdapter[] = [mockTool];
      const mockBlock1 = createMockBlock('paragraph');
      const mockBlock2 = createMockBlock('paragraph');

      const result = await getConvertibleToolsForBlocks([mockBlock1, mockBlock2], allBlockTools);

      // Should return empty since all blocks are already paragraphs
      expect(result).toEqual([]);
    });

    it('should include tool when blocks have mixed types', async () => {
      const mockTool1 = {
        name: 'header',
        conversionConfig: {
          export: 'text',
          import: 'text',
        },
        toolbox: [
          {
            icon: 'H',
            title: 'Header',
          },
        ],
      } as unknown as BlockToolAdapter;

      const mockTool2 = {
        name: 'paragraph',
        conversionConfig: {
          export: 'text',
          import: 'text',
        },
        toolbox: [
          {
            icon: 'P',
            title: 'Paragraph',
          },
        ],
      } as unknown as BlockToolAdapter;

      const allBlockTools: BlockToolAdapter[] = [mockTool1, mockTool2];
      const mockBlock1 = createMockBlock('paragraph');
      const mockBlock2 = createMockBlock('header');

      const result = await getConvertibleToolsForBlocks([mockBlock1, mockBlock2], allBlockTools);

      // Should return both tools since blocks have mixed types
      expect(result).toHaveLength(2);
    });

    it('should filter out toolbox items without icon', async () => {
      const mockTool = {
        name: 'header',
        conversionConfig: {
          export: 'text',
          import: 'text',
        },
        toolbox: [
          {
            icon: 'H',
            title: 'Header',
          },
          {
            title: 'No Icon Header',
            // No icon
          },
        ],
      } as unknown as BlockToolAdapter;

      const mockTool2 = {
        name: 'paragraph',
        conversionConfig: {
          export: 'text',
          import: 'text',
        },
        toolbox: [
          {
            icon: 'P',
            title: 'Paragraph',
          },
        ],
      } as unknown as BlockToolAdapter;

      const allBlockTools: BlockToolAdapter[] = [mockTool, mockTool2];
      const mockBlock1 = createMockBlock('paragraph');
      const mockBlock2 = createMockBlock('paragraph');

      const result = await getConvertibleToolsForBlocks([mockBlock1, mockBlock2], allBlockTools);

      expect(result).toHaveLength(1);
      expect(result[0].toolbox).toHaveLength(1);
      expect(result[0].toolbox![0].icon).toBe('H');
    });
  });
});

