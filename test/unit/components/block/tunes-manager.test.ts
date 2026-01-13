import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

import { TunesManager } from '../../../../src/components/block/tunes-manager';
import { ToolsCollection } from '../../../../src/components/tools/collection';
import type { BlockTuneAdapter } from '../../../../src/components/tools/tune';
import type { BlockAPI } from '@/types/api';
import type { BlockTuneData } from '@/types/block-tunes/block-tune-data';
import { PopoverItemType } from '@/types/utils/popover/popover-item-type';

interface MockTuneInstance {
  render: Mock<() => HTMLElement | { title: string }>;
  wrap: Mock<(node: HTMLElement) => HTMLElement>;
  save: Mock<() => BlockTuneData>;
}

interface CreateTuneAdapterResult {
  name: string;
  adapter: BlockTuneAdapter;
  instance: MockTuneInstance;
}

const createTuneAdapter = (name: string, {
  isInternal = false,
  renderReturn,
  saveReturn,
}: {
  isInternal?: boolean;
  renderReturn?: HTMLElement | { title: string };
  saveReturn?: BlockTuneData;
} = {}): CreateTuneAdapterResult => {
  const instance = {
    render: vi.fn((): HTMLElement | { title: string } => renderReturn ?? { title: `${name}-action` }),
    wrap: vi.fn((node: HTMLElement): HTMLElement => node),
    save: vi.fn((): BlockTuneData => saveReturn ?? { [`${name}Enabled`]: true }),
  };

  const adapter = {
    name,
    isInternal,
    create: vi.fn(() => instance),
  } as unknown as BlockTuneAdapter;

  return {
    name,
    adapter,
    instance,
  };
};

describe('TunesManager', () => {
  let mockBlockAPI: BlockAPI;

  beforeEach(() => {
    mockBlockAPI = {
      id: 'test-block',
      name: 'paragraph',
    } as unknown as BlockAPI;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    it('creates user tune instances from tune adapters', () => {
      const userTune = createTuneAdapter('userTune', { isInternal: false });
      const tunesCollection = new ToolsCollection<BlockTuneAdapter>(
        [[userTune.adapter.name, userTune.adapter]]
      );

      const manager = new TunesManager(tunesCollection, {}, mockBlockAPI);

      // When tune data doesn't have a key for the tune, undefined is passed
      expect(userTune.adapter.create).toHaveBeenCalledWith(undefined, mockBlockAPI);
      expect(manager.userTunes.has('userTune')).toBe(true);
      expect(manager.defaultTunes.has('userTune')).toBe(false);
    });

    it('creates default (internal) tune instances separately', () => {
      const internalTune = createTuneAdapter('internalTune', { isInternal: true });
      const tunesCollection = new ToolsCollection<BlockTuneAdapter>(
        [[internalTune.adapter.name, internalTune.adapter]]
      );

      const manager = new TunesManager(tunesCollection, {}, mockBlockAPI);

      // When tune data doesn't have a key for the tune, undefined is passed
      expect(internalTune.adapter.create).toHaveBeenCalledWith(undefined, mockBlockAPI);
      expect(manager.defaultTunes.has('internalTune')).toBe(true);
      expect(manager.userTunes.has('internalTune')).toBe(false);
    });

    it('stores unavailable tune data for tunes not in collection', () => {
      const userTune = createTuneAdapter('userTune');
      const tunesCollection = new ToolsCollection<BlockTuneAdapter>(
        [[userTune.adapter.name, userTune.adapter]]
      );

      const tunesData = {
        userTune: { enabled: true },
        missingTune: { collapsed: true },
      };

      const manager = new TunesManager(tunesCollection, tunesData, mockBlockAPI);

      // Missing tune data should be preserved and returned via extractTunesData
      const extractedData = manager.extractTunesData();
      expect(extractedData).toHaveProperty('missingTune', { collapsed: true });
    });

    it('passes tune-specific data to tune constructor', () => {
      const userTune = createTuneAdapter('userTune');
      const tunesCollection = new ToolsCollection<BlockTuneAdapter>(
        [[userTune.adapter.name, userTune.adapter]]
      );

      const tuneData = { userTune: { custom: 'data' } };

      new TunesManager(tunesCollection, tuneData, mockBlockAPI);

      expect(userTune.adapter.create).toHaveBeenCalledWith({ custom: 'data' }, mockBlockAPI);
    });
  });

  describe('getMenuConfig', () => {
    it('returns tool tunes from passed toolRenderSettings', () => {
      const userTune = createTuneAdapter('userTune');
      const tunesCollection = new ToolsCollection<BlockTuneAdapter>(
        [[userTune.adapter.name, userTune.adapter]]
      );

      const manager = new TunesManager(tunesCollection, {}, mockBlockAPI);

      const toolSettings = [{ title: 'Tool Action' }];
      const config = manager.getMenuConfig(toolSettings as any);

      expect(config.toolTunes).toEqual(toolSettings);
    });

    it('returns common tunes from tune instances render methods', () => {
      const userTune = createTuneAdapter('userTune');
      const internalTune = createTuneAdapter('internalTune', { isInternal: true });
      const tunesCollection = new ToolsCollection<BlockTuneAdapter>(
        [
          [userTune.adapter.name, userTune.adapter],
          [internalTune.adapter.name, internalTune.adapter],
        ]
      );

      const manager = new TunesManager(tunesCollection, {}, mockBlockAPI);

      const config = manager.getMenuConfig();

      expect(config.commonTunes).toHaveLength(2);
      expect(config.commonTunes).toContainEqual({ title: 'userTune-action' });
      expect(config.commonTunes).toContainEqual({ title: 'internalTune-action' });
    });

    it('handles HTMLElement return from render', () => {
      const htmlButton = document.createElement('button');
      const userTune = createTuneAdapter('userTune', { renderReturn: htmlButton });
      const tunesCollection = new ToolsCollection<BlockTuneAdapter>(
        [[userTune.adapter.name, userTune.adapter]]
      );

      const manager = new TunesManager(tunesCollection, {}, mockBlockAPI);

      const config = manager.getMenuConfig();

      expect(config.commonTunes).toHaveLength(1);
      expect(config.commonTunes[0]).toEqual({
        type: PopoverItemType.Html,
        element: htmlButton,
      });
    });

    it('handles array return from render', () => {
      const arrayReturn = [{ title: 'Action 1' }, { title: 'Action 2' }];
      const userTune = createTuneAdapter('userTune', { renderReturn: arrayReturn as any });
      const tunesCollection = new ToolsCollection<BlockTuneAdapter>(
        [[userTune.adapter.name, userTune.adapter]]
      );

      const manager = new TunesManager(tunesCollection, {}, mockBlockAPI);

      const config = manager.getMenuConfig();

      expect(config.commonTunes).toEqual(arrayReturn);
    });

    it('handles single MenuConfigItem return from render', () => {
      const itemReturn = { title: 'Single Action' };
      const userTune = createTuneAdapter('userTune', { renderReturn: itemReturn });
      const tunesCollection = new ToolsCollection<BlockTuneAdapter>(
        [[userTune.adapter.name, userTune.adapter]]
      );

      const manager = new TunesManager(tunesCollection, {}, mockBlockAPI);

      const config = manager.getMenuConfig();

      expect(config.commonTunes).toEqual([itemReturn]);
    });

    it('handles undefined/null gracefully', () => {
      const userTune = createTuneAdapter('userTune');
      // Override render to return undefined
      userTune.instance.render.mockReturnValue(undefined as unknown as HTMLElement);
      const tunesCollection = new ToolsCollection<BlockTuneAdapter>(
        [[userTune.adapter.name, userTune.adapter]]
      );

      const manager = new TunesManager(tunesCollection, {}, mockBlockAPI);

      const config = manager.getMenuConfig();

      // Undefined should be skipped by the pushTuneConfig function
      expect(config.commonTunes).toEqual([]);
    });
  });

  describe('wrapContent', () => {
    it('returns original node when no tunes have wrap method', () => {
      const userTune = createTuneAdapter('userTune');
      // Remove wrap method
      userTune.instance.wrap = undefined as unknown as Mock<(node: HTMLElement) => HTMLElement>;
      const tunesCollection = new ToolsCollection<BlockTuneAdapter>(
        [[userTune.adapter.name, userTune.adapter]]
      );

      const manager = new TunesManager(tunesCollection, {}, mockBlockAPI);

      const contentNode = document.createElement('div');
      const result = manager.wrapContent(contentNode);

      expect(result).toBe(contentNode);
    });

    it('applies single tune wrapper', () => {
      const wrapper = document.createElement('div');
      const userTune = createTuneAdapter('userTune');
      userTune.instance.wrap.mockReturnValue(wrapper);
      const tunesCollection = new ToolsCollection<BlockTuneAdapter>(
        [[userTune.adapter.name, userTune.adapter]]
      );

      const manager = new TunesManager(tunesCollection, {}, mockBlockAPI);

      const contentNode = document.createElement('div');
      const result = manager.wrapContent(contentNode);

      expect(result).toBe(wrapper);
      expect(userTune.instance.wrap).toHaveBeenCalledWith(contentNode);
    });

    it('chains multiple tune wrappers in correct order', () => {
      const wrapper1 = document.createElement('div');
      const wrapper2 = document.createElement('div');
      const userTune1 = createTuneAdapter('userTune1');
      const userTune2 = createTuneAdapter('userTune2');

      userTune1.instance.wrap.mockReturnValue(wrapper1);
      userTune2.instance.wrap.mockReturnValue(wrapper2);

      const tunesCollection = new ToolsCollection<BlockTuneAdapter>(
        [
          [userTune1.adapter.name, userTune1.adapter],
          [userTune2.adapter.name, userTune2.adapter],
        ]
      );

      const manager = new TunesManager(tunesCollection, {}, mockBlockAPI);

      const contentNode = document.createElement('div');
      const result = manager.wrapContent(contentNode);

      // First tune wraps content, second tune wraps result of first
      expect(userTune1.instance.wrap).toHaveBeenCalledWith(contentNode);
      expect(userTune2.instance.wrap).toHaveBeenCalledWith(wrapper1);
      expect(result).toBe(wrapper2);
    });

    it('handles tune wrap throwing error (logs warning, continues)', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const wrapper = document.createElement('div');
      const userTune1 = createTuneAdapter('userTune1');
      const userTune2 = createTuneAdapter('userTune2');

      userTune1.instance.wrap.mockImplementation(() => {
        throw new Error('Wrap error');
      });
      userTune2.instance.wrap.mockReturnValue(wrapper);

      const tunesCollection = new ToolsCollection<BlockTuneAdapter>(
        [
          [userTune1.adapter.name, userTune1.adapter],
          [userTune2.adapter.name, userTune2.adapter],
        ]
      );

      const manager = new TunesManager(tunesCollection, {}, mockBlockAPI);

      const contentNode = document.createElement('div');
      const result = manager.wrapContent(contentNode);

      // Should continue with next tune
      expect(result).toBe(wrapper);
      expect(userTune2.instance.wrap).toHaveBeenCalledWith(contentNode);
      expect(consoleWarnSpy).toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });
  });

  describe('extractTunesData', () => {
    it('extracts data from user tunes with save method', () => {
      const userTune = createTuneAdapter('userTune');
      const tunesCollection = new ToolsCollection<BlockTuneAdapter>(
        [[userTune.adapter.name, userTune.adapter]]
      );

      const manager = new TunesManager(tunesCollection, {}, mockBlockAPI);

      const result = manager.extractTunesData();

      expect(result).toHaveProperty('userTune', { userTuneEnabled: true });
      expect(userTune.instance.save).toHaveBeenCalled();
    });

    it('extracts data from default tunes with save method', () => {
      const internalTune = createTuneAdapter('internalTune', { isInternal: true });
      const tunesCollection = new ToolsCollection<BlockTuneAdapter>(
        [[internalTune.adapter.name, internalTune.adapter]]
      );

      const manager = new TunesManager(tunesCollection, {}, mockBlockAPI);

      const result = manager.extractTunesData();

      expect(result).toHaveProperty('internalTune', { internalTuneEnabled: true });
      expect(internalTune.instance.save).toHaveBeenCalled();
    });

    it('includes unavailable tune data in result', () => {
      const userTune = createTuneAdapter('userTune');
      const tunesCollection = new ToolsCollection<BlockTuneAdapter>(
        [[userTune.adapter.name, userTune.adapter]]
      );

      const tunesData = {
        userTune: { enabled: true },
        missingTune: { collapsed: true },
      };

      const manager = new TunesManager(tunesCollection, tunesData, mockBlockAPI);

      const result = manager.extractTunesData();

      expect(result).toHaveProperty('userTune', { userTuneEnabled: true });
      expect(result).toHaveProperty('missingTune', { collapsed: true });
    });

    it('handles tune save throwing error (logs warning, skips)', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const userTune = createTuneAdapter('userTune');
      userTune.instance.save.mockImplementation(() => {
        throw new Error('Save error');
      });

      const tunesCollection = new ToolsCollection<BlockTuneAdapter>(
        [[userTune.adapter.name, userTune.adapter]]
      );

      const manager = new TunesManager(tunesCollection, {}, mockBlockAPI);

      const result = manager.extractTunesData();

      // Should not have the tune data since save failed
      expect(result).not.toHaveProperty('userTune');
      expect(consoleWarnSpy).toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });
  });

  describe('Getters', () => {
    it('userTunes returns user tune instances map', () => {
      const userTune = createTuneAdapter('userTune');
      const internalTune = createTuneAdapter('internalTune', { isInternal: true });
      const tunesCollection = new ToolsCollection<BlockTuneAdapter>(
        [
          [userTune.adapter.name, userTune.adapter],
          [internalTune.adapter.name, internalTune.adapter],
        ]
      );

      const manager = new TunesManager(tunesCollection, {}, mockBlockAPI);

      expect(manager.userTunes.size).toBe(1);
      expect(manager.userTunes.has('userTune')).toBe(true);
      expect(manager.userTunes.has('internalTune')).toBe(false);
    });

    it('defaultTunes returns default tune instances map', () => {
      const userTune = createTuneAdapter('userTune');
      const internalTune = createTuneAdapter('internalTune', { isInternal: true });
      const tunesCollection = new ToolsCollection<BlockTuneAdapter>(
        [
          [userTune.adapter.name, userTune.adapter],
          [internalTune.adapter.name, internalTune.adapter],
        ]
      );

      const manager = new TunesManager(tunesCollection, {}, mockBlockAPI);

      expect(manager.defaultTunes.size).toBe(1);
      expect(manager.defaultTunes.has('internalTune')).toBe(true);
      expect(manager.defaultTunes.has('userTune')).toBe(false);
    });
  });
});
