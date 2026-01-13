import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DataPersistenceManager } from '../../../../src/components/block/data-persistence-manager';
import type { InputManager } from '../../../../src/components/block/input-manager';
import type { TunesManager } from '../../../../src/components/block/tunes-manager';
import type { BlockTool, BlockToolData, ConversionConfig } from '@/types';
import type { BlockTuneData } from '@/types/block-tunes/block-tune-data';

// Mock TunesManager
vi.mock('../../../../src/components/block/tunes-manager', () => ({
  TunesManager: vi.fn(),
}));

// Mock InputManager
vi.mock('../../../../src/components/block/input-manager', () => ({
  InputManager: vi.fn(),
}));

describe('DataPersistenceManager', () => {
  let toolInstance: BlockTool;
  let getToolRenderedElement: () => HTMLElement | null;
  let tunesManager: TunesManager;
  let inputManager: InputManager;
  let callToolUpdated: () => void;
  let toggleEmptyMark: () => void;
  let dataPersistenceManager: DataPersistenceManager;
  let mockRenderedElement: HTMLElement;
  let initialData: BlockToolData;
  let initialTunesData: { [name: string]: BlockTuneData };

  beforeEach(() => {
    mockRenderedElement = document.createElement('div');
    mockRenderedElement.innerHTML = '<p>Test content</p>';

    getToolRenderedElement = () => mockRenderedElement;

    toolInstance = {
      render: vi.fn(() => mockRenderedElement),
      save: vi.fn(() => Promise.resolve({ text: 'saved content' })),
      validate: vi.fn(() => Promise.resolve(true)),
    } as unknown as BlockTool;

    tunesManager = {
      extractTunesData: vi.fn(() => ({ tune1: { enabled: true } })),
    } as unknown as TunesManager;

    inputManager = {
      dropCache: vi.fn(),
    } as unknown as InputManager;

    callToolUpdated = vi.fn();
    toggleEmptyMark = vi.fn();

    initialData = { text: 'initial text' };
    initialTunesData = { tune1: { enabled: false } };

    dataPersistenceManager = new DataPersistenceManager(
      toolInstance,
      getToolRenderedElement,
      tunesManager,
      'paragraph',
      () => false, // getIsEmpty
      inputManager,
      callToolUpdated,
      toggleEmptyMark,
      initialData,
      initialTunesData
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    it('creates instance with required dependencies', () => {
      expect(dataPersistenceManager).toBeInstanceOf(DataPersistenceManager);
    });

    it('stores initial data', () => {
      expect(dataPersistenceManager.lastSavedData).toEqual(initialData);
      expect(dataPersistenceManager.lastSavedTunes).toEqual(initialTunesData);
    });
  });

  describe('save', () => {
    it('extracts data from tool and tunes manager', async () => {
      const result = await dataPersistenceManager.save();

      expect(toolInstance.save).toHaveBeenCalled();
      expect(tunesManager.extractTunesData).toHaveBeenCalled();
      expect(result?.data).toEqual({ text: 'saved content' });
      expect(result?.tunes).toEqual({ tune1: { enabled: true } });
    });

    it('includes block metadata in save result', async () => {
      const result = await dataPersistenceManager.save();

      expect(result?.tool).toBe('paragraph');
      expect(result?.time).toBeGreaterThanOrEqual(0);
    });

    it('returns undefined when tool save fails', async () => {
      vi.mocked(toolInstance.save).mockRejectedValue(new Error('Save failed'));

      const result = await dataPersistenceManager.save();

      expect(result).toBeUndefined();
    });

    it('updates last saved data on successful save', async () => {
      await dataPersistenceManager.save();

      expect(dataPersistenceManager.lastSavedData).toEqual({ text: 'saved content' });
    });
  });

  describe('validate', () => {
    it('delegates to tool validate method when it exists', async () => {
      const validate = vi.fn(() => Promise.resolve(true));
      (toolInstance as { validate?: unknown }).validate = validate;

      const result = await dataPersistenceManager.validate({ text: 'test' });

      expect(validate).toHaveBeenCalledWith({ text: 'test' });
      expect(result).toBe(true);
    });

    it('returns true when tool has no validate method', async () => {
      (toolInstance as { validate?: unknown }).validate = undefined;

      const result = await dataPersistenceManager.validate({ text: 'test' });

      expect(result).toBe(true);
    });
  });

  describe('setData', () => {
    it('uses tool setData method when available', async () => {
      const setData = vi.fn(() => Promise<void>);
      (toolInstance as { setData?: unknown }).setData = setData;

      const result = await dataPersistenceManager.setData({ text: 'new text' });

      expect(setData).toHaveBeenCalledWith({ text: 'new text' });
      expect(result).toBe(true);
    });

    it('updates last saved data after tool setData', async () => {
      const setData = vi.fn(() => Promise<void>);
      (toolInstance as { setData?: unknown }).setData = setData;

      await dataPersistenceManager.setData({ text: 'new text' });

      expect(dataPersistenceManager.lastSavedData).toEqual({ text: 'new text' });
    });

    it('returns false when tool setData throws', async () => {
      const setData = vi.fn(() => Promise.reject(new Error('Set data failed')));
      (toolInstance as { setData?: unknown }).setData = setData;

      const result = await dataPersistenceManager.setData({ text: 'new text' });

      expect(result).toBe(false);
    });

    it('falls back to innerHTML update for contenteditable elements without setData', async () => {
      mockRenderedElement.setAttribute('contenteditable', 'true');

      const result = await dataPersistenceManager.setData({ text: 'fallback text' });

      expect(mockRenderedElement.innerHTML).toBe('fallback text');
      expect(inputManager.dropCache).toHaveBeenCalled();
      expect(toggleEmptyMark).toHaveBeenCalled();
      expect(callToolUpdated).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('handles empty data object for paragraph as empty string', async () => {
      mockRenderedElement.setAttribute('contenteditable', 'true');
      // Create a new manager with paragraph name
      const manager = new DataPersistenceManager(
        toolInstance,
        getToolRenderedElement,
        tunesManager,
        'paragraph',
        () => false,
        inputManager,
        callToolUpdated,
        toggleEmptyMark,
        initialData,
        initialTunesData
      );

      const result = await manager.setData({});

      expect(mockRenderedElement.innerHTML).toBe('');
      expect(result).toBe(true);
    });

    it('returns false when tool has no setData and element is not contenteditable', async () => {
      const result = await dataPersistenceManager.setData({ text: 'new text' });

      expect(result).toBe(false);
    });

    it('returns false when tool rendered element is null', async () => {
      getToolRenderedElement = () => null;
      const manager = new DataPersistenceManager(
        toolInstance,
        getToolRenderedElement,
        tunesManager,
        'paragraph',
        () => false,
        inputManager,
        callToolUpdated,
        toggleEmptyMark,
        initialData,
        initialTunesData
      );

      const result = await manager.setData({ text: 'new text' });

      expect(result).toBe(false);
    });
  });

  describe('exportDataAsString', () => {
    it('exports data using conversion config', () => {
      const conversionConfig: ConversionConfig = {
        export: 'text',
      };

      const result = dataPersistenceManager.exportDataAsString(conversionConfig);

      expect(result).toBe('initial text');
    });
  });

  describe('Getters', () => {
    it('data returns promise with saved data', async () => {
      const data = await dataPersistenceManager.data;

      expect(data).toEqual({ text: 'saved content' });
    });

    it('data returns saved data even when empty string', async () => {
      vi.mocked(toolInstance.save).mockResolvedValue({ text: '' } as BlockToolData);

      const data = await dataPersistenceManager.data;

      // Empty string is still considered valid data
      expect(data).toEqual({ text: '' });
    });

    it('data returns empty object when save returns undefined', async () => {
      vi.mocked(toolInstance.save).mockResolvedValue(undefined);

      const data = await dataPersistenceManager.data;

      expect(data).toEqual({});
    });

    it('preservedData returns last saved data', () => {
      expect(dataPersistenceManager.preservedData).toEqual(initialData);
    });

    it('preservedTunes returns last saved tunes', () => {
      expect(dataPersistenceManager.preservedTunes).toEqual(initialTunesData);
    });

    it('lastSavedData returns internal data property', () => {
      expect(dataPersistenceManager.lastSavedData).toEqual(initialData);
    });

    it('lastSavedTunes returns internal tunes property', () => {
      expect(dataPersistenceManager.lastSavedTunes).toEqual(initialTunesData);
    });
  });

  describe('Empty field sanitization', () => {
    it('sanitizes empty text fields in saved data when block is empty', async () => {
      // Create a manager where getIsEmpty returns true
      const manager = new DataPersistenceManager(
        toolInstance,
        getToolRenderedElement,
        tunesManager,
        'paragraph',
        () => true, // getIsEmpty returns true
        inputManager,
        callToolUpdated,
        toggleEmptyMark,
        initialData,
        initialTunesData
      );

      vi.mocked(toolInstance.save).mockResolvedValue({
        text: '<div></div>',
        html: '<span></span>',
      } as BlockToolData);

      const result = await manager.save();

      // Should sanitize empty fields to empty strings
      expect(result?.data).toEqual({ text: '', html: '' });
    });
  });

  describe('Error handling', () => {
    it('handles save error gracefully', async () => {
      vi.mocked(toolInstance.save).mockRejectedValue(new Error('Tool save failed'));

      const result = await dataPersistenceManager.save();

      expect(result).toBeUndefined();
    });

    it('handles non-object save result for empty blocks', async () => {
      vi.mocked(toolInstance.save).mockResolvedValue(null);

      const result = await dataPersistenceManager.save();

      expect(result?.data).toBeNull();
    });
  });
});
