import { describe, it, expect } from 'vitest';
import List, { type ListItemConfig, type ListItemData } from '../../../src/tools/list';
import defaultDictionary from '../../../src/components/i18n/locales/en/messages.json';
import type { API, BlockToolConstructorOptions } from '../../../types';
import type { I18nDictionary } from '../../../types/configs';
import type { MenuConfig } from '../../../types/tools/menu-config';

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

    it('has tools.list.list key for List placeholder', () => {
      const dictionary = defaultDictionary as I18nDictionary;

      expect(dictionary).toHaveProperty('tools.list.list');
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
