/**
 * Seeded random trees x random public-API operations that replace, retype,
 * update or delete a block — preferring blocks that have children. After every
 * operation `save()` must resolve (the tree-placement gate throws under
 * NODE_ENV=test) and the tree must stay depth-first with every holder under its
 * parent; undoing every operation must give back the starting tree.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import type { Block } from '../../../../../src/components/block';
import { Callout, Header, Toggle } from '../../../../../src/tools';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { API, OutputBlockData, OutputData } from '../../../../../types';

interface Runtime {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  history: { undo: () => void };
  blocks: API['blocks'];
  module: {
    blockManager: { blocks: Block[] };
    yjsManager: { stopCapturing: () => void };
  };
}

const SEEDS = 40;
const OPS_PER_SEED = 2;

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

// Legacy callout data: the tool saves other data, so undo rebuilds the callout.
const CALLOUT_DATA = { text: 'Callout' };

/** Paragraphs, toggles, toggle headings and callouts, nested at most two levels. */
const randomDoc = (random: () => number): OutputBlockData[] => {
  const out: OutputBlockData[] = [];
  let counter = 0;
  const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];

  const make = (parent: string | undefined, depth: number): string => {
    const id = `b${counter++}`;
    const kind = depth >= 2 ? 'paragraph' : pick(['paragraph', 'toggle', 'toggle', 'heading', 'callout']);
    const base = parent === undefined ? {} : { parent };

    if (kind === 'paragraph') {
      out.push({ id, type: 'paragraph', data: { text: id }, ...base });

      return id;
    }

    const dataByKind: Record<string, Record<string, unknown>> = {
      toggle: { text: id, isOpen: random() < 0.7 },
      heading: { text: id, level: 2, isToggleable: true, isOpen: random() < 0.7 },
      callout: CALLOUT_DATA,
    };
    const data = dataByKind[kind];
    const entry: OutputBlockData = { id, type: kind === 'heading' ? 'header' : kind, data, content: [], ...base };

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

const settle = (ms = 0): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, ms);
});

/** Undo and removals replay across an animation frame. */
const settleFrame = async (): Promise<void> => {
  await settle();
  await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
  await settle();
};

const holders: HTMLElement[] = [];

const boot = async (blocks: OutputBlockData[]): Promise<Runtime> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  holders.push(holder);

  const editor = new Blok({
    holder,
    tools: { paragraph: Paragraph, header: Header, toggle: Toggle, callout: Callout },
    data: { blocks },
  }) as unknown as Runtime;

  await editor.isReady;
  // Tools run rendered() a frame after render; start from a settled tree.
  await settleFrame();
  editor.module.yjsManager.stopCapturing();

  return editor;
};

const snapshot = (editor: Runtime): string[] => editor.module.blockManager.blocks.map(block =>
  `${block.id}:${block.name}^${block.parentId ?? '-'}`);

const treeViolations = (editor: Runtime): string[] => {
  const blocks = editor.module.blockManager.blocks;
  const byId = new Map(blocks.map(block => [block.id, block]));
  const parentOf = (block: Block): Block | undefined => block.parentId === null ? undefined : byId.get(block.parentId);
  const isUnder = (block: Block, ancestorId: string): boolean => {
    const parent = parentOf(block);

    return parent !== undefined && (parent.id === ancestorId || isUnder(parent, ancestorId));
  };

  return blocks.flatMap((block, index) => {
    const problems: string[] = [];
    const parent = parentOf(block);

    if (block.parentId !== null && parent === undefined) {
      problems.push(`${block.id} points at a missing parent`);
    }

    if (parent !== undefined) {
      const parentIndex = blocks.indexOf(parent);

      if (parentIndex > index || blocks.slice(parentIndex + 1, index).some(between => !isUnder(between, parent.id))) {
        problems.push(`${block.id} is not inside ${parent.id}'s run`);
      }
    }

    if (!block.holder.isConnected) {
      problems.push(`${block.id} holder is detached`);
    }

    return problems;
  });
};

/** Blocks with children first, so most operations hit the paths under test. */
const pickTarget = (editor: Runtime, random: () => number): Block => {
  const blocks = editor.module.blockManager.blocks;
  const withChildren = blocks.filter(block => block.contentIds.length > 0 && block.name !== 'callout');
  const pool = withChildren.length > 0 && random() < 0.8 ? withChildren : blocks;

  return pool[Math.floor(random() * pool.length)];
};

const TARGETS: Array<[string, Record<string, unknown>]> = [
  ['paragraph', { text: 'x' }],
  ['header', { text: 'x', level: 3 }],
  ['header', { text: 'x', level: 3, isToggleable: true }],
  ['toggle', { text: 'x' }],
];

/**
 * One random operation.
 * @param editor - editor under test
 * @param random - seeded generator
 * @returns a label, or null when the editor refused it (nothing changed)
 */
const randomOperation = async (editor: Runtime, random: () => number): Promise<string | null> => {
  const target = pickTarget(editor, random);
  const index = editor.module.blockManager.blocks.indexOf(target);
  const [tool, data] = TARGETS[Math.floor(random() * TARGETS.length)];
  const kind = Math.floor(random() * 4);

  if (kind === 0) {
    try {
      await editor.blocks.convert(target.id, tool, data);
    } catch {
      return null;
    }

    return `convert ${target.id} -> ${tool}${data.isToggleable === true ? ' toggle' : ''}`;
  }

  if (kind === 1) {
    editor.blocks.insert(tool, data, undefined, index, false, true);

    return `replace ${target.id} -> ${tool}${data.isToggleable === true ? ' toggle' : ''}`;
  }

  if (kind === 2) {
    await editor.blocks.update(target.id, { text: 'updated' });

    return `update ${target.id}`;
  }

  await editor.blocks.delete(index, false);

  return `delete ${target.id}`;
};

const runSeed = async (seed: number): Promise<string | null> => {
  const random = rng(seed);
  const editor = await boot(randomDoc(random));
  const initial = snapshot(editor);
  const steps: string[] = [];

  const check = async (when: string): Promise<string | null> => {
    const problems = treeViolations(editor);
    const saveError = await editor.save().then(() => null, (error: unknown) => String(error));

    return problems.length > 0 || saveError !== null
      ? `seed ${seed} ${when} [${steps.join(', ')}] from ${initial.join(' ')}: ${[...problems, saveError ?? ''].join('; ')} | ${snapshot(editor).join(' ')}`
      : null;
  };

  const firstFailure = async (): Promise<string | null> => {
    for (let op = 0; op < OPS_PER_SEED; op++) {
      const label = await randomOperation(editor, random);

      await settleFrame();
      editor.module.yjsManager.stopCapturing();

      if (label === null) {
        continue;
      }
      steps.push(label);

      const failure = await check('after');

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
      await settleFrame();
    }

    const undone = snapshot(editor);

    if (undone.join(' ') !== initial.join(' ')) {
      return `seed ${seed} undo of [${steps.join(', ')}]: got ${undone.join(' ')} want ${initial.join(' ')}`;
    }

    return await check('after undoing');
  } finally {
    editor.destroy();
  }
};

describe('random replace, convert, update and delete keep the tree and undo exactly', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
  });

  afterEach(() => {
    holders.splice(0).forEach(holder => holder.remove());
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const runSeeds = async (seeds: number[]): Promise<string[]> => {
    const failures: string[] = [];

    for (const seed of seeds) {
      const failure = await runSeed(seed);

      if (failure !== null) {
        failures.push(failure);
      }
    }

    return failures;
  };

  const allSeeds = Array.from({ length: SEEDS }, (_, index) => index + 1);

  it(`${SEEDS} seeds x ${OPS_PER_SEED} operations`, async () => {
    expect(await runSeeds(allSeeds)).toStrictEqual([]);
  }, 300_000);
});
