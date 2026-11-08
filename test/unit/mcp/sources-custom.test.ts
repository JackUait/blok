// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { McpConfigError } from '../../../src/mcp/config';
import { createBlok } from '../../../src/mcp/embed';
import { BlokMcpSourceError, createBlokMcpServer } from '../../../src/mcp/index';
import { assembleMcp } from '../../../src/mcp/server';
import type { AssembledMcp } from '../../../src/mcp/server';
import type { Caller } from '../../../src/mcp/dispatcher';
import type { BlokDocumentCaller, BlokMcpDocumentSource, BlokMcpOptions } from '../../../src/mcp/options';

const caller: Caller = { principal: 'alice', clientName: 'Desktop', scopes: null };
const aliceCaller: BlokDocumentCaller = {
  principal: 'alice',
  clientName: 'Desktop',
  scopes: null,
  actor: { id: 'agent:alice:Desktop', name: 'Desktop (for alice)', kind: 'agent', onBehalfOf: 'alice' },
};
const STORED_DOC = { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'Stored' } }] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const owned: AssembledMcp[] = [];

const assemble = (source: BlokMcpDocumentSource, options: Partial<BlokMcpOptions> = {}): AssembledMcp => {
  const server = assembleMcp({
    transport: { kind: 'stdio' },
    auth: { kind: 'none' },
    source: { kind: 'custom', source },
    ...options,
  });

  owned.push(server);

  return server;
};

const hostSource = (overrides: Partial<BlokMcpDocumentSource> = {}): BlokMcpDocumentSource & {
  load: ReturnType<typeof vi.fn<BlokMcpDocumentSource['load']>>;
  save: ReturnType<typeof vi.fn<BlokMcpDocumentSource['save']>>;
} => ({
  load: vi.fn<BlokMcpDocumentSource['load']>(async () => ({ documentText: JSON.stringify(STORED_DOC), version: 'v1' })),
  save: vi.fn<BlokMcpDocumentSource['save']>(async () => ({ version: 'v2' })),
  ...overrides,
} as never);

const structured = (outcome: unknown): Record<string, unknown> =>
  isRecord(outcome) && isRecord(outcome.structuredContent) ? outcome.structuredContent : {};

const errorOf = (outcome: unknown): unknown => structured(outcome).error;

const openHandle = async (server: AssembledMcp, documentId = 'doc'): Promise<string> => {
  const opened = structured(await server.dispatch('blok_open', { documentId, mode: 'stored', write: true }, caller));

  if (typeof opened.handle !== 'string') {
    throw new Error(`blok_open failed: ${JSON.stringify(opened)}`);
  }

  return opened.handle;
};

const setTitle = (server: AssembledMcp, handle: string, title: string): Promise<unknown> =>
  server.dispatch('blok_execute', { handle, commands: [{ name: 'doc.setTitle', args: { title } }] }, caller);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(owned.splice(0).map(server => server.stop()));
});

describe('custom document source', () => {
  it('loads and saves through the host with the opener\'s caller and the compact document text', async () => {
    const source = hostSource();
    const server = assemble(source);
    const handle = await openHandle(server);
    const outcome = await setTitle(server, handle, 'Saved');

    expect(source.load).toHaveBeenCalledWith(aliceCaller, 'doc');
    expect(source.save).toHaveBeenCalledTimes(1);
    const [who, id, text, ifVersion] = source.save.mock.calls[0];

    expect([who, id, ifVersion]).toEqual([aliceCaller, 'doc', 'v1']);
    expect(text).toBe(JSON.stringify(JSON.parse(text)));
    expect(JSON.parse(text)).toMatchObject({ title: 'Saved', blocks: [{ id: 'p1' }] });
    expect(structured(outcome)).toMatchObject({ ok: true, delivery: { durable: true, savedVersion: 'v2' } });
  });

  it('opens a missing document empty, and its first save asks for create-if-absent with ifVersion null', async () => {
    const source = hostSource({ load: vi.fn(async () => null) });
    const server = assemble(source);
    const opened = structured(await server.dispatch('blok_open', { documentId: 'new', mode: 'stored', write: true }, caller));

    expect(opened.exists).toBe(false);
    await setTitle(server, String(opened.handle), 'First');
    await setTitle(server, String(opened.handle), 'Second');

    expect(source.save.mock.calls.map(call => call[3])).toEqual([null, 'v2']);
  });

  it('maps each source error kind to its agent code, showing the host\'s agentMessage', async () => {
    const cases = [
      ['changed', 'DOCUMENT_CHANGED', true],
      ['unavailable', 'SOURCE_UNAVAILABLE', true],
      ['forbidden', 'FORBIDDEN', false],
      ['invalidId', 'INVALID_ARGS', false],
    ] as const;

    for (const [kind, code, retryable] of cases) {
      const server = assemble(hostSource({ save: vi.fn(async () => Promise.reject(new BlokMcpSourceError(kind, `host says ${kind}`))) }));
      const handle = await openHandle(server);

      expect(errorOf(await setTitle(server, handle, 'x'))).toMatchObject({ code, message: `host says ${kind}`, retryable });
    }
  });

  it('falls back to Blok\'s own words when agentMessage is empty', async () => {
    const server = assemble(hostSource({ save: vi.fn(async () => Promise.reject(new BlokMcpSourceError('changed', ''))) }));
    const handle = await openHandle(server);

    expect(errorOf(await setTitle(server, handle, 'x'))).toMatchObject({
      code: 'DOCUMENT_CHANGED',
      message: 'Someone saved this document since you opened it. Read it again, then retry.',
    });
  });

  it('a refused save reloads the source document', async () => {
    const source = hostSource({ save: vi.fn(async () => Promise.reject(new BlokMcpSourceError('changed', ''))) });
    const server = assemble(source);
    const handle = await openHandle(server);

    source.load.mockResolvedValue({ documentText: '{"title":"Theirs","blocks":[]}', version: 'v9' });
    await setTitle(server, handle, 'Mine');
    const read = structured(await server.dispatch('blok_read', { handle }, caller));

    expect(JSON.stringify(read)).toContain('Theirs');
    expect(JSON.stringify(read)).not.toContain('Mine');
  });

  // Spec §0 F1: a plain throw from the host must not leave the unsaved document or its undo steps in memory.
  it('a generic throw on save is logged in full, answers SOURCE_UNAVAILABLE in generic words, and drops the edit and its undo step', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const secret = new Error('db password=hunter2 at 10.0.0.5');
    const source = hostSource({ save: vi.fn(async () => Promise.reject(secret)) });
    const server = assemble(source);
    const handle = await openHandle(server);
    const failed = errorOf(await setTitle(server, handle, 'Lost'));

    expect(failed).toEqual({
      code: 'SOURCE_UNAVAILABLE',
      message: 'The host could not save this document, so nothing was saved. Try again.',
      retryable: true,
    });
    expect(logged.mock.calls.some(call => call.includes(secret))).toBe(true);
    expect(JSON.stringify(structured(await server.dispatch('blok_read', { handle }, caller)))).not.toContain('Lost');
    const undo = await server.dispatch('blok_execute', { handle, commands: [{ name: 'history.undo', args: {} }] }, caller);

    expect(errorOf(undo) ?? structured(undo)).toMatchObject({ code: 'NOTHING_TO_UNDO' });
    expect(source.load).toHaveBeenCalledTimes(2);
  });

  it('a load or save without a version is a host bug: logged, SOURCE_UNAVAILABLE', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const noLoadVersion = assemble(hostSource({ load: vi.fn(async () => ({ documentText: JSON.stringify(STORED_DOC), version: '' })) }));

    expect(errorOf(await noLoadVersion.dispatch('blok_open', { documentId: 'doc', mode: 'stored' }, caller))).toEqual({
      code: 'SOURCE_UNAVAILABLE',
      message: 'The host could not load this document. Try again.',
      retryable: true,
    });
    const noSaveVersion = assemble(hostSource({ save: vi.fn(async () => ({}) as never) }));
    const handle = await openHandle(noSaveVersion);

    expect(errorOf(await setTitle(noSaveVersion, handle, 'x'))).toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
    expect(logged).toHaveBeenCalledTimes(2);
  });

  it('checks every load like a file: blocks array, depth, lone surrogates', async () => {
    const deep = (levels: number): string => (levels === 0 ? '"x"' : `{"a":${deep(levels - 1)}}`);
    const shapeless = assemble(hostSource({ load: vi.fn(async () => ({ documentText: '{"title":"no blocks"}', version: 'v1' })) }));

    expect(errorOf(await shapeless.dispatch('blok_open', { documentId: 'doc', mode: 'stored' }, caller))).toMatchObject({
      code: 'SOURCE_UNAVAILABLE',
      message: 'The host\'s document "doc" is not a Blok document: expected an object with a "blocks" array.',
    });
    // The document itself 49 levels deep: 48 is the limit, as for a file.
    const fits = assemble(hostSource({ load: vi.fn(async () => ({ documentText: `{"blocks":[],"meta":${deep(47)}}`, version: 'v1' })) }));

    expect(structured(await fits.dispatch('blok_open', { documentId: 'doc', mode: 'stored' }, caller))).toMatchObject({ exists: true });
    const tooDeep = assemble(hostSource({ load: vi.fn(async () => ({ documentText: `{"blocks":[],"meta":${deep(48)}}`, version: 'v1' })) }));

    expect(errorOf(await tooDeep.dispatch('blok_open', { documentId: 'doc', mode: 'stored' }, caller))).toMatchObject({
      code: 'SOURCE_UNAVAILABLE',
      message: 'The host\'s document "doc" nests deeper than 48 levels of objects and arrays.',
    });
    const lone = hostSource({ load: vi.fn(async () => ({ documentText: '{"blocks":[{"id":"p1","type":"paragraph","data":{"text":"a\\ud800b"}}]}', version: 'v1' })) });
    const surrogates = assemble(lone);
    const handle = await openHandle(surrogates);
    const read = JSON.stringify(structured(await surrogates.dispatch('blok_read', { handle }, caller)));

    expect(read).toContain('a�b');
    expect(read).not.toContain('\\ud800');
  });

  it('parses the document text as JSON.parse does: a repeated key keeps its last value', async () => {
    const server = assemble(hostSource({ load: vi.fn(async () => ({ documentText: '{"title":"a","blocks":[],"title":"b"}', version: 'v1' })) }));
    const handle = await openHandle(server);

    expect(structured(await server.dispatch('blok_read', { handle }, caller))).toMatchObject({ page: { title: 'b' } });
  });

  it('refuses text that is not JSON, as the endpoint source does', async () => {
    const server = assemble(hostSource({ load: vi.fn(async () => ({ documentText: '{"blocks":', version: 'v1' })) }));

    expect(errorOf(await server.dispatch('blok_open', { documentId: 'doc', mode: 'stored' }, caller))).toEqual({
      code: 'SOURCE_UNAVAILABLE', message: 'The host\'s document "doc" is not JSON.', retryable: true,
    });
  });

  it('refuses a parsed document instead of text as a host bug: logged, SOURCE_UNAVAILABLE', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const server = assemble(hostSource({ load: vi.fn(async () => ({ documentText: STORED_DOC, version: 'v1' }) as never) }));

    expect(errorOf(await server.dispatch('blok_open', { documentId: 'doc', mode: 'stored' }, caller))).toEqual({
      code: 'SOURCE_UNAVAILABLE', message: 'The host could not load this document. Try again.', retryable: true,
    });
    expect(logged).toHaveBeenCalled();
  });

  it.each([['.'], ['..']])('refuses the id %s as INVALID_ARGS before the host sees it', async (documentId) => {
    const source = hostSource();
    const server = assemble(source);

    expect(errorOf(await server.dispatch('blok_open', { documentId, mode: 'stored' }, caller))).toEqual({
      code: 'INVALID_ARGS', message: `"${documentId}" is not a document id.`, retryable: false,
    });
    expect(source.load).not.toHaveBeenCalled();
  });

  it('a save answered without a version says the host may have saved, logs the answer, and reloads', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const source = hostSource({ save: vi.fn(async () => ({ version: 5 }) as never) });
    const server = assemble(source);
    const handle = await openHandle(server);

    expect(errorOf(await setTitle(server, handle, 'x'))).toEqual({
      code: 'SOURCE_UNAVAILABLE',
      message: 'The host may have saved this document but did not say which version. Read it before you retry.',
      retryable: true,
    });
    expect(logged.mock.calls.some(call => call.some(arg => isRecord(arg) && isRecord(arg.answer) && arg.answer.version === 5))).toBe(true);
    expect(source.load).toHaveBeenCalledTimes(2);
  });

  it('saves with the opener\'s caller when a later call comes from another client of the same principal', async () => {
    const source = hostSource();
    const server = assemble(source);
    const handle = await openHandle(server);

    await server.dispatch('blok_execute', { handle, commands: [{ name: 'doc.setTitle', args: { title: 'x' } }] }, { ...caller, clientName: 'Other' });
    expect(source.save.mock.calls[0][0]).toEqual(aliceCaller);
  });

  it('creates a page document through the host with Blok\'s id: load finds none, the save asks create-if-absent', async () => {
    const source = hostSource();
    const server = assemble(source, { pageTitles: 'page-map' });
    const handle = await openHandle(server);

    source.load.mockResolvedValue(null);
    const inserted = structured(await server.dispatch('blok_execute', {
      handle, commands: [{ name: 'block.insert', args: { type: 'page', id: 'np', position: 'end' } }],
    }, caller));

    expect(inserted).toMatchObject({ ok: true });
    const pageSave = source.save.mock.calls.find(call => call[1] !== 'doc');

    expect(pageSave).toEqual([aliceCaller, expect.any(String), '{"blocks":[]}', null]);
  });

  it('runs every listed id and title through the same text checks', async () => {
    const list = vi.fn<NonNullable<BlokMcpDocumentSource['list']>>(async () => ({ documents: [{ id: 'mine', title: 'a\uD800b' }] }));
    const server = assemble(hostSource({ list }));

    expect(structured(await server.dispatch('blok_list_documents', {}, caller))).toMatchObject({ documents: [{ id: 'mine', title: 'a\uFFFDb' }] });
  });

  it('lists through the host with the caller, and still drops ids authorize refuses', async () => {
    const list = vi.fn<NonNullable<BlokMcpDocumentSource['list']>>(async () => ({
      documents: [{ id: 'mine', title: 'Mine' }, { id: 'theirs' }],
      nextCursor: 'next',
    }));
    const authorize = vi.fn(async (_principal: string, id: string) => id === 'mine');
    const server = assemble(hostSource({ list }), { authorize });

    expect(structured(await server.dispatch('blok_list_documents', { query: 'm' }, caller))).toEqual({
      documents: [{ id: 'mine', title: 'Mine', live: false }],
      nextCursor: 'next',
      supported: true,
    });
    expect(list).toHaveBeenCalledWith(aliceCaller, { query: 'm', limit: expect.any(Number) as number });
  });

  it('without a list method, listing is not supported', async () => {
    const server = assemble(hostSource());

    expect(structured(await server.dispatch('blok_list_documents', {}, caller))).toMatchObject({ supported: false });
  });

  it('refuses at start a custom source without load and save functions', () => {
    expect(() => assembleMcp({
      transport: { kind: 'stdio' }, auth: { kind: 'none' }, source: { kind: 'custom', source: { load: () => null } as never },
    })).toThrow(new McpConfigError('source.source needs load and save functions'));
  });

  // The ticket route's waiver is "no source": a custom source must not open every document to HTTP callers.
  it('counts as a source in the safety check: ticket URL, custom source and no authorize refuse to start', () => {
    const tickets = { kind: 'url' as const, url: 'http://127.0.0.1:1/tickets', hostToken: 'token' };
    const source = { kind: 'custom' as const, source: hostSource() };

    expect(() => createBlokMcpServer({
      transport: { kind: 'http', listen: '127.0.0.1:0' }, auth: { kind: 'none' }, sync: { url: 'ws://127.0.0.1:1' }, tickets, source,
    })).toThrow(McpConfigError);
    expect(() => createBlok({ sync: { url: 'ws://127.0.0.1:1' }, tickets, source })).toThrow(McpConfigError);
  });
});
