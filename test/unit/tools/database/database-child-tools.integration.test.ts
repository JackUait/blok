import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../src/components/core';
import { BlockPlacementError } from '../../../../src/components/modules/api/block-placement';
import { DropTargetDetector } from '../../../../src/components/modules/drag/target/DropTargetDetector';
import { destroy as destroyTooltip } from '../../../../src/components/utils/tooltip';
import { Paragraph } from '../../../../src/tools/paragraph';
import { List, TabsTool, TabTool, Toggle } from '../../../../src/tools';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { DatabaseCommentTool } from '../../../../src/tools/database-comment';
import type { DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';
import type { OutputBlockData } from '../../../../types';

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
];

/** p0, the database (a row with a body, then a row without one), p2. */
const doc = (): OutputBlockData[] => [
  { id: 'p0', type: 'paragraph', data: { text: 'before' } },
  { id: 'db', type: 'database', content: ['r1', 'r2'], data: { title: 'Projects', schema, views: [view], activeViewId: 'v1' } },
  { id: 'r1', type: 'database-row', parent: 'db', content: ['body1'], data: { properties: { t: 'Row' }, position: 'a0', bodyBlocks: true } },
  { id: 'body1', type: 'paragraph', parent: 'r1', data: { text: 'body text' } },
  { id: 'r2', type: 'database-row', parent: 'db', data: { properties: { t: 'Row 2' }, position: 'a1' } },
  { id: 'p2', type: 'paragraph', data: { text: 'after' } },
];

const boot = async (blocks = doc()): Promise<Core> => {
  holder = document.createElement('div');
  document.body.appendChild(holder);
  const instance = new Core({
    holder, tabSync: false, dataModel: 'hierarchical', i18n: { locale: 'en' },
    tools: { paragraph: Paragraph, list: List, toggle: Toggle, tabs: TabsTool, tab: TabTool, database: DatabaseTool, 'database-row': DatabaseRowTool, 'database-comment': DatabaseCommentTool },
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

const editableOf = (instance: Core, id: string): HTMLElement => {
  const found = [...block(instance, id).holder.querySelectorAll<HTMLElement>('*')]
    .find((element) => element.contentEditable === 'true');

  if (found === undefined) throw new Error(`no editable in ${id}`);

  return found;
};

/** Puts the caret at the start of a block and presses a key there. */
const pressAtStart = async (instance: Core, id: string, key: string): Promise<void> => {
  const editable = editableOf(instance, id);
  const range = document.createRange();

  // jsdom does not reflect contentEditable to the attribute that block inputs are found by.
  [...(holder?.querySelectorAll<HTMLElement>('*') ?? [])]
    .filter((element) => element.contentEditable === 'true')
    .forEach((element) => element.setAttribute('contenteditable', 'true'));
  editable.focus();
  range.selectNodeContents(editable);
  range.collapse(true);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  instance.moduleInstances.BlockManager.setCurrentBlockByChildNode(editable);
  block(instance, id).currentInput = editable;
  editable.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  await quiet();
};

/** Drags a block by its handle and drops it on the bottom half of another block's holder. */
const dragOnto = async (instance: Core, id: string, targetId: string, clientX: number): Promise<void> => {
  const { DragManager } = instance.moduleInstances;
  const target = block(instance, targetId).holder;
  const rect = { top: 100, bottom: 140, left: 0, right: 600, width: 600, height: 40, x: 0, y: 100, toJSON: () => ({}) };
  const clientY = 135;

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

const savedOf = async (instance: Core, id: string): Promise<OutputBlockData | undefined> =>
  (await instance.moduleInstances.Saver.save())?.blocks.find((saved) => saved.id === id);

describe('a database takes only its own child blocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom has no hit testing; a started drag asks it on every move.
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null });
  });

  afterEach(async () => {
    if (core !== undefined) await destroyCore(core);
    core = undefined;
    holder?.remove();
    holder = undefined;
    destroyTooltip();
    document.body.innerHTML = '';
    Reflect.deleteProperty(document, 'elementFromPoint');
    vi.restoreAllMocks();
  });

  it('Tab on the paragraph right after a database does not nest it under the database', async () => {
    const instance = await boot();

    await pressAtStart(instance, 'p2', 'Tab');

    expect(block(instance, 'p2').parentId).toBeNull();
    expect(block(instance, 'db').contentIds).toEqual(['r1', 'r2']);
  });

  it('a list item dropped right below a database at a deeper indent does not nest under it', async () => {
    const instance = await boot([...doc(), { id: 'l', type: 'list', data: { text: 'item', style: 'unordered' } }]);

    await dragOnto(instance, 'l', 'db', 400);

    expect(block(instance, 'l').parentId).toBeNull();
    expect(block(instance, 'db').contentIds).toEqual(['r1', 'r2']);
  });

  it('a list drop that still asks for a deeper indent below a database lands beside it', async () => {
    const instance = await boot([...doc(), { id: 'l', type: 'list', data: { text: 'item', style: 'unordered' } }]);

    // The indicator's own clamp is covered elsewhere: here the drop itself must refuse.
    vi.spyOn(DropTargetDetector.prototype, 'calculateTargetDepth').mockReturnValue(1);
    await dragOnto(instance, 'l', 'db', 400);

    expect(block(instance, 'l').parentId).toBeNull();
    expect(block(instance, 'db').contentIds).toEqual(['r1', 'r2']);
  });

  it('moveTo refuses to put a paragraph under a database', async () => {
    const instance = await boot();
    const { blocks } = instance.moduleInstances.API.methods;

    expect(() => blocks.moveTo('p2', { parentId: 'db', position: 'end' })).toThrow(BlockPlacementError);
    expect(block(instance, 'p2').parentId).toBeNull();
    expect(block(instance, 'db').contentIds).toEqual(['r1', 'r2']);
  });

  it('a paragraph inserted at the index right after the database stays a paragraph at the root', async () => {
    const instance = await boot();
    const { blocks } = instance.moduleInstances.API.methods;
    const index = blocks.getBlockIndex('p2');

    if (index === undefined) throw new Error('p2 has no index');
    const inserted = blocks.insert('paragraph', { text: 'new' }, undefined, index, false);

    await quiet();

    expect(inserted.name).toBe('paragraph');
    expect(block(instance, inserted.id).parentId).toBeNull();
    expect(block(instance, 'db').contentIds).toEqual(['r1', 'r2']);
  });

  it('Tab on a selection that starts with the database does not nest the next block under it', async () => {
    const instance = await boot(doc().filter((b) => b.id !== 'p0'));
    const { BlockSelection, BlockEvents } = instance.moduleInstances;

    BlockSelection.selectBlock(block(instance, 'db'));
    BlockSelection.selectBlock(block(instance, 'p2'));
    BlockEvents.keydown(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    await quiet();

    expect(block(instance, 'p2').parentId).toBeNull();
    expect(block(instance, 'db').contentIds).toEqual(['r1', 'r2']);
  });

  it('Shift+Tab on a database inside a toggle does not hand it the blocks after it', async () => {
    const instance = await boot([
      { id: 'tg', type: 'toggle', data: { text: 'toggle', isOpen: true }, content: ['a', 'db', 'x'] },
      { id: 'a', type: 'paragraph', parent: 'tg', data: { text: 'a' } },
      ...doc().filter((b) => b.id !== 'p0' && b.id !== 'p2').map((b) => b.id === 'db' ? { ...b, parent: 'tg' } : b),
      { id: 'x', type: 'paragraph', parent: 'tg', data: { text: 'x' } },
    ]);
    const { BlockSelection, BlockEvents } = instance.moduleInstances;

    BlockSelection.selectBlock(block(instance, 'db'));
    BlockEvents.keydown(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    await quiet();

    expect(block(instance, 'db').contentIds).toEqual(['r1', 'r2']);
    expect(block(instance, 'x').parentId).not.toBe('db');
  });

  it('a nested list pasted into the empty paragraph after a database does not nest under it', async () => {
    const instance = await boot([...doc(), { id: 'pe', type: 'paragraph', data: { text: '' } }].filter((b) => b.id !== 'p2'));

    instance.moduleInstances.BlockManager.currentBlock = block(instance, 'pe');
    await instance.moduleInstances.Paste.processText('<ul><li>a<ul><li>b</li></ul></li></ul>', true);
    await quiet();

    const saved = (await instance.moduleInstances.Saver.save())?.blocks ?? [];

    expect(saved.filter((b) => b.parent === 'db').map((b) => b.type)).toEqual(['database-row', 'database-row']);
    expect(block(instance, 'db').contentIds).toEqual(['r1', 'r2']);
    expect(saved.filter((b) => b.type === 'list').length).toBeGreaterThan(0);
  });

  it('insertAt a paragraph under the database makes a row with empty properties instead', async () => {
    const instance = await boot();
    const { blocks } = instance.moduleInstances.API.methods;

    const made = blocks.insertAt('paragraph', { text: 'x' }, { parentId: 'db', position: 'end' });

    await quiet();

    expect(made.name).toBe('database-row');
    expect(block(instance, 'db').contentIds).toEqual(['r1', 'r2', made.id]);
    expect((await savedOf(instance, made.id))?.type).toBe('database-row');
    // The row keeps the given data as extra keys; its properties start empty.
    expect((await savedOf(instance, made.id))?.data).toMatchObject({ properties: {}, text: 'x' });
  });

  it('rows, a second data source and a page layout tabs block still go under the database', async () => {
    const instance = await boot();
    const { blocks } = instance.moduleInstances.API.methods;

    const row = blocks.insertAt('database-row', { properties: { t: 'Row 3' }, position: 'a2' }, { parentId: 'db', position: 'end' });
    const source = blocks.insertAt('database', { title: 'Source', schema, views: [view], activeViewId: 'v1' }, { parentId: 'db', position: 'end' });
    const tabs = blocks.insertAt('tabs', { noSeed: true }, { parentId: 'db', position: 'end' });

    await quiet();

    expect([row.name, source.name, tabs.name]).toEqual(['database-row', 'database', 'tabs']);
    expect(block(instance, 'db').contentIds).toEqual(['r1', 'r2', row.id, source.id, tabs.id]);
    expect((await savedOf(instance, row.id))?.type).toBe('database-row');
  });

  it('a row page body still takes a paragraph, and Tab inside it nests under its sibling', async () => {
    const instance = await boot([
      ...doc().map((b) => b.id === 'r1' ? { ...b, content: ['body1', 'body2'] } : b),
      { id: 'body2', type: 'paragraph', parent: 'r1', data: { text: 'more' } },
    ]);

    await pressAtStart(instance, 'body2', 'Tab');

    expect(block(instance, 'body2').parentId).toBe('body1');
  });
});
