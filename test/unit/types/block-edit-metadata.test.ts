import { describe, it, expect } from 'vitest';
import type { OutputBlockData } from '../../../types/data-formats/output-data';
import type { BlokConfig } from '../../../types/configs/blok-config';

describe('Block edit metadata types', () => {
  it('OutputBlockData accepts lastEditedAt and lastEditedBy', () => {
    const block: OutputBlockData = {
      type: 'paragraph',
      data: { text: 'Hello' },
      lastEditedAt: 1712880000000,
      lastEditedBy: 'Jack Uait',
    };

    expect(block.lastEditedAt).toBe(1712880000000);
    expect(block.lastEditedBy).toBe('Jack Uait');
  });

  it('OutputBlockData works without metadata (backward compat)', () => {
    const block: OutputBlockData = {
      type: 'paragraph',
      data: { text: 'Hello' },
    };

    expect(block.lastEditedAt).toBeUndefined();
    expect(block.lastEditedBy).toBeUndefined();
  });

  it('BlokConfig accepts user option', () => {
    const config: BlokConfig = {
      user: { name: 'Jack Uait' },
    };

    expect(config.user?.name).toBe('Jack Uait');
  });

  it('BlokConfig works without user option (backward compat)', () => {
    const config: BlokConfig = {};

    expect(config.user).toBeUndefined();
  });
});
