import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { UndoHistory } from '../../../../../src/components/modules/yjs/undo-history';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { CaretHistoryEntry, UndoScopeType } from '../../../../../src/components/modules/yjs/types';

interface FakeBlock {
  id: string;
  inputs: HTMLElement[];
  currentInputIndex: number;
  currentInput: HTMLElement;
}

const makeBlock = (id: string, text: string): FakeBlock => {
  const input = document.createElement('div');

  input.contentEditable = 'true';
  input.textContent = text;
  document.body.appendChild(input);

  return { id, inputs: [input], currentInputIndex: 0, currentInput: input };
};

const putCaret = (block: FakeBlock, offset: number): void => {
  const text = block.inputs[0].firstChild;

  if (text === null) {
    throw new Error('empty input');
  }
  window.getSelection()?.collapse(text, offset);
};

describe('UndoHistory gestures', () => {
  let history: UndoHistory;
  let ydoc: Y.Doc;
  let yblocks: Y.Array<Y.Map<unknown>>;
  let blocks: FakeBlock[];

  const write = (id: string): void => {
    ydoc.transact(() => {
      const yblock = new Y.Map<unknown>();

      yblock.set('id', id);
      yblocks.push([yblock]);
    }, 'local');
  };

  const undoSteps = (): number => history.undoManager.undoStack.length;
  const caretStack = (): CaretHistoryEntry[] =>
    (history as unknown as { caretUndoStack: CaretHistoryEntry[] }).caretUndoStack;

  beforeEach(() => {
    vi.clearAllMocks();
    blocks = [makeBlock('a', 'Alpha one'), makeBlock('b', 'Bravo two')];
    ydoc = new Y.Doc();
    yblocks = ydoc.getArray('blocks');

    const blockManager = {
      currentBlock: undefined,
      getBlockById: (id: string) => blocks.find((block) => block.id === id),
      getBlockByChildNode: (node: Node) => blocks.find((block) => block.inputs[0].contains(node)),
      setCurrentBlockByChildNode: vi.fn(),
    };

    history = new UndoHistory([yblocks as unknown as UndoScopeType], {
      BlockManager: blockManager,
      BlockSelection: { clearSelection: vi.fn() },
      Caret: { setToInput: vi.fn(), setToBlock: vi.fn(), positions: { START: 'start', DEFAULT: 'default' } },
    } as unknown as BlokModules);
  });

  afterEach(() => {
    history.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('keeps an implicit stopCapturing as a split while no gesture has started', () => {
    write('x');
    history.stopCapturing();
    write('y');

    expect(undoSteps()).toBe(2);
  });

  it('does not let an implicit stopCapturing split a gesture', () => {
    putCaret(blocks[0], 2);
    history.beginGesture('discrete');
    write('x');
    history.stopCapturing();
    write('y');

    expect(undoSteps()).toBe(1);
  });

  it('flushes buffered writes on an implicit stopCapturing inside a gesture', () => {
    const flush = vi.fn();

    history.setFlushPendingWritesHook(flush);
    history.beginGesture('discrete');
    history.stopCapturing();

    expect(flush).toHaveBeenCalled();
  });

  it('closes the open step when a discrete gesture starts, even inside the capture window', () => {
    putCaret(blocks[0], 2);
    history.beginGesture('typing');
    write('x');
    history.beginGesture('discrete');
    write('y');

    expect(undoSteps()).toBe(2);
  });

  it('lets typing in the same input continue the typing step', () => {
    putCaret(blocks[0], 2);
    history.beginGesture('typing');
    write('x');
    putCaret(blocks[0], 3);
    history.beginGesture('typing');
    write('y');

    expect(undoSteps()).toBe(1);
  });

  it('closes the typing step when typing moves to another input', () => {
    putCaret(blocks[0], 2);
    history.beginGesture('typing');
    write('x');
    putCaret(blocks[1], 1);
    history.beginGesture('typing');
    write('y');

    expect(undoSteps()).toBe(2);
  });

  it('closes a discrete step when typing starts after it', () => {
    putCaret(blocks[0], 2);
    history.beginGesture('discrete');
    write('x');
    history.beginGesture('typing');
    write('y');

    expect(undoSteps()).toBe(2);
  });

  it('records the caret at the gesture start as the step caret-before', () => {
    putCaret(blocks[1], 3);
    history.beginGesture('discrete');
    putCaret(blocks[0], 1);
    write('x');

    expect(caretStack().at(-1)?.before).toEqual({ blockId: 'b', inputIndex: 0, offset: 3 });
  });

  it('keeps the pending caret-before when a gesture starts outside every block', () => {
    putCaret(blocks[1], 3);
    history.beginGesture('discrete');
    window.getSelection()?.removeAllRanges();
    history.beginGesture('discrete');
    write('x');

    expect(caretStack().at(-1)?.before).toEqual({ blockId: 'b', inputIndex: 0, offset: 3 });
  });

  it('drops a pending caret-before once the caret moves to another block', () => {
    putCaret(blocks[0], 0);
    history.markCaretBeforeChange(true);
    putCaret(blocks[1], 3);
    document.dispatchEvent(new Event('selectionchange'));
    history.markCaretBeforeChange();
    write('x');

    expect(caretStack().at(-1)?.before?.blockId).toBe('b');
  });

  it('sets the caret-after of the previous step to where the next gesture starts', () => {
    putCaret(blocks[0], 2);
    history.beginGesture('discrete');
    write('x');
    putCaret(blocks[1], 4);
    history.beginGesture('discrete');

    expect(caretStack().at(-1)?.after).toEqual({ blockId: 'b', inputIndex: 0, offset: 4 });
  });

  it('keeps splitting on the word-boundary timer after gestures started', () => {
    vi.useFakeTimers();
    putCaret(blocks[0], 2);
    history.beginGesture('typing');
    write('x');
    history.markBoundary();
    vi.advanceTimersByTime(150);
    write('y');

    expect(undoSteps()).toBe(2);
  });

  it('startSubStep splits and keeps the caret from before its flush as caret-before', () => {
    putCaret(blocks[0], 2);
    history.beginGesture('typing');
    write('x');
    putCaret(blocks[0], 5);
    history.setFlushPendingWritesHook(() => write('buffered'));
    history.startSubStep();
    history.setFlushPendingWritesHook(() => undefined);
    putCaret(blocks[0], 1);
    write('y');

    expect(undoSteps()).toBe(2);
    expect(caretStack().at(-1)?.before).toEqual({ blockId: 'a', inputIndex: 0, offset: 5 });
  });

  it('ends the typing run at a sub-step, so the next keystroke starts a new step', () => {
    putCaret(blocks[0], 2);
    history.beginGesture('typing');
    write('x');
    history.startSubStep();
    write('converted');
    history.beginGesture('typing');
    write('y');

    expect(undoSteps()).toBe(3);
  });

  it('holds one step open past the capture window until released', () => {
    // lib0 reads Date.now at import time, so fake timers cannot age the step.
    const ageStep = (): void => {
      history.undoManager.lastChange -= 2000;
    };

    putCaret(blocks[0], 2);
    history.beginGesture('discrete');
    history.holdCapture();
    write('x');
    ageStep();
    write('y');
    history.releaseCapture();
    ageStep();
    write('z');

    expect(undoSteps()).toBe(2);
  });

  it('makes an API call outside a gesture task its own step', async () => {
    putCaret(blocks[0], 2);
    history.beginGesture('typing');
    write('x');
    await new Promise((resolve) => setTimeout(resolve, 0));
    history.beginApiCall();
    write('y');

    expect(undoSteps()).toBe(2);
  });

  it('keeps an API call inside a gesture task in that gesture', async () => {
    putCaret(blocks[0], 2);
    history.beginGesture('discrete');
    write('x');
    await Promise.resolve();
    history.beginApiCall();
    write('y');

    expect(undoSteps()).toBe(1);
  });

  it('clears a pending caret-before after an undo', () => {
    putCaret(blocks[0], 2);
    history.beginGesture('discrete');
    write('x');
    putCaret(blocks[1], 4);
    history.beginGesture('discrete');
    history.undo();
    window.getSelection()?.removeAllRanges();
    write('y');

    expect(caretStack().at(-1)?.before).toBeNull();
  });
});
