import { describe, it, expect } from 'vitest';
import { ListItem as List, type ListItemConfig, type ListItemData } from '../../../src/tools/list';
import defaultDictionary from '../../../src/components/i18n/locales/en/messages.json';
import type { API, BlockToolConstructorOptions } from '../../../types';
import type { I18nDictionary } from '../../../types/configs';
import type { MenuConfig } from '../../../types/tools/menu-config';
import { analyzeDataFormat, expandToHierarchical, collapseToLegacy } from '../../../src/components/utils/data-model-transform';
import type { OutputBlockData } from '../../../types';

/**
 * Creates a mock API object for testing with custom dictionary
 */
const createMockAPI = (dictionary: Record<string, string> = defaultDictionary as Record<string, string>): API =>
  ({
    styles: {
      block: 'blok-block',
      inlineToolbar: 'blok-inline-toolbar',
      inlineToolButton: 'blok-inline-tool-button',
      inlineToolButtonActive: 'blok-inline-tool-button--active',
      input: 'blok-input',
      loader: 'blok-loader',
      button: 'blok-button',
      settingsButton: 'blok-settings-button',
      settingsButtonActive: 'blok-settings-button--active',
    },
    i18n: {
      t: (key: string) => dictionary[key] ?? key,
    },
    blocks: {
      getCurrentBlockIndex: () => 0,
      delete: () => {},
      insert: () => {},
    },
    events: {
      on: () => {},
      off: () => {},
      emit: () => {},
    },
  }) as unknown as API;

/**
 * Creates list tool constructor options with optional custom dictionary
 */
const createListOptions = (
  data: Partial<ListItemData> = {},
  config: ListItemConfig = {},
  dictionary?: Record<string, string>
): BlockToolConstructorOptions<ListItemData, ListItemConfig> => ({
  data: { text: '', style: 'unordered', ...data } as ListItemData,
  config,
  api: createMockAPI(dictionary),
  readOnly: false,
  block: {} as never,
});

/**
 * Helper to convert MenuConfig to array for easier testing
 */
const toMenuArray = (config: MenuConfig): Array<Record<string, unknown>> => {
  return (Array.isArray(config) ? config : [config]) as Array<Record<string, unknown>>;
};

describe('List Tool - i18n', () => {
  describe('default dictionary contains list translations', () => {
    it('has toolNames entries for list styles', () => {
      const dictionary = defaultDictionary as I18nDictionary;

      expect(dictionary).toHaveProperty('toolNames.bulletedList');
      expect(dictionary).toHaveProperty('toolNames.numberedList');
      expect(dictionary).toHaveProperty('toolNames.todoList');
    });

    it('has tools.list.placeholder key for List placeholder', () => {
      const dictionary = defaultDictionary as I18nDictionary;

      expect(dictionary).toHaveProperty('tools.list.placeholder');
    });
  });

  describe('renderSettings uses i18n via API', () => {
    it('translates style labels in settings menu', () => {
      const frenchDictionary: Record<string, string> = {
        'toolNames.bulletedList': 'Liste à puces',
        'toolNames.numberedList': 'Liste numérotée',
        'toolNames.todoList': 'Liste de contrôle',
      };

      const options = createListOptions({}, {}, frenchDictionary);
      const list = new List(options);
      const settings = toMenuArray(list.renderSettings());

      expect(settings).toHaveLength(3);
      expect(settings[0].label).toBe('Liste à puces');
      expect(settings[1].label).toBe('Liste numérotée');
      expect(settings[2].label).toBe('Liste de contrôle');
    });

    it('falls back to original key when translation is missing', () => {
      const emptyDictionary: Record<string, string> = {};

      const options = createListOptions({}, {}, emptyDictionary);
      const list = new List(options);
      const settings = toMenuArray(list.renderSettings());

      // Falls back to the full key when translation is missing
      expect(settings[0].label).toBe('toolNames.bulletedList');
      expect(settings[1].label).toBe('toolNames.numberedList');
      expect(settings[2].label).toBe('toolNames.todoList');
    });

    it('respects configured styles when translating', () => {
      const germanDictionary: Record<string, string> = {
        'toolNames.bulletedList': 'Aufzählung',
        'toolNames.numberedList': 'Nummerierung',
        'toolNames.todoList': 'Aufgabenliste',
      };

      const options = createListOptions({}, { styles: ['unordered', 'checklist'] }, germanDictionary);
      const list = new List(options);
      const settings = toMenuArray(list.renderSettings());

      expect(settings).toHaveLength(2);
      expect(settings[0].label).toBe('Aufzählung');
      expect(settings[1].label).toBe('Aufgabenliste');
    });
  });

  describe('toolbox configuration', () => {
    it('has translatable titles in toolbox config', () => {
      const toolbox = List.toolbox;

      expect(Array.isArray(toolbox)).toBe(true);

      const toolboxArray = toolbox as Array<{ title: string; name: string }>;

      expect(toolboxArray).toHaveLength(3);
      expect(toolboxArray[0].title).toBe('Bulleted list');
      expect(toolboxArray[1].title).toBe('Numbered list');
      expect(toolboxArray[2].title).toBe('To-do list');
    });

    it('toolbox titles have corresponding dictionary entries', () => {
      const toolbox = List.toolbox as Array<{ title: string }>;
      const dictionary = defaultDictionary as I18nDictionary;

      // Map toolbox titles to their dictionary key equivalents
      const titleToDictKey: Record<string, string> = {
        'Bulleted list': 'bulletedList',
        'Numbered list': 'numberedList',
        'To-do list': 'todoList',
      };

      toolbox.forEach((item) => {
        const dictKey = titleToDictKey[item.title];
        expect(dictKey).toBeDefined();
        expect(dictionary).toHaveProperty(`toolNames.${dictKey}`);
      });
    });
  });

  describe('i18n integration via mock API', () => {
    it('translates list style names via api.i18n.t()', () => {
      const spanishDictionary: Record<string, string> = {
        'toolNames.bulletedList': 'Lista con viñetas',
        'toolNames.numberedList': 'Lista numerada',
        'toolNames.todoList': 'Lista de verificación',
      };

      const api = createMockAPI(spanishDictionary);

      expect(api.i18n.t('toolNames.bulletedList')).toBe('Lista con viñetas');
      expect(api.i18n.t('toolNames.numberedList')).toBe('Lista numerada');
      expect(api.i18n.t('toolNames.todoList')).toBe('Lista de verificación');
    });

    it('translates toolbox titles via toolNames namespace', () => {
      const japaneseDictionary: Record<string, string> = {
        'toolNames.bulletedList': '箇条書きリスト',
        'toolNames.numberedList': '番号付きリスト',
        'toolNames.todoList': 'ToDoリスト',
      };

      const api = createMockAPI(japaneseDictionary);

      expect(api.i18n.t('toolNames.bulletedList')).toBe('箇条書きリスト');
      expect(api.i18n.t('toolNames.numberedList')).toBe('番号付きリスト');
      expect(api.i18n.t('toolNames.todoList')).toBe('ToDoリスト');
    });
  });
});

describe('List Tool - Backward Compatibility', () => {
  describe('normalizeData handles legacy items[] format', () => {
    it('extracts first item content from legacy format', () => {
      const legacyData = {
        style: 'unordered',
        items: [
          { content: 'First item' },
          { content: 'Second item' },
        ],
      } as unknown as ListItemData;

      const options = createListOptions(legacyData);
      const list = new List(options);
      const saved = list.save();

      expect(saved.text).toBe('First item');
      expect(saved.style).toBe('unordered');
    });

    it('handles legacy checklist format with checked state', () => {
      const legacyData = {
        style: 'checklist',
        items: [
          { content: 'Completed task', checked: true },
        ],
      } as unknown as ListItemData;

      const options = createListOptions(legacyData);
      const list = new List(options);
      const saved = list.save();

      expect(saved.text).toBe('Completed task');
      expect(saved.style).toBe('checklist');
      expect(saved.checked).toBe(true);
    });

    it('handles empty legacy items array', () => {
      const legacyData = {
        style: 'ordered',
        items: [],
      } as unknown as ListItemData;

      const options = createListOptions(legacyData);
      const list = new List(options);
      const saved = list.save();

      expect(saved.text).toBe('');
      expect(saved.style).toBe('ordered');
    });

    it('preserves start value from legacy format', () => {
      const legacyData = {
        style: 'ordered',
        start: 5,
        items: [
          { content: 'Item starting at 5' },
        ],
      } as unknown as ListItemData;

      const options = createListOptions(legacyData);
      const list = new List(options);
      const saved = list.save();

      expect(saved.text).toBe('Item starting at 5');
      expect(saved.start).toBe(5);
    });
  });

  describe('new flat format works correctly', () => {
    it('handles flat format with text field', () => {
      const flatData: ListItemData = {
        text: 'Flat format item',
        style: 'unordered',
      };

      const options = createListOptions(flatData);
      const list = new List(options);
      const saved = list.save();

      expect(saved.text).toBe('Flat format item');
      expect(saved.style).toBe('unordered');
    });

    it('handles flat format with depth', () => {
      const flatData: ListItemData = {
        text: 'Nested item',
        style: 'unordered',
        depth: 2,
      };

      const options = createListOptions(flatData);
      const list = new List(options);
      const saved = list.save();

      expect(saved.text).toBe('Nested item');
      expect(saved.depth).toBe(2);
    });
  });
});

describe('Data Model Transform - List Compatibility', () => {
  describe('analyzeDataFormat', () => {
    it('detects legacy format with nested items', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'block1',
          type: 'list',
          data: {
            style: 'unordered',
            items: [
              { content: 'Item 1', items: [{ content: 'Nested' }] },
            ],
          },
        },
      ];

      const result = analyzeDataFormat(blocks);

      expect(result.format).toBe('legacy');
      expect(result.hasHierarchy).toBe(true);
    });

    it('detects legacy format with flat items (no nesting)', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'block1',
          type: 'list',
          data: {
            style: 'unordered',
            items: [
              { content: 'Item 1', items: [] },
              { content: 'Item 2', items: [] },
            ],
          },
        },
      ];

      const result = analyzeDataFormat(blocks);

      expect(result.format).toBe('legacy');
      expect(result.hasHierarchy).toBe(false);
    });

    it('detects flat format without hierarchy', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'block1',
          type: 'list',
          data: {
            text: 'Item 1',
            style: 'unordered',
          },
        },
      ];

      const result = analyzeDataFormat(blocks);

      expect(result.format).toBe('flat');
      expect(result.hasHierarchy).toBe(false);
    });

    it('detects hierarchical format with parent/content refs', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'block1',
          type: 'list',
          data: { text: 'Parent', style: 'unordered' },
          content: ['block2'],
        },
        {
          id: 'block2',
          type: 'list',
          data: { text: 'Child', style: 'unordered', depth: 1 },
          parent: 'block1',
        },
      ];

      const result = analyzeDataFormat(blocks);

      expect(result.format).toBe('hierarchical');
      expect(result.hasHierarchy).toBe(true);
    });
  });

  describe('expandToHierarchical', () => {
    it('expands legacy list to flat list blocks', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'list1',
          type: 'list',
          data: {
            style: 'unordered',
            items: [
              { content: 'Item 1' },
              { content: 'Item 2' },
            ],
          },
        },
      ];

      const expanded = expandToHierarchical(blocks);

      expect(expanded).toHaveLength(2);
      expect(expanded[0].type).toBe('list');
      expect(expanded[0].data.text).toBe('Item 1');
      expect(expanded[0].data.style).toBe('unordered');
      expect(expanded[1].type).toBe('list');
      expect(expanded[1].data.text).toBe('Item 2');
    });

    it('expands nested items with correct depth', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'list1',
          type: 'list',
          data: {
            style: 'unordered',
            items: [
              {
                content: 'Parent',
                items: [{ content: 'Child' }],
              },
            ],
          },
        },
      ];

      const expanded = expandToHierarchical(blocks);

      expect(expanded).toHaveLength(2);
      expect(expanded[0].data.text).toBe('Parent');
      expect(expanded[0].data.depth).toBeUndefined(); // depth 0 is omitted
      expect(expanded[1].data.text).toBe('Child');
      expect(expanded[1].data.depth).toBe(1);
    });

    it('preserves ordered list start value', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'list1',
          type: 'list',
          data: {
            style: 'ordered',
            start: 5,
            items: [{ content: 'Item 5' }],
          },
        },
      ];

      const expanded = expandToHierarchical(blocks);

      expect(expanded[0].data.start).toBe(5);
    });

    it('preserves checklist checked state', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'list1',
          type: 'list',
          data: {
            style: 'checklist',
            items: [
              { content: 'Done', checked: true },
              { content: 'Not done', checked: false },
            ],
          },
        },
      ];

      const expanded = expandToHierarchical(blocks);

      expect(expanded[0].data.checked).toBe(true);
      expect(expanded[1].data.checked).toBe(false);
    });

    it('expands legacy list with plain string items', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'list1',
          type: 'list',
          data: {
            style: 'unordered',
            items: ['Item 1', 'Item 2', 'Item 3'],
          },
        },
      ];

      const expanded = expandToHierarchical(blocks);

      expect(expanded).toHaveLength(3);
      expect(expanded[0].type).toBe('list');
      expect(expanded[0].data.text).toBe('Item 1');
      expect(expanded[0].data.style).toBe('unordered');
      expect(expanded[1].data.text).toBe('Item 2');
      expect(expanded[2].data.text).toBe('Item 3');
    });

    it('expands old checklist format with text property', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'list1',
          type: 'list',
          data: {
            style: 'checklist',
            items: [
              { text: 'Task 1', checked: true },
              { text: 'Task 2', checked: false },
            ],
          },
        },
      ];

      const expanded = expandToHierarchical(blocks);

      expect(expanded).toHaveLength(2);
      expect(expanded[0].data.text).toBe('Task 1');
      expect(expanded[0].data.checked).toBe(true);
      expect(expanded[1].data.text).toBe('Task 2');
      expect(expanded[1].data.checked).toBe(false);
    });
  });

  describe('collapseToLegacy', () => {
    it('collapses flat list blocks to legacy format', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'item1',
          type: 'list',
          data: { text: 'Item 1', style: 'unordered' },
        },
        {
          id: 'item2',
          type: 'list',
          data: { text: 'Item 2', style: 'unordered' },
        },
      ];

      const collapsed = collapseToLegacy(blocks);

      expect(collapsed).toHaveLength(2);
      // Each root item becomes a separate list block
      expect(collapsed[0].type).toBe('list');
      expect(collapsed[0].data.items[0].content).toBe('Item 1');
    });

    it('preserves non-list blocks unchanged', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'p1',
          type: 'paragraph',
          data: { text: 'Hello' },
        },
        {
          id: 'item1',
          type: 'list',
          data: { text: 'List item', style: 'unordered' },
        },
      ];

      const collapsed = collapseToLegacy(blocks);

      expect(collapsed).toHaveLength(2);
      expect(collapsed[0].type).toBe('paragraph');
      expect(collapsed[0].data.text).toBe('Hello');
    });
  });
});
