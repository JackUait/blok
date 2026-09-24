import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { UndoHistory } from '../../../../../src/components/modules/yjs/undo-history';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { UndoScopeType } from '../../../../../src/components/modules/yjs/types';

describe('UndoHistory.addToStepThatWrote', () => {
  let history: UndoHistory;
  let ydoc: Y.Doc;
  let yblocks: Y.Array<Y.Map<unknown>>;
  let data: Y.Map<unknown>;

  const edit = (fn: () => void): void => {
    history.beginGesture('discrete');
    ydoc.transact(fn, 'local');
  };

  const land = (key: string, value: unknown, from?: string[]): void => {
    history.addToStepThatWrote(data, () => ydoc.transact(() => data.set(key, value), 'no-capture'), from);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    ydoc = new Y.Doc();
    yblocks = ydoc.getArray('blocks');
    history = new UndoHistory([yblocks as unknown as UndoScopeType], {
      BlockManager: { currentBlock: undefined, getBlockById: () => undefined, getBlockByChildNode: () => undefined, setCurrentBlockByChildNode: vi.fn() },
      BlockSelection: { clearSelection: vi.fn() },
      Caret: { setToInput: vi.fn(), setToBlock: vi.fn(), positions: { START: 'start', DEFAULT: 'default' } },
    } as unknown as BlokModules);
    data = new Y.Map<unknown>();
    edit(() => {
      const block = new Y.Map<unknown>();

      block.set('data', data);
      yblocks.push([block]);
      data.set('url', '');
    });
  });

  afterEach(() => {
    history.destroy();
    vi.restoreAllMocks();
  });

  it('joins the step that wrote the named key, not a later edit of the block', () => {
    edit(() => data.set('fileName', 'a.png'));
    edit(() => data.set('width', 300));
    land('url', 'https://cdn/a.png', ['fileName']);

    history.undo();

    expect(data.get('width')).toBeUndefined();
    expect(data.get('url')).toBe('https://cdn/a.png');
    history.undo();
    expect(data.get('fileName')).toBeUndefined();
    expect(data.get('url')).toBe('');
    history.redo();
    expect(data.get('url')).toBe('https://cdn/a.png');
  });

  it('adds no step and keeps redo', () => {
    edit(() => data.set('fileName', 'a.png'));
    edit(() => data.set('width', 300));
    history.undo();
    const steps = history.undoManager.undoStack.length;

    land('url', 'https://cdn/a.png', ['fileName']);

    expect(history.undoManager.undoStack).toHaveLength(steps);
    expect(history.canRedo()).toBe(true);
  });

  it('joins no step when the step that wrote the key was undone', () => {
    edit(() => data.set('fileName', 'a.png'));
    history.undo();

    land('url', 'https://cdn/a.png', ['fileName']);
    const written = data._map.get('url')?.id;

    expect(written).toBeDefined();
    expect(history.undoManager.undoStack.some((step) => written !== undefined && Y.isDeleted(step.insertions, written))).toBe(false);
  });

  it('writes untracked without named keys', () => {
    edit(() => data.set('fileName', 'a.png'));
    land('url', 'https://cdn/a.png');

    history.undo();

    expect(data.get('fileName')).toBeUndefined();
    expect(data.get('url')).toBe('https://cdn/a.png');
  });

  it('does not let an API call inside the write start a step', () => {
    edit(() => data.set('fileName', 'a.png'));
    const steps = history.undoManager.undoStack.length;

    history.addToStepThatWrote(data, () => {
      history.beginApiCall();
      ydoc.transact(() => data.set('url', 'https://cdn/a.png'), 'no-capture');
    }, ['fileName']);
    edit(() => data.set('width', 300));

    expect(history.undoManager.undoStack).toHaveLength(steps + 1);
    history.undo();
    history.undo();
    expect(data.get('url')).toBe('');
  });
  it('drops the step when the joined write puts every value it wrote back', () => {
    edit(() => data.set('text', 'a'));
    edit(() => data.set('url', 'https://example.com/a.png'));
    const block = yblocks.get(0);

    history.addToStepThatWrote(data, () => ydoc.transact(() => {
      data.set('url', '');
      block.set('lastEditedAt', 2);
    }, 'no-capture'), ['url']);

    expect(data.get('url')).toBe('');
    history.undo();
    expect(data.get('text')).toBeUndefined();
    expect(data.get('url')).toBe('');
    history.redo();
    expect(data.get('text')).toBe('a');
    expect(history.canRedo()).toBe(false);
  });

  it('keeps redo when it drops the step', () => {
    edit(() => data.set('url', 'https://example.com/a.png'));
    edit(() => data.set('text', 'a'));
    history.undo();

    land('url', '', ['url']);

    expect(history.canRedo()).toBe(true);
    history.redo();
    expect(data.get('text')).toBe('a');
    expect(data.get('url')).toBe('');
  });

  it('keeps the step when the joined write leaves a change in it', () => {
    edit(() => {
      data.set('url', 'https://example.com/a.png');
      data.set('text', 'a');
    });
    land('url', '', ['url']);

    history.undo();

    expect(data.get('text')).toBeUndefined();
    expect(data.get('url')).toBe('');
  });
});
