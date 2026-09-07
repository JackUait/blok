import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOrphanSweep } from '../../../../src/components/utils/orphan-sweep';
import { sanitizeBlocks } from '../../../../src/components/utils/sanitizer';
import { Paragraph } from '../../../../src/tools/paragraph';
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

  // The walk must scan object KEYS, not just values: a tool keying its data by
  // URL counted as referenced while presence was a JSON.stringify substring
  // test, and a false orphan is deleted while the document still points at it.
  it('leaves an asset referenced only as an object key alone', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const sweep = createOrphanSweep();

    sweep.record(IMAGE, remove);
    await sweep.sweep({
      time: 0,
      version: '1',
      blocks: [{
        id: 'block-0',
        type: 'gallery',
        data: { sizes: { [IMAGE]: { width: 10 } } },
      }],
    });

    expect(remove).not.toHaveBeenCalled();
  });

  // Presence is a substring test against the strings the document holds, not a
  // walk of block data per tool: audio cover art already nests a URL somewhere
  // no per-tool rule would look.
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

  // A removal is issued as the sweep decides, and the queue no longer waits for
  // it, so the next save's sweep runs while the first delete is still open.
  it('does not offer a candidate again while its removal is still in flight', async () => {
    const remove = vi.fn(() => new Promise<void>(() => undefined));
    const sweep = createOrphanSweep();

    sweep.record(IMAGE, remove);

    // Neither sweep is awaited: the removal never settles, so both would hang.
    // `remove` is issued synchronously as the sweep decides, which is what the
    // count below reads.
    void sweep.sweep(EMPTY_DOCUMENT);
    void sweep.sweep(EMPTY_DOCUMENT);
    await Promise.resolve();

    expect(remove).toHaveBeenCalledTimes(1);
  });

  // Retrying forever costs a request per save for the rest of the session and
  // never gets anywhere against an endpoint that refuses the delete outright.
  it('gives up on a removal the host keeps refusing', async () => {
    const remove = vi.fn().mockRejectedValue(new Error('forbidden'));
    const sweep = createOrphanSweep();

    sweep.record(IMAGE, remove);

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await sweep.sweep(EMPTY_DOCUMENT);
    }

    expect(remove).toHaveBeenCalledTimes(3);
  });
});

/**
 * A saved document does not necessarily hold the URL byte-for-byte: the
 * sanitizer parses strings through an innerHTML round trip, which entity-encodes
 * `&` — the character every signed CDN URL is full of.
 */
describe('createOrphanSweep — entity-encoded URLs', () => {
  const SIGNED = 'https://cdn.example/uploads/a1.png?X-Amz-Signature=abc&X-Amz-Date=20260101';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('leaves an asset the document still references as an entity-encoded URL alone', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const sweep = createOrphanSweep();

    sweep.record(SIGNED, remove);
    await sweep.sweep({
      time: 0,
      version: '1',
      blocks: [ {
        id: 'a',
        type: 'image',
        data: { file: { url: SIGNED.replace('&', '&amp;') } },
      } ],
    });

    expect(remove).not.toHaveBeenCalled();
  });

  // Path (a): a host-level `sanitizer` config makes every string go through the
  // parser, a media block's own `data.url` included.
  it('survives the global sanitizer re-encoding a media block url', async () => {
    const [block] = sanitizeBlocks(
      [ { tool: 'image',
        data: { file: { url: SIGNED } } } ],
      {},
      { b: true }
    );

    expect(JSON.stringify(block.data)).toContain('&amp;');

    const remove = vi.fn().mockResolvedValue(undefined);
    const sweep = createOrphanSweep();

    sweep.record(SIGNED, remove);
    await sweep.sweep({ time: 0,
      version: '1',
      blocks: [ { id: 'a',
        type: 'image',
        data: block.data } ] });

    expect(remove).not.toHaveBeenCalled();
  });

  // Path (b): no global sanitizer needed — the paragraph tool allows `a[href]`,
  // so a link to the asset is re-encoded by the tool's own rules.
  it('survives a paragraph link to the asset being re-encoded', async () => {
    const [block] = sanitizeBlocks(
      [ { tool: 'paragraph',
        data: { text: `<a href="${SIGNED}">download</a>` } } ],
      Paragraph.sanitize
    );

    expect(JSON.stringify(block.data)).toContain('&amp;');

    const remove = vi.fn().mockResolvedValue(undefined);
    const sweep = createOrphanSweep();

    sweep.record(SIGNED, remove);
    await sweep.sweep({ time: 0,
      version: '1',
      blocks: [ { id: 'a',
        type: 'paragraph',
        data: block.data } ] });

    expect(remove).not.toHaveBeenCalled();
  });
});

/**
 * Presence is tested against the document's own strings. Serializing it to JSON
 * first would hide any URL holding a `"` or a `\` behind JSON's escaping — a
 * `Content-Disposition` filename is enough to produce one — and the file behind
 * a visible block would be deleted with no undo.
 */
describe('createOrphanSweep — URLs JSON escaping would hide', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('leaves an asset referenced by a URL holding a quote alone', async () => {
    const quoted = 'https://cdn.example/u/a?t="x"&n=1';
    const remove = vi.fn().mockResolvedValue(undefined);
    const sweep = createOrphanSweep();

    sweep.record(quoted, remove);
    await sweep.sweep(documentWith(quoted));

    expect(remove).not.toHaveBeenCalled();
  });

  it('leaves an asset referenced by a URL holding a backslash alone', async () => {
    const escaped = 'https://cdn.example/u/a\\b.png';
    const remove = vi.fn().mockResolvedValue(undefined);
    const sweep = createOrphanSweep();

    sweep.record(escaped, remove);
    await sweep.sweep(documentWith(escaped));

    expect(remove).not.toHaveBeenCalled();
  });

  it('survives a block whose data references itself', async () => {
    const data: Record<string, unknown> = { file: { url: IMAGE } };

    data.self = data;

    const remove = vi.fn().mockResolvedValue(undefined);
    const sweep = createOrphanSweep();

    sweep.record(IMAGE, remove);

    await expect(sweep.sweep({
      time: 0,
      version: '1',
      blocks: [ { id: 'a',
        type: 'image',
        data } ],
    })).resolves.toBeUndefined();

    expect(remove).not.toHaveBeenCalled();
  });

  // The substring semantics are load-bearing: a URL may sit inside a larger
  // string, so the walk must keep matching within one, not compare whole values.
  it('finds a URL nested inside a block html string', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const sweep = createOrphanSweep();

    sweep.record(IMAGE, remove);
    await sweep.sweep({
      time: 0,
      version: '1',
      blocks: [ { id: 'a',
        type: 'paragraph',
        data: { text: `see <img src="${IMAGE}"> here` } } ],
    });

    expect(remove).not.toHaveBeenCalled();
  });
});

/**
 * `UploadedAsset` comes from host code, so `record` may be handed a URL that is
 * not a string — a JavaScript uploader resolving `{ url: response.headers.get(
 * 'Location') }` with no such header does it. One of those must not take the
 * whole pass down: the entry it poisons would otherwise reject every later
 * sweep, so orphan cleanup would be dead for the rest of the session.
 */
describe('createOrphanSweep — a URL that is not a string', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ignores it and still deletes a genuine orphan recorded beside it', async () => {
    const removeBad = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    const sweep = createOrphanSweep();

    sweep.record(undefined as unknown as string, removeBad);
    sweep.record(IMAGE, remove);

    await expect(sweep.sweep(EMPTY_DOCUMENT)).resolves.toBeUndefined();

    expect(remove).toHaveBeenCalledWith(IMAGE);
    expect(removeBad).not.toHaveBeenCalled();
  });
});
