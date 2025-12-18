import { describe, it, expect, vi } from 'vitest';
import { resolveBlock } from '../../../src/components/utils/api';
import type { BlokModules } from '../../../src/types-internal/blok-modules';
import type { Block } from '../../../src/components/block';
import type { BlockAPI } from '../../../types/api/block';

type BlockManagerStub = {
  getBlockByIndex: ReturnType<typeof vi.fn>;
  getBlockById: ReturnType<typeof vi.fn>;
};

const createBlok = (): { blok: BlokModules; blockManager: BlockManagerStub } => {
  const blockManager: BlockManagerStub = {
    getBlockByIndex: vi.fn(),
    getBlockById: vi.fn(),
  };

  const blok = {
    BlockManager: blockManager,
  } as unknown as BlokModules;

  return { blok,
    blockManager };
};

describe('utils/api resolveBlock', () => {
  it('returns block resolved by index when attribute is a number', () => {
    const { blok, blockManager } = createBlok();
    const block = {
      id: 'by-index',
    } as Block;

    blockManager.getBlockByIndex.mockReturnValue(block);

    const result = resolveBlock(2, blok);

    expect(blockManager.getBlockByIndex).toHaveBeenCalledWith(2);
    expect(blockManager.getBlockById).not.toHaveBeenCalled();
    expect(result).toBe(block);
  });

  it('returns block resolved by id when attribute is a string', () => {
    const { blok, blockManager } = createBlok();
    const block = {
      id: 'by-id',
    } as Block;

    blockManager.getBlockById.mockReturnValue(block);

    const result = resolveBlock('block-id', blok);

    expect(blockManager.getBlockById).toHaveBeenCalledWith('block-id');
    expect(blockManager.getBlockByIndex).not.toHaveBeenCalled();
    expect(result).toBe(block);
  });

  it('extracts id from BlockAPI instances and resolves via BlockManager', () => {
    const { blok, blockManager } = createBlok();
    const blockApi = {
      id: 'api-id',
    } as BlockAPI;
    const block = {
      id: 'resolved',
    } as Block;

    blockManager.getBlockById.mockReturnValue(block);

    const result = resolveBlock(blockApi, blok);

    expect(blockManager.getBlockById).toHaveBeenCalledWith('api-id');
    expect(blockManager.getBlockByIndex).not.toHaveBeenCalled();
    expect(result).toBe(block);
  });

  it('returns undefined when BlockManager fails to resolve numeric attribute', () => {
    const { blok, blockManager } = createBlok();

    blockManager.getBlockByIndex.mockReturnValue(undefined);

    const result = resolveBlock(99, blok);

    expect(blockManager.getBlockByIndex).toHaveBeenCalledWith(99);
    expect(result).toBeUndefined();
  });
});
