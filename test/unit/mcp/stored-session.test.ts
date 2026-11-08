// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { surfaceError } from '../../../src/mcp/errors';
import type { DocumentSource } from '../../../src/mcp/sources/types';
import { openStoredSession } from '../../../src/mcp/stored-session';
import type { AgentBatch } from '../../../types/agent';

const okResult = { ok: true as const, revision: 'r', results: [], refs: {}, changed: { created: ['p1'], updated: [], moved: [], removed: [] }, warnings: [] };

const contract = {
  formatVersion: 1, revision: 'c1', manifest: {}, guidance: { general: '', commands: {}, tools: {} },
  commands: [
    { name: 'doc.read', readOnly: true, available: true },
    { name: 'block.insert', readOnly: false, available: true },
    { name: 'history.undo', readOnly: false, available: true },
  ],
} as never;

describe('openStoredSession', () => {
  let source: DocumentSource;
  let documents: unknown[];
  const agents: Array<{ execute: ReturnType<typeof vi.fn> }> = [];
  const agent = (doc: unknown) => ({
    id: 's', actor: { id: 'agent:x', name: 'x', kind: 'agent' as const },
    read: vi.fn(async () => ({ doc }) as never),
    describe: vi.fn(() => ({}) as never),
    execute: vi.fn(async () => okResult),
    log: () => [],
    close: () => undefined,
    output: () => ({ blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'x' } }] }),
    // Differs from okResult.revision, so a write counts as a change.
    revision: () => 'r0',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    documents = [];
    source = {
      kind: 'files',
      load: vi.fn(async () => ({ raw: { blocks: [] }, version: 'v1' })),
      save: vi.fn(async () => ({ version: 'v2' })),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const open = (write = true) => openStoredSession({
    documentId: 'doc',
    write,
    source,
    contract,
    loadDocument: (raw) => {
      documents.push(raw);

      return raw as never;
    },
    createAgentSession: (document) => {
      const made = agent(document);

      agents.push(made);

      return made;
    },
  });

  it('hands the client\'s approver to the agent session', async () => {
    const session = await open();
    const approve = vi.fn(async () => true);
    const batch: AgentBatch = { commands: [{ name: 'block.insert', args: { type: 'paragraph' } }] };

    await session.execute(batch, { approve });

    expect(agents.at(-1)?.execute).toHaveBeenCalledWith(batch, { approve });
  });

  it('loads through 01 loader and reports its facts', async () => {
    const session = await open();

    expect(documents).toEqual([{ blocks: [] }]);
    expect(session).toMatchObject({ mode: 'stored', write: true, durability: 'saved-on-execute', contractRevision: 'c1' });
  });

  it('saves after a writing batch with the last version and reports it', async () => {
    const session = await open();
    const result = await session.execute({ commands: [{ name: 'block.insert', args: {} }] });

    expect(source.save).toHaveBeenCalledWith('doc', { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'x' } }] }, { ifVersion: 'v1' });
    expect(result).toMatchObject({ ok: true, delivery: { durable: true, pending: false, serverSequence: null, savedVersion: 'v2' } });
  });

  it('chains versions: the second save uses the first save version (Review Focus 1)', async () => {
    vi.mocked(source.save).mockResolvedValueOnce({ version: 'v2' }).mockResolvedValueOnce({ version: 'v3' });
    const session = await open();

    await session.execute({ commands: [{ name: 'block.insert', args: {} }] });
    await session.execute({ commands: [{ name: 'block.insert', args: {} }] });

    expect(vi.mocked(source.save).mock.calls.map((call) => call[2])).toEqual([{ ifVersion: 'v1' }, { ifVersion: 'v2' }]);
  });

  it('does not save a read-only batch', async () => {
    const session = await open();
    const result = await session.execute({ commands: [{ name: 'doc.read', args: {} }] });

    expect(source.save).not.toHaveBeenCalled();
    expect(result.delivery).toEqual({ durable: false, pending: false, serverSequence: null, savedVersion: null });
  });

  it.each([
    ['commands is not an array', { commands: 5 }],
    ['an entry is null', { commands: [null, { args: {} }] }],
  ])('hands a malformed batch to core when %s, instead of throwing', async (_label, batch) => {
    const refusal = { ok: false as const, error: { code: 'INVALID_ARGS' as const, message: 'core', retryable: false }, warnings: [] };
    const session = await openStoredSession({
      documentId: 'doc', write: false, source, contract, loadDocument: raw => raw as never,
      createAgentSession: document => ({ ...agent(document), execute: vi.fn(async () => refusal) }),
    });

    expect(await session.execute(batch as never)).toMatchObject({ ok: false, error: { code: 'INVALID_ARGS', message: 'core' } });
    expect(source.save).not.toHaveBeenCalled();
  });

  it('refuses writes on a read-only handle without running them', async () => {
    const session = await open(false);
    const result = await session.execute({ commands: [{ name: 'block.insert', args: {} }] });

    expect(result).toMatchObject({ ok: false, error: { code: 'READ_ONLY' } });
    expect(source.save).not.toHaveBeenCalled();
  });

  it('on DOCUMENT_CHANGED reloads and reports the conflict', async () => {
    vi.mocked(source.save).mockRejectedValueOnce(surfaceError('DOCUMENT_CHANGED', 'stale'));
    vi.mocked(source.load).mockResolvedValueOnce({ raw: { blocks: [] }, version: 'v1' }).mockResolvedValueOnce({ raw: { blocks: [], title: 'theirs' }, version: 'v9' });
    const session = await open();
    const result = await session.execute({ commands: [{ name: 'block.insert', args: {} }] });

    expect(result).toMatchObject({ ok: false, error: { code: 'DOCUMENT_CHANGED' }, delivery: { durable: false } });
    expect(documents.at(-1)).toEqual({ blocks: [], title: 'theirs' });
    await session.execute({ commands: [{ name: 'block.insert', args: {} }] });
    expect(vi.mocked(source.save).mock.calls.at(-1)?.[2]).toEqual({ ifVersion: 'v9' });
  });

  it('drops the refused batch when the save fails with an unexpected error', async () => {
    const failure = new Error('disk exploded');
    vi.mocked(source.save).mockRejectedValueOnce(failure);
    vi.mocked(source.load)
      .mockResolvedValueOnce({ raw: { blocks: [] }, version: 'v1' })
      .mockResolvedValueOnce({ raw: { blocks: [], title: 'reloaded' }, version: 'v7' });
    const session = await open();

    await expect(session.execute({ commands: [{ name: 'block.insert', args: {} }] })).rejects.toBe(failure);
    expect(documents.at(-1)).toEqual({ blocks: [], title: 'reloaded' });
    await session.execute({ commands: [{ name: 'block.insert', args: {} }] });
    expect(vi.mocked(source.save).mock.calls.at(-1)?.[2]).toEqual({ ifVersion: 'v7' });
  });

  describe('a save that breaks with an unexpected error after the batch made pages', () => {
    const SERVER_STOP = { code: 'APPLY_FAILED', message: 'The batch stopped on a server error. Nothing was written.', retryable: true };
    const openMaking = (made: string[]) => openStoredSession({
      documentId: 'doc', write: true, source, contract, madePages: made,
      loadDocument: (raw) => raw as never,
      createAgentSession: (document) => ({
        ...agent(document),
        output: () => document,
        execute: vi.fn(async () => {
          made.push('page-1', 'page-2');

          return okResult;
        }),
      }),
    });

    it('lists the pages the reloaded parent does not name as orphaned, and logs the error', async () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.mocked(source.save).mockRejectedValueOnce(new Error('disk exploded'));
      vi.mocked(source.load)
        .mockResolvedValueOnce({ raw: { blocks: [] }, version: 'v1' })
        .mockResolvedValueOnce({ raw: { blocks: [{ id: 'b', type: 'page', data: { pageId: 'page-1' } }] }, version: 'v2' });
      const session = await openMaking([]);
      const result = await session.execute({ commands: [{ name: 'block.insert', args: {} }] });

      expect(result).toEqual({
        ok: false,
        error: {
          code: 'ORPHANED_SIDE_EFFECT',
          message: `The batch failed after the host did work for it (${SERVER_STOP.message}). Clean up the listed items.`,
          retryable: false,
          details: { orphaned: [{ command: 'block.insert', type: 'page', prepared: { pageId: 'page-2' } }], cause: SERVER_STOP },
        },
        warnings: [],
        delivery: { durable: false, pending: false, serverSequence: null, savedVersion: null },
      });
      expect(logged).toHaveBeenCalled();
    });

    it('throws the error as before when the parent cannot be read again', async () => {
      const failure = new Error('disk exploded');
      vi.mocked(source.save).mockRejectedValueOnce(failure);
      vi.mocked(source.load)
        .mockResolvedValueOnce({ raw: { blocks: [] }, version: 'v1' })
        .mockRejectedValueOnce(surfaceError('SOURCE_UNAVAILABLE', 'gone'));
      const session = await openMaking([]);

      await expect(session.execute({ commands: [{ name: 'block.insert', args: {} }] })).rejects.toBe(failure);
    });

    it('throws the error as before when the reloaded parent names every page', async () => {
      const failure = new Error('disk exploded');
      vi.mocked(source.save).mockRejectedValueOnce(failure);
      vi.mocked(source.load)
        .mockResolvedValueOnce({ raw: { blocks: [] }, version: 'v1' })
        .mockResolvedValueOnce({ raw: { blocks: [{ id: 'a', type: 'page', data: { pageId: 'page-1' } }, { id: 'b', type: 'page', data: { pageId: 'page-2' } }] }, version: 'v2' });
      const session = await openMaking([]);

      await expect(session.execute({ commands: [{ name: 'block.insert', args: {} }] })).rejects.toBe(failure);
    });

    it('does not report pages an earlier batch made', async () => {
      const failure = new Error('disk exploded');
      const made: string[] = [];
      const session = await openMaking(made);

      await session.execute({ commands: [{ name: 'block.insert', args: {} }] });
      vi.mocked(source.save).mockRejectedValueOnce(failure);
      const second = await openStoredSession({
        documentId: 'doc', write: true, source, contract, madePages: made,
        loadDocument: (raw) => raw as never,
        createAgentSession: (document) => ({ ...agent(document), output: () => document }),
      });

      await expect(second.execute({ commands: [{ name: 'block.insert', args: {} }] })).rejects.toBe(failure);
    });
  });

  it('saves an undo like any batch', async () => {
    const session = await open();

    await session.execute({ commands: [{ name: 'history.undo', args: {} }] });
    expect(source.save).toHaveBeenCalledTimes(1);
  });

  it('passes a failed batch through without saving', async () => {
    const failing = { ok: false as const, revision: 'r', error: { code: 'BLOCK_NOT_FOUND' as const, message: 'x', retryable: false }, warnings: [] };
    const session = await openStoredSession({
      documentId: 'doc', write: true, source, contract,
      loadDocument: (raw) => raw as never,
      createAgentSession: (document) => ({ ...agent(document), execute: vi.fn(async () => failing) }),
    });

    expect(await session.execute({ commands: [{ name: 'block.insert', args: {} }] })).toMatchObject({ ...failing, delivery: { durable: false } });
    expect(source.save).not.toHaveBeenCalled();
  });

  it('closes with nothing unsaved', async () => {
    expect(await (await open()).close('closed')).toEqual({ unsavedBatches: 0, hostRecordLags: false });
  });
});
