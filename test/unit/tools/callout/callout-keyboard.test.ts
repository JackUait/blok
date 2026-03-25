// test/unit/tools/callout/callout-keyboard.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API } from '../../../../types';

const createMockAPI = (childCount = 1): API => ({
  blocks: {
    insertInsideParent: vi.fn().mockReturnValue({ id: 'new-block-id', holder: document.createElement('div') }),
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
    const textElement = document.createElement('div');
    textElement.innerHTML = '';
    document.body.appendChild(textElement);

    // Place caret at offset 0 (start) in the empty element
    const range = document.createRange();
    range.setStart(textElement, 0);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

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
    document.body.removeChild(textElement);
  });

  it('does NOT convert when text is non-empty', async () => {
    const { handleCalloutBackspace } = await import('../../../../src/tools/callout/callout-keyboard');
    const api = createMockAPI();
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
