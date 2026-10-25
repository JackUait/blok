import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openJsonSession, openStoreSession } from './harness';

import type { AgentBatch, OutputData } from '../../../types';

/**
 * doc.find and text.replace {find} match text the way the user's find bar does
 * (src/shared/text-match.ts): case, accents and whitespace runs fold, Match case
 * and Whole word are options, and every hit comes back with offsets.
 */

const TIMEOUT = 60_000;

const SEED: OutputData = {
  title: 'Needle plans',
  blocks: [
    { id: 'p', type: 'paragraph', data: { text: [{ text: 'Hello world, Café' }] } },
    { id: 'w', type: 'paragraph', data: { text: [{ text: 'needle needle  needle' }] } },
    { id: 'c', type: 'paragraph', data: { text: [{ text: 'cat catalog cat' }] } },
    { id: 'code', type: 'code', data: { code: 'const needle = 1;', language: 'javascript' } },
    { id: 'img', type: 'image', data: { url: 'https://example.com/a.png', caption: 'A needle in hay' } },
    { id: 'bm', type: 'bookmark', data: { url: 'https://example.com', title: 'Needle site' } },
  ],
};

const RUNTIMES = [
  ['json', openJsonSession],
  ['store', openStoreSession],
] as const;

type Open = (typeof RUNTIMES)[number][1];

const run = async (open: Open, batch: AgentBatch, seed: OutputData = SEED) => {
  const session = open(seed);

  try {
    const result = await session.execute(batch);
    const text = Object.fromEntries((await session.read({ detail: 'full' })).blocks.map(block => [block.id, block.data?.text]));

    return { result, text };
  } finally {
    await session.close();
  }
};

const find = async (open: Open, args: Record<string, unknown>): Promise<unknown> => {
  const { result } = await run(open, { commands: [{ name: 'doc.find', args }] });

  if (!result.ok) {
    throw new Error(result.error.message);
  }

  return result.results[0];
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(RUNTIMES)('doc.find matches like the find bar (%s)', (_runtime, open) => {
  it('folds case by default, and Match case turns that off', async () => {
    expect(await find(open, { text: 'hello' })).toEqual({
      count: 1,
      matches: [{ id: 'p', type: 'paragraph', field: 'text', start: 0, end: 5, snippet: 'Hello world, Café' }],
    });
    expect(await find(open, { text: 'hello', matchCase: true })).toEqual({ count: 0, matches: [] });
  }, TIMEOUT);

  it('folds accents and whitespace runs', async () => {
    expect(await find(open, { text: 'cafe' })).toMatchObject({ count: 1, matches: [{ id: 'p', start: 13, end: 17 }] });
    expect(await find(open, { text: 'needle needle needle' })).toMatchObject({ count: 1, matches: [{ id: 'w', start: 0, end: 21 }] });
  }, TIMEOUT);

  it('returns every hit with its offsets and a count; limit caps the list, not the count', async () => {
    expect(await find(open, { text: 'cat' })).toMatchObject({
      count: 3,
      matches: [{ id: 'c', start: 0, end: 3 }, { id: 'c', start: 4, end: 7 }, { id: 'c', start: 12, end: 15 }],
    });
    expect(await find(open, { text: 'cat', limit: 1 })).toMatchObject({ count: 3, matches: [{ id: 'c', start: 0 }] });
  }, TIMEOUT);

  it('Whole word skips a hit inside a longer word', async () => {
    expect(await find(open, { text: 'cat', wholeWord: true })).toMatchObject({
      count: 2,
      matches: [{ id: 'c', start: 0, end: 3 }, { id: 'c', start: 12, end: 15 }],
    });
  }, TIMEOUT);

  it('searches the title, code, captions and bookmark titles the find bar searches, and names how to edit them', async () => {
    expect(await find(open, { text: 'needle', wholeWord: true })).toEqual({
      count: 7,
      matches: [
        { field: 'title', edit: 'doc.setTitle', start: 0, end: 6, snippet: 'Needle plans' },
        { id: 'w', type: 'paragraph', field: 'text', start: 0, end: 6, snippet: 'needle needle  needle' },
        { id: 'w', type: 'paragraph', field: 'text', start: 7, end: 13, snippet: 'needle needle  needle' },
        { id: 'w', type: 'paragraph', field: 'text', start: 15, end: 21, snippet: 'needle needle  needle' },
        { id: 'code', type: 'code', field: 'code', edit: 'block.update', start: 6, end: 12, snippet: 'const needle = 1;' },
        { id: 'img', type: 'image', field: 'caption', edit: 'block.update', start: 2, end: 8, snippet: 'A needle in hay' },
        { id: 'bm', type: 'bookmark', field: 'title', edit: 'block.update', start: 0, end: 6, snippet: 'Needle site' },
      ],
    });
  }, TIMEOUT);

  it('a type-only find lists each block once', async () => {
    expect(await find(open, { type: 'code' })).toEqual({ count: 1, matches: [{ id: 'code', type: 'code' }] });
  }, TIMEOUT);
});

describe.each(RUNTIMES)('text.replace {find} matches what doc.find found (%s)', (_runtime, open) => {
  const replace = (id: string, range: Record<string, unknown>, value: unknown): AgentBatch =>
    ({ commands: [{ name: 'text.replace', args: { id, range, with: value } }] });

  it('folds case and accents, and Match case turns case folding off', async () => {
    expect((await run(open, replace('p', { find: 'hello' }, 'Bye'))).text.p).toEqual([{ text: 'Bye world, Café' }]);
    expect((await run(open, replace('p', { find: 'cafe' }, 'tea'))).text.p).toEqual([{ text: 'Hello world, tea' }]);
    expect((await run(open, replace('p', { find: 'hello', matchCase: true }, 'Bye'))).result)
      .toMatchObject({ ok: false, error: { code: 'RANGE_NOT_FOUND' } });
  }, TIMEOUT);

  it('Whole word skips a hit inside a longer word', async () => {
    expect((await run(open, replace('c', { find: 'catalog' }, 'list'))).text.c).toEqual([{ text: 'cat list cat' }]);
    expect((await run(open, replace('c', { find: 'cat', wholeWord: true, occurrence: 2 }, 'dog'))).text.c)
      .toEqual([{ text: 'cat catalog dog' }]);
  }, TIMEOUT);

  it('replaces every hit in one pass, never matching its own output', async () => {
    const seed: OutputData = { blocks: [{ id: 'c', type: 'paragraph', data: { text: [{ text: 'cat cat cat' }] } }] };
    const { result, text } = await run(open, replace('c', { find: 'cat', all: true }, 'concat'), seed);

    expect(text.c).toEqual([{ text: 'concat concat concat' }]);
    expect(result).toMatchObject({ ok: true, results: [{ count: 3 }] });
  }, TIMEOUT);

  it('replace-all gives each hit the marks where it starts', async () => {
    const seed: OutputData = { blocks: [{ id: 'c', type: 'paragraph', data: { text: [
      { text: 'a ' }, { text: 'cat', marks: { bold: true } }, { text: ' and Cat' },
    ] } }] };

    expect((await run(open, replace('c', { find: 'cat', all: true }, 'dog'), seed)).text.c).toEqual([
      { text: 'a ' }, { text: 'dog', marks: { bold: true } }, { text: ' and dog' },
    ]);
  }, TIMEOUT);

  it('refuses all outside text.replace, so a format or delete never touches only the first hit', async () => {
    expect((await run(open, { commands: [{ name: 'text.format', args: { id: 'c', range: { find: 'cat', all: true }, set: { bold: true } } }] })).result)
      .toMatchObject({ ok: false, error: { code: 'INVALID_ARGS' } });
  }, TIMEOUT);

  it('refuses all with an occurrence', async () => {
    expect((await run(open, replace('c', { find: 'cat', all: true, occurrence: 2 }, 'dog'))).result)
      .toMatchObject({ ok: false, error: { code: 'INVALID_ARGS' } });
  }, TIMEOUT);
});
