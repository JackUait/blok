import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../src/blok';
import { Column, ColumnList, Database, DatabaseRow, Paragraph, TabsTool, TabTool } from '../../../src/tools';
import type { Agent, AgentBatch, OutputData } from '../../../types';

interface TestEditor { isReady: Promise<unknown>; destroy: () => void; agent: Agent; save: () => Promise<OutputData> }

const editors: TestEditor[] = [];

const boot = async (data: OutputData): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  const editor = new Blok({
    holder,
    data,
    user: { id: 'human-1' },
    tools: {
      paragraph: { class: Paragraph }, column_list: { class: ColumnList }, column: { class: Column },
      tabs: { class: TabsTool }, tab: { class: TabTool }, database: { class: Database }, 'database-row': { class: DatabaseRow },
    },
  }) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;

  return editor;
};

const execute = async (editor: TestEditor, batch: AgentBatch): Promise<unknown> => {
  const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

  try {
    const result = await turn.execute(batch);

    return result.ok ? null : result.error;
  } finally {
    turn.end();
  }
};

const lockedDb = (parent: string): OutputData['blocks'] => [
  {
    id: 'L', type: 'database', parent, content: ['L-row'],
    data: {
      schema: [{ id: 'Lt', name: 'Name', type: 'title', position: 'a0', databaseLocked: true }],
      views: [{ id: 'Lv', name: 'Table', type: 'table', position: 'a0', filters: [], sorts: [] }],
      activeViewId: 'Lv',
    },
  },
  { id: 'L-row', type: 'database-row', parent: 'L', content: [], data: { properties: { Lt: 'Row' }, position: 'a0' } },
];

const columns = (): OutputData => ({ blocks: [
  { id: 'cl', type: 'column_list', data: {}, content: ['c1', 'c2', 'c3'] },
  { id: 'c1', type: 'column', data: {}, parent: 'cl', content: ['L'] },
  { id: 'c2', type: 'column', data: {}, parent: 'cl', content: ['p2'] },
  { id: 'p2', type: 'paragraph', data: { text: 'two' }, parent: 'c2' },
  { id: 'c3', type: 'column', data: {}, parent: 'cl', content: ['p3'] },
  { id: 'p3', type: 'paragraph', data: { text: 'three' }, parent: 'c3' },
  ...lockedDb('c1'),
] });

const tabs = (): OutputData => ({ blocks: [
  { id: 'T', type: 'tabs', data: {}, content: ['t1', 't2'] },
  { id: 't1', type: 'tab', data: { title: 'One' }, parent: 'T', content: ['L'] },
  { id: 't2', type: 'tab', data: { title: 'Two' }, parent: 'T', content: ['p2'] },
  { id: 'p2', type: 'paragraph', data: { text: 'two' }, parent: 't2' },
  ...lockedDb('t1'),
] });

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('the editor agent never removes a locked database', () => {
  it.each([
    ['column_list.removeColumn', columns, { name: 'column_list.removeColumn', args: { id: 'cl', index: 0 } }],
    ['tabs.deleteTab', tabs, { name: 'tabs.deleteTab', args: { id: 'T', tabId: 't1' } }],
  ] as const)('%s is refused, and the database stays', async (_name, seed, command) => {
    const editor = await boot(seed());

    expect(await execute(editor, { commands: [command] })).toMatchObject({ code: 'PRECONDITION_FAILED', details: { reason: 'locked', blockIds: ['L'] } });
    expect((await editor.save()).blocks.map(block => block.id)).toContain('L');
  });
});
