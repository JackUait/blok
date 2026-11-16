import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Blok } from '../../../../src/blok';
import type { Blok as PublicBlok } from '../../../../types';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Table } from '../../../../src/tools/table';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';

let editor: PublicBlok | undefined;
beforeEach(() => { vi.clearAllMocks(); });
afterEach(async () => { await editor?.destroy(); document.body.replaceChildren(); vi.restoreAllMocks(); });

async function createEditor(readOnly = false): Promise<PublicBlok> {
  const holder = document.createElement('div'); document.body.append(holder);
  editor = new Blok({ holder, readOnly, tools: { paragraph: Paragraph, table: Table, database: DatabaseTool, 'database-row': DatabaseRowTool }, data: { blocks: [
    { id: 'db', type: 'database', data: { schema: [{ id: 'title', name: 'Name', type: 'title', position: 'a0' }], views: [{ id: 'v', type: 'table', name: 'Table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }], activeViewId: 'v' }, content: ['r1', 'r2'] },
    ...['r1', 'r2'].flatMap((id, index) => [
      { id, type: 'database-row', parent: 'db', content: [`t${index}`], data: { properties: { title: id }, position: `a${index}`, bodyBlocks: true } },
      { id: `t${index}`, type: 'table', parent: id, data: { content: [['A', 'B'], ['C', 'D']], withHeadings: true } },
    ]),
  ] } }) as unknown as PublicBlok;
  await editor.isReady;
  return editor;
}

it('keeps closed row tables in the document without constructing their DOM, then opens just one body', async () => {
  const editor = await createEditor();
  expect(document.querySelectorAll('table')).toHaveLength(0);
  const before = await editor.save();
  expect(document.querySelectorAll('table')).toHaveLength(0);
  // Legacy cells are migrated to paragraph blocks before composition. Saving
  // an unopened body must preserve those references and their text unchanged.
  const unopened = before.blocks.filter(block => block.id === 't1' || block.parent === 't1');
  expect(unopened.filter(block => block.type === 'paragraph').map(block => block.data.text)).toEqual([
    [{ text: 'A' }], [{ text: 'B' }], [{ text: 'C' }], [{ text: 'D' }],
  ]);
  expect(editor.history.canUndo()).toBe(false);
  editor.blocks.getById('db')?.call('openRow', { rowId: 'r1' });
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  expect(document.querySelectorAll('table')).toHaveLength(1);
  expect(document.querySelector('table')?.textContent).toContain('A');
  expect(editor.history.canUndo()).toBe(false);
  await editor.blocks.update('r1', { properties: { title: 'Renamed while open' } });
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  expect(editor.blocks.getById('r1')?.holder.classList.contains('hidden')).toBe(false);
  expect(editor.blocks.getById('r1')?.holder.querySelectorAll('table')).toHaveLength(1);
  const after = await editor.save();
  expect(after.blocks.filter(block => block.id === 't1' || block.parent === 't1')).toEqual(unopened);
  expect(after.blocks.find(block => block.id === 't0')?.parent).toBe('r1');
  // Moving an unopened container into the page wakes its whole body.
  editor.blocks.setBlockParent('t1', null);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  expect(document.querySelectorAll('table')).toHaveLength(2);
  expect(editor.blocks.getById('t1')?.holder.textContent).toContain('A');
}, 30_000);


it('updates and undoes unopened cell content without constructing its table', async () => {
  const editor = await createEditor();
  const original = (await editor.save()).blocks.find(block => block.type === 'paragraph' && block.parent === 't1');
  if (original?.id === undefined) throw new Error('Missing table cell paragraph');
  await editor.blocks.update(original.id, { text: 'Edited while closed' });
  expect(document.querySelectorAll('table')).toHaveLength(0);
  expect((await editor.save()).blocks.find(block => block.id === original.id)?.data.text).toEqual([{ text: 'Edited while closed' }]);
  editor.history.undo();
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  expect(document.querySelectorAll('table')).toHaveLength(0);
  expect((await editor.save()).blocks.find(block => block.id === original.id)?.data.text).toEqual(original.data.text);
  editor.blocks.getById('db')?.call('openRow', { rowId: 'r2' });
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  expect(document.querySelectorAll('table')).toHaveLength(1);
  expect(document.querySelector('table')?.textContent).toContain('A');
});

it('opens read-only bodies without editable descendants', async () => {
  const editor = await createEditor(true);
  expect(document.querySelectorAll('table')).toHaveLength(0);
  editor.blocks.getById('db')?.call('openRow', { rowId: 'r1' });
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  expect(document.querySelectorAll('table')).toHaveLength(1);
  expect(editor.blocks.getById('t0')?.holder.querySelector('[contenteditable="true"]')).toBeNull();
});
