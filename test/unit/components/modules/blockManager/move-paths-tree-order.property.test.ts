/**
 * Seeded random trees x random moves through the keyboard move, the public
 * blocks.move and the public blocks.setBlockParent. After every move the flat array must stay a depth-first order
 * of the tree with every holder mounted under its parent and no block lost;
 * undoing every move must give back the starting tree exactly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import type { Block } from '../../../../../src/components/block';
import { isCollapsedToggleBlock } from '../../../../../src/components/modules/drag/utils/toggleState';
import { Callout, Toggle } from '../../../../../src/tools';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { OutputBlockData } from '../../../../../types';

interface Runtime {
  isReady: Promise<unknown>;
  destroy: () => void;
  history: { undo: () => void };
  blocks: {
    move: (toIndex: number, fromIndex?: number) => void;
    setBlockParent: (blockId: string, parentId: string | null) => void;
  };
  module: {
    blockManager: {
      blocks: Block[];
      currentBlockIndex: number;
      moveCurrentBlockUp: () => void;
      moveCurrentBlockDown: () => void;
    };
    yjsManager: { stopCapturing: () => void };
  };
}

const SEEDS = 60;
const MOVES_PER_SEED = 3;

/** mulberry32: small, fast, deterministic. */
const rng = (seed: number): () => number => {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Paragraphs, open/collapsed toggles and callouts, nested at most two levels. */
const randomDoc = (random: () => number): OutputBlockData[] => {
  const out: OutputBlockData[] = [];
  let counter = 0;
  const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];

  const make = (parent: string | undefined, depth: number): string => {
    const id = `b${counter++}`;
    const kind = depth >= 2 ? 'paragraph' : pick(['paragraph', 'paragraph', 'toggle', 'toggle', 'callout']);
    const base = parent === undefined ? {} : { parent };

    if (kind === 'paragraph') {
      out.push({ id, type: 'paragraph', data: { text: id }, ...base });

      return id;
    }

    const entry: OutputBlockData = kind === 'toggle'
      ? { id, type: 'toggle', data: { text: id, isOpen: random() < 0.7 }, content: [], ...base }
      : { id, type: 'callout', data: { emoji: '', textColor: null, backgroundColor: null }, content: [], ...base };

    out.push(entry);
    // A callout always holds at least one block.
    const childCount = Math.floor(random() * 3) + (kind === 'callout' ? 1 : 0);

    entry.content = Array.from({ length: childCount }, () => make(id, depth + 1));

    return id;
  };

  const roots = 2 + Math.floor(random() * 3);

  Array.from({ length: roots }).forEach(() => make(undefined, 0));

  return out;
};

const settle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

const holders: HTMLElement[] = [];

const boot = async (blocks: OutputBlockData[]): Promise<Runtime> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  holders.push(holder);

  const editor = new Blok({
    holder,
    tools: { paragraph: Paragraph, toggle: Toggle, callout: Callout },
    data: { blocks },
  }) as unknown as Runtime;

  await editor.isReady;
  await settle();
  editor.module.yjsManager.stopCapturing();

  return editor;
};

const snapshot = (editor: Runtime): string[] => editor.module.blockManager.blocks.map(block =>
  `${block.id}^${block.parentId ?? '-'}${block.holder.classList.contains('hidden') ? ' hidden' : ''}`);

const treeViolations = (editor: Runtime): string[] => {
  const blocks = editor.module.blockManager.blocks;
  const byId = new Map(blocks.map(block => [block.id, block]));
  const parentOf = (block: Block): Block | undefined => block.parentId === null ? undefined : byId.get(block.parentId);
  const isUnder = (block: Block, ancestorId: string): boolean => {
    const parent = parentOf(block);

    return parent !== undefined && (parent.id === ancestorId || isUnder(parent, ancestorId));
  };
  const hasCollapsedAncestor = (block: Block): boolean => {
    const parent = parentOf(block);

    return parent !== undefined && (isCollapsedToggleBlock(parent) || hasCollapsedAncestor(parent));
  };

  return blocks.flatMap((block, index) => {
    const problems: string[] = [];
    const parent = parentOf(block);

    if (parent !== undefined) {
      const parentIndex = blocks.indexOf(parent);

      if (parentIndex > index || blocks.slice(parentIndex + 1, index).some(between => !isUnder(between, parent.id))) {
        problems.push(`${block.id} is not inside ${parent.id}'s run`);
      }
    }

    const domParent = block.holder.parentElement?.closest('[data-blok-element]') ?? null;

    if (domParent !== (parent?.holder ?? null)) {
      problems.push(`${block.id} is mounted under the wrong holder`);
    }

    if (index > 0 && (blocks[index - 1].holder.compareDocumentPosition(block.holder) & Node.DOCUMENT_POSITION_FOLLOWING) === 0) {
      problems.push(`${block.id} is before ${blocks[index - 1].id} on screen`);
    }

    // A grandchild is hidden through its hidden parent holder.
    if ((block.holder.closest('.hidden') !== null) !== hasCollapsedAncestor(block)) {
      problems.push(`${block.id} hidden flag is wrong`);
    }

    return problems;
  });
};

/**
 * Sends `source` to the root, to one of its ancestors, or into a container
 * that is not inside it.
 * @param editor - editor under test
 * @param random - seeded generator
 * @param source - the block to reparent
 */
const randomReparent = (editor: Runtime, random: () => number, source: Block): string => {
  const blocks = editor.module.blockManager.blocks;
  const byId = new Map(blocks.map(block => [block.id, block]));
  const ancestors = (block: Block): string[] =>
    block.parentId === null ? [] : [block.parentId, ...ancestors(byId.get(block.parentId) ?? block)];
  const containers = blocks
    .filter(block => block.name !== 'paragraph' && block !== source && !ancestors(block).includes(source.id))
    .map(block => block.id);
  const targets: Array<string | null> = [null, ...ancestors(source), ...containers];
  const target = targets[Math.floor(random() * targets.length)];

  editor.blocks.setBlockParent(source.id, target);

  return `parent ${source.id} -> ${target ?? 'root'}`;
};

/**
 * One random move. A hidden block is never the source: nothing on screen can
 * grab it, and leaving a collapsed toggle is pinned separately
 * (move-paths-tree-order.test.ts).
 * @param editor - editor under test
 * @param random - seeded generator
 */
const randomMove = (editor: Runtime, random: () => number, withApi: boolean, reparent: boolean): string => {
  const manager = editor.module.blockManager;
  const visible = manager.blocks.filter(block => !block.holder.closest('.hidden'));
  const source = visible[Math.floor(random() * visible.length)];
  const fromIndex = manager.blocks.indexOf(source);

  if (reparent) {
    return randomReparent(editor, random, source);
  }
  const kind = Math.floor(random() * (withApi ? 3 : 2));

  if (kind === 0) {
    manager.currentBlockIndex = fromIndex;
    manager.moveCurrentBlockUp();

    return `up ${source.id}`;
  }

  if (kind === 1) {
    manager.currentBlockIndex = fromIndex;
    manager.moveCurrentBlockDown();

    return `down ${source.id}`;
  }

  const toIndex = Math.floor(random() * manager.blocks.length);

  editor.blocks.move(toIndex, fromIndex);

  return `api ${source.id} ${fromIndex}->${toIndex}`;
};

/**
 * Boots a random tree, applies the moves, then undoes them all.
 * @param seed - generator seed
 * @param withApi - also draw public blocks.move calls
 * @param reparent - draw only public blocks.setBlockParent calls
 * @returns what went wrong, or null
 */
const runSeed = async (seed: number, withApi: boolean, reparent = false): Promise<string | null> => {
  const random = rng(seed);
  const editor = await boot(randomDoc(random));
  const initial = snapshot(editor);
  const steps: string[] = [];

  // One move, then the tree check; the problem text, or null.
  const step = async (): Promise<string | null> => {
    steps.push(randomMove(editor, random, withApi, reparent));
    await settle();
    editor.module.yjsManager.stopCapturing();

    const problems = treeViolations(editor);

    return problems.length > 0 || editor.module.blockManager.blocks.length !== initial.length
      ? `seed ${seed} after [${steps.join(', ')}]: ${problems.join('; ')} | ${snapshot(editor).join(' ')}`
      : null;
  };

  const firstFailure = async (): Promise<string | null> => {
    for (let move = 0; move < MOVES_PER_SEED; move++) {
      const failure = await step();

      if (failure !== null) {
        return failure;
      }
    }

    return null;
  };

  try {
    const failure = await firstFailure();

    if (failure !== null) {
      return failure;
    }

    for (const _step of steps) {
      editor.history.undo();
      await settle();
    }

    const undone = snapshot(editor);
    const problems = treeViolations(editor);

    return undone.join(' ') === initial.join(' ') && problems.length === 0
      ? null
      : `seed ${seed} undo of [${steps.join(', ')}]: got ${undone.join(' ')} want ${initial.join(' ')} ${problems.join('; ')}`;
  } finally {
    editor.destroy();
  }
};

describe('random moves keep tree order and undo exactly', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // blocks.move logs a warning when it refuses a move; refusals are part of the run.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    holders.splice(0).forEach(holder => holder.remove());
    vi.restoreAllMocks();
  });

  const runSeeds = async (withApi: boolean, reparent = false): Promise<string[]> => {
    const failures: string[] = [];

    for (let seed = 1; seed <= SEEDS; seed++) {
      const failure = await runSeed(seed, withApi, reparent);

      if (failure !== null) {
        failures.push(failure);
      }
    }

    return failures;
  };

  it(`keyboard moves: ${SEEDS} seeds x ${MOVES_PER_SEED} moves`, async () => {
    expect(await runSeeds(false)).toStrictEqual([]);
  }, 120_000);

  it(`keyboard and blocks.move: ${SEEDS} seeds x ${MOVES_PER_SEED} moves`, async () => {
    expect(await runSeeds(true)).toStrictEqual([]);
  }, 120_000);

  it(`blocks.setBlockParent, in and out: ${SEEDS} seeds x ${MOVES_PER_SEED} moves`, async () => {
    expect(await runSeeds(false, true)).toStrictEqual([]);
  }, 120_000);
});
