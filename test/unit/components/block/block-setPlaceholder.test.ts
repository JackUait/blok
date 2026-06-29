import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Block } from '../../../../src/components/block';

describe('Block.setPlaceholder delegation', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('delegates to toolInstance.setPlaceholder when implemented', () => {
    const setPlaceholder = vi.fn();
    const block = Object.create(Block.prototype) as Block;

    Object.defineProperty(block, 'toolInstance', {
      value: { setPlaceholder },
      configurable: true,
    });

    block.setPlaceholder('Hello');
    expect(setPlaceholder).toHaveBeenCalledWith('Hello');
  });

  it('propagates false to the tool', () => {
    const setPlaceholder = vi.fn();
    const block = Object.create(Block.prototype) as Block;

    Object.defineProperty(block, 'toolInstance', {
      value: { setPlaceholder },
      configurable: true,
    });

    block.setPlaceholder(false);
    expect(setPlaceholder).toHaveBeenCalledWith(false);
  });

  it('is a no-op when the tool does not implement setPlaceholder', () => {
    const block = Object.create(Block.prototype) as Block;

    Object.defineProperty(block, 'toolInstance', {
      value: {},
      configurable: true,
    });

    expect(() => block.setPlaceholder('x')).not.toThrow();
  });
});
