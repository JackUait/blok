import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../src/blok';
import { Paragraph } from '../../../src/tools';
import { openJsonSession, openStoreSession } from './harness';

import type { Agent, AgentBatch, OutputData } from '../../../types';
import type { TextRange } from '../../../types/agent';
import type { RichText } from '../../../types/rich-text';

/**
 * A plain-string text.replace keeps marks the way the user's Find & replace does:
 * the new text takes the marks at the start of the replaced range, links included.
 */

const TIMEOUT = 60_000;
const link = { link: { href: 'https://example.com' } };

interface Case {
  label: string;
  text: RichText;
  range: TextRange;
  with: string | RichText;
  expected: RichText;
}

const CASES: Case[] = [
  {
    label: 'bold word, found',
    text: [{ text: 'Hello ' }, { text: 'world', marks: { bold: true } }],
    range: { find: 'world' },
    with: 'there',
    expected: [{ text: 'Hello ' }, { text: 'there', marks: { bold: true } }],
  },
  {
    label: 'bold word, by offsets',
    text: [{ text: 'Hello ' }, { text: 'world', marks: { bold: true } }],
    range: { start: 6, end: 11 },
    with: 'there',
    expected: [{ text: 'Hello ' }, { text: 'there', marks: { bold: true } }],
  },
  {
    label: 'word inside a link',
    text: [{ text: 'See ' }, { text: 'the docs page', marks: link }, { text: ' now' }],
    range: { find: 'docs' },
    with: 'API',
    expected: [{ text: 'See ' }, { text: 'the API page', marks: link }, { text: ' now' }],
  },
  {
    label: 'the whole link text',
    text: [{ text: 'See ' }, { text: 'the docs page', marks: link }, { text: ' now' }],
    range: { find: 'the docs page' },
    with: 'the reference',
    expected: [{ text: 'See ' }, { text: 'the reference', marks: link }, { text: ' now' }],
  },
  {
    label: 'bold run inside a link',
    text: [{ text: 'go ' }, { text: 'big', marks: { bold: true, ...link } }, { text: ' docs', marks: link }],
    range: { find: 'big' },
    with: 'small',
    expected: [{ text: 'go ' }, { text: 'small', marks: { bold: true, ...link } }, { text: ' docs', marks: link }],
  },
  {
    label: 'a range that starts in plain text',
    text: [{ text: 'ab' }, { text: 'cd', marks: { bold: true, color: 'red' } }, { text: 'ef' }],
    range: { find: 'bcd' },
    with: 'XY',
    expected: [{ text: 'aXYef' }],
  },
  {
    label: 'a range that starts in a coloured run',
    text: [{ text: 'ab' }, { text: 'cd', marks: { bold: true, color: 'red' } }, { text: 'ef' }],
    range: { find: 'cde' },
    with: 'XY',
    expected: [{ text: 'ab' }, { text: 'XY', marks: { bold: true, color: 'red' } }, { text: 'f' }],
  },
  {
    label: 'segments keep their own marks',
    text: [{ text: 'Hello ' }, { text: 'world', marks: { bold: true } }],
    range: { find: 'world' },
    with: [{ text: 'there', marks: { italic: true } }],
    expected: [{ text: 'Hello ' }, { text: 'there', marks: { italic: true } }],
  },
  {
    label: 'an empty range inserts plain text',
    text: [{ text: 'Hello ' }, { text: 'world', marks: { bold: true } }],
    range: { start: 6, end: 6 },
    with: 'big ',
    expected: [{ text: 'Hello big ' }, { text: 'world', marks: { bold: true } }],
  },
  {
    label: 'the whole field ("all") is new plain text',
    text: [{ text: 'Hello', marks: { bold: true } }, { text: ' world' }],
    range: 'all',
    with: 'Fresh text',
    expected: [{ text: 'Fresh text' }],
  },
];

const seedOf = (text: RichText): OutputData => ({ blocks: [{ id: 'p', type: 'paragraph', data: { text } }] });
const batchOf = (c: Case): AgentBatch => ({ commands: [{ name: 'text.replace', args: { id: 'p', range: c.range, with: c.with } }] });

interface TestEditor { isReady: Promise<unknown>; destroy(): void; agent: Agent; save(): Promise<OutputData> }

const editors: TestEditor[] = [];

const boot = async (data: OutputData): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  const editor = new Blok({ holder, data, tools: { paragraph: { class: Paragraph } } }) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;

  return editor;
};

const editorText = async (editor: TestEditor): Promise<unknown> => {
  const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

  try {
    return (await turn.read({ ids: ['p'] })).blocks[0]?.data?.text;
  } finally {
    turn.end();
  }
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  editors.splice(0).forEach(editor => editor.destroy());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('text.replace keeps the marks at the start of the range', () => {
  it.each([
    ['json', openJsonSession],
    ['store', openStoreSession],
  ] as const)('headless (%s)', async (_runtime, open) => {
    for (const c of CASES) {
      const session = open(seedOf(c.text));

      try {
        const result = await session.execute(batchOf(c));

        expect(result.ok ? null : result.error, c.label).toBeNull();
        expect((await session.read({ ids: ['p'] })).blocks[0]?.data?.text, c.label).toEqual(c.expected);
      } finally {
        await session.close();
      }
    }
  }, TIMEOUT);

  it.each(CASES.map(c => [c.label, c] as const))('in the editor, and after save and reload: %s', async (_label, c) => {
    const editor = await boot(seedOf(c.text));
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    try {
      const result = await turn.execute(batchOf(c));

      expect(result.ok ? null : result.error).toBeNull();
    } finally {
      turn.end();
    }

    expect(await editorText(editor)).toEqual(c.expected);

    const saved = await editor.save();
    const reloaded = await boot(saved);

    expect(await editorText(reloaded)).toEqual(c.expected);
  }, TIMEOUT);

  it('in the editor, a replace inside a link leaves one anchor', async () => {
    const c = CASES[2];

    if (c === undefined) {
      throw new Error('Missing link case.');
    }

    const editor = await boot(seedOf(c.text));
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    try {
      await turn.execute(batchOf(c));
    } finally {
      turn.end();
    }

    const anchors = document.querySelectorAll('a');

    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.textContent).toBe('the API page');
  }, TIMEOUT);
});
