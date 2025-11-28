import { describe, it, expect, beforeEach, vi } from 'vitest';
import CaretAPI from '../../../../../src/components/modules/api/caret';
import EventsDispatcher from '../../../../../src/components/utils/events';
import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import type { BlokConfig } from '../../../../../types';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlockAPI } from '../../../../../types/api';

const resolveBlockMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../../src/components/utils/api', () => ({
  resolveBlock: resolveBlockMock,
}));

type BlockManagerStub = {
  firstBlock?: BlockAPI;
  lastBlock?: BlockAPI;
  previousBlock?: BlockAPI;
  nextBlock?: BlockAPI;
};

type CaretModuleStub = {
  positions: {
    DEFAULT: string;
    START: string;
    END: string;
  };
  setToBlock: ReturnType<typeof vi.fn>;
};

type BlokStub = {
  BlockManager: BlockManagerStub;
  Caret: CaretModuleStub;
};

const createBlock = (id: string): BlockAPI => ({
  id,
} as BlockAPI);

const createCaretApi = (): { caretApi: CaretAPI; blok: BlokStub } => {
  const eventsDispatcher = new EventsDispatcher<BlokEventMap>();
  const moduleConfig: ModuleConfig = {
    config: {} as BlokConfig,
    eventsDispatcher,
  };

  const caretApi = new CaretAPI(moduleConfig);

  const blok: BlokStub = {
    BlockManager: {},
    Caret: {
      positions: {
        DEFAULT: 'default',
        START: 'start',
        END: 'end',
      },
      setToBlock: vi.fn(),
    },
  };

  caretApi.state = blok as unknown as BlokModules;

  return { caretApi,
    blok };
};

describe('CaretAPI', () => {
  beforeEach(() => {
    resolveBlockMock.mockReset();
  });

  it('exposes caret helpers via methods getter', () => {
    const { caretApi } = createCaretApi();

    expect(caretApi.methods).toEqual(expect.objectContaining({
      setToFirstBlock: expect.any(Function),
      setToLastBlock: expect.any(Function),
      setToPreviousBlock: expect.any(Function),
      setToNextBlock: expect.any(Function),
      setToBlock: expect.any(Function),
      focus: expect.any(Function),
    }));
  });

  describe('setToFirstBlock', () => {
    it('returns false when there is no first block', () => {
      const { caretApi } = createCaretApi();

      expect(caretApi.methods.setToFirstBlock()).toBe(false);
    });

    it('moves caret to the first block using provided params', () => {
      const { caretApi, blok } = createCaretApi();
      const block = createBlock('first');

      blok.BlockManager.firstBlock = block;

      const result = caretApi.methods.setToFirstBlock('start', 3);

      expect(result).toBe(true);
      expect(blok.Caret.setToBlock).toHaveBeenCalledWith(block, 'start', 3);
    });
  });

  describe('setToLastBlock', () => {
    it('returns false when last block is missing', () => {
      const { caretApi } = createCaretApi();

      expect(caretApi.methods.setToLastBlock()).toBe(false);
    });

    it('moves caret to the last block', () => {
      const { caretApi, blok } = createCaretApi();
      const block = createBlock('last');

      blok.BlockManager.lastBlock = block;

      const result = caretApi.methods.setToLastBlock('end');

      expect(result).toBe(true);
      expect(blok.Caret.setToBlock).toHaveBeenCalledWith(block, 'end', 0);
    });
  });

  describe('setToPreviousBlock', () => {
    it('returns false when previous block does not exist', () => {
      const { caretApi } = createCaretApi();

      expect(caretApi.methods.setToPreviousBlock()).toBe(false);
    });

    it('moves caret to the previous block', () => {
      const { caretApi, blok } = createCaretApi();
      const block = createBlock('previous');

      blok.BlockManager.previousBlock = block;

      const result = caretApi.methods.setToPreviousBlock('start', 1);

      expect(result).toBe(true);
      expect(blok.Caret.setToBlock).toHaveBeenCalledWith(block, 'start', 1);
    });
  });

  describe('setToNextBlock', () => {
    it('returns false when next block does not exist', () => {
      const { caretApi } = createCaretApi();

      expect(caretApi.methods.setToNextBlock()).toBe(false);
    });

    it('moves caret to the next block', () => {
      const { caretApi, blok } = createCaretApi();
      const block = createBlock('next');

      blok.BlockManager.nextBlock = block;

      const result = caretApi.methods.setToNextBlock('default', 2);

      expect(result).toBe(true);
      expect(blok.Caret.setToBlock).toHaveBeenCalledWith(block, 'default', 2);
    });
  });

  describe('setToBlock', () => {
    it('returns false when block cannot be resolved', () => {
      const { caretApi, blok } = createCaretApi();

      resolveBlockMock.mockReturnValueOnce(undefined);

      const result = caretApi.methods.setToBlock('missing');

      expect(result).toBe(false);
      expect(resolveBlockMock).toHaveBeenCalledWith('missing', blok);
      expect(blok.Caret.setToBlock).not.toHaveBeenCalled();
    });

    it('delegates caret placement to resolved block', () => {
      const { caretApi, blok } = createCaretApi();
      const resolvedBlock = createBlock('resolved');

      resolveBlockMock.mockReturnValueOnce(resolvedBlock);

      const result = caretApi.methods.setToBlock('any', 'default', 4);

      expect(result).toBe(true);
      expect(resolveBlockMock).toHaveBeenCalledWith('any', blok);
      expect(blok.Caret.setToBlock).toHaveBeenCalledWith(resolvedBlock, 'default', 4);
    });
  });

  describe('focus', () => {
    it('focuses the first block when atEnd is false', () => {
      const { caretApi, blok } = createCaretApi();
      const firstBlock = createBlock('first');

      blok.BlockManager.firstBlock = firstBlock;

      const result = caretApi.methods.focus();

      expect(result).toBe(true);
      expect(blok.Caret.setToBlock).toHaveBeenCalledWith(firstBlock, blok.Caret.positions.START, 0);
    });

    it('focuses the last block when atEnd is true', () => {
      const { caretApi, blok } = createCaretApi();
      const lastBlock = createBlock('last');

      blok.BlockManager.lastBlock = lastBlock;

      const result = caretApi.methods.focus(true);

      expect(result).toBe(true);
      expect(blok.Caret.setToBlock).toHaveBeenCalledWith(lastBlock, blok.Caret.positions.END, 0);
    });
  });
});
