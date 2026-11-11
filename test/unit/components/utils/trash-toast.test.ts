import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Block } from '../../../../src/components/block';
import { deleteWithTrashToast, showTrashToast, trashesBlock } from '../../../../src/components/utils/trash-toast';
import type { NotifierOptions } from '../../../../types/configs/notifier';

type Modules = Parameters<typeof showTrashToast>[0];

const makeModules = (steps: Array<Record<string, unknown> | undefined>): { modules: Modules; shown: NotifierOptions[]; undoStep: ReturnType<typeof vi.fn>; dismiss: ReturnType<typeof vi.fn> } => {
  const shown: NotifierOptions[] = [];
  const undoStep = vi.fn(() => true);
  const dismiss = vi.fn();
  const latestStep = vi.fn(() => steps.shift());
  const modules = {
    HistoryAPI: { latestStep, undoStep },
    NotifierAPI: { show: (options: NotifierOptions) => shown.push(options), dismiss },
    // A method that reads `this`, like the real I18n: an unbound call throws.
    I18n: {
      words: { 'tools.database.movedToTrash': 'Moved to Trash', 'tools.database.restore': 'Restore' } as Record<string, string>,
      t(this: { words: Record<string, string> }, key: string): string {
        return this.words[key] ?? key;
      },
    },
  } as unknown as Modules;

  return { modules, shown, undoStep, dismiss };
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
    const before = {};
    const after = {};
    const { modules, shown, undoStep, dismiss } = makeModules([after]);

    showTrashToast(modules, before);

    expect(shown).toHaveLength(1);
    expect(shown[0].message).toBe('Moved to Trash');
    expect(shown[0].actions?.map((action) => action.label)).toEqual(['Restore']);

    shown[0].actions?.[0].onClick();

    expect(undoStep).toHaveBeenCalledWith(after);
    expect(dismiss).toHaveBeenCalledWith(shown[0]);
  });

  it('shows nothing when the delete left no undo step of its own', () => {
    const step = {};
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
