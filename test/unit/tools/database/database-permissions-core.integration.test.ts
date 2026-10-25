import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../src/components/core';
import { destroy as destroyTooltip } from '../../../../src/components/utils/tooltip';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Column, ColumnList, List, Toggle } from '../../../../src/tools';
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
      list: List,
      column_list: ColumnList,
      column: Column,
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

/** Each batch's error code, or null when it wrote. All batches run in one turn. */
const runAll = async (instance: Core, batches: AgentBatch[]): Promise<Array<string | null>> => {
  const agent = instance.moduleInstances.API.methods.agent;

  if (agent === undefined) throw new Error('agent API is missing');
  const turn = agent.begin({ agent: { id: 'bot', name: 'Bot' } });
  const codes: Array<string | null> = [];

  try {
    for (const batch of batches) {
      const result = await turn.execute(batch);

      codes.push(result.ok ? null : result.error.code);
    }

    return codes;
  } finally {
    turn.end();
  }
};

const run = async (instance: Core, batch: AgentBatch): Promise<string | null> => (await runAll(instance, [batch]))[0] ?? null;

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

      expect(await run(instance, { commands: [{ name: 'block.delete', args: { id: 'db' } }] })).toBe('PRECONDITION_FAILED');
      expect(await run(instance, { commands: [{ name: 'block.update', args: { id: 'body1', data: { text: 'agent' } } }] })).toBe('PRECONDITION_FAILED');
      expect(await run(instance, { commands: [{ name: 'block.insert', args: { type: 'paragraph', data: { text: 'x' }, parentId: 'r1', position: 'end' } }] })).toBe('PRECONDITION_FAILED');
      expect(await run(instance, { commands: [{ name: 'database.addRow', args: { id: 'db', values: { t: 'Agent row' } } }] })).toBe('PRECONDITION_FAILED');
      expect(await ids(instance)).toEqual(expect.arrayContaining(['db', 'r1', 'body1']));
    });

    /** A column list whose delete takes its columns and their blocks along (deletesChildren). */
    const inColumns = (): OutputBlockData[] => [
      { id: 'p0', type: 'paragraph', data: { text: 'before' } },
      { id: 'cl', type: 'column_list', data: {}, content: ['c1', 'c2'] },
      { id: 'c1', type: 'column', data: {}, parent: 'cl', content: ['db'] },
      ...doc().filter((b) => b.id !== 'p0').map((b) => b.id === 'db' ? { ...b, parent: 'c1' } : b),
      { id: 'c2', type: 'column', data: {}, parent: 'cl', content: ['q'] },
      { id: 'q', type: 'paragraph', parent: 'c2', data: { text: 'side' } },
    ];

    it('the agent cannot delete a block that would take the database along', async () => {
      const instance = await boot(['editContent'], false, inColumns());

      expect(await run(instance, { commands: [{ name: 'block.delete', args: { id: 'cl' } }] })).toBe('PRECONDITION_FAILED');
      expect(await ids(instance)).toEqual(expect.arrayContaining(['cl', 'c1', 'db', 'r1', 'body1']));
    });

    it('a selection delete keeps a block that would take the database along', async () => {
      const instance = await boot(['editContent'], false, inColumns());
      const { BlockSelection, BlockManager } = instance.moduleInstances;

      BlockSelection.selectBlock(block(instance, 'cl'));
      BlockManager.deleteSelectedBlocksAndInsertReplacement();
      await quiet();

      expect(await ids(instance)).toEqual(expect.arrayContaining(['cl', 'c1', 'db', 'r1', 'body1']));
    });

    it('the agent cannot move a block that holds the database', async () => {
      const instance = await boot(['editContent'], false, inColumns());

      expect(await run(instance, { commands: [{ name: 'block.move', args: { id: 'cl', position: 'start' } }] })).toBe('PRECONDITION_FAILED');
      expect((await ids(instance))[0]).toBe('p0');
    });

    it('one plan cannot move a block into the database and then edit it', async () => {
      const instance = await boot(['editContent']);

      expect(await run(instance, { commands: [
        { name: 'block.move', args: { id: 'p0', parentId: 'r1', position: 'end' } },
        { name: 'block.update', args: { id: 'p0', data: { text: 'agent' } } },
      ] })).toBe('PRECONDITION_FAILED');
      expect(block(instance, 'p0').parentId).toBeNull();
    });

    it('one plan cannot insert a block and then move it into the database', async () => {
      const instance = await boot(['editContent']);

      expect(await run(instance, { commands: [
        { name: 'block.insert', args: { type: 'paragraph', data: { text: 'new' }, position: 'end' }, ref: 'fresh' },
        { name: 'block.move', args: { id: '$fresh', parentId: 'r1', position: 'end' } },
        { name: 'block.update', args: { id: '$fresh', data: { text: 'agent' } } },
      ] })).toBe('PRECONDITION_FAILED');
      expect(block(instance, 'r1').contentIds).toEqual(['body1']);
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

    it('in the same turn, a refused batch does not stop edits outside the database', async () => {
      const instance = await boot(['editContent']);

      expect(await runAll(instance, [
        { commands: [{ name: 'block.delete', args: { id: 'db' } }] },
        { commands: [{ name: 'block.update', args: { id: 'p0', data: { text: 'agent' } } }] },
      ])).toEqual(['PRECONDITION_FAILED', null]);
    });

    it('the host API still writes rows: the host owns both the gate and the API', async () => {
      const instance = await boot(['editContent']);

      await instance.moduleInstances.API.methods.blocks.update('body1', { text: 'host' });
      await quiet();

      const saved = await instance.moduleInstances.Saver.save();

      expect(saved?.blocks.find((b) => b.id === 'body1')?.data).toEqual({ text: [{ text: 'host' }] });
    });
  });

  describe('keyboard and drop paths without editContent', () => {
    /** p0, the database with a two-block row page body, then p2. */
    const around = (): OutputBlockData[] => [
      ...doc().map((b) => b.id === 'r1' ? { ...b, content: ['body1', 'body2'] } : b),
      { id: 'body2', type: 'paragraph', parent: 'r1', data: { text: 'more body' } },
      { id: 'p2', type: 'paragraph', data: { text: 'after' } },
    ];

    const editableOf = (instance: Core, id: string): HTMLElement => {
      const found = [...block(instance, id).holder.querySelectorAll<HTMLElement>('*')]
        .find((element) => element.contentEditable === 'true');

      if (found === undefined) throw new Error(`no editable in ${id}`);

      return found;
    };

    /** Puts the caret at the start or end of a block and presses a key there. */
    const press = async (instance: Core, id: string, key: string, at: 'start' | 'end', shiftKey = false): Promise<void> => {
      const editable = editableOf(instance, id);
      const range = document.createRange();

      // jsdom does not reflect contentEditable to the attribute that block inputs are found by.
      [...(holder?.querySelectorAll<HTMLElement>('*') ?? [])]
        .filter((element) => element.contentEditable === 'true')
        .forEach((element) => element.setAttribute('contenteditable', 'true'));
      editable.focus();
      range.selectNodeContents(editable);
      range.collapse(at === 'start');
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      instance.moduleInstances.BlockManager.setCurrentBlockByChildNode(editable);
      block(instance, id).currentInput = editable;
      editable.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
      await quiet();
    };

    const textOf = async (instance: Core, id: string): Promise<unknown> =>
      (await instance.moduleInstances.Saver.save())?.blocks.find((b) => b.id === id)?.data.text;

    it('Cmd+Shift+Up and Down do not move a row page body block', async () => {
      const instance = await boot(['editContent'], false, around());
      const { BlockManager } = instance.moduleInstances;

      BlockManager.currentBlock = block(instance, 'body2');
      BlockManager.moveCurrentBlockUp();
      await quiet();
      expect(block(instance, 'r1').contentIds).toEqual(['body1', 'body2']);

      BlockManager.currentBlock = block(instance, 'body1');
      BlockManager.moveCurrentBlockDown();
      await quiet();
      expect(block(instance, 'r1').contentIds).toEqual(['body1', 'body2']);
    });

    it('Cmd+Shift+Up does not move the selected database, or a block holding it', async () => {
      const instance = await boot(['editContent'], false, around());
      const { BlockManager, BlockSelection } = instance.moduleInstances;

      BlockSelection.selectBlock(block(instance, 'db'));
      BlockManager.moveCurrentBlockUp();
      await quiet();

      expect((await ids(instance)).slice(0, 2)).toEqual(['p0', 'db']);
    });

    it('Cmd+Shift+Down still moves a block past the database, at its own level', async () => {
      const instance = await boot(['editContent'], false, around());
      const { BlockManager } = instance.moduleInstances;

      BlockManager.currentBlock = block(instance, 'p0');
      BlockManager.moveCurrentBlockDown();
      await quiet();

      const saved = await ids(instance);

      expect(saved.indexOf('p0')).toBeGreaterThan(saved.indexOf('body2'));
      expect(block(instance, 'p0').parentId).toBeNull();
      expect(block(instance, 'r1').contentIds).toEqual(['body1', 'body2']);
    });

    it('Tab does not nest a block into the database', async () => {
      const instance = await boot(['editContent'], false, around());

      await press(instance, 'p2', 'Tab', 'start');

      expect(block(instance, 'p2').parentId).toBeNull();
      expect(block(instance, 'db').contentIds).toEqual(['r1']);
    });

    it('Tab with a block selection does not nest blocks under the database', async () => {
      const instance = await boot(['editContent'], false, around());
      const { BlockSelection } = instance.moduleInstances;

      BlockSelection.selectBlock(block(instance, 'db'));
      BlockSelection.selectBlock(block(instance, 'p2'));
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      instance.moduleInstances.BlockEvents.keydown(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      await quiet();

      expect(block(instance, 'p2').parentId).toBeNull();
      expect(block(instance, 'db').contentIds).toEqual(['r1']);
    });

    it('Shift+Tab does not adopt the database as a child', async () => {
      const blocks: OutputBlockData[] = [
        { id: 'tg', type: 'toggle', data: { text: 'toggle', isOpen: true }, content: ['a', 'db'] },
        { id: 'a', type: 'paragraph', parent: 'tg', data: { text: 'a' } },
        ...doc().filter((b) => b.id !== 'p0').map((b) => b.id === 'db' ? { ...b, parent: 'tg' } : b),
      ];
      const instance = await boot(['editContent'], false, blocks);

      await press(instance, 'a', 'Tab', 'start', true);

      expect(block(instance, 'db').parentId).toBe('tg');
    });

    it('Backspace at the start of the next block does not merge into a row page body block', async () => {
      const instance = await boot(['editContent'], false, around());

      await press(instance, 'p2', 'Backspace', 'start');

      expect(await textOf(instance, 'body2')).toEqual([{ text: 'more body' }]);
      expect(await ids(instance)).toContain('p2');
    });

    it('Backspace does not remove an empty row page body block', async () => {
      const blocks = around().map((b) => b.id === 'body2' ? { ...b, data: { text: '' } } : b);
      const instance = await boot(['editContent'], false, blocks);

      await press(instance, 'p2', 'Backspace', 'start');

      expect(await ids(instance)).toEqual(expect.arrayContaining(['body1', 'body2', 'p2']));
    });

    it('Backspace and Delete inside a row page body do not merge or remove its blocks', async () => {
      const instance = await boot(['editContent'], false, around());

      await press(instance, 'body2', 'Backspace', 'start');
      expect(await ids(instance)).toEqual(expect.arrayContaining(['body1', 'body2']));
      expect(await textOf(instance, 'body1')).toEqual([{ text: 'body text' }]);

      await press(instance, 'body1', 'Delete', 'end');
      expect(await ids(instance)).toEqual(expect.arrayContaining(['body1', 'body2']));
      expect(await textOf(instance, 'body1')).toEqual([{ text: 'body text' }]);
    });

    it('Delete at the end of the block before keeps the database', async () => {
      const instance = await boot(['editContent'], false, around());

      await press(instance, 'p0', 'Delete', 'end');
      await press(instance, 'p0', 'Delete', 'end');

      expect(await ids(instance)).toEqual(['p0', 'db', 'r1', 'body1', 'body2', 'p2']);
    });

    /** Drags a block by its handle and drops it on the bottom half of another block's holder. */
    const dragOnto = async (instance: Core, id: string, targetId: string, clientX = 50, clientY = 135): Promise<void> => {
      const { DragManager } = instance.moduleInstances;
      const target = block(instance, targetId).holder;
      const rect = { top: 100, bottom: 140, left: 0, right: 600, width: 600, height: 40, x: 0, y: 100, toJSON: () => ({}) };

      vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(rect);
      const content = target.querySelector<HTMLElement>('[data-blok-element-content]');

      if (content !== null) vi.spyOn(content, 'getBoundingClientRect').mockReturnValue(rect);
      Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target });

      const handle = document.createElement('button');
      const cleanup = DragManager.setupDragHandle(handle, block(instance, id));

      document.body.appendChild(handle);
      handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 50, clientY: 300 }));
      document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX, clientY: clientY - 5 }));
      document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX, clientY }));
      document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX, clientY }));
      await quiet();
      cleanup();
      handle.remove();
    };

    it('a list item dropped below the database at a deeper indent does not nest under it', async () => {
      const instance = await boot(['editContent'], false, [...around(), { id: 'l', type: 'list', data: { text: 'item', style: 'unordered' } }]);

      await dragOnto(instance, 'l', 'db', 400);

      expect(block(instance, 'l').parentId).toBeNull();
      expect(block(instance, 'db').contentIds).toEqual(['r1']);
    });

    it('a side drop beside the database does not wrap it in columns', async () => {
      const instance = await boot(['editContent'], false, around());

      await dragOnto(instance, 'p2', 'db', 590, 120);

      expect(block(instance, 'db').parentId).toBeNull();
      expect(block(instance, 'p2').parentId).toBeNull();
    });

    it('dropping a block onto a row page body block does not move it into the row', async () => {
      const instance = await boot(['editContent'], false, around());

      await dragOnto(instance, 'p2', 'body1');

      expect(block(instance, 'p2').parentId).toBeNull();
      expect(block(instance, 'r1').contentIds).toEqual(['body1', 'body2']);
    });
  });

  describe('undo and redo after editContent is denied', () => {
    const withBody2 = (): OutputBlockData[] => [
      ...doc().map((b) => b.id === 'r1' ? { ...b, content: ['body1', 'body2'] } : b),
      { id: 'body2', type: 'paragraph', parent: 'r1', data: { text: 'more body' } },
    ];

    const textOf = async (instance: Core, id: string): Promise<unknown> =>
      (await instance.moduleInstances.Saver.save())?.blocks.find((b) => b.id === id)?.data.text;

    /** One step of history, closed so the next write starts its own. */
    const step = async (instance: Core, write: () => unknown): Promise<void> => {
      const { YjsManager } = instance.moduleInstances;

      YjsManager.stopCapturing();
      await write();
      await quiet();
      YjsManager.stopCapturing();
    };

    it('a step that wrote into the database waits, and an older step still undoes', async () => {
      const denied: DatabasePermissionAction[] = [];
      const instance = await boot(denied, false, withBody2());
      const { YjsManager, API } = instance.moduleInstances;

      await step(instance, () => API.methods.blocks.update('p0', { text: 'older' }));
      await step(instance, () => API.methods.blocks.update('body1', { text: 'edited' }));
      denied.push('editContent');

      YjsManager.undo();
      await quiet();

      expect(await textOf(instance, 'body1')).toEqual([{ text: 'edited' }]);
      expect(await textOf(instance, 'p0')).toEqual([{ text: 'before' }]);

      denied.length = 0;
      YjsManager.undo();
      await quiet();

      expect(await textOf(instance, 'body1')).toEqual([{ text: 'body text' }]);
    });

    it('a move inside the database waits, and an older step still undoes', async () => {
      const denied: DatabasePermissionAction[] = [];
      const instance = await boot(denied, false, withBody2());
      const { YjsManager, API, BlockManager } = instance.moduleInstances;

      await step(instance, () => API.methods.blocks.update('p0', { text: 'older' }));
      await step(instance, () => {
        BlockManager.currentBlock = block(instance, 'body2');
        BlockManager.moveCurrentBlockUp();
      });
      expect(block(instance, 'r1').contentIds).toEqual(['body2', 'body1']);
      denied.push('editContent');

      YjsManager.undo();
      await quiet();

      expect(block(instance, 'r1').contentIds).toEqual(['body2', 'body1']);
      expect(await textOf(instance, 'p0')).toEqual([{ text: 'before' }]);

      denied.length = 0;
      YjsManager.undo();
      await quiet();

      expect(block(instance, 'r1').contentIds).toEqual(['body1', 'body2']);
    });

    it('a block moved past the database still moves back', async () => {
      const denied: DatabasePermissionAction[] = [];
      const instance = await boot(denied, false, withBody2());
      const { YjsManager, BlockManager } = instance.moduleInstances;

      await step(instance, () => {
        BlockManager.currentBlock = block(instance, 'p0');
        BlockManager.moveCurrentBlockDown();
      });
      expect((await ids(instance)).at(-1)).toBe('p0');
      denied.push('editContent');

      YjsManager.undo();
      await quiet();

      expect((await ids(instance))[0]).toBe('p0');
      expect(block(instance, 'r1').contentIds).toEqual(['body1', 'body2']);
    });

    it('a lone step that waited undoes again once the database opens', async () => {
      const denied: DatabasePermissionAction[] = [];
      const instance = await boot(denied, false, withBody2());
      const { YjsManager, API } = instance.moduleInstances;

      await step(instance, () => API.methods.blocks.update('body1', { text: 'edited' }));
      denied.push('editContent');

      expect(API.methods.history.canUndo()).toBe(false);
      YjsManager.undo();
      await quiet();
      expect(await textOf(instance, 'body1')).toEqual([{ text: 'edited' }]);

      denied.length = 0;

      expect(API.methods.history.canUndo()).toBe(true);
      API.methods.history.undo();
      await quiet();
      expect(await textOf(instance, 'body1')).toEqual([{ text: 'body text' }]);
    });

    it('a deleted row page body block does not come back while the database is read-only', async () => {
      const denied: DatabasePermissionAction[] = [];
      const instance = await boot(denied, false, withBody2());
      const { YjsManager, BlockManager } = instance.moduleInstances;

      await step(instance, () => BlockManager.removeBlock(block(instance, 'body2')));
      expect(await ids(instance)).not.toContain('body2');
      denied.push('editContent');

      YjsManager.undo();
      await quiet();
      expect(await ids(instance)).not.toContain('body2');

      denied.length = 0;
      YjsManager.undo();
      await quiet();
      expect(await ids(instance)).toContain('body2');
    });

    it('redo does not write into the database either', async () => {
      const denied: DatabasePermissionAction[] = [];
      const instance = await boot(denied, false, withBody2());
      const { YjsManager, API } = instance.moduleInstances;

      await step(instance, () => API.methods.blocks.update('body1', { text: 'edited' }));
      YjsManager.undo();
      await quiet();
      expect(await textOf(instance, 'body1')).toEqual([{ text: 'body text' }]);
      denied.push('editContent');

      YjsManager.redo();
      await quiet();

      expect(await textOf(instance, 'body1')).toEqual([{ text: 'body text' }]);

      denied.length = 0;
      YjsManager.redo();
      await quiet();

      expect(await textOf(instance, 'body1')).toEqual([{ text: 'edited' }]);
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

    it('the agent cannot add a property or a view, like on a locked database', async () => {
      const instance = await boot(['editStructure']);

      expect(await run(instance, { commands: [{ name: 'database.addProperty', args: { id: 'db', name: 'Size', type: 'number' } }] })).toBe('PRECONDITION_FAILED');
      expect(await run(instance, { commands: [{ name: 'database.addView', args: { id: 'db', type: 'board' } }] })).toBe('PRECONDITION_FAILED');
      expect(await run(instance, { commands: [{ name: 'database.addRow', args: { id: 'db', values: { t: 'Agent row' } } }] })).toBeNull();
    });

    it('the agent cannot change a view\'s settings or layout, or lock the database', async () => {
      const instance = await boot(['editStructure']);

      expect(await run(instance, { commands: [{ name: 'database.updateView', args: { id: 'db', viewId: 'v1', changes: { frozenColumnCount: 1 } } }] })).toBe('PRECONDITION_FAILED');
      expect(await run(instance, { commands: [{ name: 'database.setLayout', args: { id: 'db', viewId: 'v1', type: 'list' } }] })).toBe('PRECONDITION_FAILED');
      expect(await run(instance, { commands: [{ name: 'database.setLock', args: { id: 'db', locked: true } }] })).toBe('PRECONDITION_FAILED');
    });

    it('the agent can still edit a row body block', async () => {
      const instance = await boot(['editStructure']);

      expect(await run(instance, { commands: [{ name: 'block.update', args: { id: 'body1', data: { text: 'agent' } } }] })).toBeNull();
    });
  });

  describe('undo and redo after editStructure is denied', () => {
    /** One step of history, closed so the next write starts its own. */
    const step = async (instance: Core, write: () => unknown): Promise<void> => {
      const { YjsManager } = instance.moduleInstances;

      YjsManager.stopCapturing();
      await write();
      await quiet();
      YjsManager.stopCapturing();
    };

    const saved = async (instance: Core, id: string): Promise<OutputBlockData | undefined> =>
      (await instance.moduleInstances.Saver.save())?.blocks.find((b) => b.id === id);

    const propertyNames = async (instance: Core): Promise<string[]> => {
      const data: unknown = (await saved(instance, 'db'))?.data;
      const list: unknown = typeof data === 'object' && data !== null && 'schema' in data ? data.schema : [];

      return Array.isArray(list) ? list.map((property: unknown) => typeof property === 'object' && property !== null && 'name' in property ? String(property.name) : '') : [];
    };

    it('a schema change made before the deny waits, and an older step still undoes', async () => {
      const denied: DatabasePermissionAction[] = [];
      const instance = await boot(denied);
      const { YjsManager, API } = instance.moduleInstances;

      await step(instance, () => API.methods.blocks.update('p0', { text: 'older' }));
      await step(instance, () => run(instance, { commands: [{ name: 'database.addProperty', args: { id: 'db', name: 'Size', type: 'number' } }] }));
      expect(await propertyNames(instance)).toContain('Size');
      denied.push('editStructure');

      YjsManager.undo();
      await quiet();

      expect(await propertyNames(instance)).toContain('Size');
      expect((await saved(instance, 'p0'))?.data.text).toEqual([{ text: 'before' }]);

      denied.length = 0;
      YjsManager.undo();
      await quiet();

      expect(await propertyNames(instance)).not.toContain('Size');
    });

    it('redo does not bring a schema change back while editStructure is denied', async () => {
      const denied: DatabasePermissionAction[] = [];
      const instance = await boot(denied);
      const { YjsManager, API } = instance.moduleInstances;

      await step(instance, () => run(instance, { commands: [{ name: 'database.addProperty', args: { id: 'db', name: 'Size', type: 'number' } }] }));
      YjsManager.undo();
      await quiet();
      expect(await propertyNames(instance)).not.toContain('Size');
      denied.push('editStructure');

      YjsManager.redo();
      await quiet();
      expect(await propertyNames(instance)).not.toContain('Size');

      denied.length = 0;
      expect(API.methods.history.canRedo()).toBe(true);
      YjsManager.redo();
      await quiet();
      expect(await propertyNames(instance)).toContain('Size');
    });

    it('a database inserted before the deny still goes away on undo', async () => {
      const denied: DatabasePermissionAction[] = [];
      const instance = await boot(denied);
      const { YjsManager, API } = instance.moduleInstances;

      await step(instance, () => API.methods.blocks.insertAt('database', { title: 'Copy', schema, views: [view], activeViewId: 'v1' }, { position: 'end', id: 'db2' }));
      expect(await ids(instance)).toContain('db2');
      denied.push('editStructure');

      YjsManager.undo();
      await quiet();

      expect(await ids(instance)).not.toContain('db2');
    });

    it('a row added and a row edited before the deny still undo: rows stay open', async () => {
      const denied: DatabasePermissionAction[] = [];
      const instance = await boot(denied);
      const { YjsManager, API } = instance.moduleInstances;

      await step(instance, () => API.methods.blocks.update('r1', { properties: { t: 'Row', notes: 'edited' }, position: 'a0', bodyBlocks: true }));
      await step(instance, () => API.methods.blocks.insertAt('database-row', { properties: { t: 'New' }, position: 'a1' }, { parentId: 'db', position: 'end', id: 'r2' }));
      expect(block(instance, 'db').contentIds).toEqual(['r1', 'r2']);
      denied.push('editStructure');

      YjsManager.undo();
      await quiet();
      expect(block(instance, 'db').contentIds).toEqual(['r1']);

      YjsManager.undo();
      await quiet();
      expect((await saved(instance, 'r1'))?.data.properties).toEqual({ t: 'Row', notes: 'n' });
    });
  });
});
