import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../src/blok';
import { Code, Column, ColumnList, Header, Paragraph, Table } from '../../../src/tools';
import { openJsonSession } from './harness';

import type { Agent, AgentBatch, AgentError, AgentResult, OutputData } from '../../../types';

interface TestEditor { isReady: Promise<unknown>; destroy: () => void; agent: Agent }

const editors: TestEditor[] = [];
const seed: OutputData = { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'Intro' } }] };

const errorOf = (result: AgentResult): AgentError => {
  if (result.ok) {
    throw new Error('Expected a failed batch');
  }

  return result.error;
};

const inEditor = async (batch: AgentBatch): Promise<AgentError> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  const editor = new Blok({
    holder,
    data: structuredClone(seed),
    tools: {
      paragraph: { class: Paragraph }, header: { class: Header }, code: { class: Code },
      table: { class: Table }, column_list: { class: ColumnList }, column: { class: Column },
    },
  }) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;
  const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

  try {
    return errorOf(await turn.execute(batch));
  } finally {
    turn.end();
  }
};

const inJson = async (batch: AgentBatch): Promise<AgentError> => {
  const session = openJsonSession(structuredClone(seed));

  try {
    return errorOf(await session.execute(batch));
  } finally {
    session.close();
  }
};

const located = (error: AgentError): unknown[] =>
  [error, ...error.others ?? []].map(problem => [problem.code, problem.commandIndex, problem.path]);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  editors.splice(0).forEach(editor => editor.destroy());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('the in-app editor reports every problem of a failed batch, like the stored runtime', () => {
  it('lists the later ref mistakes and the bad nested data next to the first error', async () => {
    const batch = { commands: [
      { name: 'block.insert', args: { type: 'column_list', data: { columnCount: 2 }, children: [
        { type: 'column', id: 'colA', children: [{ type: 'header', id: 'hA', data: { level: 2 } }] },
        { type: 'column', id: 'colB', children: [{ type: 'header', id: 'hB', data: { level: 2 } }] },
      ] } },
      { name: 'text.replace', args: { id: '$headA', with: 'Plan A' } },
      { name: 'text.replace', args: { id: '$headB', with: 'Plan B' } },
      { name: 'block.insert', args: { type: 'code', data: { language: 'bash' } } },
    ] } as AgentBatch;
    const editor = await inEditor(batch);

    expect(located(editor)).toEqual([
      ['BLOCK_NOT_FOUND', 1, '/commands/1/args/id'],
      ['DATA_REJECTED', 0, '/commands/0/args/data'],
      ['DATA_REJECTED', 0, '/commands/0/args/children/0/children/0/data'],
      ['DATA_REJECTED', 0, '/commands/0/args/children/1/children/0/data'],
      ['BLOCK_NOT_FOUND', 2, '/commands/2/args/id'],
      ['DATA_REJECTED', 3, '/commands/3/args/data'],
    ]);
    expect(located(editor)).toEqual(located(await inJson(batch)));
  });
});
