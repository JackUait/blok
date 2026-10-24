// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDocumentAgentSession } from '../../../../src/shared/agent';
import { createHeadlessAgentSetup, loadStoredDocument } from '../../../../src/view/agent-runtime';
import { openJsonSession, openStoreSession, TEST_ACTOR } from '../../agent/harness';

import type { AgentBatch, AgentResult, AgentSession, OutputData } from '../../../../types';

const sessions: Array<[string, (seed: OutputData) => AgentSession]> = [
  ['json', seed => openJsonSession(seed)],
  ['store', seed => openStoreSession(seed)],
];

const seed: OutputData = { blocks: [{ id: 'p', type: 'paragraph', data: { text: [{ text: 'Hello world' }] } }] };

const run = (session: AgentSession, commands: AgentBatch['commands']): Promise<AgentResult> => session.execute({ commands });

const insertWith = (marks: Record<string, unknown>): AgentBatch['commands'] => [{
  name: 'block.insert', args: { id: 'n', type: 'paragraph', data: { text: [{ text: 'Hi ' }, { text: 'there', marks }] } },
}];

const formatWith = (set: Record<string, unknown>): AgentBatch['commands'] => [{
  name: 'text.format', args: { id: 'p', range: { find: 'world' }, set },
}];

const textOf = async (session: AgentSession, id: string): Promise<unknown> =>
  (await session.read({ ids: [id], detail: 'full' })).blocks.find(block => block.id === id)?.data?.text;

const codes = (result: AgentResult): string[] => result.warnings.map(item => item.code);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(sessions)('agent mark writes match what a reload shows (%s session)', (_label, open) => {
  it('writes highlight as the marker default yellow background, not a bare mark', async () => {
    const session = open(seed);

    try {
      const result = await run(session, formatWith({ highlight: true }));

      expect(await textOf(session, 'p')).toEqual([{ text: 'Hello ' }, { text: 'world', marks: { background: 'yellow' } }]);
      expect(codes(result)).toContain('CORRECTED');
    } finally {
      await session.close();
    }
  });

  it('writes highlight plus a text colour as one mark with both colours', async () => {
    const session = open(seed);

    try {
      await run(session, insertWith({ highlight: true, color: 'red' }));

      expect(await textOf(session, 'n')).toEqual([{ text: 'Hi ' }, { text: 'there', marks: { color: 'red', background: 'yellow' } }]);
    } finally {
      await session.close();
    }
  });

  it('snaps a raw colour to the preset the editor load path picks', async () => {
    const session = open(seed);

    try {
      const result = await run(session, formatWith({ color: '#ff0000', background: 'rgb(255, 0, 255)' }));

      expect(await textOf(session, 'p')).toEqual([{ text: 'Hello ' }, { text: 'world', marks: { color: 'red', background: 'pink' } }]);
      expect(codes(result)).toContain('CORRECTED');
    } finally {
      await session.close();
    }
  });

  it.each(['#ffffff', 'white', 'transparent'])('drops an invisible background %s instead of storing a mark that reloads as a highlight', async (background) => {
    const session = open(seed);

    try {
      const result = await run(session, insertWith({ background, bold: true }));

      expect(await textOf(session, 'n')).toEqual([{ text: 'Hi ' }, { text: 'there', marks: { bold: true } }]);
      expect(codes(result)).toContain('CORRECTED');
    } finally {
      await session.close();
    }
  });

  it('drops a colour that is not a colour, with a warning', async () => {
    const session = open(seed);

    try {
      const result = await run(session, formatWith({ color: 'notacolor' }));

      expect(await textOf(session, 'p')).toEqual([{ text: 'Hello world' }]);
      expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'CORRECTED', message: expect.stringContaining('notacolor') }));
    } finally {
      await session.close();
    }
  });

  it('keeps one of sup and sub on a run, with a warning', async () => {
    const session = open(seed);

    try {
      const result = await run(session, insertWith({ sup: true, sub: true }));

      expect(await textOf(session, 'n')).toEqual([{ text: 'Hi ' }, { text: 'there', marks: { sup: true } }]);
      expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'CORRECTED', message: expect.stringContaining('sub') }));
    } finally {
      await session.close();
    }
  });

  it('turns sub off when sup is set over it, like the sup/sub tool', async () => {
    const session = open({ blocks: [{ id: 'p', type: 'paragraph', data: { text: [{ text: 'Hello ' }, { text: 'world', marks: { sub: true } }] } }] });

    try {
      await run(session, formatWith({ sup: true }));

      expect(await textOf(session, 'p')).toEqual([{ text: 'Hello ' }, { text: 'world', marks: { sup: true } }]);
    } finally {
      await session.close();
    }
  });

  it('drops a link on a page mention, which is a link already, with a warning', async () => {
    const session = open(seed);

    try {
      const result = await run(session, [{
        name: 'block.insert', args: { id: 'n', type: 'paragraph', data: { text: [
          { text: 'See ' }, { embed: { page: { id: 'pg1' } }, marks: { link: { href: 'https://e.com' } } },
        ] } },
      }]);

      expect(await textOf(session, 'n')).toEqual([{ text: 'See ' }, { embed: { page: { id: 'pg1' } } }]);
      expect(codes(result)).toContain('CORRECTED');
    } finally {
      await session.close();
    }
  });

  it('drops a link that text.format puts over a page mention', async () => {
    const session = open({ blocks: [{ id: 'p', type: 'paragraph', data: { text: [{ text: 'See ' }, { embed: { page: { id: 'pg1' } } }] } }] });

    try {
      const result = await run(session, [{ name: 'text.format', args: { id: 'p', range: 'all', set: { link: { href: 'https://e.com' } } } }]);

      expect(await textOf(session, 'p')).toEqual([
        { text: 'See ', marks: { link: { href: 'https://e.com', target: '_blank', rel: 'nofollow' } } },
        { embed: { page: { id: 'pg1' } } },
      ]);
      expect(codes(result)).toContain('CORRECTED');
    } finally {
      await session.close();
    }
  });

  it('gives an href-only link the link tool defaults', async () => {
    const session = open(seed);

    try {
      await run(session, formatWith({ link: { href: 'https://e.com' } }));
      await run(session, [{ name: 'text.format', args: { id: 'p', range: { find: 'Hello' }, set: { link: { href: '#top' } } } }]);

      expect(await textOf(session, 'p')).toEqual([
        { text: 'Hello', marks: { link: { href: '#top', target: '_self', rel: 'nofollow' } } },
        { text: ' ' },
        { text: 'world', marks: { link: { href: 'https://e.com', target: '_blank', rel: 'nofollow' } } },
      ]);
    } finally {
      await session.close();
    }
  });

  it('keeps the target and rel the model gave', async () => {
    const session = open(seed);

    try {
      await run(session, formatWith({ link: { href: 'https://e.com', target: '_self', rel: 'noopener' } }));

      expect(await textOf(session, 'p')).toEqual([
        { text: 'Hello ' }, { text: 'world', marks: { link: { href: 'https://e.com', target: '_self', rel: 'noopener' } } },
      ]);
    } finally {
      await session.close();
    }
  });

  it('clears every mark, custom tags too, with unset "*"', async () => {
    const session = open({ blocks: [{ id: 'p', type: 'paragraph', data: { text: [
      { text: 'abc', marks: { bold: true, color: 'red', link: { href: 'https://k.k' }, sup: true, 'tag:kbd': {} } },
    ] } }] });

    try {
      const result = await run(session, [{ name: 'text.format', args: { id: 'p', range: 'all', unset: ['*'] } }]);

      expect(result.ok).toBe(true);
      expect(await textOf(session, 'p')).toEqual([{ text: 'abc' }]);
    } finally {
      await session.close();
    }
  });

  it('clears the yellow highlight with unset "highlight"', async () => {
    const session = open(seed);

    try {
      await run(session, formatWith({ highlight: true }));
      await run(session, [{ name: 'text.format', args: { id: 'p', range: 'all', unset: ['highlight'] } }]);

      expect(await textOf(session, 'p')).toEqual([{ text: 'Hello world' }]);
    } finally {
      await session.close();
    }
  });

  it('warns about an unset key that is not a mark', async () => {
    const session = open(seed);

    try {
      const result = await run(session, [{ name: 'text.format', args: { id: 'p', range: 'all', unset: ['bolds'] } }]);

      expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'UNKNOWN_MARK_DROPPED', message: expect.stringContaining('bolds') }));
    } finally {
      await session.close();
    }
  });

  it.each([
    ['block.insert', [{ name: 'block.insert', args: { type: 'paragraph', data: { text: [{ text: 'x', marks: { bold: 'yes' } }] } } }], '/commands/0/args/data/text/0/marks/bold'],
    ['block.update', [{ name: 'block.update', args: { id: 'p', data: { text: [{ text: 'x', marks: { color: 7 } }] } } }], '/commands/0/args/data/text/0/marks/color'],
    ['text.replace', [{ name: 'text.replace', args: { id: 'p', with: [{ text: 'x', marks: { link: 'https://e.com' } }] } }], '/commands/0/args/with/0/marks/link'],
    ['text.insert', [{ name: 'text.insert', args: { id: 'p', at: 0, text: 'x', marks: { italic: 'yes' } } }], '/commands/0/args/marks/italic'],
  ])('refuses a bad mark value in %s like text.format does', async (_name, commands, path) => {
    const session = open(seed);

    try {
      const result = await run(session, commands as AgentBatch['commands']);

      expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_ARGS', path } });
      expect(await textOf(session, 'p')).toEqual([{ text: 'Hello world' }]);
    } finally {
      await session.close();
    }
  });

  it('leaves marks the agent did not write alone when it edits the same field', async () => {
    const session = open({ blocks: [{ id: 'p', type: 'paragraph', data: { text: [
      { text: 'old', marks: { highlight: true } }, { text: ' tail' },
    ] } }] });

    try {
      const result = await run(session, [{ name: 'text.insert', args: { id: 'p', at: 8, text: '!' } }]);

      expect(await textOf(session, 'p')).toEqual([{ text: 'old', marks: { highlight: true } }, { text: ' tail!' }]);
      expect(codes(result)).not.toContain('CORRECTED');
    } finally {
      await session.close();
    }
  });

  it('copies stored marks as they are when it duplicates a block', async () => {
    const stored = [{ text: 'old', marks: { highlight: true, link: { href: 'https://k.k' } } }];
    const session = open({ blocks: [{ id: 'p', type: 'paragraph', data: { text: stored } }] });

    try {
      const result = await run(session, [{ name: 'block.duplicate', args: { id: 'p' } }]);
      const copy = result.ok ? result.changed.created[0] : undefined;

      expect(await textOf(session, copy ?? '')).toEqual(stored);
      expect(codes(result)).not.toContain('CORRECTED');
    } finally {
      await session.close();
    }
  });

  it.each([
    ['hsl(0deg 100% 50%)', 'red'],
    ['hsla(0, 100%, 50%, 50%)', 'red'],
    ['rgb(100% 0% 0%)', 'red'],
    ['rgb(255 0 0 / 50%)', 'red'],
    ['Red', 'red'],
    ['NAVY', 'navy'],
  ])('keeps the valid colour %s, as the preset or name the load path reads', async (color, expected) => {
    const session = open(seed);

    try {
      await run(session, formatWith({ color }));

      expect(await textOf(session, 'p')).toEqual([{ text: 'Hello ' }, { text: 'world', marks: { color: expected } }]);
    } finally {
      await session.close();
    }
  });

  it.each([
    [{ color: 'hsl(0 150% 50%)' }, { color: 'red' }],
    [{ color: 'rgb(300, 0, 0)' }, { color: 'red' }],
  ])('reads an out-of-range colour %o the way the browser clamps it', async (set, expected) => {
    const session = open(seed);

    try {
      await run(session, formatWith(set));

      expect(await textOf(session, 'p')).toEqual([{ text: 'Hello ' }, { text: 'world', marks: expected }]);
    } finally {
      await session.close();
    }
  });

  it('drops a background whose lightness above 100% makes it the white page', async () => {
    const session = open(seed);

    try {
      const result = await run(session, formatWith({ background: 'hsl(0 0% 150%)' }));

      expect(await textOf(session, 'p')).toEqual([{ text: 'Hello world' }]);
      expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'CORRECTED', message: expect.stringContaining('page background') }));
    } finally {
      await session.close();
    }
  });

  it('treats false and null mark values as not set, with a warning', async () => {
    const session = open(seed);

    try {
      const result = await run(session, insertWith({ bold: false, color: null, italic: true, link: { href: 'https://e.com', title: 'x' } }));

      expect(result.ok).toBe(true);
      expect(await textOf(session, 'n')).toEqual([{ text: 'Hi ' }, { text: 'there', marks: {
        link: { href: 'https://e.com', target: '_blank', rel: 'nofollow' }, italic: true,
      } }]);
      expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'CORRECTED', message: expect.stringContaining('title') }));
      expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'CORRECTED', message: expect.stringContaining('bold') }));
    } finally {
      await session.close();
    }
  });

  it.each<[string, AgentBatch['commands'][number]['args']]>([
    ['text.replace', { id: 'p', range: { find: 'world' }, with: [{ text: 'there', marks: { bold: false, color: null, italic: true, link: { href: 'https://e.com', title: 'x' } } }] }],
    ['text.insert', { id: 'p', at: { after: 'Hello ' }, text: [{ text: 'there', marks: { bold: false, color: null, italic: true, link: { href: 'https://e.com', title: 'x' } } }] }],
  ])('%s treats false and null mark values in segments as not set, like block.insert', async (name, args) => {
    const session = open(seed);

    try {
      const result = await run(session, [{ name: name === 'text.replace' ? 'text.replace' : 'text.insert', args }]);

      expect(result.ok ? null : result.error).toBeNull();
      expect(JSON.stringify(await textOf(session, 'p'))).toContain('"marks":{"link":{"href":"https://e.com","target":"_blank","rel":"nofollow"},"italic":true}');
      expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'CORRECTED', message: expect.stringContaining('bold') }));
    } finally {
      await session.close();
    }
  });

  it('stores HTML in a plain string as literal text, not as marks', async () => {
    const session = open(seed);

    try {
      await run(session, [{ name: 'block.insert', args: { id: 'n', type: 'paragraph', data: { text: 'a <b>bold</b> word' } } }]);

      expect(await textOf(session, 'n')).toEqual([{ text: 'a <b>bold</b> word' }]);
    } finally {
      await session.close();
    }
  });

  it('names custom tag:<name> marks when it drops an unknown mark', async () => {
    const session = open(seed);

    try {
      const result = await run(session, insertWith({ blink: true }));

      expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'UNKNOWN_MARK_DROPPED', message: expect.stringContaining('tag:<name>') }));
    } finally {
      await session.close();
    }
  });

  it.each(['#0000ff', 'rgb(0, 0, 255)', 'hsl(240 100% 50%)', '#4b0082', '#000080'])('snaps the dark colour %s to a preset background instead of dropping it', async (background) => {
    const session = open(seed);

    try {
      const result = await run(session, formatWith({ background }));
      const marks = JSON.stringify(await textOf(session, 'p'));

      expect(marks).toMatch(/"background":"(gray|brown|orange|yellow|green|blue|purple|pink|red)"/);
      expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'CORRECTED', message: expect.stringContaining('nearest preset') }));
    } finally {
      await session.close();
    }
  });

  it('drops the neutral dark page background and says so', async () => {
    const session = open(seed);

    try {
      const result = await run(session, formatWith({ background: '#191918' }));

      expect(await textOf(session, 'p')).toEqual([{ text: 'Hello world' }]);
      expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'CORRECTED', message: expect.stringContaining('page background') }));
    } finally {
      await session.close();
    }
  });

  it.each([
    [{ background: 'rgba(255, 0, 0, 0)' }],
    [{ color: 'rgb(255 0 0 / 0)' }],
    [{ background: '#ff000000' }],
  ])('drops a fully transparent colour %j', async (set) => {
    const session = open(seed);

    try {
      await run(session, formatWith(set));

      expect(await textOf(session, 'p')).toEqual([{ text: 'Hello world' }]);
    } finally {
      await session.close();
    }
  });

  it('drops a colour syntax Blok does not read, naming the ones it does', async () => {
    const session = open(seed);

    try {
      const result = await run(session, formatWith({ color: 'oklch(0.6 0.2 30)' }));

      expect(await textOf(session, 'p')).toEqual([{ text: 'Hello world' }]);
      expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'CORRECTED', message: expect.stringContaining('hex, rgb, hsl') }));
      expect(result.warnings).not.toContainEqual(expect.objectContaining({ message: expect.stringContaining('is not a colour') }));
    } finally {
      await session.close();
    }
  });

  it.each([
    [{ href: 'https://e.com' }, { href: 'https://e.com', target: '_blank', rel: 'nofollow' }],
    [{ href: '#top' }, { href: '#top', target: '_self', rel: 'nofollow' }],
    [{ href: 'https://e.com', target: '_self', rel: 'noopener' }, { href: 'https://e.com', target: '_self', rel: 'noopener' }],
  ])('fills link %j with the Link tool defaults', async (link, expected) => {
    const session = open(seed);

    try {
      await run(session, formatWith({ link }));

      expect(await textOf(session, 'p')).toEqual([{ text: 'Hello ' }, { text: 'world', marks: { link: expected } }]);
    } finally {
      await session.close();
    }
  });

  // The sanitizer's HTML round trip still drops it (nested anchors cannot exist): that is
  // reported as SANITIZED, not blamed on the agent's write.
  it('does not correct a stored link on a page mention outside the range it formats', async () => {
    const stored = [{ embed: { page: { id: 'pg1' } }, marks: { link: { href: 'https://k.k' } } }, { text: ' tail' }];
    const session = open({ blocks: [{ id: 'p', type: 'paragraph', data: { text: stored } }] });

    try {
      const result = await run(session, [{ name: 'text.format', args: { id: 'p', range: { find: 'tail' }, set: { bold: true } } }]);

      expect(codes(result)).not.toContain('CORRECTED');
    } finally {
      await session.close();
    }
  });

  it('leaves runs a block.update sends back unchanged as they are stored', async () => {
    const stored = [{ text: 'old', marks: { highlight: true } }, { text: ' red', marks: { color: '#ff0000' } }];
    const session = open({ blocks: [{ id: 'p', type: 'paragraph', data: { text: stored } }] });

    try {
      const result = await run(session, [{ name: 'block.update', args: { id: 'p', data: { text: [...stored, { text: ' new', marks: { highlight: true } }] } } }]);

      expect(await textOf(session, 'p')).toEqual([...stored, { text: ' new', marks: { background: 'yellow' } }]);
      expect(result.warnings.filter(item => item.code === 'CORRECTED')).toHaveLength(1);
    } finally {
      await session.close();
    }
  });

  it.each<[`${string}.${string}`, Record<string, unknown>]>([
    ['table.duplicateRows', { at: 0 }],
    ['table.duplicateColumns', { at: 0 }],
    ['table.fillCells', { range: { fromRow: 0, fromCol: 0, toRow: 1, toCol: 0 }, direction: 'down' }],
  ])('%s copies stored cell marks as they are', async (name, args) => {
    const stored = [{ text: 'cell', marks: { link: { href: 'https://k.k' }, highlight: true } }];
    const maker = openJsonSession({ blocks: [] });
    const made = await run(maker, [{ name: 'table.create', args: { rows: 2, cols: 2 } }]);
    const tableId = made.ok ? made.changed.created[0] : '';
    const doc = maker.output();
    const firstCell = doc.blocks.find(block => block.parent === tableId);

    maker.close();
    if (firstCell !== undefined) {
      firstCell.data = { text: stored };
    }
    const session = open(doc);

    try {
      const result = await run(session, [{ name, args: { id: tableId, ...args } }]);
      const texts = (await session.read({ detail: 'full' })).blocks.filter(block => block.parentId === tableId).map(block => block.data?.text);

      expect(result.ok ? null : result.error).toBeNull();
      expect(texts.filter(text => JSON.stringify(text) === JSON.stringify(stored))).toHaveLength(2);
      expect(codes(result)).not.toContain('CORRECTED');
    } finally {
      await session.close();
    }
  });

  it.each<[string, Record<string, unknown>, Record<string, unknown>]>([
    ['Note', { highlight: true }, { background: 'yellow' }],
    ['Error', { color: '#ff0000' }, { color: 'red' }],
    ['site', { link: { href: 'https://e.com' } }, { link: { href: 'https://e.com', target: '_blank', rel: 'nofollow' } }],
    ['x2', { sup: true, sub: true }, { sup: true }],
  ])('writes a new "%s" run the same way when an old block holds the same run as stored', async (text, marks, expected) => {
    const session = open({ blocks: [{ id: 'old', type: 'paragraph', data: { text: [{ text, marks }] } }] });

    try {
      const result = await run(session, [{ name: 'block.insert', args: { id: 'n', type: 'paragraph', data: { text: [{ text, marks }] } } }]);

      expect(await textOf(session, 'n')).toEqual([{ text, marks: expected }]);
      expect(await textOf(session, 'old')).toEqual([{ text, marks }]);
      expect(result.ok).toBe(true);
    } finally {
      await session.close();
    }
  });

  it('writes a block.update run the same way when another block holds the same run as stored', async () => {
    const run1 = { text: 'Note', marks: { highlight: true } };
    const session = open({ blocks: [
      { id: 'old', type: 'paragraph', data: { text: [run1] } },
      { id: 'p', type: 'paragraph', data: { text: [{ text: 'Hello' }] } },
    ] });

    try {
      await run(session, [{ name: 'block.update', args: { id: 'p', data: { text: [run1] } } }]);

      expect(await textOf(session, 'p')).toEqual([{ text: 'Note', marks: { background: 'yellow' } }]);
    } finally {
      await session.close();
    }
  });

  it('keeps an old run next to a new run with the same marks as stored when block.update sends it back', async () => {
    const old = { text: 'old', marks: { highlight: true } };
    const session = open({ blocks: [{ id: 'p', type: 'paragraph', data: { text: [old] } }] });

    try {
      await run(session, [{ name: 'block.update', args: { id: 'p', data: { text: [old, { text: ' new', marks: { highlight: true } }] } } }]);

      expect(await textOf(session, 'p')).toEqual([old, { text: ' new', marks: { background: 'yellow' } }]);
    } finally {
      await session.close();
    }
  });

  it('leaves runs a text.replace sends back as read as they are stored', async () => {
    const stored = [{ text: 'old', marks: { highlight: true } }, { text: ' red', marks: { color: '#ff0000' } }];
    const session = open({ blocks: [{ id: 'p', type: 'paragraph', data: { text: stored } }] });

    try {
      const result = await run(session, [{ name: 'text.replace', args: { id: 'p', range: 'all', with: await textOf(session, 'p') } }]);

      expect(await textOf(session, 'p')).toEqual(stored);
      expect(codes(result)).not.toContain('CORRECTED');
    } finally {
      await session.close();
    }
  });

  it('leaves an old raw-coloured run alone when text.replace and text.insert edit around it', async () => {
    const old = { text: 'red', marks: { color: '#ff0000' } };
    const session = open({ blocks: [{ id: 'p', type: 'paragraph', data: { text: [old, { text: ' tail' }] } }] });

    try {
      await run(session, [
        { name: 'text.replace', args: { id: 'p', range: { find: 'tail' }, with: 'end' } },
        { name: 'text.insert', args: { id: 'p', at: 0, text: '> ' } },
      ]);

      expect(await textOf(session, 'p')).toEqual([{ text: '> ' }, old, { text: ' end' }]);
    } finally {
      await session.close();
    }
  });

});

// A host's inline tool, so the sanitizer keeps the custom mark and only the agent's checks can refuse it.
const openWithCustomTool = (doc: OutputData): AgentSession => {
  const setup = createHeadlessAgentSetup({
    runtime: 'node',
    customTools: { formatVersion: 1, blocks: [], inlineTools: [{ name: 'num', sanitize: { span: { 'data-n': true } } }] },
  });

  return createDocumentAgentSession({
    document: loadStoredDocument(structuredClone(doc), setup.richTextFieldsFor),
    tools: setup.tools, contract: setup.contract, actor: TEST_ACTOR, ports: setup.ports, services: {},
  });
};

// Stored data an agent could not write as is: a number attribute, and a highlight with no colour.
const odd = [{ text: 'tagged', marks: { 'tag:span': { 'data-n': 1 } } }, { text: ' old', marks: { highlight: true } }];

describe('stored marks the agent schema would refuse', () => {
  // The agent's checks must not refuse or rewrite them. What the sanitizer keeps of the number is its own business.
  const kept = { text: ' old', marks: { highlight: true } };

  it('keeps them when block.update sends the field back as read', async () => {
    const session = openWithCustomTool({ blocks: [{ id: 'p', type: 'paragraph', data: { text: odd } }] });

    try {
      const result = await run(session, [{ name: 'block.update', args: { id: 'p', data: { text: await textOf(session, 'p') } } }]);

      expect(result.ok ? null : result.error).toBeNull();
      expect(await textOf(session, 'p')).toContainEqual(kept);
      expect(codes(result)).not.toContain('CORRECTED');
    } finally {
      await session.close();
    }
  });

  it('copies them as they are when block.duplicate copies a block and its children', async () => {
    const session = openWithCustomTool({ blocks: [
      { id: 't', type: 'toggle', data: { text: odd }, content: ['c'] },
      { id: 'c', type: 'paragraph', parent: 't', data: { text: odd } },
    ] });

    try {
      const result = await run(session, [{ name: 'block.duplicate', args: { id: 't' } }]);
      const after = await session.read({ detail: 'full' });
      const copyId = result.ok ? result.changed.created[0] : '';

      expect(result.ok ? null : result.error).toBeNull();
      expect(after.blocks.find(block => block.id === copyId)?.data?.text).toContainEqual(kept);
      expect(after.blocks.find(block => block.parentId === copyId)?.data?.text).toContainEqual(kept);
      expect(codes(result)).not.toContain('CORRECTED');
    } finally {
      await session.close();
    }
  });
});
