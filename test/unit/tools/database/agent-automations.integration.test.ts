import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../src/components/core';
import { undoForPerson } from '../../../../src/components/modules/api/agent-turn';
import { createEditorAgentSession } from '../../../../src/components/modules/agent/editor-session';
import { destroy as destroyTooltip } from '../../../../src/components/utils/tooltip';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseComment, Embed, Page } from '../../../../src/tools';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type {
  DatabaseAdapter,
  DatabaseRow,
  DatabaseViewConfig,
  DatabaseAutomationContext,
  DatabaseAutomationTrigger,
  DatabaseSavedAutomation,
  PropertyDefinition,
} from '../../../../src/tools/database/types';
import type { AgentBatch, OutputBlockData } from '../../../../types';
import type { AgentApprover } from '../../../../types/agent';
import type { AgentTurn } from '../../../../types/api';

/*
 * An agent's row edit fires what the same edit by the person fires: saved
 * automations, the host's onTrigger and the adapter. Each case runs the
 * person's edit (the tool's own path) and the agent's on identical boots.
 */

let holder: HTMLDivElement | undefined;
let core: Core | undefined;

const quiet = async (): Promise<void> => {
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  for (let frame = 0; frame < 3; frame++) {
    await new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); });
  }
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
};

/** Past the 500ms settle of a propertyEdited trigger. */
const settled = async (): Promise<void> => {
  await new Promise<void>((resolve) => { setTimeout(resolve, 700); });
  await quiet();
};

const schema: PropertyDefinition[] = [
  { id: 't', name: 'Name', type: 'title', position: 'a0' },
  { id: 'c', name: 'Done', type: 'checkbox', position: 'a1' },
  { id: 'notes', name: 'Notes', type: 'text', position: 'a2' },
];

const automation = (id: string, trigger: DatabaseSavedAutomation['triggers'][number], value: string, propertyId = 'notes'): DatabaseSavedAutomation => ({
  id,
  name: id,
  status: 'active',
  scope: { type: 'database' },
  triggerMode: 'any',
  triggers: [trigger],
  actions: [{ id: `${id}-a`, type: 'editProperty', target: 'triggerRow', propertyId, value }],
});

const SAVED = [
  automation('added', { id: 'tr-added', type: 'pageAdded' }, 'auto-filled'),
  automation('done', { id: 'tr-done', type: 'propertyEdited', propertyId: 'c' }, 'done-filled'),
];

const blocks = (definitions: DatabaseSavedAutomation[] = SAVED, locked = false): OutputBlockData[] => [
  {
    id: 'db',
    type: 'database',
    content: ['r1'],
    data: {
      title: 'Tasks',
      schema: schema.map((property) => (locked && property.type === 'title' ? { ...property, databaseLocked: true } : property)),
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v1',
      automations: { version: 1, definitions },
    },
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { position: 'a0', title: 'One', properties: { t: 'One', c: false } } },
];

interface Spies {
  calls: string[];
  triggers: DatabaseAutomationTrigger[];
}

/** A host backend that logs every row call. Its database is the seed's, so loading changes nothing. */
const spyAdapter = (seed: OutputBlockData[], calls: string[]): DatabaseAdapter => {
  const data = seed[0].data as { schema: PropertyDefinition[]; views: DatabaseViewConfig[] };
  const row = (id: string): DatabaseRow => ({ id, position: 'a0', properties: {} });

  return {
    loadDatabase: () => Promise.resolve({ schema: structuredClone(data.schema), views: structuredClone(data.views) }),
    createRow: (params) => { calls.push(`createRow:${params.id}`); return Promise.resolve(row(params.id)); },
    updateRow: (params) => { calls.push(`updateRow:${params.rowId}`); return Promise.resolve(row(params.rowId)); },
    moveRow: (params) => { calls.push(`moveRow:${params.rowId}:${params.position}`); return Promise.resolve(row(params.rowId)); },
    deleteRow: (params) => { calls.push(`deleteRow:${params.rowId}`); return Promise.resolve(); },
    createProperty: (params) => Promise.resolve({ ...params } as PropertyDefinition),
    updateProperty: (params) => Promise.resolve({ id: params.propertyId } as PropertyDefinition),
    deleteProperty: () => Promise.resolve(),
    createView: (params) => Promise.resolve({ ...params } as DatabaseViewConfig),
    updateView: (params) => { calls.push(`updateView:${params.viewId}:${Object.keys(params.changes).join(',')}`); return Promise.resolve({ id: params.viewId } as DatabaseViewConfig); },
    deleteView: () => Promise.resolve(),
  };
};

const boot = async (
  seed: OutputBlockData[],
  onTrigger?: (trigger: DatabaseAutomationTrigger, ctx: DatabaseAutomationContext) => void,
  options: { adapter?: boolean; config?: Record<string, unknown> } = {},
): Promise<{ instance: Core; spies: Spies }> => {
  const spies: Spies = { calls: [], triggers: [] };

  holder = document.createElement('div');
  document.body.appendChild(holder);
  const instance = new Core({
    holder, tabSync: false, dataModel: 'hierarchical', i18n: { locale: 'en' }, user: { id: 'human-1' },
    tools: {
      paragraph: Paragraph,
      database: {
        class: DatabaseTool,
        config: {
          ...(options.adapter === true ? { adapter: spyAdapter(seed, spies.calls) } : {}),
          ...options.config,
          automations: {
            onTrigger: (trigger: DatabaseAutomationTrigger, ctx: DatabaseAutomationContext) => {
              spies.calls.push(`onTrigger:${trigger.type}`);
              spies.triggers.push(trigger);
              onTrigger?.(trigger, ctx);
            },
          },
        },
      },
      'database-row': DatabaseRowTool,
      'database-comment': DatabaseComment,
      page: Page,
      embed: Embed,
    },
    data: { blocks: structuredClone(seed) },
  });

  core = instance;
  await instance.isReady;
  await quiet();

  return { instance, spies };
};

const hasMarkDestroyed = (value: unknown): value is { markDestroyed(): void } =>
  typeof value === 'object' && value !== null && 'markDestroyed' in value && typeof value.markDestroyed === 'function';
const hasDestroy = (value: unknown): value is { destroy(): void | Promise<void> } =>
  typeof value === 'object' && value !== null && 'destroy' in value && typeof value.destroy === 'function';

const teardown = async (): Promise<void> => {
  if (core !== undefined) {
    const modules: unknown[] = Object.values(core.moduleInstances);

    modules.filter(hasMarkDestroyed).forEach((module) => module.markDestroyed());
    await Promise.all(modules.filter(hasDestroy).map((module) => module.destroy()));
  }
  core = undefined;
  holder?.remove();
  holder = undefined;
  destroyTooltip();
  document.body.innerHTML = '';
};

const runAgent = async (instance: Core, batch: AgentBatch): Promise<string | null> => {
  const agent = instance.moduleInstances.API.methods.agent;

  if (agent === undefined) throw new Error('agent API is missing');
  const turn = agent.begin({ agent: { id: 'bot', name: 'Bot' } });

  try {
    const result = await turn.execute(batch);

    return result.ok ? null : `${result.error.code}: ${result.error.message}`;
  } finally {
    turn.end();
  }
};

const openTurn = (instance: Core): AgentTurn => {
  const agent = instance.moduleInstances.API.methods.agent;

  if (agent === undefined) throw new Error('agent API is missing');

  return agent.begin({ agent: { id: 'bot', name: 'Bot' } });
};

const outcome = async (turn: AgentTurn, batch: AgentBatch): Promise<string | null> => {
  const result = await turn.execute(batch);

  return result.ok ? null : `${result.error.code}: ${result.error.message}`;
};

/** The editor's own agent session: the one Ask AI runs, which takes a person's approver. */
const asked = async (instance: Core, batch: AgentBatch, approve?: AgentApprover): Promise<string | null> => {
  // As Ask AI's turn: the agent acts for the editor's person, one step per turn.
  const session = createEditorAgentSession(instance.moduleInstances, { id: 'bot', name: 'Bot', kind: 'agent', onBehalfOf: 'human-1' }, { mergeSteps: 'turn' });

  try {
    const result = await session.execute(batch, approve === undefined ? {} : { approve });

    return result.ok ? null : `${result.error.code}: ${result.error.message}`;
  } finally {
    await session.close();
  }
};


const setDone = (value: boolean): AgentBatch => ({ commands: [{ name: 'database.setRowValues', args: { id: 'db', rowId: 'r1', values: { c: value } } }] });

const stampOf = (instance: Core, id: string): { by: string | null | undefined; with: string | null | undefined } => {
  const block = instance.moduleInstances.BlockManager.getBlockById(id);

  return { by: block?.lastEditedBy, with: block?.lastEditedWith };
};

/** Who made the block, without when. */
const creationOf = (instance: Core, id: string): Record<string, unknown> => {
  const { createdAt: _at, ...who } = { ...instance.moduleInstances.YjsManager.getBlockCreation(id) };

  return who;
};

const clickNewRow = (): void => {
  const button = document.querySelector<HTMLElement>('[data-blok-database-table-add-row]');

  if (button === null) throw new Error('missing Add row button');
  button.click();
};

interface SavedRow {
  id: string;
  properties: Record<string, unknown>;
}

const rowsOf = async (instance: Core): Promise<SavedRow[]> => {
  const saved = await instance.moduleInstances.Saver.save();

  return (saved?.blocks ?? []).filter((block) => block.type === 'database-row').map((block) => ({
    id: block.id ?? '',
    properties: (block.data as { properties?: Record<string, unknown> }).properties ?? {},
  }));
};

/** The person's cell edit: the same commit a cell editor makes. */
const personEdit = (instance: Core, rowId: string, changes: Record<string, unknown>): void => {
  const block = instance.moduleInstances.BlockManager.getBlockById('db');

  if (block === undefined) throw new Error('database block is missing');
  block.call('writeButtonValues', { rowId, changes });
};

describe('agent row edits fire automations as a person\'s do', { timeout: 30_000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await teardown();
    vi.restoreAllMocks();
  });

  it('baseline: the person\'s cell edit fires the saved automation and onTrigger once', async () => {
    const { instance, spies } = await boot(blocks());

    personEdit(instance, 'r1', { c: true });
    await settled();

    expect((await rowsOf(instance)).find((row) => row.id === 'r1')?.properties.notes).toBe('done-filled');
    expect(spies.triggers).toEqual([{ type: 'propertyEdited', rowId: 'r1', propertyId: 'c', value: true }]);
  });

  it('agent setRowValues fires a saved propertyEdited automation and the host onTrigger', async () => {
    const { instance, spies } = await boot(blocks());

    expect(await runAgent(instance, { commands: [{ name: 'database.setRowValues', args: { id: 'db', rowId: 'r1', values: { c: true } } }] })).toBeNull();
    await settled();

    expect((await rowsOf(instance)).find((row) => row.id === 'r1')?.properties.notes).toBe('done-filled');
    expect(spies.triggers).toEqual([{ type: 'propertyEdited', rowId: 'r1', propertyId: 'c', value: true }]);
  });

  it('agent addRow fires a saved pageAdded automation and the host onTrigger', async () => {
    const { instance, spies } = await boot(blocks());

    expect(await runAgent(instance, { commands: [{ name: 'database.addRow', args: { id: 'db', values: { t: 'Two' } } }] })).toBeNull();
    await settled();

    const added = (await rowsOf(instance)).find((row) => row.id !== 'r1');

    expect(added?.properties.notes).toBe('auto-filled');
    expect(spies.triggers.map((trigger) => `${trigger.type}:${trigger.rowId}`)).toEqual([`pageAdded:${added?.id ?? ''}`]);
  });

  it('an agent edit on a locked database fires nothing, as a person\'s does', async () => {
    const person = await boot(blocks(SAVED, true));

    personEdit(person.instance, 'r1', { c: true });
    await settled();
    const personNotes = (await rowsOf(person.instance)).find((row) => row.id === 'r1')?.properties.notes;
    const personTriggers = person.spies.triggers.length;

    await teardown();
    const { instance, spies } = await boot(blocks(SAVED, true));

    expect(await runAgent(instance, setDone(true))).toBeNull();
    await settled();

    expect(personTriggers).toBe(0);
    expect(spies.triggers).toHaveLength(personTriggers);
    expect((await rowsOf(instance)).find((row) => row.id === 'r1')?.properties.notes).toBe(personNotes);
  });

  it('adversarial: an automation that writes back to its trigger runs once (automations never chain)', async () => {
    const loop = [automation('loop', { id: 'tr-loop', type: 'propertyEdited', propertyId: 'c' }, 'flipped', 'c')];
    const { instance, spies } = await boot(blocks(loop), (trigger, ctx) => {
      // The host writes back to the same row and property too.
      ctx.run({ type: 'editProperty', rowId: trigger.rowId, propertyId: 'c', value: false });
      ctx.run({ type: 'editProperty', rowId: trigger.rowId, propertyId: 'notes', value: `host-${spies.triggers.length}` });
    });

    expect(await runAgent(instance, setDone(true))).toBeNull();
    await settled();
    await settled();

    expect(spies.triggers).toEqual([{ type: 'propertyEdited', rowId: 'r1', propertyId: 'c', value: true }]);
    expect((await rowsOf(instance)).find((row) => row.id === 'r1')?.properties.notes).toBe('host-1');
  });

  it('adversarial: an automation cannot unlock or reshare, and asks no one', async () => {
    const reach = [
      automation('lock', { id: 'tr-lock', type: 'propertyEdited', propertyId: 'c' }, 'false', 'databaseLocked'),
      automation('share', { id: 'tr-share', type: 'propertyEdited', propertyId: 'c' }, 'true', 'public'),
    ];
    const seed = blocks(reach);
    const database = seed[0];
    const data = database.data as { views: Array<Record<string, unknown>> };

    data.views.push({ id: 'f1', name: 'Form', type: 'form', position: 'a1', sorts: [], filters: [], visibleProperties: [], form: { public: false } });
    const ran: boolean[] = [];
    const { instance, spies } = await boot(seed, (trigger, ctx) => {
      ran.push(ctx.run({ type: 'editProperty', rowId: trigger.rowId, propertyId: 'databaseLocked', value: false }));
      ran.push(ctx.run({ type: 'editProperty', rowId: trigger.rowId, propertyId: 'f1', value: true }));
    });
    const approve = vi.fn<AgentApprover>(() => Promise.resolve(true));
    const before = JSON.stringify((await instance.moduleInstances.Saver.save())?.blocks.find((block) => block.id === 'db')?.data);

    expect(await asked(instance, setDone(true), approve)).toBeNull();
    await settled();
    const saved = await instance.moduleInstances.Saver.save();

    expect(spies.triggers).toHaveLength(1);
    expect(ran).toEqual([false, false]);
    expect(approve).not.toHaveBeenCalled();
    expect(JSON.stringify(saved?.blocks.find((block) => block.id === 'db')?.data)).toBe(before);
    expect(Object.keys((await rowsOf(instance)).find((row) => row.id === 'r1')?.properties ?? {}).sort()).toEqual(['c', 't']);
  });

  it('the automation\'s write keeps the edit\'s stamps: By the person, With the agent', async () => {
    const person = await boot(blocks());

    personEdit(person.instance, 'r1', { c: true });
    await quiet();
    const personBefore = stampOf(person.instance, 'r1');

    await settled();
    const personAfter = stampOf(person.instance, 'r1');

    await teardown();
    const { instance } = await boot(blocks());

    expect(await runAgent(instance, setDone(true))).toBeNull();
    await quiet();
    const agentBefore = stampOf(instance, 'r1');

    await settled();

    expect((await rowsOf(instance)).find((row) => row.id === 'r1')?.properties.notes).toBe('done-filled');
    expect(personAfter).toEqual(personBefore);
    expect(agentBefore).toEqual({ by: 'human-1', with: 'bot' });
    expect(stampOf(instance, 'r1')).toEqual(agentBefore);
  });

  it('history.undo and Discard of the agent\'s edit leave the automation\'s write as a person\'s Cmd+Z does', async () => {
    const person = await boot(blocks());

    personEdit(person.instance, 'r1', { c: true });
    await settled();
    person.instance.moduleInstances.YjsManager.undo();
    await settled();
    const personRow = (await rowsOf(person.instance)).find((row) => row.id === 'r1');

    await teardown();

    for (const take of ['history.undo', 'discard'] as const) {
      const { instance } = await boot(blocks());
      const turn = openTurn(instance);

      try {
        expect(await outcome(turn, setDone(true))).toBeNull();
        await settled();
        const undone = take === 'discard' ? await undoForPerson(turn) : await turn.execute({ commands: [{ name: 'history.undo', args: {} }] });

        expect(undone.ok).toBe(true);
        await settled();
      } finally {
        turn.end();
      }

      expect(personRow?.properties.c).toBe(false);
      expect((await rowsOf(instance)).find((row) => row.id === 'r1')).toEqual(personRow);
      await teardown();
    }
  });

  it('a host addPage on pageAdded: the new row is stamped and undone as the person\'s', async () => {
    const spawn = (trigger: DatabaseAutomationTrigger, ctx: DatabaseAutomationContext): void => {
      if (trigger.type === 'pageAdded') ctx.run({ type: 'addPage', properties: { notes: 'spawned' } });
    };
    const person = await boot(blocks([]), spawn);

    clickNewRow();
    await settled();
    const personRows = await rowsOf(person.instance);
    const personSpawned = personRows.find((row) => row.properties.notes === 'spawned');
    const personCreation = creationOf(person.instance, personSpawned?.id ?? '');

    person.instance.moduleInstances.YjsManager.undo();
    await settled();
    const personAfterUndo = (await rowsOf(person.instance)).length;

    await teardown();
    const { instance, spies } = await boot(blocks([]), spawn);
    const turn = openTurn(instance);

    try {
      expect(await outcome(turn, { commands: [{ name: 'database.addRow', args: { id: 'db', values: { t: 'Two' } } }] })).toBeNull();
      await settled();
      const rows = await rowsOf(instance);
      const spawned = rows.find((row) => row.properties.notes === 'spawned');

      expect(spies.triggers.filter((trigger) => trigger.type === 'pageAdded')).toHaveLength(1);
      expect(rows).toHaveLength(personRows.length);
      expect(creationOf(instance, spawned?.id ?? '')).toEqual(personCreation);
      expect((await undoForPerson(turn)).ok).toBe(true);
      await settled();
    } finally {
      turn.end();
    }

    expect((await rowsOf(instance)).length).toBe(personAfterUndo);
  });

  it('one batch with addRow and setRowValues fires each trigger once, either order, and stays undoable', async () => {
    const orders: AgentBatch['commands'][] = [
      [{ name: 'database.addRow', args: { id: 'db', values: { t: 'Two' } } }, setDone(true).commands[0]],
      [setDone(true).commands[0], { name: 'database.addRow', args: { id: 'db', values: { t: 'Two' } } }],
    ];

    for (const commands of orders) {
      const { instance, spies } = await boot(blocks());
      const turn = openTurn(instance);

      try {
        expect(await outcome(turn, { commands })).toBeNull();
        await settled();
        const rows = await rowsOf(instance);
        const added = rows.find((row) => row.id !== 'r1');

        expect(spies.triggers.map((trigger) => `${trigger.type}:${trigger.rowId}`).sort())
          .toEqual([`pageAdded:${added?.id ?? ''}`, 'propertyEdited:r1'].sort());
        expect(added?.properties.notes).toBe('auto-filled');
        expect(rows.find((row) => row.id === 'r1')?.properties.notes).toBe('done-filled');
        expect(stampOf(instance, added?.id ?? '')).toEqual({ by: 'human-1', with: 'bot' });
        expect(await outcome(turn, { commands: [{ name: 'history.undo', args: {} }] })).toBeNull();
      } finally {
        turn.end();
      }
      await teardown();
    }
  });

  it('a linked view of the database does not fire the edit a second time', async () => {
    const seed = blocks();
    const linked: OutputBlockData = {
      id: 'lv',
      type: 'database',
      content: [],
      data: {
        schema: [{ id: 'lt', name: 'Name', type: 'title', position: 'a0' }],
        views: [{ id: 'lv1', name: 'Linked', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
        activeViewId: 'lv1',
        source: { databaseId: 'db' },
      },
    };
    const { instance, spies } = await boot([...seed, linked]);

    expect(await runAgent(instance, { commands: [setDone(true).commands[0], { name: 'database.addRow', args: { id: 'db', values: { t: 'Two' } } }] })).toBeNull();
    await settled();

    expect(spies.triggers.map((trigger) => trigger.type).sort()).toEqual(['pageAdded', 'propertyEdited']);
  });
});

describe('agent row deletes and moves reach the host adapter as a person\'s do', { timeout: 60_000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await teardown();
    vi.restoreAllMocks();
  });

  const twoRows = (rowOrder?: Record<string, string>): OutputBlockData[] => {
    const [database, r1] = blocks([]);
    const data = database.data as { views: Array<Record<string, unknown>> };

    if (rowOrder !== undefined) data.views[0].rowOrder = rowOrder;

    return [
      { ...database, content: ['r1', 'r2'] },
      r1,
      { id: 'r2', type: 'database-row', parent: 'db', data: { position: 'a1', title: 'Two', properties: { t: 'Two', c: false } } },
    ];
  };

  const withSecondDatabase = (): OutputBlockData[] => [
    ...twoRows(),
    {
      id: 'db2', type: 'database', content: [],
      data: {
        title: 'Other',
        schema: [{ id: 't2', name: 'Name', type: 'title', position: 'a0' }],
        views: [{ id: 'w1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
        activeViewId: 'w1',
        automations: { version: 1, definitions: [] },
      },
    },
  ];

  const rowCalls = (calls: string[]): string[] => calls.filter((call) => !call.startsWith('updateRow:'));

  it('agent deleteRow deletes the row from the backend once, and its undo creates it once', async () => {
    const { instance, spies } = await boot(twoRows(), undefined, { adapter: true });
    const turn = openTurn(instance);

    try {
      expect(await outcome(turn, { commands: [{ name: 'database.deleteRow', args: { id: 'db', rowId: 'r1' } }] })).toBeNull();
      await settled();
      expect(rowCalls(spies.calls)).toEqual(['deleteRow:r1']);
      expect(await outcome(turn, { commands: [{ name: 'history.undo', args: {} }] })).toBeNull();
      await settled();
    } finally {
      turn.end();
    }

    expect(rowCalls(spies.calls)).toEqual(['deleteRow:r1', 'createRow:r1']);
  });

  it('agent addRow creates the row once, and its undo deletes it once', async () => {
    const { instance, spies } = await boot(twoRows(), undefined, { adapter: true });
    const turn = openTurn(instance);

    try {
      expect(await outcome(turn, { commands: [{ name: 'database.addRow', args: { id: 'db', values: { t: 'Three' } } }] })).toBeNull();
      await settled();
      expect(await outcome(turn, { commands: [{ name: 'history.undo', args: {} }] })).toBeNull();
      await settled();
    } finally {
      turn.end();
    }
    const added = spies.calls.find((call) => call.startsWith('createRow:'))?.slice('createRow:'.length) ?? '';

    expect(rowCalls(spies.calls).filter((call) => !call.startsWith('onTrigger'))).toEqual([`createRow:${added}`, `deleteRow:${added}`]);
  });

  it('agent moveRow on the shared order sends moveRow with the row\'s new position', async () => {
    const { instance, spies } = await boot(twoRows(), undefined, { adapter: true });

    expect(await runAgent(instance, { commands: [{ name: 'database.moveRow', args: { id: 'db', rowId: 'r1', after: 'r2' } }] })).toBeNull();
    await settled();
    const position = (await instance.moduleInstances.Saver.save())?.blocks.find((block) => block.id === 'r1')?.data.position as string;

    expect(position > 'a1').toBe(true);
    expect(rowCalls(spies.calls)).toEqual([`moveRow:r1:${position}`]);
  });

  it('agent moveRow in a view with its own order sends that view\'s rowOrder', async () => {
    const { instance, spies } = await boot(twoRows({ r1: 'a0', r2: 'a1' }), undefined, { adapter: true });

    expect(await runAgent(instance, { commands: [{ name: 'database.moveRow', args: { id: 'db', rowId: 'r1', after: 'r2' } }] })).toBeNull();
    await settled();

    expect(rowCalls(spies.calls)).toEqual(['updateView:v1:rowOrder']);
  });

  it('agent moveRowTo another database sends what the person\'s Move to sends', async () => {
    const person = await boot(withSecondDatabase(), undefined, { adapter: true });
    const block = person.instance.moduleInstances.BlockManager.getBlockById('db');

    block?.call('moveRowTo', { rowId: 'r1', databaseId: 'db2' });
    await settled();
    const personCalls = rowCalls(person.spies.calls);

    await teardown();
    const { instance, spies } = await boot(withSecondDatabase(), undefined, { adapter: true });

    expect(await runAgent(instance, { commands: [{ name: 'database.moveRowTo', args: { id: 'db', rowId: 'r1', databaseId: 'db2' } }] })).toBeNull();
    await settled();

    expect(personCalls).toEqual(['deleteRow:r1', 'createRow:r1', 'onTrigger:pageAdded']);
    expect(rowCalls(spies.calls)).toEqual(personCalls);
  });

  it('undoing an agent moveRowTo sends what undoing the person\'s Move to sends', async () => {
    const person = await boot(withSecondDatabase(), undefined, { adapter: true });

    person.instance.moduleInstances.BlockManager.getBlockById('db')?.call('moveRowTo', { rowId: 'r1', databaseId: 'db2' });
    await settled();
    person.spies.calls.length = 0;
    person.instance.moduleInstances.YjsManager.undo();
    await settled();
    const personCalls = rowCalls(person.spies.calls);

    await teardown();
    const { instance, spies } = await boot(withSecondDatabase(), undefined, { adapter: true });
    const turn = openTurn(instance);

    try {
      expect(await outcome(turn, { commands: [{ name: 'database.moveRowTo', args: { id: 'db', rowId: 'r1', databaseId: 'db2' } }] })).toBeNull();
      await settled();
      spies.calls.length = 0;
      expect(await outcome(turn, { commands: [{ name: 'history.undo', args: {} }] })).toBeNull();
      await settled();
    } finally {
      turn.end();
    }

    expect(personCalls).toContain('createRow:r1');
    expect(rowCalls(spies.calls)).toEqual(personCalls);
  });
});

describe('an agent submits a form as the person\'s Submit does', { timeout: 60_000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await teardown();
    vi.restoreAllMocks();
  });

  const formSchema: PropertyDefinition[] = [
    { id: 't', name: 'Name', type: 'title', position: 'a0' },
    { id: 'notes', name: 'Notes', type: 'text', position: 'a1' },
    { id: 'mail', name: 'Mail', type: 'email', position: 'a2' },
    { id: 'hidden', name: 'Hidden', type: 'text', position: 'a3' },
    { id: 'who', name: 'Owner', type: 'person', position: 'a4', person: { default: 'createdBy' } },
  ];

  const formSeed = (form: Record<string, unknown> = {}): OutputBlockData[] => [
    {
      id: 'db', type: 'database', content: [],
      data: {
        title: 'Requests',
        schema: formSchema,
        views: [{
          id: 'f1', name: 'Form', type: 'form', position: 'a0', sorts: [], filters: [], visibleProperties: [],
          properties: [
            { id: 't', visible: true }, { id: 'notes', visible: true, required: true }, { id: 'mail', visible: true },
            { id: 'hidden', visible: false }, { id: 'who', visible: false },
          ],
          form,
        }],
        activeViewId: 'f1',
        automations: { version: 1, definitions: [] },
      },
    },
  ];

  const submitted: unknown[] = [];
  // The person's "Created by" default reads the host's people directory; the agent's names the same person.
  const forms = {
    forms: { onSubmit: (submission: unknown): void => { submitted.push(structuredClone(submission)); } },
    people: { list: (): Promise<[]> => Promise.resolve([]), me: (): string => 'human-1' },
  };

  const submit = (answers: Record<string, unknown>, viewId = 'f1'): AgentBatch => ({ commands: [{ name: 'database.submitForm', args: { id: 'db', viewId, answers } }] });

  const savedRows = async (instance: Core): Promise<Array<Record<string, unknown>>> =>
    ((await instance.moduleInstances.Saver.save())?.blocks ?? []).filter((block) => block.type === 'database-row').map((block) => ({
      data: block.data,
      createdBy: (block as { createdBy?: unknown }).createdBy,
    }));

  beforeEach(() => {
    submitted.length = 0;
  });

  it('makes the row and calls onSubmit the way the person\'s Submit does', async () => {
    const person = await boot(formSeed(), undefined, { config: forms });
    const field = (id: string): HTMLInputElement | HTMLTextAreaElement => {
      const element = document.getElementById(`blok-form-f1-${id}`);

      if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) throw new Error(`missing field ${id}`);

      return element;
    };

    field('t').value = 'Ask';
    field('notes').value = 'Please';
    document.querySelector<HTMLButtonElement>('[data-blok-database-form-submit]')?.click();
    await settled();
    const personRows = await savedRows(person.instance);
    const personSubmitted = structuredClone(submitted);

    await teardown();
    submitted.length = 0;
    const { instance } = await boot(formSeed(), undefined, { config: forms });

    expect(await runAgent(instance, submit({ t: 'Ask', notes: 'Please' }))).toBeNull();
    await settled();
    const rows = await savedRows(instance);
    const strip = (rowsOrSubmissions: unknown[]): unknown => JSON.parse(JSON.stringify(rowsOrSubmissions, (key, value: unknown) => (key === 'position' || key === 'rowId' ? undefined : value)));

    expect(personRows).toHaveLength(1);
    expect(strip(rows)).toEqual(strip(personRows));
    expect(personSubmitted).toHaveLength(1);
    expect(strip(submitted)).toEqual(strip(personSubmitted));
    expect((submitted[0] as { rowId?: unknown }).rowId).toBe(instance.moduleInstances.BlockManager.blocks.find((block) => block.name === 'database-row')?.id);
  });

  it('refuses what the form\'s Submit refuses, writes nothing and tells the host nothing', async () => {
    const { instance } = await boot(formSeed(), undefined, { config: forms });
    const refusals: Array<[Record<string, unknown>, string]> = [
      [{ t: 'Ask' }, 'notes is required'],
      [{ t: 'Ask', notes: 'x', mail: 'not-an-email' }, 'needs an email address'],
      [{ t: 'Ask', notes: 'x', hidden: 'sneaky' }, 'is not a question of this form'],
      [{ t: 'Ask', notes: 'x', who: [{ id: 'someone-else' }] }, 'is not a question of this form'],
    ];

    for (const [answers, reason] of refusals) {
      expect(await runAgent(instance, submit(answers))).toContain(reason);
    }
    await settled();

    expect(await savedRows(instance)).toEqual([]);
    expect(submitted).toEqual([]);
  });

  it('adversarial: a closed form and an anonymous form refuse the agent', async () => {
    for (const [form, reason] of [[{ closed: true }, 'closed'], [{ anonymous: true }, 'anonymous']] as const) {
      const { instance } = await boot(formSeed(form), undefined, { config: forms });

      expect(await runAgent(instance, submit({ t: 'Ask', notes: 'x' }))).toContain(reason);
      await settled();
      expect(await savedRows(instance)).toEqual([]);
      expect(submitted).toEqual([]);
      await teardown();
    }
  });

  it('runs alone, and a refused or read-only batch calls no host hook', async () => {
    const { instance } = await boot(formSeed(), undefined, { config: forms });
    const both: AgentBatch = { commands: [...submit({ t: 'Ask', notes: 'x' }).commands, { name: 'block.update', args: { id: 'db', data: { title: 'Renamed' } } }] };

    expect(await runAgent(instance, both)).toContain('must be the only command in its batch');
    await instance.moduleInstances.API.methods.readOnly.toggle(true);
    expect(await runAgent(instance, submit({ t: 'Ask', notes: 'x' }))).toMatch(/READ_ONLY/);
    await settled();

    expect(submitted).toEqual([]);
  });

  it('undo takes the answer\'s row back and calls the host no second time', async () => {
    const { instance } = await boot(formSeed(), undefined, { config: forms });
    const turn = openTurn(instance);

    try {
      expect(await outcome(turn, submit({ t: 'Ask', notes: 'x' }))).toBeNull();
      await settled();
      expect(await outcome(turn, { commands: [{ name: 'history.undo', args: {} }] })).toBeNull();
      await settled();
      expect(await outcome(turn, { commands: [{ name: 'history.redo', args: {} }] })).toBeNull();
      await settled();
    } finally {
      turn.end();
    }

    expect(await savedRows(instance)).toHaveLength(1);
    expect(submitted).toHaveLength(1);
  });
});

describe('an agent presses a database button as the person\'s click does', { timeout: 60_000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await teardown();
    vi.restoreAllMocks();
  });

  const hooks: Array<{ hook: string; payload: unknown }> = [];
  const buttonConfig = {
    buttons: {
      onAction: (payload: unknown): void => { hooks.push({ hook: 'onAction', payload: structuredClone(payload) }); },
      onNotify: (payload: unknown): void => { hooks.push({ hook: 'onNotify', payload: structuredClone(payload) }); },
    },
    people: { list: (): Promise<[]> => Promise.resolve([]), me: (): string => 'human-1' },
  };

  const buttonSeed = (buttonActions: unknown[], definitions: DatabaseSavedAutomation[] = []): OutputBlockData[] => {
    const [database, r1] = blocks(definitions);
    const data = database.data as { schema: PropertyDefinition[] };

    data.schema = [...data.schema, { id: 'btn', name: 'Go', type: 'button', position: 'a3', button: { label: 'Go', buttonActions } } as PropertyDefinition];

    return [database, r1];
  };

  const STEPS = [
    { id: 's1', type: 'editProperty', propertyId: 'c', value: true },
    { id: 's2', type: 'insertBlocks', blocks: [{ type: 'paragraph', data: { text: 'From the button' } }] },
    { id: 's3', type: 'addPage', name: 'Spawned', edits: [{ propertyId: 'notes', value: 'made by the button' }] },
    { id: 's4', type: 'callback' },
    { id: 's5', type: 'sendNotification', recipients: { type: 'people', people: [{ id: 'u2' }] }, message: 'Pressed' },
  ];

  const press: AgentBatch = { commands: [{ name: 'database.pressButton', args: { id: 'db', rowId: 'r1', propertyId: 'btn' } }] };

  const documentOf = async (instance: Core): Promise<unknown> => {
    const saved = (await instance.moduleInstances.Saver.save())?.blocks ?? [];

    return saved.filter((block) => block.type !== 'database').map((block) => ({
      type: block.type,
      parent: block.parent ?? null,
      text: (block.data as { text?: unknown }).text,
      properties: (block.data as { properties?: unknown }).properties,
    }));
  };
  const withoutIds = (value: unknown): unknown => JSON.parse(JSON.stringify(value), (key, entry: unknown) => (key === 'parent' && entry !== 'db' && entry !== null ? 'row' : entry));

  beforeEach(() => {
    hooks.length = 0;
  });

  it('writes, adds and calls the host exactly as the person\'s click', async () => {
    const person = await boot(buttonSeed(STEPS), undefined, { config: buttonConfig });

    document.querySelector<HTMLButtonElement>('[data-blok-id="db"] [data-row-id="r1"] [data-blok-database-button][data-property-id="btn"]')?.click();
    await settled();
    const personDocument = await documentOf(person.instance);
    const personHooks = structuredClone(hooks);

    await teardown();
    hooks.length = 0;
    const { instance } = await boot(buttonSeed(STEPS), undefined, { config: buttonConfig });

    expect(await asked(instance, press, () => Promise.resolve(true))).toBeNull();
    await settled();

    expect(personHooks.map((entry) => entry.hook)).toEqual(['onAction', 'onNotify']);
    expect(withoutIds(await documentOf(instance))).toEqual(withoutIds(personDocument));
    expect(hooks).toEqual(personHooks);
    expect(stampOf(instance, 'r1')).toEqual({ by: 'human-1', with: 'bot' });
  });

  it('asks the person before a "Show confirmation" with the button\'s own text, and only a yes goes on', async () => {
    const steps = [{ id: 'q', type: 'showConfirmation', message: 'Really\u202e mark it done?\nsure', confirmLabel: 'Do it', cancelLabel: 'Stop' }, STEPS[0], STEPS[3]];

    for (const answer of [true, false, undefined] as const) {
      const { instance } = await boot(buttonSeed(steps), undefined, { config: buttonConfig });
      const approve = vi.fn<AgentApprover>(() => Promise.resolve(answer === true));
      const result = await asked(instance, press, answer === undefined ? undefined : approve);

      await settled();
      const done = (await rowsOf(instance)).find((row) => row.id === 'r1')?.properties.c;

      if (answer === true) {
        expect(result).toBeNull();
        expect(approve).toHaveBeenCalledWith({
          kind: 'database.buttonConfirm', blockId: 'db', title: 'Tasks', message: 'Really mark it done? sure', confirmLabel: 'Do it', cancelLabel: 'Stop',
          rowId: 'r1', steps: JSON.stringify(steps),
        });
        expect(done).toBe(true);
        expect(hooks.map((entry) => entry.hook)).toEqual(['onAction']);
      } else {
        expect(result).toMatch(/^APPROVAL_REQUIRED/);
        expect(done).toBe(false);
        expect(hooks).toEqual([]);
      }
      hooks.length = 0;
      await teardown();
    }
  });

  it('adversarial: a button aimed at the lock or a form\'s sharing refuses the press and asks no one', async () => {
    for (const step of [
      { id: 'x', type: 'editProperty', propertyId: 'databaseLocked', value: false },
      { id: 'y', type: 'editPages', target: { type: 'thisPage' }, edits: [{ propertyId: 'public', value: true }] },
    ]) {
      const { instance } = await boot(buttonSeed([STEPS[0], step, STEPS[3]]), undefined, { config: buttonConfig });
      const approve = vi.fn<AgentApprover>(() => Promise.resolve(true));
      const before = JSON.stringify((await instance.moduleInstances.Saver.save())?.blocks);

      expect(await asked(instance, press, approve)).toMatch(/^PRECONDITION_FAILED/);
      await settled();

      expect(approve).not.toHaveBeenCalled();
      expect(hooks).toEqual([]);
      expect(JSON.stringify((await instance.moduleInstances.Saver.save())?.blocks)).toBe(before);
      await teardown();
    }
  });

  it('its edit starts the automation once, and the automation presses nothing', async () => {
    const { instance, spies } = await boot(buttonSeed([STEPS[0], STEPS[3]], SAVED), undefined, { config: buttonConfig });

    expect(await asked(instance, press, () => Promise.resolve(true))).toBeNull();
    await settled();
    await settled();

    expect(spies.triggers).toEqual([{ type: 'propertyEdited', rowId: 'r1', propertyId: 'c', value: true }]);
    expect((await rowsOf(instance)).find((row) => row.id === 'r1')?.properties.notes).toBe('done-filled');
    expect(hooks.map((entry) => entry.hook)).toEqual(['onAction']);
  });

  it('read-only refuses the press and calls no host hook', async () => {
    const { instance } = await boot(buttonSeed([STEPS[3]]), undefined, { config: buttonConfig });

    await instance.moduleInstances.API.methods.readOnly.toggle(true);
    expect(await runAgent(instance, press)).toMatch(/READ_ONLY/);
    await settled();

    expect(hooks).toEqual([]);
  });

  it('adversarial: a press that would call the host asks the person first, with what the host gets, and refuses when no one can be asked', async () => {
    const steps = [
      { id: 'n', type: 'sendNotification', recipients: { type: 'people', people: [{ id: 'u2‮' }] }, message: 'Wire 50k\nto IBAN X' },
      { id: 'cb', type: 'callback', name: 'Sync\u0000 CRM' },
    ];
    const { instance } = await boot(buttonSeed(steps), undefined, { config: buttonConfig });

    expect(await runAgent(instance, press)).toMatch(/^APPROVAL_REQUIRED/);
    await settled();
    expect(hooks).toEqual([]);

    const approve = vi.fn<AgentApprover>(() => Promise.resolve(false));

    expect(await asked(instance, press, approve)).toMatch(/^APPROVAL_REQUIRED/);
    await settled();

    expect(approve).toHaveBeenCalledTimes(1);
    expect(approve.mock.calls[0]?.[0]).toMatchObject({
      kind: 'database.buttonHooks',
      blockId: 'db',
      hooks: [{ kind: 'notify', to: ['u2'], message: 'Wire 50k to IBAN X' }, { kind: 'callback', name: 'Sync CRM' }],
    });
    expect(hooks).toEqual([]);
  });

  it('adversarial: the host gets only the declared fields of a step, cleaned', async () => {
    const steps = [
      { id: 'cb', type: 'callback', name: 'Sync', url: 'javascript:alert(1)', secret: 'x' },
      { id: 'n', type: 'sendNotification', recipients: { type: 'people', people: [{ id: 'u2', role: 'admin' }] }, message: 'Hi', url: 'javascript:alert(1)' },
    ];
    const { instance } = await boot(buttonSeed(steps), undefined, { config: buttonConfig });

    expect(await asked(instance, press, () => Promise.resolve(true))).toBeNull();
    await settled();

    expect(hooks.map((entry) => (entry.payload as { action: unknown }).action)).toEqual([
      { id: 'cb', type: 'callback', name: 'Sync' },
      { id: 'n', type: 'sendNotification', recipients: { type: 'people', people: [{ id: 'u2' }] }, message: 'Hi' },
    ]);
  });

  it('adversarial: steps changed while the person decides do not run without their new yes', async () => {
    const { instance } = await boot(buttonSeed([STEPS[3]]), undefined, { config: buttonConfig });
    const approve = vi.fn<AgentApprover>(async (request) => {
      if (approve.mock.calls.length > 1) return false;
      // Someone rewrites the button while the question is open.
      const block = instance.moduleInstances.BlockManager.getBlockById('db');
      const data = (await instance.moduleInstances.Saver.save())?.blocks.find((each) => each.id === 'db')?.data as { schema: PropertyDefinition[] };
      const schema = data.schema.map((property) => (property.id === 'btn'
        ? { ...property, button: { buttonActions: [{ id: 'evil', type: 'callback', name: 'Exfiltrate' }] } }
        : property));

      if (block !== undefined) await instance.moduleInstances.API.methods.blocks.update(block.id, { ...data, schema });
      await quiet();

      return request.kind === 'database.buttonHooks';
    });

    expect(await asked(instance, press, approve)).toMatch(/^APPROVAL_REQUIRED/);
    await settled();

    expect(approve.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(approve.mock.calls[1]?.[0]).toMatchObject({ hooks: [{ kind: 'callback', name: 'Exfiltrate' }] });
    expect(hooks).toEqual([]);
  });

  it('adversarial: a button\'s inserted blocks get block.insert\'s checks', async () => {
    const lockedDatabase = {
      type: 'database',
      data: {
        title: 'Locked',
        schema: [{ id: 'lt', name: 'Name', type: 'title', position: 'a0', databaseLocked: true }],
        views: [{ id: 'lv', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
        activeViewId: 'lv',
      },
    };
    const cases: Array<[string, unknown, RegExp]> = [
      ['page', { type: 'page', data: { pageId: 'agent-chosen' } }, /^INVALID_ARGS: Insert "page" with its own block\.insert/],
      ['locked database', lockedDatabase, /^DATA_REJECTED/],
      ['not insertable', { type: 'database-comment', data: { text: 'x', createdAt: 1, authorId: 'human-1' } }, /^COMMAND_UNAVAILABLE: "database-comment" is not insertable/],
      ['embed', { type: 'embed', data: { service: 'youtube', source: 'javascript:alert(1)', embed: 'javascript:alert(1)' } }, /^DATA_REJECTED/],
    ];

    const misses: string[] = [];

    for (const [name, insert, expected] of cases) {
      const { instance } = await boot(buttonSeed([{ id: 'ins', type: 'insertBlocks', blocks: [insert] }]), undefined, { config: buttonConfig });
      const before = JSON.stringify((await instance.moduleInstances.Saver.save())?.blocks);

      const refusal = await runAgent(instance, press);

      await settled();
      if (refusal === null || !expected.test(refusal) || JSON.stringify((await instance.moduleInstances.Saver.save())?.blocks) !== before) misses.push(`${name}: ${refusal ?? 'applied'}`);
      await teardown();
    }

    expect(misses).toEqual([]);
  });
});

