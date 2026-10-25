import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../../src/components/core';
import { createEditorAgentSession } from '../../../../../src/components/modules/agent/editor-session';
import { Database, DatabaseRow, Paragraph } from '../../../../../src/tools';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { OutputData } from '../../../../../types';
import type { AgentActor, AgentResult } from '../../../../../types/agent';

const actor: AgentActor = { id: 'agent-1', name: 'Agent', kind: 'agent' };
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
    tools: { paragraph: { class: Paragraph }, database: { class: Database }, 'database-row': { class: DatabaseRow } },
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
});
