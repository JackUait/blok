// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../src/blok';
import { Header, Paragraph, Table, Toggle } from '../../../src/tools';
import type { Agent, AgentBatch, AgentError, OutputData } from '../../../types';
import { openJsonSession, openStoreSession, TEST_ACTOR } from './harness';
import { normalizeForParity } from './parity/normalize';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  agent: Agent;
  save: () => Promise<OutputData>;
  blocks: { convert: (id: string, type: string, data?: Record<string, unknown>) => Promise<unknown> };
}

const editors: TestEditor[] = [];

// Two blocks in the first cell, one in the next: a section walk over the
// table's flat children would reach into the neighbour cell.
const seed: OutputData = {
  blocks: [
    { id: 't', type: 'table', data: { withHeadings: false, withHeadingColumn: false, content: [[{ blocks: ['a', 'b'] }, { blocks: ['c'] }]] }, content: ['a', 'b', 'c'] },
    { id: 'a', type: 'paragraph', data: { text: 'one' }, parent: 't' },
    { id: 'b', type: 'paragraph', data: { text: 'two' }, parent: 't' },
    { id: 'c', type: 'paragraph', data: { text: 'three' }, parent: 't' },
    { id: 'z', type: 'paragraph', data: { text: 'after' } },
  ],
};

const toToggleHeading: AgentBatch = {
  commands: [{ name: 'block.convert', args: { id: 'a', type: 'header', data: { level: 2, isToggleable: true } } }],
};

const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 50));

const boot = async (): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  const editor = new Blok({
    holder,
    // TEST_ACTOR acts for human-1; headless runs credit that person too.
    user: { id: 'human-1' },
    data: structuredClone(seed),
    tools: { paragraph: { class: Paragraph }, header: { class: Header }, toggle: { class: Toggle }, table: { class: Table } },
  }) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;

  return editor;
};

// blocks.convert reaches BlockManager.convert without a plan, like Turn into.
const runPerson = async (): Promise<OutputData> => {
  const editor = await boot();

  await editor.blocks.convert('a', 'header', { level: 2, isToggleable: true });
  await settle();

  return editor.save();
};

const runAgentInEditor = async (): Promise<{ error: AgentError | null; doc: OutputData }> => {
  const editor = await boot();
  const turn = editor.agent.begin({ agent: { id: TEST_ACTOR.id, name: TEST_ACTOR.name } });
  const result = await turn.execute(toToggleHeading);

  turn.end();
  await settle();

  return { error: result.ok ? null : result.error, doc: await editor.save() };
};

const runHeadless = async (open: typeof openJsonSession | typeof openStoreSession): Promise<{ error: AgentError | null; doc: OutputData }> => {
  const session = open(seed);

  try {
    const result = await session.execute(toToggleHeading);

    return { error: result.ok ? null : result.error, doc: session.output() };
  } finally {
    await session.close();
  }
};

// The person's convert stamps the block it touched; a refused agent turn writes nothing.
const strip = (doc: OutputData): OutputData => ({
  blocks: doc.blocks.map(({ lastEditedBy: _by, lastEditedAt: _at, lastEditedWith: _with, ...block }) => block),
});

const cellsOf = (doc: OutputData): unknown =>
  (doc.blocks.find((block) => block.id === 't')?.data.content as Array<Array<{ blocks: string[] }>>)
    .map((row) => row.map((cell) => cell.blocks));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('turning a table cell block into a toggle heading', () => {
  it('adopts nothing, in the editor and in every agent runtime', async () => {
    const person = await runPerson();
    const agents = [await runAgentInEditor(), await runHeadless(openJsonSession), await runHeadless(openStoreSession)];

    expect(cellsOf(person)).toEqual([[['a', 'b'], ['c']]]);
    expect(person.blocks.map((block) => [block.id, block.parent ?? null, block.content ?? []]))
      .toEqual([['t', null, ['a', 'b', 'c']], ['a', 't', []], ['b', 't', []], ['c', 't', []], ['z', null, []]]);
    expect(person.blocks.find((block) => block.id === 'a')).toMatchObject({ type: 'paragraph', data: { text: [{ text: 'one' }] } });
    expect(person.blocks.find((block) => block.id === 'a')?.data).not.toHaveProperty('isToggleable');

    const ids = new Set(['t', 'a', 'b', 'c', 'z']);

    for (const agent of agents) {
      expect(agent.error).toMatchObject({ code: 'PLACEMENT_REFUSED', details: { reason: 'RESTRICTED_IN_CELL' } });
      expect(normalizeForParity(strip(agent.doc), ids)).toEqual(normalizeForParity(strip(person), ids));
    }
  });
});
