import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardNavigation } from '../../../../../../src/components/modules/blockEvents/composers/keyboardNavigation';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';
import type { Block } from '../../../../../../src/components/block';
import type { API } from '../../../../../../types';

const createKeyboardEvent = (options: Partial<KeyboardEvent> = {}): KeyboardEvent => {
  let defaultPrevented = false;
  const preventDefaultFn = vi.fn(() => {
    defaultPrevented = true;
  });

  const mockEvent = {
    keyCode: options.keyCode ?? 0,
    key: options.key ?? '',
    code: options.code ?? '',
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    altKey: options.altKey ?? false,
    shiftKey: options.shiftKey ?? false,
    target: options.target ?? null,
    get defaultPrevented() {
      return defaultPrevented;
    },
    preventDefault: preventDefaultFn,
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    ...options,
  };

  return mockEvent as unknown as KeyboardEvent;
};

const createBlock = (overrides: Partial<Block> = {}): Block => {
  const input = document.createElement('div');
  input.contentEditable = 'true';
  input.textContent = '';

  const holder = document.createElement('div');
  holder.appendChild(input);

  return {
    id: 'test-block',
    name: 'paragraph',
    parentId: null,
    holder,
    currentInput: input,
    inputs: [input],
    firstInput: input,
    lastInput: input,
    tool: {
      isDefault: true,
      isLineBreaksEnabled: false,
      name: 'paragraph',
    },
    isEmpty: false,
    hasMedia: false,
    mergeable: true,
    updateCurrentInput: vi.fn(),
    save: vi.fn(() => Promise.resolve({})),
    render: vi.fn(),
    ...overrides,
  } as unknown as Block;
};

const apiMethods = { blocks: {} } as unknown as API;

const createModules = (options: {
  currentBlock?: Block | undefined;
  someToolbarOpened?: boolean;
  someFlipperButtonFocused?: boolean;
  savedData?: unknown;
} = {}): {
  blok: BlokModules;
  split: ReturnType<typeof vi.fn>;
  insertDefaultBlockAtIndex: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
} => {
  const mockBlock = 'currentBlock' in options ? options.currentBlock : createBlock();
  const insertedBlock = createBlock({ id: 'inserted-block' });
  const split = vi.fn(() => insertedBlock);
  const insertDefaultBlockAtIndex = vi.fn(() => insertedBlock);
  const save = vi.fn().mockResolvedValue(options.savedData ?? { blocks: [] });

  const blok = {
    Saver: {
      save,
    },
    BlockManager: {
      currentBlock: mockBlock,
      blocks: mockBlock === undefined ? [] : [mockBlock],
      currentBlockIndex: 0,
      split,
      insertDefaultBlockAtIndex,
      setBlockParent: vi.fn(),
      transactForTool: vi.fn((fn: () => void) => fn()),
    },
    Caret: {
      positions: { START: 'start', END: 'end', DEFAULT: 'default' },
      setToBlock: vi.fn(),
    },
    Toolbar: {
      moveAndOpen: vi.fn(),
    },
    UI: {
      someToolbarOpened: options.someToolbarOpened ?? false,
      someFlipperButtonFocused: options.someFlipperButtonFocused ?? false,
      isRtl: false,
    },
    YjsManager: {
      stopCapturing: vi.fn(),
      markCaretBeforeChange: vi.fn(),
      updateLastCaretAfterPosition: vi.fn(),
    },
    API: {
      methods: apiMethods,
    },
  } as unknown as BlokModules;

  return { blok, split, insertDefaultBlockAtIndex, save };
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('KeyboardNavigation — config.onEnter hook', () => {
  it('calls onEnter once with (event, api) and suppresses the default split when it returns true', () => {
    const onEnter = vi.fn(() => true);
    const { blok, split, insertDefaultBlockAtIndex } = createModules();
    const keyboardNavigation = new KeyboardNavigation(blok, () => onEnter);
    const event = createKeyboardEvent({ key: 'Enter' });

    keyboardNavigation.handleEnter(event);

    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(onEnter).toHaveBeenCalledWith(event, apiMethods);
    // No block was created or split
    expect(split).not.toHaveBeenCalled();
    expect(insertDefaultBlockAtIndex).not.toHaveBeenCalled();
    // blok still prevents the browser's native newline
    expect(event.defaultPrevented).toBe(true);
  });

  it('keeps the default split behavior when onEnter returns undefined', () => {
    const onEnter = vi.fn(() => undefined);
    const { blok, split, insertDefaultBlockAtIndex } = createModules();
    const keyboardNavigation = new KeyboardNavigation(blok, () => onEnter);
    const event = createKeyboardEvent({ key: 'Enter' });

    keyboardNavigation.handleEnter(event);

    expect(onEnter).toHaveBeenCalledTimes(1);
    const blockOperationCalled = split.mock.calls.length > 0 || insertDefaultBlockAtIndex.mock.calls.length > 0;
    expect(blockOperationCalled).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it('never calls onEnter for Shift+Enter (soft line break stays native)', () => {
    const onEnter = vi.fn(() => true);
    const { blok } = createModules();
    const keyboardNavigation = new KeyboardNavigation(blok, () => onEnter);
    const event = createKeyboardEvent({ key: 'Enter', shiftKey: true });

    keyboardNavigation.handleEnter(event);

    expect(onEnter).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('never calls onEnter (and does not split) while an IME composition is active', () => {
    const onEnter = vi.fn(() => true);
    const { blok, split, insertDefaultBlockAtIndex } = createModules();
    const keyboardNavigation = new KeyboardNavigation(blok, () => onEnter);
    // Enter pressed to commit an IME candidate: the browser fires keydown with
    // isComposing=true. Blok must not treat this as a block command.
    const event = createKeyboardEvent({ key: 'Enter', isComposing: true });

    keyboardNavigation.handleEnter(event);

    expect(onEnter).not.toHaveBeenCalled();
    expect(split).not.toHaveBeenCalled();
    expect(insertDefaultBlockAtIndex).not.toHaveBeenCalled();
    // Blok must NOT preventDefault — the browser needs to commit the composition
    expect(event.defaultPrevented).toBe(false);
  });

  it('never calls onEnter while a toolbar flipper owns Enter', () => {
    const onEnter = vi.fn(() => true);
    const { blok } = createModules({ someToolbarOpened: true, someFlipperButtonFocused: true });
    const keyboardNavigation = new KeyboardNavigation(blok, () => onEnter);
    const event = createKeyboardEvent({ key: 'Enter' });

    keyboardNavigation.handleEnter(event);

    expect(onEnter).not.toHaveBeenCalled();
  });

  it('never calls onEnter for tools with enableLineBreaks', () => {
    const onEnter = vi.fn(() => true);
    const codeBlock = createBlock({
      tool: {
        isLineBreaksEnabled: true,
        isDefault: false,
        name: 'code',
      } as unknown as Block['tool'],
    });
    const { blok } = createModules({ currentBlock: codeBlock });
    const keyboardNavigation = new KeyboardNavigation(blok, () => onEnter);
    const event = createKeyboardEvent({ key: 'Enter' });

    keyboardNavigation.handleEnter(event);

    expect(onEnter).not.toHaveBeenCalled();
  });
});

describe('KeyboardNavigation — config.onSubmit hook', () => {
  it('serializes the doc and calls onSubmit with (data, api), suppressing the default split', async () => {
    const saved = { blocks: [{ id: 'b1', type: 'paragraph', data: { text: 'hi' } }] };
    const onSubmit = vi.fn();
    const { blok, split, insertDefaultBlockAtIndex, save } = createModules({ savedData: saved });
    const keyboardNavigation = new KeyboardNavigation(blok, () => undefined, () => onSubmit);
    const event = createKeyboardEvent({ key: 'Enter' });

    keyboardNavigation.handleEnter(event);
    await Promise.resolve();
    await Promise.resolve();

    expect(save).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(saved, apiMethods);
    // No block was created or split — Enter submits, it does not insert a line
    expect(split).not.toHaveBeenCalled();
    expect(insertDefaultBlockAtIndex).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('lets onEnter take precedence: a handled onEnter suppresses onSubmit', async () => {
    const onEnter = vi.fn(() => true);
    const onSubmit = vi.fn();
    const { blok, save } = createModules();
    const keyboardNavigation = new KeyboardNavigation(blok, () => onEnter, () => onSubmit);
    const event = createKeyboardEvent({ key: 'Enter' });

    keyboardNavigation.handleEnter(event);
    await Promise.resolve();
    await Promise.resolve();

    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('never calls onSubmit for Shift+Enter (soft line break stays native)', async () => {
    const onSubmit = vi.fn();
    const { blok, save } = createModules();
    const keyboardNavigation = new KeyboardNavigation(blok, () => undefined, () => onSubmit);
    const event = createKeyboardEvent({ key: 'Enter', shiftKey: true });

    keyboardNavigation.handleEnter(event);
    await Promise.resolve();

    expect(save).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('never calls onSubmit while an IME composition is active', async () => {
    const onSubmit = vi.fn();
    const { blok, save } = createModules();
    const keyboardNavigation = new KeyboardNavigation(blok, () => undefined, () => onSubmit);
    const event = createKeyboardEvent({ key: 'Enter', isComposing: true });

    keyboardNavigation.handleEnter(event);
    await Promise.resolve();

    expect(save).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('runs the default split when neither onEnter nor onSubmit is configured', () => {
    const { blok, split, insertDefaultBlockAtIndex } = createModules();
    const keyboardNavigation = new KeyboardNavigation(blok);
    const event = createKeyboardEvent({ key: 'Enter' });

    keyboardNavigation.handleEnter(event);

    const blockOperationCalled = split.mock.calls.length > 0 || insertDefaultBlockAtIndex.mock.calls.length > 0;
    expect(blockOperationCalled).toBe(true);
  });
});
