/**
 * Pins what the column and database insert paths do to the whole editor, so a
 * change in how they place blocks cannot change what a user or host sees.
 * Each case records, after the action and after undo/redo: flat order with
 * parents, each block's contentIds, where each holder is mounted, the saved
 * JSON, the Yjs doc, the current block and the onChange events.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../src/blok';
import type { Block } from '../../../src/components/block';
import { Paragraph } from '../../../src/tools/paragraph';
import { ColumnList } from '../../../src/tools/column-list';
import { Column } from '../../../src/tools/column';
import { ToggleItem } from '../../../src/tools/toggle';
import { DatabaseTool } from '../../../src/tools/database';
import { DatabaseRowTool } from '../../../src/tools/database-row';
import { addColumnToList, wrapBlocksInColumns, wrapInNewColumnList } from '../../../src/tools/column-drop';
import type { API, BlockMutationEvent, OutputBlockData, OutputData } from '../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
  history: { undo: () => void; redo: () => void };
  module: {
    blockManager: { blocks: Block[] };
    yjsManager: { stopCapturing: () => void; toJSON: () => OutputBlockData[] };
  };
}

const P = (id: string, parent?: string): OutputBlockData => ({
  id,
  type: 'paragraph',
  data: { text: id },
  ...(parent !== undefined ? { parent } : {}),
});

const T = (id: string, content: string[], parent?: string): OutputBlockData => ({
  id,
  type: 'toggle',
  data: { text: id, isOpen: true },
  content,
  ...(parent !== undefined ? { parent } : {}),
});

const settle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

const nextFrames = async (count: number): Promise<void> => {
  for (let i = 0; i < count; i++) {
    await new Promise(resolve => {
      requestAnimationFrame(() => resolve(undefined));
    });
  }
};

const quiet = async (): Promise<void> => {
  await settle();
  await nextFrames(3);
  await settle();
};

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;
let events: BlockMutationEvent[] = [];

const boot = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: {
      paragraph: Paragraph,
      column_list: ColumnList,
      column: Column,
      toggle: ToggleItem,
      database: DatabaseTool,
      'database-row': DatabaseRowTool,
    },
    data: { blocks },
    onChange: (_api, event) => {
      events.push(...(Array.isArray(event) ? event : [event]));
    },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await quiet();
  instance.module.yjsManager.stopCapturing();
  events = [];

  return instance;
};

/**
 * Generated ids are random: name them n1, n2… by first appearance in the flat
 * array right after the action, so a run is comparable with another.
 */
const namer = (instance: TestEditor, known: Set<string>): (id: string | null | undefined) => string => {
  const names = new Map<string, string>();

  instance.module.blockManager.blocks.forEach(block => {
    if (!known.has(block.id) && !names.has(block.id)) {
      names.set(block.id, `n${names.size + 1}`);
    }
  });

  return id => {
    if (id === null || id === undefined) {
      return '-';
    }

    return known.has(id) ? id : (names.get(id) ?? '?');
  };
};

type Name = ReturnType<typeof namer>;

const holderOwner = (block: Block, name: Name): string => {
  const owner = block.holder.parentElement?.closest('[data-blok-id]');

  return owner instanceof HTMLElement ? name(owner.getAttribute('data-blok-id')) : '-';
};

const renameDeep = (value: unknown, name: Name, ids: Set<string>): unknown => {
  if (typeof value === 'string') {
    return ids.has(value) ? name(value) : value;
  }

  if (Array.isArray(value)) {
    return value.map(item => renameDeep(item, name, ids));
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renameDeep(item, name, ids)]));
  }

  return value;
};

const state = async (instance: TestEditor, name: Name): Promise<Record<string, unknown>> => {
  const blocks = instance.module.blockManager.blocks;
  const ids = new Set(blocks.map(block => block.id));
  const holders = Array.from(holder?.querySelectorAll('[data-blok-id]') ?? [])
    .map(element => name(element.getAttribute('data-blok-id')));
  const saved = await instance.save();
  const doc = instance.module.yjsManager.toJSON();

  doc.forEach(block => block.id !== undefined && ids.add(block.id));

  return {
    flat: blocks.map(block => `${name(block.id)}^${name(block.parentId)}`),
    contentIds: blocks.map(block => `${name(block.id)}:[${block.contentIds.map(name).join(',')}]`),
    mountedIn: blocks.map(block => `${name(block.id)}@${holderOwner(block, name)}`),
    holderOrder: holders,
    current: instance.blocks.getCurrentBlockIndex(),
    saved: renameDeep(saved.blocks.map(({ id, type, parent, content, data }) => ({ id, type, parent, content, data })), name, ids),
    doc: renameDeep(doc.map(({ id, type, parent, content, data }) => ({ id, type, parent, content, data })), name, ids),
  };
};

const eventLog = (name: Name): string[] => events.map(event => {
  const { target, ...rest } = event.detail as unknown as Record<string, unknown> & { target: { id: string } };
  const extra = Object.entries(rest)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? name(value) : String(value)}`)
    .join(' ');

  return `${event.type} ${name(target.id)} ${extra}`.trim();
});

/**
 * Runs `action`, then undoes it step by step and redoes it again, recording
 * the whole editor at each stop.
 */
const record = async (
  blocks: OutputBlockData[],
  action: (instance: TestEditor) => void | Promise<void>
): Promise<Record<string, unknown>> => {
  const instance = await boot(blocks);
  const known = new Set(blocks.map(block => block.id ?? ''));
  const before = instance.module.blockManager.blocks.map(block => block.id).join();

  await action(instance);
  await quiet();
  // onChange delivers the rest of a batch when its 400ms window closes.
  await new Promise(resolve => {
    setTimeout(resolve, 450);
  });

  const name = namer(instance, known);
  const after = await state(instance, name);
  const afterEvents = eventLog(name);

  instance.module.yjsManager.stopCapturing();

  const undoSteps = await (async (): Promise<number> => {
    for (let step = 1; step <= 4; step++) {
      instance.history.undo();
      await quiet();

      if (instance.module.blockManager.blocks.map(block => block.id).join() === before) {
        return step;
      }
    }

    return -1;
  })();

  const afterUndo = await state(instance, name);

  for (let step = 0; step < undoSteps; step++) {
    instance.history.redo();
    await quiet();
  }

  const afterRedo = await state(instance, name);

  return { after, events: afterEvents, undoSteps, afterUndo, afterRedo };
};

const nestedTarget = (): OutputBlockData[] => [
  T('t', ['tc']),
  P('tc', 't'),
  P('target'),
  P('s'),
  P('z'),
];

const toggleColumns = (): OutputBlockData[] => [
  P('a'),
  { id: 'cl', type: 'column_list', data: {}, content: ['c1', 'c2'] },
  { id: 'c1', type: 'column', data: {}, parent: 'cl', content: ['t1'] },
  T('t1', ['t1c'], 'c1'),
  P('t1c', 't1'),
  { id: 'c2', type: 'column', data: {}, parent: 'cl', content: ['q'] },
  P('q', 'c2'),
  P('z'),
];

const database = (): OutputBlockData[] => [
  P('a'),
  {
    id: 'db',
    type: 'database',
    data: {
      title: 'Tasks',
      schema: [
        { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
        {
          id: 'p-status',
          name: 'Status',
          type: 'select',
          position: 'a1',
          config: { options: [{ id: 'o1', label: 'Todo', position: 'a0' }, { id: 'o2', label: 'Done', position: 'a1' }] },
        },
      ],
      views: [
        { id: 'v-board', name: 'Board', type: 'board', position: 'a0', groupBy: 'p-status', sorts: [], filters: [], visibleProperties: [] },
        { id: 'v-list', name: 'List', type: 'list', position: 'a1', sorts: [], filters: [], visibleProperties: [] },
      ],
      activeViewId: 'v-board',
    },
    content: ['r1', 'r2'],
  },
  { id: 'r1', type: 'database-row', data: { properties: { 'p-title': 'one', 'p-status': 'o1' }, position: 'a0', title: 'one' }, parent: 'db' },
  { id: 'r2', type: 'database-row', data: { properties: { 'p-title': 'two', 'p-status': 'o2' }, position: 'a1', title: 'two' }, parent: 'db' },
  P('z'),
];

const click = (selector: string): void => {
  const button = holder?.querySelector(selector);

  if (!(button instanceof HTMLElement)) {
    throw new Error(`no ${selector}`);
  }

  button.click();
};

describe('column and database placement — characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    holder = document.createElement('div');
    document.body.appendChild(holder);
    events = [];
  });

  afterEach(() => {
    editor?.destroy();
    holder?.remove();
    editor = undefined;
    holder = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each(['left', 'right'] as const)('side-drop %s of a root block that follows a nested child', async (side) => {
    const result = await record(nestedTarget(), instance => {
      wrapInNewColumnList(instance as unknown as API, 'target', ['s'], side);
    });

    expect(result).toMatchSnapshot();
  }, 30_000);

  it('wraps a selection with a toggle and its child into columns', async () => {
    const result = await record([T('t', ['tc']), P('tc', 't'), P('p'), P('q')], instance => {
      wrapBlocksInColumns(instance as unknown as API, ['t', 'tc', 'p']);
    });

    expect(result).toMatchSnapshot();
  }, 30_000);

  it.each(['left', 'right'] as const)('adds a column on the %s of a column whose child has children', async (side) => {
    const result = await record(toggleColumns(), instance => {
      addColumnToList(instance as unknown as API, 'c1', ['z'], side);
    });

    expect(result).toMatchSnapshot();
  }, 30_000);

  it('seeds a three-column preset, one paragraph per column', async () => {
    const result = await record([P('a'), P('b')], instance => {
      instance.blocks.insert('column_list', { columnCount: 3 }, undefined, 1, true, false, 'cl', undefined, 'user');
    });

    expect(result).toMatchSnapshot();
  }, 30_000);

  it('appends a paragraph when the dead space under a column is clicked', async () => {
    const result = await record(toggleColumns(), instance => {
      instance.blocks.getById('c1')?.holder.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(result).toMatchSnapshot();
  }, 30_000);

  it('adds a database row from a board column', async () => {
    // A new row's position ends in a random suffix.
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const result = await record(database(), () => {
      click('[data-blok-database-add-card][data-option-id="o2"]');
    });

    expect(result).toMatchSnapshot();
  }, 30_000);

  it('adds a database row from the list view', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const result = await record(
      database().map(block => block.id === 'db' ? { ...block, data: { ...block.data, activeViewId: 'v-list' } } : block),
      () => {
        click('[data-blok-database-add-row]');
      }
    );

    expect(result).toMatchSnapshot();
  }, 30_000);
});
