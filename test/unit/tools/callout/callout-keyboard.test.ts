// test/unit/tools/callout/callout-keyboard.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API } from '../../../../types';

const createMockAPI = (): API => ({
  blocks: {
    insertInsideParent: vi.fn().mockReturnValue({ id: 'new-block-id' }),
    convert: vi.fn(),
    getBlockIndex: vi.fn().mockReturnValue(0),
    getChildren: vi.fn().mockReturnValue([]),
  },
  caret: {
    setToBlock: vi.fn(),
    isAtStart: vi.fn().mockReturnValue(false),
  },
  events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  i18n: { t: (k: string) => k, has: vi.fn().mockReturnValue(false) },
} as unknown as API);

describe('handleCalloutEnter', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('inserts a child block and focuses it when Enter is pressed at end of text', async () => {
    const { handleCalloutEnter } = await import('../../../../src/tools/callout/callout-keyboard');
    const api = createMockAPI();
    const textElement = document.createElement('div');
    textElement.innerHTML = 'hello';

    await handleCalloutEnter({
      api,
      blockId: 'callout-id',
      data: { text: 'hello', emoji: '💡', color: 'default' },
      textElement,
    });

    expect(api.blocks.insertInsideParent).toHaveBeenCalledWith('callout-id', expect.any(Number));
    expect(api.caret.setToBlock).toHaveBeenCalledWith('new-block-id', 'start');
  });
});

describe('handleCalloutBackspace', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('converts to paragraph when text is empty and caret is at start', async () => {
    const { handleCalloutBackspace } = await import('../../../../src/tools/callout/callout-keyboard');
    const api = createMockAPI();
    (api.caret.isAtStart as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const textElement = document.createElement('div');
    textElement.innerHTML = '';
    const event = new KeyboardEvent('keydown', { key: 'Backspace' });
    const preventDefault = vi.spyOn(event, 'preventDefault');

    await handleCalloutBackspace({
      api,
      blockId: 'callout-id',
      data: { text: '', emoji: '💡', color: 'default' },
      textElement,
      event,
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(api.blocks.convert).toHaveBeenCalledWith('callout-id', 'paragraph');
  });

  it('does NOT convert when text is non-empty', async () => {
    const { handleCalloutBackspace } = await import('../../../../src/tools/callout/callout-keyboard');
    const api = createMockAPI();
    (api.caret.isAtStart as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const textElement = document.createElement('div');
    textElement.innerHTML = 'some text';
    const event = new KeyboardEvent('keydown', { key: 'Backspace' });

    await handleCalloutBackspace({
      api,
      blockId: 'callout-id',
      data: { text: 'some text', emoji: '💡', color: 'default' },
      textElement,
      event,
    });

    expect(api.blocks.convert).not.toHaveBeenCalled();
  });
});
