import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../../src/components/core';
import { createEditorAgentSession } from '../../../../../src/components/modules/agent/editor-session';
import { Database, DatabaseRow, Paragraph } from '../../../../../src/tools';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { OutputData } from '../../../../../types';
import type { AgentActor, AgentResult } from '../../../../../types/agent';

const actor: AgentActor = { id: 'agent-1', name: 'Agent', kind: 'agent', onBehalfOf: 'human-1' };
const booted: Array<{ core: Core; holder: HTMLDivElement }> = [];

const PAIR = [
  { id: 'par', name: 'Parent item', type: 'relation', position: 'a1', relation: { targetDatabaseId: 'db', limit: 1, twoWay: true, syncedPropertyId: 'sub', role: 'parentItem' } },
  { id: 'sub', name: 'Sub-items', type: 'relation', position: 'a2', relation: { targetDatabaseId: 'db', twoWay: true, syncedPropertyId: 'par', role: 'subItems' } },
];

type Block = OutputData['blocks'][number];

const rowBlock = (id: string, properties: Record<string, unknown>, position: string): Block =>
  ({ id, type: 'database-row', parent: 'db', data: { position, title: String(properties.t), properties } });

const seed = (): OutputData => ({
  blocks: [
    {
      id: 'db',
      type: 'database',
      data: {
        schema: [{ id: 't', name: 'Title', type: 'title', position: 'a0' }, ...PAIR],
        views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
        activeViewId: 'v',
      },
      content: ['p', 'c', 'z'],
    },
    { ...rowBlock('p', { t: 'p', par: [], sub: [{ id: 'c' }] }, 'a0'), content: ['p-body'] },
    rowBlock('c', { t: 'c', par: [{ id: 'p' }], sub: [] }, 'a1'),
    rowBlock('z', { t: 'z', par: [], sub: [] }, 'a2'),
    { id: 'p-body', type: 'paragraph', parent: 'p', data: { text: 'Body' } },
  ],
});

const boot = async (data: OutputData): Promise<BlokModules> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  const core = new Core({
    holder,
    user: { id: 'human-1' },
    dataModel: 'hierarchical',
    tools: {
      paragraph: { class: Paragraph },
      database: { class: Database, config: { people: { list: () => Promise.resolve([]), me: () => 'human-1' } } },
      'database-row': { class: DatabaseRow },
    },
    data,
  });

  booted.push({ core, holder });
  await core.isReady;

  return core.moduleInstances;
};

const saved = (Blok: BlokModules): Map<string, { parent?: string; data: Record<string, unknown> }> =>
  new Map(Blok.YjsManager.toJSON().map(block => [block.id ?? '', { parent: block.parent ?? undefined, data: block.data }]));

/** A module torn down before its neighbour may throw; the next test boots fresh. */
const destroyQuietly = (module: unknown): void => {
  const destroy = typeof module === 'object' && module !== null && 'destroy' in module ? module.destroy : undefined;

  try {
    if (typeof destroy === 'function') {
      destroy.call(module);
    }
  } catch {
    // See above.
  }
};

describe('database rows through the editor agent session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const { core, holder } of booted.splice(0)) {
      Object.values(core.moduleInstances).forEach(destroyQuietly);
      holder.remove();
    }
    vi.restoreAllMocks();
  });

  it('block.delete on a parent row deletes its sub-items, as the row menu does', async () => {
    const Blok = await boot(seed());
    const session = createEditorAgentSession(Blok, actor);
    const result: AgentResult = await session.execute({ commands: [{ name: 'block.delete', args: { id: 'p' } }] });

    expect(result.ok).toBe(true);
    expect([...saved(Blok).keys()]).toEqual(['db', 'z']);
    session.close();
  }, 30_000);

  it('block.duplicate on a row copies its page and sub-items and lists the copy under the same parent', async () => {
    const Blok = await boot(seed());
    const session = createEditorAgentSession(Blok, actor);
    const result: AgentResult = await session.execute({ commands: [{ name: 'block.duplicate', args: { id: 'c' } }] });

    expect(result.ok).toBe(true);
    const copy = result.ok ? String((result.results[0] as { id: string }).id) : '';
    const blocks = saved(Blok);

    expect(blocks.get(copy)).toMatchObject({ parent: 'db', data: { title: 'c', properties: { par: [{ id: 'p' }] } } });
    expect((blocks.get('p')?.data.properties as Record<string, unknown>).sub).toEqual([{ id: 'c' }, { id: copy }]);
    session.close();
  }, 30_000);
  it('database.moveRowTo moves a row into another database that then shows it', async () => {
    const data = seed();

    data.blocks.push({
      id: 'db2', type: 'database',
      data: {
        schema: [{ id: 't2', name: 'Title', type: 'title', position: 'a0' }],
        views: [{ id: 'v2', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
        activeViewId: 'v2',
      },
    });
    const Blok = await boot(data);
    const session = createEditorAgentSession(Blok, actor);
    const result: AgentResult = await session.execute({ commands: [{ name: 'database.moveRowTo', args: { id: 'db', rowId: 'z', databaseId: 'db2' } }] });

    expect(result.ok).toBe(true);
    expect(saved(Blok).get('z')).toMatchObject({ parent: 'db2', data: { title: 'z', properties: { t2: 'z' } } });
    expect(Blok.API.methods.blocks.getChildren('db2').map(block => block.id)).toEqual(['z']);
    expect(Blok.BlockManager.getBlockById('db2')?.holder.querySelector('[data-row-id="z"]')).not.toBeNull();
    session.close();
  }, 30_000);
  it('database.addRow fills the values the open view filters on, so the new row shows', async () => {
    const data = seed();
    const database = data.blocks[0];

    database.data.schema = [
      ...(database.data.schema as unknown[]),
      { id: 'who', name: 'Owner', type: 'person', position: 'a3' },
      { id: 'done', name: 'Done', type: 'checkbox', position: 'a4' },
    ];
    database.data.views = [{
      id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], visibleProperties: [],
      filters: [{ id: 'f1', propertyId: 'who', operator: 'contains', value: ['me'] }],
      filterTree: { id: 'g', conjunction: 'and', filterRules: [{ id: 'r1', propertyId: 'done', operator: 'equals', value: true }] },
    }];
    const Blok = await boot(data);
    const session = createEditorAgentSession(Blok, actor);
    const result: AgentResult = await session.execute({ commands: [{ name: 'database.addRow', args: { id: 'db', values: { t: 'new' } } }] });

    expect(result.ok).toBe(true);
    const rowId = result.ok ? String((result.results[0] as { rowId: string }).rowId) : '';

    expect(saved(Blok).get(rowId)?.data.properties).toMatchObject({ who: [{ id: 'human-1' }], done: true });
    expect(Blok.BlockManager.getBlockById('db')?.holder.querySelector(`[data-row-id="${rowId}"]`)).not.toBeNull();
    session.close();
  }, 30_000);

  it('database.duplicateRow puts the copy right after the original in a view with its own order', async () => {
    const data = seed();
    const database = data.blocks[0];

    // Keys apart from the positions: a copy with no key of its own would sort last.
    database.data.views = [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], rowOrder: { z: 'Zx', p: 'Zy', c: 'Zz' } }];
    const Blok = await boot(data);
    const session = createEditorAgentSession(Blok, actor);
    const result: AgentResult = await session.execute({ commands: [{ name: 'database.duplicateRow', args: { id: 'db', rowId: 'z' } }] });

    expect(result.ok).toBe(true);
    const copy = result.ok ? String((result.results[0] as { rowId: string }).rowId) : '';
    const order = ((saved(Blok).get('db')?.data.views as Array<{ rowOrder: Record<string, string> }>)[0]).rowOrder;
    const manual = Object.keys(order).sort((a, b) => (order[a] < order[b] ? -1 : 1));

    expect(manual).toEqual(['z', copy, 'p', 'c']);
    const shown = [...(Blok.BlockManager.getBlockById('db')?.holder.querySelectorAll('[data-row-id]') ?? [])].map(el => el.getAttribute('data-row-id'));

    expect([...new Set(shown)]).toEqual(['z', copy, 'p', 'c']);
    session.close();
  }, 30_000);
  it('database.moveRow and database.addRow after a row write the open view\'s own order, which the view then shows', async () => {
    const data = seed();

    // No sub-items here: the table shows a sub-item under its parent, whatever the order.
    data.blocks = data.blocks.map(block => (block.type === 'database-row'
      ? { ...block, data: { ...block.data, properties: { ...(block.data.properties as Record<string, unknown>), par: [], sub: [] } } }
      : block));
    // Keys apart from the positions: placing by position alone would not move a row in this view.
    data.blocks[0].data.views = [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], rowOrder: { z: 'Zx', p: 'Zy', c: 'Zz' } }];
    const Blok = await boot(data);
    const session = createEditorAgentSession(Blok, actor);
    const moved: AgentResult = await session.execute({ commands: [{ name: 'database.moveRow', args: { id: 'db', rowId: 'c', before: 'z' } }] });
    const added: AgentResult = await session.execute({ commands: [{ name: 'database.addRow', args: { id: 'db', after: 'z', values: { t: 'new' } } }] });

    expect(moved.ok && added.ok).toBe(true);
    const rowId = added.ok ? String((added.results[0] as { rowId: string }).rowId) : '';
    const order = ((saved(Blok).get('db')?.data.views as Array<{ rowOrder: Record<string, string> }>)[0]).rowOrder;

    expect(Object.keys(order).sort((a, b) => (order[a] < order[b] ? -1 : 1))).toEqual(['c', 'z', rowId, 'p']);
    expect(saved(Blok).get('c')?.data.position).toBe('a1');
    const shown = [...(Blok.BlockManager.getBlockById('db')?.holder.querySelectorAll('[data-row-id]') ?? [])].map(el => el.getAttribute('data-row-id'));

    expect([...new Set(shown)]).toEqual(['c', 'z', rowId, 'p']);
    session.close();
  }, 30_000);
});
