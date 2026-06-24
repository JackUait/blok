import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BlockManager } from '../../../../../src/components/modules/blockManager/blockManager';

describe('BlockManager.setPlaceholder', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  const makeManager = () => {
    const blockA = { setPlaceholder: vi.fn() };
    const blockB = { setPlaceholder: vi.fn() };
    const setDefaultPlaceholder = vi.fn();
    const config: { placeholder?: string | false; defaultBlock?: string } = {
      placeholder: 'Old',
      defaultBlock: 'paragraph',
    };

    const manager = Object.create(BlockManager.prototype) as BlockManager;
    Object.defineProperty(manager, 'blocks', { get: () => [blockA, blockB], configurable: true });
    Object.defineProperty(manager, 'config', { get: () => config, configurable: true });
    Object.defineProperty(manager, 'Blok', {
      get: () => ({ Tools: { blockTools: { get: () => ({ setDefaultPlaceholder }) } } }),
      configurable: true,
    });

    return { manager, blockA, blockB, setDefaultPlaceholder, config };
  };

  it('updates config, the default adapter, and every existing block', () => {
    const { manager, blockA, blockB, setDefaultPlaceholder, config } = makeManager();

    manager.setPlaceholder('New');

    expect(config.placeholder).toBe('New');
    expect(setDefaultPlaceholder).toHaveBeenCalledWith('New');
    expect(blockA.setPlaceholder).toHaveBeenCalledWith('New');
    expect(blockB.setPlaceholder).toHaveBeenCalledWith('New');
  });

  it('propagates false to clear the placeholder', () => {
    const { manager, blockA, setDefaultPlaceholder, config } = makeManager();

    manager.setPlaceholder(false);

    expect(config.placeholder).toBe(false);
    expect(setDefaultPlaceholder).toHaveBeenCalledWith(false);
    expect(blockA.setPlaceholder).toHaveBeenCalledWith(false);
  });
});
