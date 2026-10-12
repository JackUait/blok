// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as corpus from './corpus';
import type { CorpusBatch, ParityCase } from './corpus';
import type { ParityDocument } from './normalize';
import { compareToGolden, readGolden, runCorpusCase } from './run-case';
import type { SessionLike } from './run-case';

const c: ParityCase = { name: 'zz-task7-golden-guard-test', seed: { blocks: [] }, batches: [] };
const doc: ParityDocument = { blocks: [] };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('golden guard', () => {
  let ownedDirectory: string | undefined;
  let fixturePath = '';

  beforeEach(() => {
    if (existsSync(corpus.goldenPath(c.name))) {
      throw new Error('The reserved project golden name is already in use.');
    }
    vi.stubEnv('BLOK_UPDATE_GOLDENS', '');
    ownedDirectory = mkdtempSync(join(tmpdir(), 'blok-task7-golden-'));
    fixturePath = join(ownedDirectory, `${c.name}.json`);

    if (existsSync(fixturePath)) {
      throw new Error('Refusing to overwrite a preexisting golden fixture.');
    }

    // Redirect only the path dependency; golden reads and writes stay real.
    vi.spyOn(corpus, 'goldenPath').mockImplementation((name) => {
      if (name !== c.name) {
        throw new Error('Only the reserved unit fixture name is allowed.');
      }

      return fixturePath;
    });
  });

  afterEach(() => {
    if (ownedDirectory !== undefined) {
      rmSync(ownedDirectory, { recursive: true, force: true });
      ownedDirectory = undefined;
    }
  });

  it('writes a missing golden as unreviewed', () => {
    vi.stubEnv('BLOK_UPDATE_GOLDENS', '1');

    compareToGolden(c, doc);

    expect(readGolden(c.name)).toEqual({ reviewed: false, document: { blocks: [] } });
    const written: unknown = JSON.parse(readFileSync(fixturePath, 'utf8'));

    expect(written).toEqual({ reviewed: false, document: { blocks: [] } });
  });

  it('fails a comparison against an unreviewed golden', () => {
    const original = JSON.stringify({ reviewed: false, document: { blocks: [] } });

    writeFileSync(fixturePath, original, { flag: 'wx' });

    expect(() => compareToGolden(c, doc)).toThrow(/not reviewed/);
    expect(readFileSync(fixturePath, 'utf8')).toBe(original);
  });

  it('reports a content mismatch against an unreviewed golden before the review gate', () => {
    const golden: ParityDocument = { blocks: [{ id: 'p', type: 'paragraph', data: { text: [{ text: 'golden' }] } }] };

    writeFileSync(fixturePath, JSON.stringify({ reviewed: false, document: golden }), { flag: 'wx' });

    expect(() => compareToGolden(c, doc)).toThrow(/differs from its golden/);
  });

  it.each(['equal', 'changed'])('refuses to regenerate a reviewed %s golden', (variant) => {
    const original = JSON.stringify({ reviewed: 'TEST_ONLY_NOT_A_PERSON_REVIEW', document: { blocks: [] } });
    const actual: ParityDocument = variant === 'equal' ? { blocks: [] } : {
      blocks: [{ id: 'x', type: 'paragraph', data: { text: [{ text: 'Changed' }] } }],
    };

    writeFileSync(fixturePath, original, { flag: 'wx' });
    vi.stubEnv('BLOK_UPDATE_GOLDENS', '1');

    expect(() => compareToGolden(c, actual)).toThrow(/edited by hand/);
    expect(readFileSync(fixturePath, 'utf8')).toBe(original);
  });

  it('passes against a reviewed, equal golden', () => {
    const equal: ParityDocument = {
      blocks: [{ id: 'p1', type: 'paragraph', data: { text: [{ text: 'Before' }] } }],
      title: 'Original', icon: { type: 'emoji', value: 'A' },
    };
    const original = JSON.stringify({ reviewed: 'TEST_ONLY_NOT_A_PERSON_REVIEW', document: equal });

    writeFileSync(fixturePath, original, { flag: 'wx' });

    expect(() => compareToGolden(c, equal)).not.toThrow();
    expect(readGolden(c.name)).toEqual({
      reviewed: 'TEST_ONLY_NOT_A_PERSON_REVIEW',
      document: {
        blocks: [{ id: 'p1', type: 'paragraph', data: { text: [{ text: 'Before' }] } }],
        title: 'Original', icon: { type: 'emoji', value: 'A' },
      },
    });
    expect(readFileSync(fixturePath, 'utf8')).toBe(original);
  });

  it('rejects a blocks-only mismatch against a reviewed golden', () => {
    const golden: ParityDocument = {
      blocks: [{ id: 'p1', type: 'paragraph', data: { text: [{ text: 'Before' }] } }],
      title: 'Original', icon: { type: 'emoji', value: 'A' },
    };
    const actual: ParityDocument = {
      blocks: [{ id: 'p1', type: 'paragraph', data: { text: [{ text: 'Changed' }] } }],
      title: 'Original', icon: { type: 'emoji', value: 'A' },
    };
    const original = JSON.stringify({ reviewed: 'TEST_ONLY_NOT_A_PERSON_REVIEW', document: golden });

    writeFileSync(fixturePath, original, { flag: 'wx' });

    expect(() => compareToGolden(c, actual)).toThrow();
    expect(readFileSync(fixturePath, 'utf8')).toBe(original);
  });

  it('refreshes an unreviewed golden without marking it reviewed', () => {
    writeFileSync(fixturePath, JSON.stringify({
      reviewed: false,
      document: { blocks: [{ id: 'before', type: 'paragraph', data: { text: [{ text: 'Before' }] } }] },
    }), { flag: 'wx' });
    vi.stubEnv('BLOK_UPDATE_GOLDENS', '1');

    compareToGolden(c, doc);

    expect(readGolden(c.name)).toEqual({ reviewed: false, document: { blocks: [] } });
    const written: unknown = JSON.parse(readFileSync(fixturePath, 'utf8'));

    expect(written).toEqual({ reviewed: false, document: { blocks: [] } });
  });

  it.each(['title', 'icon'])('rejects a page %s mismatch when the blocks are equal', (field) => {
    const golden: ParityDocument = {
      blocks: [], title: 'Original', icon: { type: 'emoji', value: 'A' },
    };
    const actual: ParityDocument = field === 'title' ? {
      blocks: [], title: 'Changed', icon: { type: 'emoji', value: 'A' },
    } : {
      blocks: [], title: 'Original', icon: { type: 'emoji', value: 'B' },
    };
    const original = JSON.stringify({ reviewed: 'TEST_ONLY_NOT_A_PERSON_REVIEW', document: golden });

    writeFileSync(fixturePath, original, { flag: 'wx' });

    expect(() => compareToGolden(c, actual)).toThrow();
    expect(readFileSync(fixturePath, 'utf8')).toBe(original);
  });

  it('requires a golden when update mode is off', () => {
    expect(() => compareToGolden(c, doc)).toThrow(/No golden/);
    expect(readGolden(c.name)).toBeNull();
    expect(existsSync(fixturePath)).toBe(false);
  });
});

describe('runCorpusCase', () => {
  it('awaits each batch in corpus order before starting the next', async () => {
    const events: string[] = [];
    const ordered: ParityCase = {
      name: 'ordered-batches', seed: { blocks: [] }, batches: [
        { commands: [{ name: 'doc.setTitle', args: { title: 'First' } }] },
        { commands: [{ name: 'doc.setTitle', args: { title: 'Second' } }] },
      ],
    };
    const session: SessionLike = {
      execute: async (batch: CorpusBatch) => {
        const title = batch.commands[0]?.args.title;

        if (typeof title !== 'string') {
          throw new Error('Expected a title batch.');
        }
        events.push(`${title}:start`);
        await Promise.resolve();
        events.push(`${title}:finish`);

        return { ok: true };
      },
    };
    const outcome = await runCorpusCase(session, ordered);

    expect(events).toEqual(['First:start', 'First:finish', 'Second:start', 'Second:finish']);
    expect(outcome).toBe('ok');
  });

  it('stops at the first refused batch and preserves its error code', async () => {
    const executed: string[] = [];
    const refused: ParityCase = {
      name: 'stop-first-refusal', seed: { blocks: [] }, batches: [
        { commands: [{ name: 'doc.setTitle', args: { title: 'First' } }] },
        { commands: [{ name: 'doc.setTitle', args: { title: 'Refused' } }] },
        { commands: [{ name: 'doc.setTitle', args: { title: 'Must not run' } }] },
      ],
    };
    const session: SessionLike = {
      execute: (batch: CorpusBatch) => {
        const title = batch.commands[0]?.args.title;

        if (typeof title !== 'string') {
          throw new Error('Expected a title batch.');
        }
        executed.push(title);

        return Promise.resolve(title === 'Refused'
          ? { ok: false, error: { code: 'BLOCK_NOT_FOUND' } }
          : { ok: true });
      },
    };
    const outcome = await runCorpusCase(session, refused);

    expect(executed).toEqual(['First', 'Refused']);
    expect(outcome).toEqual({ errorCode: 'BLOCK_NOT_FOUND' });
  });

  it('reports MISSING_ERROR when a refused batch has no error object', async () => {
    const missingError: ParityCase = {
      name: 'missing-error', seed: { blocks: [] },
      batches: [{ commands: [{ name: 'doc.read', args: {} }] }],
    };
    const session: SessionLike = { execute: () => Promise.resolve({ ok: false }) };

    expect(await runCorpusCase(session, missingError)).toEqual({ errorCode: 'MISSING_ERROR' });
  });

  it('returns ok for a case without batches', async () => {
    const session: SessionLike = {
      execute: () => {
        throw new Error('An empty case must not execute a batch.');
      },
    };

    expect(await runCorpusCase(session, c)).toBe('ok');
  });
});
