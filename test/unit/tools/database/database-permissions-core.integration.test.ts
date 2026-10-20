import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../src/components/core';
import { destroy as destroyTooltip } from '../../../../src/components/utils/tooltip';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Toggle } from '../../../../src/tools';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { DatabasePermissionAction, DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';
import type { AgentBatch, OutputBlockData } from '../../../../types';

let holder: HTMLDivElement | undefined;
let core: Core | undefined;

const quiet = async (): Promise<void> => {
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  for (let frame = 0; frame < 3; frame++) {
    await new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); });
  }
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
};

const view: DatabaseViewConfig = { id: 'v1', name: 'Table', type: 'table', position: 'a0', filters: [], sorts: [], visibleProperties: [] };
const schema: PropertyDefinition[] = [
  { id: 't', name: 'Name', type: 'title', position: 'a0' },
  { id: 'notes', name: 'Notes', type: 'text', position: 'a1' },
];

const doc = (locked = false): OutputBlockData[] => [
  { id: 'p0', type: 'paragraph', data: { text: 'before' } },
  {
    id: 'db', type: 'database', content: ['r1'],
    data: { title: 'Projects', schema: locked ? schema.map((p) => p.type === 'title' ? { ...p, databaseLocked: true } : p) : schema, views: [view], activeViewId: 'v1' },
  },
  { id: 'r1', type: 'database-row', parent: 'db', content: ['body1'], data: { properties: { t: 'Row', notes: 'n' }, position: 'a0', bodyBlocks: true } },
  { id: 'body1', type: 'paragraph', parent: 'r1', data: { text: 'body text' } },
];

const boot = async (denied: DatabasePermissionAction[], locked = false, blocks = doc(locked)): Promise<Core> => {
  holder = document.createElement('div');
  document.body.appendChild(holder);
  const instance = new Core({
    holder, tabSync: false, dataModel: 'hierarchical', i18n: { locale: 'en' },
    tools: {
      paragraph: Paragraph,
      toggle: Toggle,
      database: { class: DatabaseTool, config: { permissions: { can: (action: DatabasePermissionAction) => !denied.includes(action) } } },
      'database-row': DatabaseRowTool,
    },
    data: { blocks },
  });

  core = instance;
  await instance.isReady;
  await quiet();

  return instance;
};

const block = (instance: Core, id: string): NonNullable<ReturnType<Core['moduleInstances']['BlockManager']['getBlockById']>> => {
  const found = instance.moduleInstances.BlockManager.getBlockById(id);

  if (found === undefined) throw new Error(`missing block ${id}`);

  return found;
};

/** The item names of the block menu opened on a block. */
const menuItems = async (instance: Core, id: string): Promise<string[]> => {
  await instance.moduleInstances.BlockSettings.open(block(instance, id));
  const names = await vi.waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>('[data-blok-testid="block-tunes-popover"] [data-blok-item-name]')]
      .map((item) => item.getAttribute('data-blok-item-name') ?? '');

    if (found.length === 0) throw new Error('block menu did not open');

    return found;
  });

  instance.moduleInstances.BlockSettings.close();

  return names;
};

const hasMarkDestroyed = (value: unknown): value is { markDestroyed(): void } =>
  typeof value === 'object' && value !== null && 'markDestroyed' in value && typeof value.markDestroyed === 'function';
const hasDestroy = (value: unknown): value is { destroy(): void | Promise<void> } =>
  typeof value === 'object' && value !== null && 'destroy' in value && typeof value.destroy === 'function';

/** Core has no destroy of its own: every module is marked first, then torn down. */
const destroyCore = async (instance: Core): Promise<void> => {
  const modules: unknown[] = Object.values(instance.moduleInstances);

  modules.filter(hasMarkDestroyed).forEach((module) => module.markDestroyed());
  await Promise.all(modules.filter(hasDestroy).map((module) => module.destroy()));
};

const run = async (instance: Core, batch: AgentBatch): Promise<string | null> => {
  const agent = instance.moduleInstances.API.methods.agent;

  if (agent === undefined) throw new Error('agent API is missing');
  const turn = agent.begin({ agent: { id: 'bot', name: 'Bot' } });

  try {
    const result = await turn.execute(batch);

    return result.ok ? null : result.error.code;
  } finally {
    turn.end();
  }
};

const ids = async (instance: Core): Promise<string[]> =>
  (await instance.moduleInstances.Saver.save())?.blocks.map((saved) => saved.id ?? '') ?? [];

describe('database permissions reach core block actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom has no hit testing; a started drag asks it on every move.
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null });
  });

  afterEach(async () => {
    core?.moduleInstances.BlockSettings.close();
    if (core !== undefined) await destroyCore(core);
    core = undefined;
    holder?.remove();
    holder = undefined;
    destroyTooltip();
    document.body.innerHTML = '';
    Reflect.deleteProperty(document, 'elementFromPoint');
    vi.restoreAllMocks();
  });

  describe('without editContent', () => {
    it('the database block menu offers no delete, duplicate or turn into', async () => {
      const instance = await boot(['editContent']);
      const names = await menuItems(instance, 'db');

      expect(names).not.toContain('delete');
      expect(names).not.toContain('duplicate');
      expect(names).not.toContain('convert-to');
      expect(names).toContain('copy-link');
    });

    it('a block in a row page body gets the same read-only menu', async () => {
      const instance = await boot(['editContent']);
      const names = await menuItems(instance, 'body1');

      expect(names).not.toContain('delete');
      expect(names).not.toContain('duplicate');
    });

    it('deleting a selected database block does nothing', async () => {
      const instance = await boot(['editContent']);
      const { BlockSelection, BlockManager } = instance.moduleInstances;

      BlockSelection.selectBlock(block(instance, 'db'));
      BlockManager.deleteSelectedBlocksAndInsertReplacement();
      await quiet();

      expect(await ids(instance)).toContain('db');
    });

    it('a selection that also holds other blocks deletes only those', async () => {
      const instance = await boot(['editContent']);
      const { BlockSelection, BlockManager } = instance.moduleInstances;

      BlockSelection.selectBlock(block(instance, 'p0'));
      BlockSelection.selectBlock(block(instance, 'db'));
      BlockManager.deleteSelectedBlocksAndInsertReplacement();
      await quiet();

      const saved = await ids(instance);

      expect(saved).not.toContain('p0');
      expect(saved).toEqual(expect.arrayContaining(['db', 'r1', 'body1']));
    });

    it('the agent cannot delete the database, edit a row or edit a row body block', async () => {
      const instance = await boot(['editContent']);

      expect(await run(instance, { commands: [{ name: 'block.delete', args: { id: 'db' } }] })).toBe('READ_ONLY');
      expect(await run(instance, { commands: [{ name: 'block.update', args: { id: 'body1', data: { text: 'agent' } } }] })).toBe('READ_ONLY');
      expect(await run(instance, { commands: [{ name: 'block.insert', args: { type: 'paragraph', data: { text: 'x' }, parentId: 'r1', position: 'end' } }] })).toBe('READ_ONLY');
      expect(await ids(instance)).toEqual(expect.arrayContaining(['db', 'r1', 'body1']));
    });

    it('deleting a block that holds the database keeps it, by selection or by the agent', async () => {
      const nested: OutputBlockData[] = [
        { id: 'tg', type: 'toggle', data: { text: 'holder' }, content: ['db'] },
        ...doc().filter((b) => b.id !== 'p0').map((b) => b.id === 'db' ? { ...b, parent: 'tg' } : b),
      ];
      const instance = await boot(['editContent'], false, nested);
      const { BlockSelection, BlockManager } = instance.moduleInstances;

      expect(await run(instance, { commands: [{ name: 'block.delete', args: { id: 'tg' } }] })).toBe('READ_ONLY');
      BlockSelection.selectBlock(block(instance, 'tg'));
      BlockManager.deleteSelectedBlocksAndInsertReplacement();
      await quiet();

      expect(await ids(instance)).toEqual(expect.arrayContaining(['tg', 'db', 'r1', 'body1']));
    });

    it('Cmd+D does not duplicate the database', async () => {
      const instance = await boot(['editContent']);

      expect(await instance.moduleInstances.DragManager.duplicateBlocksInPlace(block(instance, 'db'))).toEqual([]);
      await quiet();
      expect((await ids(instance)).filter((id) => id !== 'p0')).toEqual(['db', 'r1', 'body1']);
    });

    it('the drag handle does not drag the database or a row page body block', async () => {
      const instance = await boot(['editContent']);
      const { DragManager } = instance.moduleInstances;

      for (const id of ['db', 'body1']) {
        const handle = document.createElement('button');
        const cleanup = DragManager.setupDragHandle(handle, block(instance, id));

        document.body.appendChild(handle);
        handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 50, clientY: 100 }));
        document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 50, clientY: 160 }));

        expect(DragManager.isDragging).toBe(false);
        document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 50, clientY: 160 }));
        cleanup();
        handle.remove();
      }
    });

    it('the drag handle still drags a block outside the database', async () => {
      const instance = await boot(['editContent']);
      const { DragManager } = instance.moduleInstances;
      const handle = document.createElement('button');
      const cleanup = DragManager.setupDragHandle(handle, block(instance, 'p0'));

      document.body.appendChild(handle);
      handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 50, clientY: 100 }));
      document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 50, clientY: 160 }));

      expect(DragManager.isDragging).toBe(true);
      document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 50, clientY: 160 }));
      cleanup();
    });

    it('the agent can still edit blocks outside the database', async () => {
      const instance = await boot(['editContent']);

      expect(await run(instance, { commands: [{ name: 'block.update', args: { id: 'p0', data: { text: 'agent' } } }] })).toBeNull();
    });

    it('the host API still writes rows: the host owns both the gate and the API', async () => {
      const instance = await boot(['editContent']);

      await instance.moduleInstances.API.methods.blocks.update('body1', { text: 'host' });
      await quiet();

      const saved = await instance.moduleInstances.Saver.save();

      expect(saved?.blocks.find((b) => b.id === 'body1')?.data).toEqual({ text: [{ text: 'host' }] });
    });
  });

  describe('the row page body', () => {
    /** The open page's body host: an ancestor of the body block's holder outside the database's row pool. */
    const bodyHost = (instance: Core): HTMLElement | null =>
      block(instance, 'body1').holder.closest<HTMLElement>('[inert]');

    /** The body sits in an open page that takes input. */
    const editableInPage = (instance: Core): boolean =>
      block(instance, 'body1').holder.closest('[data-blok-database-drawer]') !== null && bodyHost(instance) === null;

    it('an open page does not stay editable after the host denies editContent and toggles read-only', async () => {
      const denied: DatabasePermissionAction[] = [];
      const instance = await boot(denied);

      block(instance, 'db').call('openRow', { rowId: 'r1' });
      await quiet();
      expect(editableInPage(instance)).toBe(true);

      denied.push('editContent');
      await instance.moduleInstances.ReadOnly.toggle(true);
      await instance.moduleInstances.ReadOnly.toggle(false);
      await quiet();

      expect(editableInPage(instance)).toBe(false);
    });

    it('an open page leaves inert when the host allows editContent again', async () => {
      const denied: DatabasePermissionAction[] = ['editContent'];
      const instance = await boot(denied);

      block(instance, 'db').call('openRow', { rowId: 'r1' });
      await quiet();
      expect(bodyHost(instance)).not.toBeNull();

      denied.length = 0;
      await instance.moduleInstances.ReadOnly.toggle(true);
      await instance.moduleInstances.ReadOnly.toggle(false);
      await quiet();

      expect(bodyHost(instance)).toBeNull();
    });
  });

  describe('without editStructure', () => {
    it('the block menu matches a locked database: delete and duplicate stay', async () => {
      const denied = await menuItems(await boot(['editStructure']), 'db');

      if (core !== undefined) await destroyCore(core);
      holder?.remove();
      const locked = await menuItems(await boot([], true), 'db');

      expect(denied).toEqual(locked);
      expect(denied).toContain('delete');
    });

    it('the agent can still edit a row body block', async () => {
      const instance = await boot(['editStructure']);

      expect(await run(instance, { commands: [{ name: 'block.update', args: { id: 'body1', data: { text: 'agent' } } }] })).toBeNull();
    });
  });
});
