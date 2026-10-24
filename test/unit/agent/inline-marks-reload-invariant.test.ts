import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../src/blok';
import { Paragraph } from '../../../src/tools';
import { openJsonSession, openStoreSession } from './harness';

import type { Agent, AgentBatch, AgentSession, BlokConfig, OutputData } from '../../../types';
import type { RichText, RichTextMarks } from '../../../types/rich-text';

/**
 * INVARIANT: whatever the agent writes reads back the same before and after a save and reload.
 * A mark the editor rewrites on load (a raw colour, a bare highlight, a white background) or
 * cannot hold (nested anchors) would make the agent's own read disagree with the document.
 */

// Each case boots real editors, which can outlast the 5s default.
const TIMEOUT = 60_000;

interface TestEditor { isReady: Promise<unknown>; destroy(): void; agent: Agent; save(): Promise<OutputData> }

const MARKS: Array<[string, RichTextMarks | Record<string, unknown>]> = [
  ['bold', { bold: true }],
  ['italic', { italic: true }],
  ['underline', { underline: true }],
  ['strikethrough', { strikethrough: true }],
  ['code', { code: true }],
  ['sup', { sup: true }],
  ['sub', { sub: true }],
  ['highlight', { highlight: true }],
  ['color preset', { color: 'red' }],
  ['color raw', { color: '#ff0000' }],
  ['color named', { color: 'navy' }],
  ['color mixed case', { color: 'Red' }],
  ['color hsl units', { color: 'hsl(0.5turn 100% 25%)' }],
  ['color rgb percent', { color: 'rgb(100% 0% 0%)' }],
  ['background slash alpha', { background: 'rgb(255 0 0 / 50%)' }],
  ['color invalid', { color: 'notacolor' }],
  ['background preset', { background: 'yellow' }],
  ['background raw', { background: 'rgb(255, 0, 255)' }],
  ['background white', { background: '#ffffff' }],
  ['highlight and color', { highlight: true, color: 'red' }],
  ['sup and sub', { sup: true, sub: true }],
  ['link href', { link: { href: 'https://example.com' } }],
  ['link anchor', { link: { href: '#top' } }],
  ['link full', { link: { href: 'https://example.com', target: '_self', rel: 'noopener' } }],
  ['combined', { link: { href: 'https://example.com' }, color: 'red', background: 'blue', bold: true, italic: true, underline: true, strikethrough: true }],
];

const EMBEDS: Array<[string, RichText]> = [
  ['equation', [{ text: 'a ' }, { embed: { equation: { expression: 'x^2' } } }]],
  ['equation bold', [{ text: 'a ' }, { embed: { equation: { expression: 'x^2' } }, marks: { bold: true } }]],
  ['page', [{ text: 'a ' }, { embed: { page: { id: 'pg1' } } }]],
  ['page link', [{ text: 'a ' }, { embed: { page: { id: 'pg1' } }, marks: { link: { href: 'https://example.com' } } }]],
];

const SEED: OutputData = {
  blocks: MARKS.map((_, index) => ({ id: `f${index}`, type: 'paragraph', data: { text: 'Hello world' } })),
};

const insertBatch: AgentBatch = { commands: [
  ...MARKS.map(([, marks], index) => ({
    name: 'block.insert' as const, args: { id: `i${index}`, type: 'paragraph', data: { text: [{ text: 'Hi ' }, { text: 'there', marks }] } },
  })),
  ...EMBEDS.map(([, text], index) => ({ name: 'block.insert' as const, args: { id: `e${index}`, type: 'paragraph', data: { text } } })),
] };

const formatBatch: AgentBatch = { commands: MARKS.map(([, set], index) => ({
  name: 'text.format' as const, args: { id: `f${index}`, range: { find: 'world' }, set },
})) };

const written = [
  ...MARKS.flatMap(([name], index) => [[`insert ${name}`, `i${index}`], [`format ${name}`, `f${index}`]]),
  ...EMBEDS.map(([name], index) => [`embed ${name}`, `e${index}`]),
];

const editors: TestEditor[] = [];

const boot = async (data: OutputData, extra: Partial<BlokConfig> = {}): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  const editor = new Blok({ holder, data, tools: { paragraph: { class: Paragraph } }, ...extra }) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;

  return editor;
};

const textById = async (session: Pick<AgentSession, 'read'>): Promise<Record<string, unknown>> =>
  Object.fromEntries((await session.read({ detail: 'full' })).blocks.map(block => [block.id, block.data?.text]));

const editorRead = async (editor: TestEditor): Promise<Record<string, unknown>> => {
  const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

  try {
    return await textById(turn);
  } finally {
    turn.end();
  }
};

const editorWrite = async (editor: TestEditor, batches: AgentBatch[]): Promise<void> => {
  const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

  try {
    for (const batch of batches) {
      const result = await turn.execute(batch);

      expect(result.ok ? null : result.error).toBeNull();
    }
  } finally {
    turn.end();
  }
};

const pick = (texts: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(written.map(([label, id]) => [label, texts[id]]));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  editors.splice(0).forEach(editor => editor.destroy());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('agent marks read the same after save and reload', () => {
  it.each([
    ['no link config', {}],
    ['a host link config', { link: { target: '_self', rel: 'noopener' } }],
  ])('in the editor, with %s', async (_label, config: Partial<BlokConfig>) => {
    const editor = await boot(SEED, config);

    await editorWrite(editor, [insertBatch, formatBatch]);
    const before = pick(await editorRead(editor));
    const reloaded = await boot(await editor.save(), config);

    expect(pick(await editorRead(reloaded))).toEqual(before);
  }, TIMEOUT);

  it.each([
    ['json', (seed: OutputData) => openJsonSession(seed)],
    ['store', (seed: OutputData) => openStoreSession(seed)],
  ])('headless (%s), then opened in the editor', async (_label, open) => {
    const session = open(SEED);

    try {
      for (const batch of [insertBatch, formatBatch]) {
        const result = await session.execute(batch);

        expect(result.ok ? null : result.error).toBeNull();
      }
      const before = pick(await textById(session));
      const editor = await boot(session.output());

      expect(pick(await editorRead(editor))).toEqual(before);
    } finally {
      await session.close();
    }
  }, TIMEOUT);
});
