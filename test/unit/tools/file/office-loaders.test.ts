import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const openDeck = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/tools/file/pptx/viewer', () => ({ openDeck }));

import { loadPptxRenderer } from '../../../../src/tools/file/office-loaders';

describe('loadPptxRenderer', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('opens the deck with the in-house viewer', async () => {
    const deck = { destroy: vi.fn() };

    openDeck.mockResolvedValue(deck);
    const { open } = await loadPptxRenderer();
    const buf = new ArrayBuffer(8);
    const container = document.createElement('div');

    await expect(open(buf, container)).resolves.toBe(deck);
    expect(openDeck).toHaveBeenCalledWith(buf, container);
  });
});
