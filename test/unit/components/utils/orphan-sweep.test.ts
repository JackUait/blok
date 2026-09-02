import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOrphanSweep } from '../../../../src/components/utils/orphan-sweep';
import type { OutputData } from '../../../../types';

const IMAGE = 'https://cdn.example/uploads/a1.png';
const COVER = 'https://cdn.example/uploads/cover.png';

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

describe('createOrphanSweep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deletes an asset this session uploaded that the saved document no longer references', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const sweep = createOrphanSweep();

    sweep.record(IMAGE, remove);
    await sweep.sweep(EMPTY_DOCUMENT);

    expect(remove).toHaveBeenCalledWith(IMAGE);
  });

  it('leaves an asset the saved document still references alone', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const sweep = createOrphanSweep();

    sweep.record(IMAGE, remove);
    await sweep.sweep(documentWith(IMAGE));

    expect(remove).not.toHaveBeenCalled();
  });

  // Presence is a substring test against the serialized document, not a walk of
  // block data per tool: audio cover art already nests a URL somewhere no
  // per-tool rule would look.
  it('finds a URL wherever a tool nested it, not only at data.url', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const sweep = createOrphanSweep();

    sweep.record(COVER, remove);
    await sweep.sweep({
      time: 0,
      version: '1',
      blocks: [ { id: 'a', type: 'audio', data: { file: { url: IMAGE }, cover: { url: COVER } } } ],
    });

    expect(remove).not.toHaveBeenCalled();
  });

  // The same URL may still live in a document this editor cannot see, so a URL
  // that arrived by paste is not this session's to delete.
  it('never deletes a URL this session did not upload, present or absent', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const sweep = createOrphanSweep();

    sweep.record(IMAGE, remove);
    await sweep.sweep(documentWith(COVER));
    await sweep.sweep(documentWith(IMAGE));

    expect(remove).not.toHaveBeenCalledWith(COVER);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(IMAGE);
  });

  it('drops a swept URL from the candidates, so a later save does not delete it twice', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const sweep = createOrphanSweep();

    sweep.record(IMAGE, remove);
    await sweep.sweep(EMPTY_DOCUMENT);
    await sweep.sweep(EMPTY_DOCUMENT);

    expect(remove).toHaveBeenCalledTimes(1);
  });

  // A host that refuses the deletion has not deleted the asset, so the asset is
  // still an orphan and still ours to retry on the next save.
  it('survives a rejecting delete and keeps the URL a candidate', async () => {
    const remove = vi.fn()
      .mockRejectedValueOnce(new Error('gone wrong'))
      .mockResolvedValue(undefined);
    const sweep = createOrphanSweep();

    sweep.record(IMAGE, remove);

    await expect(sweep.sweep(EMPTY_DOCUMENT)).resolves.toBeUndefined();

    await sweep.sweep(EMPTY_DOCUMENT);

    expect(remove).toHaveBeenCalledTimes(2);
  });

  it('does nothing when this session uploaded nothing', async () => {
    const sweep = createOrphanSweep();

    await expect(sweep.sweep(EMPTY_DOCUMENT)).resolves.toBeUndefined();
  });
});
