import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachOrphanSweep,
  createOrphanSweep,
  orphanSweepFor,
} from '../../../../src/components/utils/orphan-sweep';
import type { BlokConfig, OutputData } from '../../../../types';

const IMAGE = 'https://cdn.example/uploads/a1.png';
const OTHER = 'https://cdn.example/uploads/b2.png';

/** A document referencing each URL the way the image tool stores one. */
const documentWith = (...urls: string[]): OutputData => ({
  time: 0,
  version: '1',
  blocks: urls.map((url, index) => ({
    id: `block-${index}`,
    type: 'image',
    data: { file: { url } },
  })),
});

const EMPTY_DOCUMENT: OutputData = { time: 0, version: '1', blocks: [] };

const resolvingRemove = () => vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * The saved document does not hold a URL byte-for-byte: a string goes through
 * the sanitizer's innerHTML round trip, which writes `&` as `&amp;` and the
 * other serializer entities for the rest. Every entity the decoder knows must
 * decode back to the character the uploader returned, or a referenced asset is
 * called an orphan and the file behind a visible block is deleted.
 */
describe('orphan-sweep — serializer entities decode back to their character', () => {
  const cases: Array<[string, string]> = [
    ['&amp;', '&'],
    ['&lt;', '<'],
    ['&gt;', '>'],
    ['&quot;', '"'],
    ['&nbsp;', ' '],
  ];

  it.each(cases)('leaves an asset alone when the document holds %s for %j', async (entity, char) => {
    const url = `https://cdn.example/uploads/a${entity}b.png`;
    const stored = `https://cdn.example/uploads/a${char}b.png`;
    const remove = resolvingRemove();
    const sweep = createOrphanSweep();

    sweep.record(url, remove);

    await expect(sweep.sweep(documentWith(stored))).resolves.toBeUndefined();

    expect(remove).not.toHaveBeenCalled();
  });
});

/**
 * `UploadedAsset` comes from host code, so `record` may be handed anything. An
 * entry that is not a usable URL must never enter the candidate set: it would
 * either reject every later sweep or be re-issued forever.
 */
describe('orphan-sweep — only a usable URL is a candidate', () => {
  it('does not record an empty string', () => {
    const remove = resolvingRemove();
    const sweep = createOrphanSweep();

    sweep.record('', remove);

    expect(sweep.beginSave()).toBe(0);
  });

  it('records an ordinary string url', async () => {
    const remove = resolvingRemove();
    const sweep = createOrphanSweep();

    sweep.record(IMAGE, remove);

    expect(sweep.beginSave()).toBe(1);

    await sweep.sweep(EMPTY_DOCUMENT);

    expect(remove).toHaveBeenCalledWith(IMAGE);
  });

  // The empty string is the boundary the guard exists for; a candidate whose
  // URL happens to equal the mutant seed string must NOT be one of its victims.
  it('treats a url spelled exactly like a mutant placeholder as a normal candidate', async () => {
    const seeded = 'Stryker was here!';
    const remove = resolvingRemove();
    const sweep = createOrphanSweep();

    sweep.record(seeded, remove);

    expect(sweep.beginSave()).toBe(1);

    await sweep.sweep(EMPTY_DOCUMENT);

    expect(remove).toHaveBeenCalledWith(seeded);
  });

  it('sweeps a url that is a prefix of a mutant placeholder', async () => {
    const seeded = 'Stryker was here';
    const remove = resolvingRemove();
    const sweep = createOrphanSweep();

    sweep.record(seeded, remove);

    expect(sweep.beginSave()).toBe(1);

    await sweep.sweep(EMPTY_DOCUMENT);

    expect(remove).toHaveBeenCalledWith(seeded);
  });

  it('ignores a url that is not a string and still sweeps the orphan recorded beside it', async () => {
    const removeBad = resolvingRemove();
    const remove = resolvingRemove();
    const sweep = createOrphanSweep();

    sweep.record(undefined as unknown as string, removeBad);
    sweep.record(IMAGE, remove);

    await expect(sweep.sweep(EMPTY_DOCUMENT)).resolves.toBeUndefined();

    expect(remove).toHaveBeenCalledWith(IMAGE);
    expect(removeBad).not.toHaveBeenCalled();
  });
});

/**
 * The walk must survive every shape a tool can nest into its `data`: scalars,
 * nulls, arrays, and payloads that point back at themselves.
 */
describe('orphan-sweep — the document walk', () => {
  it('walks past a null field without rejecting the sweep', async () => {
    const remove = resolvingRemove();
    const sweep = createOrphanSweep();

    sweep.record(IMAGE, remove);

    await expect(sweep.sweep({
      time: 0,
      version: '1',
      blocks: [ {
        id: 'block-0',
        type: 'image',
        data: { file: { url: IMAGE }, caption: null },
      } ],
    })).resolves.toBeUndefined();

    expect(remove).not.toHaveBeenCalled();
  });

  it('walks past a field explicitly set to undefined without rejecting the sweep', async () => {
    const remove = resolvingRemove();
    const sweep = createOrphanSweep();

    sweep.record(IMAGE, remove);

    await expect(sweep.sweep({
      time: 0,
      version: '1',
      blocks: [ {
        id: 'block-0',
        type: 'image',
        data: { file: { url: IMAGE }, caption: undefined },
      } ],
    })).resolves.toBeUndefined();

    expect(remove).not.toHaveBeenCalled();
  });

  it('terminates on a payload that references itself', async () => {
    const data: Record<string, unknown> = { file: { url: IMAGE } };

    data.self = data;

    const remove = resolvingRemove();
    const sweep = createOrphanSweep();

    sweep.record(IMAGE, remove);

    await expect(sweep.sweep({
      time: 0,
      version: '1',
      blocks: [ { id: 'block-0', type: 'image', data } ],
    })).resolves.toBeUndefined();

    expect(remove).not.toHaveBeenCalled();
  });

  // An array is walked as a list of ELEMENTS. Its index strings are not text
  // the document holds, so reading them as references would spare an orphan
  // whose url happens to spell an index.
  it('does not read array index strings as references', async () => {
    const remove = resolvingRemove();
    const sweep = createOrphanSweep();

    sweep.record('0', remove);
    sweep.record(IMAGE, remove);

    await expect(sweep.sweep({
      time: 0,
      version: '1',
      blocks: [ { id: 'alpha', type: 'image', data: { file: { url: IMAGE } } } ],
    })).resolves.toBeUndefined();

    expect(remove).toHaveBeenCalledWith('0');
    expect(remove).not.toHaveBeenCalledWith(IMAGE);
  });

  // An element nested in an array is still text the document holds — the blocks
  // list is where a media url lives.
  it('finds a reference held by an element of an array', async () => {
    const remove = resolvingRemove();
    const sweep = createOrphanSweep();

    sweep.record(IMAGE, remove);

    await expect(sweep.sweep(documentWith(IMAGE))).resolves.toBeUndefined();

    expect(remove).not.toHaveBeenCalled();
  });

  it('still deletes an orphan recorded beside a referenced asset', async () => {
    const remove = resolvingRemove();
    const sweep = createOrphanSweep();

    sweep.record(IMAGE, remove);
    sweep.record(OTHER, remove);

    await sweep.sweep(documentWith(IMAGE));

    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(OTHER);
  });
});

describe('orphan-sweep — per-editor attachment', () => {
  const ownerFor = (): NonNullable<BlokConfig['persistence']> => ({
    load: async () => null,
    save: async () => undefined,
  });

  it('answers with the set attached to that persistence block', () => {
    const owner = ownerFor();
    const sweep = createOrphanSweep();

    attachOrphanSweep(owner, sweep);

    expect(orphanSweepFor(owner)).toBe(sweep);
  });

  it('answers undefined for an editor with no persistence block', () => {
    expect(orphanSweepFor(undefined)).toBeUndefined();
  });

  it('answers undefined for a persistence block nothing was attached to', () => {
    expect(orphanSweepFor(ownerFor())).toBeUndefined();
  });
});
