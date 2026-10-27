import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../src/components/core';
import { undoForPerson } from '../../../../src/components/modules/api/agent-turn';
import { destroy as destroyTooltip } from '../../../../src/components/utils/tooltip';
import { Paragraph } from '../../../../src/tools/paragraph';
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
  options: { adapter?: boolean } = {},
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

const outcome = async (turn: AgentTurn, batch: AgentBatch, approve?: AgentApprover): Promise<string | null> => {
  const result = await turn.execute(batch, approve === undefined ? undefined : { approve });

  return result.ok ? null : `${result.error.code}: ${result.error.message}`;
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
    const turn = openTurn(instance);
    const before = JSON.stringify((await instance.moduleInstances.Saver.save())?.blocks.find((block) => block.id === 'db')?.data);

    try {
      expect(await outcome(turn, setDone(true), approve)).toBeNull();
      await settled();
    } finally {
      turn.end();
    }
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

