// test/unit/tools/callout/callout-keyboard.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API } from '../../../../types';

const createMockAPI = (childCount = 1): API => ({
  blocks: {
    convert: vi.fn(),
    getBlockIndex: vi.fn().mockReturnValue(0),
    getChildren: vi.fn().mockReturnValue(Array.from({ length: childCount }, (_, i) => ({ id: `child-${i}` }))),
    delete: vi.fn(),
    getById: vi.fn(),
  },
  caret: {
    setToBlock: vi.fn(),
  },
  events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  i18n: { t: (k: string) => k, has: vi.fn().mockReturnValue(false) },
} as unknown as API);

describe('handleCalloutFirstChildBackspace', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('removes the callout when the first child is the only child', async () => {
    const { handleCalloutFirstChildBackspace } = await import('../../../../src/tools/callout/callout-keyboard');
    const api = createMockAPI(1);
    const event = new KeyboardEvent('keydown', { key: 'Backspace' });
    const preventDefault = vi.spyOn(event, 'preventDefault');

    await handleCalloutFirstChildBackspace({
      api,
      calloutBlockId: 'callout-id',
      firstChildBlockId: 'child-0',
      event,
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(api.blocks.convert).toHaveBeenCalledWith('callout-id', 'paragraph');
  });

  it('deletes the first child and moves caret before callout when other children exist', async () => {
    const { handleCalloutFirstChildBackspace } = await import('../../../../src/tools/callout/callout-keyboard');
    const api = createMockAPI(3);
    // Callout is at flat index 5, first child is at flat index 6
    (api.blocks.getBlockIndex as ReturnType<typeof vi.fn>)
      .mockImplementation((id: string) => (id === 'callout-id' ? 5 : 6));
    const event = new KeyboardEvent('keydown', { key: 'Backspace' });
    const preventDefault = vi.spyOn(event, 'preventDefault');

    await handleCalloutFirstChildBackspace({
      api,
      calloutBlockId: 'callout-id',
      firstChildBlockId: 'child-0',
      event,
    });

    expect(preventDefault).toHaveBeenCalled();
    // Should delete the first child block at its flat index
    expect(api.blocks.delete).toHaveBeenCalledWith(6);
    // Should set caret to the block before the callout (index 4 = calloutIndex - 1)
    expect(api.caret.setToBlock).toHaveBeenCalledWith(4, 'end');
  });

  it('does nothing when calloutBlockId is undefined', async () => {
    const { handleCalloutFirstChildBackspace } = await import('../../../../src/tools/callout/callout-keyboard');
    const api = createMockAPI(1);
    const event = new KeyboardEvent('keydown', { key: 'Backspace' });

    await handleCalloutFirstChildBackspace({
      api,
      calloutBlockId: undefined,
      firstChildBlockId: 'child-0',
      event,
    });

    expect(api.blocks.convert).not.toHaveBeenCalled();
    expect(api.blocks.delete).not.toHaveBeenCalled();
  });
});
