// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openJsonSession, openStoreSession } from '../../agent/harness';

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
    ['block.insert', [{ name: 'block.insert', args: { type: 'paragraph', data: { text: [{ text: 'x', marks: { bold: false } }] } } }], '/commands/0/args/data/text/0/marks/bold'],
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
});
