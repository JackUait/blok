import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HistoryAPI } from '../../../../../src/components/modules/api/history';
import { EventsDispatcher } from '../../../../../src/components/utils/events';

import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import type { BlokConfig } from '../../../../../types';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

type YjsManagerUndoMock = ReturnType<typeof vi.fn>;
type YjsManagerRedoMock = ReturnType<typeof vi.fn>;
type YjsManagerCanUndoMock = ReturnType<typeof vi.fn<() => boolean>>;
type YjsManagerCanRedoMock = ReturnType<typeof vi.fn<() => boolean>>;
type YjsManagerClearMock = ReturnType<typeof vi.fn>;

type BlokStub = {
  YjsManager: {
    undo: YjsManagerUndoMock;
    redo: YjsManagerRedoMock;
    canUndo: YjsManagerCanUndoMock;
    canRedo: YjsManagerCanRedoMock;
    clear: YjsManagerClearMock;
  };
};

const createHistoryApi = (): { historyApi: HistoryAPI; blok: BlokStub } => {
  const moduleConfig: ModuleConfig = {
    config: {} as BlokConfig,
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  };

  const historyApi = new HistoryAPI(moduleConfig);

  const blok: BlokStub = {
    YjsManager: {
      undo: vi.fn(),
      redo: vi.fn(),
      canUndo: vi.fn(),
      canRedo: vi.fn(),
      clear: vi.fn(),
    },
  };

  historyApi.state = blok as unknown as BlokModules;

  return { historyApi, blok };
};

describe('HistoryAPI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('methods', () => {
    it('exposes an undo method that proxies to the class method', () => {
      const { historyApi, blok } = createHistoryApi();

      historyApi.methods.undo();

      expect(blok.YjsManager.undo).toHaveBeenCalled();
      expect(historyApi.methods).toHaveProperty('undo');
    });

    it('exposes a redo method that proxies to the class method', () => {
      const { historyApi, blok } = createHistoryApi();

      historyApi.methods.redo();

      expect(blok.YjsManager.redo).toHaveBeenCalled();
      expect(historyApi.methods).toHaveProperty('redo');
    });

    it('exposes a canUndo method that proxies to the class method', () => {
      const { historyApi, blok } = createHistoryApi();
      blok.YjsManager.canUndo.mockReturnValue(true);

      const result = historyApi.methods.canUndo();

      expect(result).toBe(true);
      expect(blok.YjsManager.canUndo).toHaveBeenCalled();
    });

    it('exposes a canRedo method that proxies to the class method', () => {
      const { historyApi, blok } = createHistoryApi();
      blok.YjsManager.canRedo.mockReturnValue(false);

      const result = historyApi.methods.canRedo();

      expect(result).toBe(false);
      expect(blok.YjsManager.canRedo).toHaveBeenCalled();
    });

    it('exposes a clear method that proxies to the class method', () => {
      const { historyApi, blok } = createHistoryApi();

      historyApi.methods.clear();

      expect(blok.YjsManager.clear).toHaveBeenCalled();
      expect(historyApi.methods).toHaveProperty('clear');
    });
  });

  describe('undo', () => {
    it('calls YjsManager.undo', () => {
      const { historyApi, blok } = createHistoryApi();
      blok.YjsManager.canUndo.mockReturnValue(true);

      expect(historyApi.canUndo()).toBe(true);
      historyApi.undo();

      expect(blok.YjsManager.undo).toHaveBeenCalledTimes(1);
    });
  });

  describe('redo', () => {
    it('calls YjsManager.redo', () => {
      const { historyApi, blok } = createHistoryApi();
      blok.YjsManager.canRedo.mockReturnValue(true);

      expect(historyApi.canRedo()).toBe(true);
      historyApi.redo();

      expect(blok.YjsManager.redo).toHaveBeenCalledTimes(1);
    });
  });

  describe('canUndo', () => {
    it('returns the result from YjsManager.canUndo', () => {
      const { historyApi, blok } = createHistoryApi();
      blok.YjsManager.canUndo.mockReturnValue(true);

      const result = historyApi.canUndo();

      expect(result).toBe(true);
    });

    it('returns false when YjsManager.canUndo returns false', () => {
      const { historyApi, blok } = createHistoryApi();
      blok.YjsManager.canUndo.mockReturnValue(false);

      const result = historyApi.canUndo();

      expect(result).toBe(false);
    });
  });

  describe('canRedo', () => {
    it('returns the result from YjsManager.canRedo', () => {
      const { historyApi, blok } = createHistoryApi();
      blok.YjsManager.canRedo.mockReturnValue(true);

      const result = historyApi.canRedo();

      expect(result).toBe(true);
    });

    it('returns false when YjsManager.canRedo returns false', () => {
      const { historyApi, blok } = createHistoryApi();
      blok.YjsManager.canRedo.mockReturnValue(false);

      const result = historyApi.canRedo();

      expect(result).toBe(false);
    });
  });

  describe('clear', () => {
    it('calls YjsManager.clear and resets undo/redo state', () => {
      const { historyApi, blok } = createHistoryApi();
      blok.YjsManager.canUndo.mockReturnValue(false);
      blok.YjsManager.canRedo.mockReturnValue(false);

      historyApi.clear();

      expect(blok.YjsManager.clear).toHaveBeenCalledTimes(1);
      expect(historyApi.canUndo()).toBe(false);
      expect(historyApi.canRedo()).toBe(false);
    });
  });
});
