// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../src/blok';
import { Callout, Header, List, Paragraph, Toggle } from '../../../src/tools';
import type { Agent, AgentBatch, OutputData } from '../../../types';
import { openJsonSession, openStoreSession, TEST_ACTOR } from './harness';
import { normalizeForParity } from './parity/normalize';

interface TestEditor { isReady: Promise<unknown>; destroy: () => void; agent: Agent; save: () => Promise<OutputData>; history: { undo: () => void } }

const editors: TestEditor[] = [];

const runEditor = async (seed: OutputData, batch: AgentBatch, undo = false): Promise<{ error: unknown; doc: OutputData; created: string[] }> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  const editor = new Blok({
    holder,
    data: structuredClone(seed),
    tools: {
      paragraph: { class: Paragraph },
      header: { class: Header },
      list: { class: List },
      toggle: { class: Toggle },
      callout: { class: Callout },
    },
  }) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;

  const turn = editor.agent.begin({ agent: { id: TEST_ACTOR.id, name: TEST_ACTOR.name } });
  const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 50));
  const result = await turn.execute(batch);

  turn.end();
  // Let the convert's deferred writes (callout seed, first save) settle.
  await settle();
  if (undo) {
    editor.history.undo();
    await settle();
  }

  return { error: result.ok ? null : result.error, doc: await editor.save(), created: result.ok ? result.changed.created : [] };
};

const runHeadless = async (open: typeof openJsonSession | typeof openStoreSession, seed: OutputData, batch: AgentBatch): Promise<{ error: unknown; doc: OutputData }> => {
  const session = open(seed);

  try {
    const result = await session.execute(batch);

    return { error: result.ok ? null : result.error, doc: session.output() };
  } finally {
    await session.close();
  }
};

const keepIds = (seed: OutputData): Set<string> => new Set(seed.blocks.flatMap((block) => block.id === undefined ? [] : [block.id]));

const expectSameEverywhere = async (seed: OutputData, batch: AgentBatch): Promise<OutputData & { created: string[] }> => {
  const editor = await runEditor(seed, batch);
  const json = await runHeadless(openJsonSession, seed, batch);
  const store = await runHeadless(openStoreSession, seed, batch);
  const ids = keepIds(seed);

  expect(editor.error).toBeNull();
  expect(json.error).toBeNull();
  expect(store.error).toBeNull();
  expect(normalizeForParity(json.doc, ids)).toEqual(normalizeForParity(editor.doc, ids));
  expect(normalizeForParity(store.doc, ids)).toEqual(normalizeForParity(editor.doc, ids));

  return { ...editor.doc, created: editor.created };
};

const convert = (id: string, type: string, data?: Record<string, unknown>): AgentBatch => ({
  commands: [{ name: 'block.convert', args: { id, type, ...(data !== undefined && { data }) } }],
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('block.convert gives the same document in the editor and headless', () => {
  it('keeps a paragraph background when it becomes a heading', async () => {
    const doc = await expectSameEverywhere({
      blocks: [{ id: 'a', type: 'paragraph', data: { text: 'hi', backgroundColor: 'red' } }],
    }, convert('a', 'header', { level: 2 }));

    expect(doc.blocks[0]?.data).toMatchObject({ backgroundColor: 'red', level: 2 });
  });

  it('keeps a coloured toggle colour when it becomes a paragraph', async () => {
    const doc = await expectSameEverywhere({
      blocks: [{ id: 't', type: 'toggle', data: { text: 'T', textColor: 'red' } }],
    }, convert('t', 'paragraph'));

    expect(doc.blocks[0]?.data).toMatchObject({ textColor: 'red' });
  });

  it('turns a checked to-do into a bullet the way the editor does', async () => {
    await expectSameEverywhere({
      blocks: [{ id: 'l', type: 'list', data: { text: 'x', style: 'checklist', checked: true } }],
    }, convert('l', 'list', { style: 'unordered' }));
  });

  it('keeps the checked state on a to-do round trip through a bullet', async () => {
    await expectSameEverywhere({
      blocks: [{ id: 'l', type: 'list', data: { text: 'x', style: 'checklist', checked: true } }],
    }, {
      commands: [
        { name: 'block.convert', args: { id: 'l', type: 'list', data: { style: 'unordered' } } },
        { name: 'block.convert', args: { id: 'l', type: 'list', data: { style: 'checklist' } } },
      ],
    });
  });

  const toggleHeading: OutputData = {
    blocks: [
      { id: 'h', type: 'header', data: { text: 'H', level: 2, isToggleable: true }, content: ['k'] },
      { id: 'k', type: 'paragraph', data: { text: 'hi' }, parent: 'h' },
      { id: 'z', type: 'paragraph', data: { text: 'after' } },
    ],
  };

  it('releases a toggle heading child when it becomes a paragraph', async () => {
    const doc = await expectSameEverywhere(toggleHeading, convert('h', 'paragraph'));

    expect(doc.blocks.map((block) => [block.id, block.parent ?? null])).toEqual([['h', null], ['k', null], ['z', null]]);
  });

  it('releases a toggle heading child when it becomes a plain heading', async () => {
    const doc = await expectSameEverywhere(toggleHeading, convert('h', 'header', { isToggleable: false }));

    expect(doc.blocks.find((block) => block.id === 'k')?.parent).toBeUndefined();
  });

  it('adopts the following section when a heading becomes a toggle heading', async () => {
    const doc = await expectSameEverywhere({
      blocks: [
        { id: 'h', type: 'header', data: { text: 'H', level: 2 } },
        { id: 's1', type: 'paragraph', data: { text: 'one' } },
        { id: 's2', type: 'paragraph', data: { text: 'two' } },
        { id: 'h2', type: 'header', data: { text: 'Next', level: 2 } },
      ],
    }, convert('h', 'header', { isToggleable: true }));

    expect(doc.blocks.find((block) => block.id === 'h')?.content).toEqual(['s1', 's2']);
    expect(doc.blocks.find((block) => block.id === 'h2')?.parent).toBeUndefined();
  });
});

describe('block.convert to and from a callout gives the same document in the editor and headless', () => {
  const contentOf = (doc: OutputData, id: string): string[] => doc.blocks.find((block) => block.id === id)?.content ?? [];

  it('puts a paragraph text into the first line it seeds, and leaves the colour behind', async () => {
    const doc = await expectSameEverywhere({
      blocks: [{ id: 'a', type: 'paragraph', data: { text: '<b>hi</b>', backgroundColor: 'red' } }],
    }, convert('a', 'callout'));

    expect(doc.blocks.map((block) => block.type)).toEqual(['callout', 'paragraph']);
    // One seeded line, with the id the plan gave it.
    expect(contentOf(doc, 'a')).toEqual(doc.created);
  });

  it('seeds the first line before the paragraph children', async () => {
    const doc = await expectSameEverywhere({
      blocks: [
        { id: 'a', type: 'paragraph', data: { text: 'hi' }, content: ['k'] },
        { id: 'k', type: 'paragraph', data: { text: 'kid' }, parent: 'a' },
      ],
    }, convert('a', 'callout'));

    expect(contentOf(doc, 'a')).toEqual([...doc.created, 'k']);
  });

  it('turns a coloured toggle with a child into a callout', async () => {
    await expectSameEverywhere({
      blocks: [
        { id: 't', type: 'toggle', data: { text: 'T', textColor: 'red' }, content: ['k'] },
        { id: 'k', type: 'paragraph', data: { text: 'kid' }, parent: 't' },
      ],
    }, convert('t', 'callout'));
  });

  const callout: OutputData = {
    blocks: [
      { id: 'c', type: 'callout', data: { emoji: '💡', backgroundColor: 'red' }, content: ['c1', 'c2'] },
      { id: 'c1', type: 'paragraph', data: { text: '<i>one</i>' }, parent: 'c' },
      { id: 'c2', type: 'paragraph', data: { text: 'two' }, parent: 'c' },
      { id: 'z', type: 'paragraph', data: { text: 'z' } },
    ],
  };

  it('takes the first line as the paragraph text and releases the other lines', async () => {
    const doc = await expectSameEverywhere(callout, convert('c', 'paragraph'));

    expect(doc.blocks.map((block) => [block.id, block.parent ?? null])).toEqual([['c', null], ['c2', null], ['z', null]]);
  });

  it('keeps the other lines nested in a toggle', async () => {
    const doc = await expectSameEverywhere(callout, convert('c', 'toggle'));

    expect(contentOf(doc, 'c')).toEqual(['c2']);
  });

  it('releases the other lines from a heading', async () => {
    await expectSameEverywhere(callout, convert('c', 'header'));
  });

  it('keeps the other lines in a toggle heading and adopts the section after it', async () => {
    const doc = await expectSameEverywhere(callout, convert('c', 'header', { isToggleable: true }));

    expect(contentOf(doc, 'c')).toEqual(['c2', 'z']);
  });

  // A heading, not a paragraph: the editor's save skips an empty paragraph (Paragraph.validate).
  it('releases every line when the first line has lines of its own', async () => {
    const doc = await expectSameEverywhere({
      blocks: [
        { id: 'c', type: 'callout', data: { emoji: '💡' }, content: ['c1'] },
        { id: 'c1', type: 'toggle', data: { text: 'one' }, parent: 'c', content: ['g'] },
        { id: 'g', type: 'paragraph', data: { text: 'g' }, parent: 'c1' },
      ],
    }, convert('c', 'header'));

    expect(doc.blocks.map((block) => [block.id, block.parent ?? null])).toEqual([['c', null], ['c1', null], ['g', 'c1']]);
  });

  it('turns a one-line callout into a list item', async () => {
    await expectSameEverywhere({
      blocks: [
        { id: 'c', type: 'callout', data: { emoji: '💡' }, content: ['c1'] },
        { id: 'c1', type: 'paragraph', data: { text: 'one' }, parent: 'c' },
      ],
    }, convert('c', 'list'));
  });
});

describe('one undo takes back a whole agent convert in the editor', () => {
  it.each([
    ['a toggle heading that releases its child', {
      blocks: [
        { id: 'h', type: 'header', data: { text: 'H', level: 2, isToggleable: true }, content: ['k'] },
        { id: 'k', type: 'paragraph', data: { text: 'hi' }, parent: 'h' },
        { id: 'z', type: 'paragraph', data: { text: 'after' } },
      ],
    }, convert('h', 'paragraph')],
    ['a callout that gives its first line', {
      blocks: [
        { id: 'c', type: 'callout', data: { emoji: '💡' }, content: ['c1', 'c2'] },
        { id: 'c1', type: 'paragraph', data: { text: 'one' }, parent: 'c' },
        { id: 'c2', type: 'paragraph', data: { text: 'two' }, parent: 'c' },
      ],
    }, convert('c', 'paragraph')],
    ['a heading that adopts its section', {
      blocks: [
        { id: 'h', type: 'header', data: { text: 'H', level: 2 } },
        { id: 's1', type: 'paragraph', data: { text: 'one' } },
        { id: 'h2', type: 'header', data: { text: 'Next', level: 2 } },
      ],
    }, convert('h', 'header', { isToggleable: true })],
    ['a paragraph that becomes a callout', {
      blocks: [{ id: 'a', type: 'paragraph', data: { text: 'hi' } }],
    }, convert('a', 'callout')],
  ] as const)('%s', async (_name, seed, batch) => {
    const { error, doc } = await runEditor(seed, batch, true);
    const ids = keepIds(seed);
    const strip = (output: OutputData): OutputData => ({ blocks: output.blocks.map(({ lastEditedBy: _by, ...block }) => block) });

    expect(error).toBeNull();
    expect(normalizeForParity(strip(doc), ids)).toEqual(normalizeForParity(strip((await runHeadless(openJsonSession, seed, { commands: [] })).doc), ids));
  });
});
