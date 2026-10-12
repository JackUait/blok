import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../src/blok';
import { Column, ColumnList, Paragraph, Table, TabsTool, TabTool } from '../../../src/tools';
import type { Agent, AgentBatch, OutputData } from '../../../types';

interface TestEditor { isReady: Promise<unknown>; destroy: () => void; agent: Agent; save: () => Promise<OutputData> }

const editors: TestEditor[] = [];

const boot = async (data: OutputData): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  const editor = new Blok({
    holder,
    data,
    tools: { paragraph: { class: Paragraph }, table: { class: Table }, column_list: { class: ColumnList }, column: { class: Column }, tabs: { class: TabsTool }, tab: { class: TabTool } },
  }) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;

  return editor;
};

const run = async (editor: TestEditor, batch: AgentBatch): Promise<unknown> => {
  const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

  try {
    const result = await turn.execute(batch);

    return result.ok ? null : result.error;
  } finally {
    turn.end();
  }
};

const childrenOf = (doc: OutputData, id: string): string[] =>
  doc.blocks.filter((block) => block.parent === id).map((block) => block.id ?? '');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('agent container actions in the editor', () => {
  const columns: OutputData = {
    blocks: [
      { id: 'co1', type: 'column_list', data: {}, content: ['co2', 'co3'] },
      { id: 'co2', type: 'column', data: {}, parent: 'co1', content: ['co4'] },
      { id: 'co4', type: 'paragraph', data: { text: '' }, parent: 'co2' },
      { id: 'co3', type: 'column', data: {}, parent: 'co1', content: ['co5'] },
      { id: 'co5', type: 'paragraph', data: { text: '' }, parent: 'co3' },
    ],
  };

  it('column_list.addColumn at the end leaves three columns for the next command', async () => {
    const editor = await boot(columns);

    expect(await run(editor, { commands: [{ name: 'column_list.addColumn', args: { id: 'co1', at: 2 } }] })).toBeNull();
    expect(childrenOf(await editor.save(), 'co1')).toHaveLength(3);
    expect(await run(editor, { commands: [{ name: 'column_list.setWidths', args: { id: 'co1', ratios: [2, 1, 1] } }] })).toBeNull();
  });

  it('tabs.addTab puts the tab inside the tabs block, so deleteTab can find it', async () => {
    const editor = await boot({
      blocks: [
        { id: 'tb1', type: 'tabs', data: {}, content: ['tb2', 'tb3'] },
        { id: 'tb2', type: 'tab', data: { title: 'One' }, parent: 'tb1' },
        { id: 'tb3', type: 'tab', data: { title: 'Two' }, parent: 'tb1' },
      ],
    });

    expect(await run(editor, { commands: [{ name: 'tabs.addTab', args: { id: 'tb1', title: 'Three' } }] })).toBeNull();
    expect(childrenOf(await editor.save(), 'tb1')).toHaveLength(3);
    expect(await run(editor, { commands: [{ name: 'tabs.deleteTab', args: { id: 'tb1', tabId: 'tb2' } }] })).toBeNull();
    expect(childrenOf(await editor.save(), 'tb1')).toEqual(['tb3', expect.any(String)]);
  });

  // A planned container brings its own children, so the tool must not also seed defaults (BlockOrigin 'paste').
  it('tabs.create makes exactly the tabs it asked for', async () => {
    const editor = await boot({ blocks: [{ id: 'p', type: 'paragraph', data: { text: 'x' } }] });

    expect(await run(editor, { commands: [{ name: 'tabs.create', args: { tabs: [{ title: 'A' }, { title: 'B' }], position: 'end' } }] })).toBeNull();
    const saved = await editor.save();
    const tabs = saved.blocks.find((block) => block.type === 'tabs');

    expect(saved.blocks.filter((block) => block.type === 'tab').map((block) => block.data.title)).toEqual(['A', 'B']);
    expect(childrenOf(saved, tabs?.id ?? '')).toHaveLength(2);
  });

  it('column_list.create makes exactly the columns it asked for', async () => {
    const editor = await boot({ blocks: [{ id: 'p', type: 'paragraph', data: { text: 'x' } }] });

    expect(await run(editor, { commands: [{ name: 'column_list.create', args: { count: 3, position: 'end' } }] })).toBeNull();
    const saved = await editor.save();
    const list = saved.blocks.find((block) => block.type === 'column_list');

    expect(childrenOf(saved, list?.id ?? '')).toHaveLength(3);
    expect(saved.blocks.filter((block) => block.type === 'column')).toHaveLength(3);
  });

  it('table.fillCells leaves every table child named by a cell', async () => {
    const editor = await boot({
      blocks: [
        { id: 't', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['a'] }, { blocks: ['b'] }]] }, content: ['a', 'b'] },
        { id: 'a', type: 'paragraph', data: { text: 'left' }, parent: 't' },
        { id: 'b', type: 'paragraph', data: { text: 'right' }, parent: 't' },
      ],
    });

    expect(await run(editor, { commands: [{ name: 'table.fillCells', args: { id: 't', range: { fromRow: 0, fromCol: 0, toRow: 0, toCol: 1 }, direction: 'right' } }] })).toBeNull();
    await new Promise((done) => setTimeout(done, 50));
    const saved = await editor.save();
    const table = saved.blocks.find((block) => block.id === 't');
    const named = JSON.stringify(table?.data.content);

    expect(childrenOf(saved, 't').filter((id) => !named.includes(`"${id}"`))).toEqual([]);
    expect(saved.blocks.filter((block) => block.parent === 't').map((block) => block.data.text)).toEqual([[{ text: 'left' }], [{ text: 'left' }]]);
  });
});
