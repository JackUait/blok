import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const announceMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/components/utils/announcer', () => ({ announce: announceMock }));

import type { Block } from '../../../../src/components/block';
import { deleteWithTrashToast, showTrashToast, trashesBlock } from '../../../../src/components/utils/trash-toast';
import type { HistoryStep } from '../../../../types/api/history';
import type { NotifierOptions } from '../../../../types/configs/notifier';

type Modules = Parameters<typeof showTrashToast>[0];

interface Harness {
  modules: Modules;
  shown: NotifierOptions[];
  undoStep: ReturnType<typeof vi.fn>;
  dismiss: ReturnType<typeof vi.fn>;
  undone: Set<unknown>;
  closed: Set<NotifierOptions>;
  beforeStep: Set<() => void>;
}

const makeModules = (steps: Array<HistoryStep | Record<string, unknown> | undefined>): Harness => {
  const shown: NotifierOptions[] = [];
  const undone = new Set<unknown>();
  const closed = new Set<NotifierOptions>();
  const beforeStep = new Set<() => void>();
  const undoStep = vi.fn(() => true);
  const dismiss = vi.fn();
  const latestStep = vi.fn(() => steps.shift());
  const modules = {
    HistoryAPI: { latestStep, undoStep, isStepUndone: (step: unknown) => undone.has(step) },
    NotifierAPI: { show: (options: NotifierOptions) => shown.push(options), dismiss, isClosed: (options: NotifierOptions) => closed.has(options) },
    YjsManager: {
      onBeforeUserStep: (listener: () => void) => {
        beforeStep.add(listener);

        return () => beforeStep.delete(listener);
      },
    },
    // A method that reads `this`, like the real I18n: an unbound call throws.
    I18n: {
      words: { 'tools.database.movedToTrash': 'Moved to Trash', 'tools.database.restore': 'Restore', 'a11y.undone': 'Undone' } as Record<string, string>,
      t(this: { words: Record<string, string> }, key: string): string {
        return this.words[key] ?? key;
      },
    },
  } as unknown as Modules;

  return { modules, shown, undoStep, dismiss, undone, closed, beforeStep };
};

const block = (trash: boolean): Block => ({ tool: { blockMenu: { titled: false, trash, lead: [] } } }) as unknown as Block;

describe('trash toast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marks a block whose menu trashes it (a sub-page)', () => {
    expect(trashesBlock(block(true))).toBe(true);
    expect(trashesBlock(block(false))).toBe(false);
  });

  it('shows "Moved to Trash" with a Restore that undoes the delete step and closes the toast', () => {
    const before = {} as HistoryStep;
    const after = {};
    const { modules, shown, undoStep, dismiss } = makeModules([after]);

    showTrashToast(modules, before);

    expect(shown).toHaveLength(1);
    expect(shown[0].message).toBe('Moved to Trash');
    expect(shown[0].actions?.map((action) => action.label)).toEqual(['Restore']);

    shown[0].actions?.[0].onClick();

    expect(undoStep).toHaveBeenCalledWith(after, true);
    expect(dismiss).toHaveBeenCalledWith(shown[0]);
  });

  it('says "Undone" when Restore undoes the step, like an undo press (Notion U109)', () => {
    const { modules, shown } = makeModules([{}]);

    showTrashToast(modules, undefined);
    shown[0].actions?.[0].onClick();

    expect(announceMock).toHaveBeenCalledWith('Undone', { group: 'history' });
  });

  it('closes the toast once its step is undone another way (Meta+z, U108)', async () => {
    const after = {};
    const { modules, shown, dismiss, undone, beforeStep } = makeModules([after]);

    showTrashToast(modules, undefined);

    // A later edit leaves the toast up.
    beforeStep.forEach((listener) => listener());
    await Promise.resolve();
    expect(dismiss).not.toHaveBeenCalled();

    // The undo runs after the listener, so the check waits a tick.
    beforeStep.forEach((listener) => listener());
    undone.add(after);
    await Promise.resolve();

    expect(dismiss).toHaveBeenCalledWith(shown[0]);
    expect(beforeStep.size).toBe(0);
  });

  it('stops watching the history once the toast has closed', () => {
    const { modules, shown, closed, beforeStep } = makeModules([{}]);

    showTrashToast(modules, undefined);
    closed.add(shown[0]);
    beforeStep.forEach((listener) => listener());

    expect(beforeStep.size).toBe(0);
  });

  it('stops watching the history after Restore', () => {
    const { modules, shown, beforeStep } = makeModules([{}]);

    showTrashToast(modules, undefined);
    shown[0].actions?.[0].onClick();

    expect(beforeStep.size).toBe(0);
  });

  it('shows nothing when the delete left no undo step of its own', () => {
    const step = {} as HistoryStep;
    const { modules, shown } = makeModules([step]);

    showTrashToast(modules, step);

    expect(shown).toHaveLength(0);
  });

  it('stays at least 6 seconds, as Notion\'s did', () => {
    const { modules, shown } = makeModules([{}]);

    showTrashToast(modules, undefined);

    expect(shown[0].time).toBeGreaterThanOrEqual(6000);
  });

  it('shows the toast after a delete that removed a trashed root, and passes the result through', () => {
    const { modules, shown } = makeModules([undefined, {}]);
    const page = { ...block(true), id: 'pg' } as unknown as Block;
    const present = new Set(['pg']);
    const withBlocks = { ...modules, BlockManager: { getBlockById: (id: string) => (present.has(id) ? page : undefined) } } as unknown as Parameters<typeof deleteWithTrashToast>[0];

    const result = deleteWithTrashToast(withBlocks, [page], () => {
      present.delete('pg');

      return 'done';
    });

    expect(result).toBe('done');
    expect(shown).toHaveLength(1);
  });

  it('shows no toast when the trashed root survived the delete (read-only)', () => {
    const { modules, shown } = makeModules([undefined, {}]);
    const page = { ...block(true), id: 'pg' } as unknown as Block;
    const withBlocks = { ...modules, BlockManager: { getBlockById: () => page } } as unknown as Parameters<typeof deleteWithTrashToast>[0];

    deleteWithTrashToast(withBlocks, [page], () => undefined);

    expect(shown).toHaveLength(0);
  });
});
