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
  let caret: { setToInput: ReturnType<typeof vi.fn>; setToBlock: ReturnType<typeof vi.fn>; positions: { START: string; DEFAULT: string } };

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

    caret = { setToInput: vi.fn(), setToBlock: vi.fn(), positions: { START: 'start', DEFAULT: 'default' } };
    history = new UndoHistory([yblocks as unknown as UndoScopeType], {
      BlockManager: blockManager,
      BlockSelection: { clearSelection: vi.fn() },
      Caret: caret,
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

  describe('typing window (Notion RM1, RM2, RM5)', () => {
    /** One key: its keydown gesture, then its write. */
    const typeKeyAt = (ms: number, id: string): void => {
      vi.setSystemTime(ms);
      history.beginGesture('typing');
      write(id);
    };

    beforeEach(() => {
      vi.useFakeTimers();
      putCaret(blocks[0], 2);
    });

    it('keeps a key 704 ms after the step\'s first key and cuts one at 712 ms (U013)', () => {
      typeKeyAt(0, 'w');
      typeKeyAt(704, 'l');
      typeKeyAt(712, 'd');

      expect(undoSteps()).toBe(2);
    });

    it('measures from the step\'s first key, not the last, so steady typing cuts mid-word (RM1-3)', () => {
      typeKeyAt(0, 'a');
      typeKeyAt(300, 'b');
      typeKeyAt(600, 'c');
      typeKeyAt(900, 'd');

      expect(undoSteps()).toBe(2);
    });

    it('starts the next window at the key that cut', () => {
      typeKeyAt(0, 'a');
      typeKeyAt(800, 'b');
      typeKeyAt(1400, 'c');
      typeKeyAt(1600, 'd');

      expect(undoSteps()).toBe(3);
    });

    it('does not cut a pause shorter than the window, after a space or "." (U008, U029)', () => {
      typeKeyAt(0, 'one');
      typeKeyAt(20, 'space');
      typeKeyAt(330, 't');
      typeKeyAt(340, 'dot');
      typeKeyAt(650, 'n');

      expect(undoSteps()).toBe(1);
    });

    it('does not cut while a hold is on (IME, open menu, drag)', () => {
      typeKeyAt(0, 'a');
      history.holdCapture();
      typeKeyAt(2000, 'b');
      history.releaseCapture();

      expect(undoSteps()).toBe(1);
    });

    it('starts a fresh window at the first key after a sub-step', () => {
      typeKeyAt(0, 'a');
      vi.setSystemTime(500);
      history.startSubStep();
      write('converted');
      typeKeyAt(600, 'b');
      typeKeyAt(1200, 'c');

      expect(undoSteps()).toBe(3);
    });

    it('lets the undo manager merge a 704 ms pause the window keeps (U013)', () => {
      typeKeyAt(0, 'w');
      // lib0 reads Date.now at import time, so fake timers cannot age the step.
      history.undoManager.lastChange -= 704;
      typeKeyAt(704, 'l');

      expect(undoSteps()).toBe(1);
    });
  });

  describe('splits, soft breaks and merges inside the window (Notion U032, U044, U098, U101)', () => {
    const at = (ms: number, kind: 'typing' | 'split' | 'merge', id: string): void => {
      vi.setSystemTime(ms);
      history.beginGesture(kind);
      write(id);
    };

    beforeEach(() => {
      vi.useFakeTimers();
      putCaret(blocks[0], 2);
    });

    it('makes fast Enters one step, with the first Enter\'s caret as caret-before (U044)', () => {
      at(0, 'split', 's1');
      putCaret(blocks[1], 0);
      at(200, 'split', 's2');
      putCaret(blocks[1], 3);
      at(400, 'split', 's3');

      expect(undoSteps()).toBe(1);
      expect(caretStack().at(-1)?.before).toEqual({ blockId: 'a', inputIndex: 0, offset: 2 });
    });

    it('keeps the first Enter\'s caret-before when its write lands after the next Enter starts', () => {
      vi.setSystemTime(0);
      history.beginGesture('split');
      putCaret(blocks[1], 0);
      vi.setSystemTime(100);
      history.beginGesture('split');
      write('s1');

      expect(caretStack().at(-1)?.before).toEqual({ blockId: 'a', inputIndex: 0, offset: 2 });
    });

    it('cuts an Enter that comes after the window', () => {
      at(0, 'split', 's1');
      at(712, 'split', 's2');

      expect(undoSteps()).toBe(2);
    });

    it('keeps typing, Enter and typing three steps however fast (U033)', () => {
      at(0, 'typing', 'one');
      at(100, 'split', 's');
      putCaret(blocks[1], 0);
      at(150, 'typing', 'two');

      expect(undoSteps()).toBe(3);
    });

    it('lets a Backspace merge join the typing before it in the same input (U101)', () => {
      at(0, 'typing', 'X');
      putCaret(blocks[0], 0);
      at(150, 'merge', 'm');

      expect(undoSteps()).toBe(1);
      expect(caretStack().at(-1)?.before).toEqual({ blockId: 'a', inputIndex: 0, offset: 2 });
    });

    it('lets typing in the block a merge landed in join the merge (U098)', () => {
      putCaret(blocks[1], 0);
      at(0, 'merge', 'm');
      putCaret(blocks[0], 4);
      at(300, 'typing', 'bs');
      at(400, 'merge', 'm2');

      expect(undoSteps()).toBe(1);
      expect(caretStack().at(-1)?.before).toEqual({ blockId: 'b', inputIndex: 0, offset: 0 });
    });

    it('cuts a merge after the window, after typing in another input, or after an Enter', () => {
      at(0, 'typing', 'a');
      at(712, 'merge', 'late');
      putCaret(blocks[1], 1);
      at(1500, 'typing', 'b');
      putCaret(blocks[0], 0);
      at(1550, 'merge', 'other');
      at(2300, 'split', 's');
      at(2350, 'merge', 'after-split');

      expect(undoSteps()).toBe(6);
    });
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

  it('keeps a hold through clear() until every holder has released', () => {
    history.holdCapture();
    history.holdCapture();
    history.clear();
    history.releaseCapture();

    expect(history.undoManager.captureTimeout).toBe(Infinity);

    history.releaseCapture();

    expect(history.undoManager.captureTimeout).not.toBe(Infinity);
  });

  it('keeps a hold on the undo manager a scope rebind builds', () => {
    history.holdCapture();
    history.rebindScope([new Y.Doc().getArray('blocks') as unknown as UndoScopeType]);

    expect(history.undoManager.captureTimeout).toBe(Infinity);
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

  it('keeps an API call during a held gesture in that gesture', async () => {
    putCaret(blocks[0], 2);
    history.beginGesture('discrete');
    history.holdCapture();
    write('x');
    await new Promise((resolve) => setTimeout(resolve, 0));
    history.beginApiCall();
    write('y');

    expect(undoSteps()).toBe(1);
  });

  // The block menu lets go of its hold while the picked tool is still
  // inserting (a column_list seeding its columns).
  it('keeps the rest of the task in the gesture when a hold ends mid-call', async () => {
    putCaret(blocks[0], 2);
    history.beginGesture('discrete');
    history.holdCapture();
    write('x');
    await new Promise((resolve) => setTimeout(resolve, 0));
    history.beginApiCall();
    write('y');
    history.releaseCapture();
    history.beginApiCall();
    write('z');

    expect(undoSteps()).toBe(1);
  });

  it('makes an API call in a later task its own step once the hold has ended', async () => {
    putCaret(blocks[0], 2);
    history.beginGesture('discrete');
    history.holdCapture();
    write('x');
    await new Promise((resolve) => setTimeout(resolve, 0));
    history.beginApiCall();
    history.releaseCapture();
    await new Promise((resolve) => setTimeout(resolve, 0));
    history.beginApiCall();
    write('y');

    expect(undoSteps()).toBe(2);
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

  describe('tracked value edits', () => {
    it('one typing run in a value is one step, even when its first write joins a gesture still open', () => {
      vi.useFakeTimers();
      putCaret(blocks[0], 2);
      history.beginGesture('discrete');
      history.beginValueEdit('title', true);
      write('t1');
      vi.advanceTimersByTime(1);
      history.beginValueEdit('title', true);
      write('t2');

      expect(undoSteps()).toBe(1);
    });

    it('typing in a value after typing in a block is a new step', () => {
      vi.useFakeTimers();
      putCaret(blocks[0], 2);
      history.beginGesture('typing');
      write('x');
      vi.advanceTimersByTime(1);
      window.getSelection()?.removeAllRanges();
      history.beginValueEdit('title', true);
      write('t1');

      expect(undoSteps()).toBe(2);
    });

    it('typing in another value is a new step', () => {
      vi.useFakeTimers();
      history.beginValueEdit('title', true);
      write('t1');
      vi.advanceTimersByTime(1);
      history.beginValueEdit('subtitle', true);
      write('s1');

      expect(undoSteps()).toBe(2);
    });

    it('undo of a value step made outside the editor leaves the caret to the host', () => {
      vi.useFakeTimers();
      // The click into the host title starts a gesture while the caret is still in the block.
      putCaret(blocks[0], 2);
      history.beginGesture('discrete');
      window.getSelection()?.removeAllRanges();
      history.beginValueEdit('title', true);
      write('t1');
      history.undo();

      expect(caret.setToInput).not.toHaveBeenCalled();
    });

    it('undo of a value write made with the caret in a block puts the caret back in the block', () => {
      vi.useFakeTimers();
      putCaret(blocks[0], 0);
      history.beginGesture('discrete');
      history.beginValueEdit('title', false);
      write('merged');
      history.undo();

      expect(caret.setToInput).toHaveBeenCalledWith(blocks[0].inputs[0], 'default', 0);
    });

    it('a discrete value write closes the typing run in that value', () => {
      vi.useFakeTimers();
      history.beginValueEdit('title', true);
      write('t1');
      vi.advanceTimersByTime(1);
      history.beginValueEdit('title', false);
      write('t2');

      expect(undoSteps()).toBe(2);
    });
  });
});
