// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPageWebhook } from '../../../src/mcp/create-page';
import type { Caller } from '../../../src/mcp/dispatcher';
import type { BlokMcpOptions, BlokPageCreateRequest } from '../../../src/mcp/options';
import { assembleMcp, type AssembledMcp } from '../../../src/mcp/server';
import { isObject } from '../../../src/shared/type-guards';
import { invoke } from '../../../src/view/server-runtime';

const caller: Caller = { principal: 'alice', clientName: 'e2e', scopes: null };
const insertPages = (count: number): Array<{ name: string; args: Record<string, unknown> }> =>
  Array.from({ length: count }, (_, index) => ({ name: 'block.insert', args: { type: 'page', id: `np${index}`, position: 'end' } }));

const HOST_FAILED = { code: 'SOURCE_UNAVAILABLE', message: 'The host could not create the page.', retryable: true };
const SERVER_STOP = { code: 'APPLY_FAILED', message: 'The batch stopped on a server error. Nothing was written.', retryable: true };

describe('a host page creator', () => {
  let dir: string;
  let mcp: AssembledMcp | undefined;
  const parentText = JSON.stringify({ blocks: [] });

  const start = (createPage: BlokMcpOptions['createPage'], extra: Partial<BlokMcpOptions> = {}): AssembledMcp => {
    mcp = assembleMcp({
      transport: { kind: 'stdio' }, auth: { kind: 'none' }, source: { kind: 'files', dir }, pageTitles: 'page-map', createPage, ...extra,
    });

    return mcp;
  };
  const openParent = async (server: AssembledMcp): Promise<string> => {
    const opened = await server.dispatch('blok_open', { documentId: 'parent', write: true }, caller);

    expect(opened.isError).toBe(false);

    return opened.structuredContent.handle as string;
  };
  const execute = async (server: AssembledMcp, handle: string, commands: unknown[]): Promise<Record<string, unknown>> =>
    (await server.dispatch('blok_execute', { handle, commands }, caller)).structuredContent;

  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), 'blok-mcp-create-page-'));
    writeFileSync(join(dir, 'parent.json'), parentText);
  });

  afterEach(async () => {
    await mcp?.stop();
    mcp = undefined;
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('puts the host id in data.pageId and tells the host the parent, the principal and the actor', async () => {
    const createPage = vi.fn((_request: BlokPageCreateRequest) => Promise.resolve<string | null>('host-page-1'));
    const server = start(createPage);
    const handle = await openParent(server);
    const result = await execute(server, handle, insertPages(1));

    expect(result).toMatchObject({ ok: true, blocks: [{ data: { pageId: 'host-page-1' } }] });
    expect(createPage).toHaveBeenCalledTimes(1);
    const request = createPage.mock.calls[0][0];

    expect(request).toEqual({
      parentDocumentId: 'parent',
      principal: 'alice',
      actor: expect.objectContaining({ id: 'agent:alice:e2e', onBehalfOf: 'alice' }) as unknown,
      suggestedPageId: expect.any(String) as unknown,
    });
    expect(request.suggestedPageId.length).toBeGreaterThan(0);
  });

  it('does not ask authorize about the new id, and saves no page document for it', async () => {
    const authorize = vi.fn((_principal: string, _documentId: string, _write: boolean) => Promise.resolve(true));
    const server = start(() => Promise.resolve('host-page-1'), { authorize });
    const handle = await openParent(server);

    expect(await execute(server, handle, insertPages(1))).toMatchObject({ ok: true });
    expect(authorize.mock.calls.map(([, documentId]) => documentId)).not.toContain('host-page-1');
    expect(existsSync(join(dir, 'host-page-1.json'))).toBe(false);
  });

  it('fails the insert with FORBIDDEN and saves nothing when the host answers null', async () => {
    const server = start(() => Promise.resolve(null));
    const handle = await openParent(server);
    const result = await execute(server, handle, [{ name: 'doc.setTitle', args: { title: 'Parent' } }, ...insertPages(1)]);

    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN', message: 'You may not create a page document here.', retryable: false, commandIndex: 1 } });
    expect(result.error).not.toHaveProperty('details');
    expect(readFileSync(join(dir, 'parent.json'), 'utf-8')).toBe(parentText);
  });

  describe('a host that fails before any page is made', () => {
    const failures: Array<[string, () => Promise<string | null>]> = [
      ['a throw', () => Promise.reject(new Error('database down'))],
      ['a non-Error rejection', () => Promise.reject('nope')],
      ['an empty id', () => Promise.resolve('')],
      ['an id of 513 characters', () => Promise.resolve('a'.repeat(513))],
      ['an id with a control character', () => Promise.resolve('page\u0007')],
      ['an id with a C1 control character', () => Promise.resolve('page\u0085')],
      ['a number', () => Promise.resolve(7 as unknown as string)],
    ];

    it.each(failures)('answers SOURCE_UNAVAILABLE for %s, logs it, and saves nothing', async (_label, createPage) => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const server = start(createPage);
      const handle = await openParent(server);
      const result = await execute(server, handle, insertPages(1));

      expect(result).toMatchObject({ ok: false, error: { ...HOST_FAILED, commandIndex: 0 } });
      expect(result.error).not.toHaveProperty('details');
      expect(logged).toHaveBeenCalled();
      expect(readFileSync(join(dir, 'parent.json'), 'utf-8')).toBe(parentText);
    });
  });

  it('accepts an id of 512 characters, counted in code points', async () => {
    const id = '😀'.repeat(512);
    const server = start(() => Promise.resolve(id));
    const handle = await openParent(server);

    expect(await execute(server, handle, insertPages(1))).toMatchObject({ ok: true, blocks: [{ data: { pageId: id } }] });
  });

  it('lists the pages made before a host failure as orphaned, with a server-stop cause', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const createPage = vi.fn<(request: BlokPageCreateRequest) => Promise<string | null>>()
      .mockResolvedValueOnce('host-1')
      .mockRejectedValueOnce(new Error('database down'));
    const server = start(createPage);
    const handle = await openParent(server);
    const result = await execute(server, handle, insertPages(2));

    expect(result.error).toEqual({
      code: 'ORPHANED_SIDE_EFFECT',
      message: `The batch failed after the host did work for it (${SERVER_STOP.message}). Clean up the listed items.`,
      retryable: false,
      commandIndex: 1,
      details: {
        orphaned: [{ command: 'block.insert', type: 'page', prepared: { pageId: 'host-1' } }],
        cause: { ...SERVER_STOP, commandIndex: 1 },
      },
    });
    expect(readFileSync(join(dir, 'parent.json'), 'utf-8')).toBe(parentText);
  });

  it('answers as the bundle does when a port sends the same pages and failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const createPage = vi.fn<(request: BlokPageCreateRequest) => Promise<string | null>>()
      .mockResolvedValueOnce('host-1')
      .mockRejectedValueOnce(new Error('database down'));
    const server = start(createPage);
    const handle = await openParent(server);
    const node = await execute(server, handle, insertPages(2));
    const bundle: unknown = JSON.parse(await invoke('agentExecute', JSON.stringify({
      services: ['pageBackend'], prepares: ['page'], document: { blocks: [] }, actor: { id: 'agent', name: 'Agent', kind: 'agent' },
      batch: { commands: insertPages(2) }, createdPages: ['host-1'], createPageFailure: { helper: 'as-is', error: SERVER_STOP },
    })));

    expect(isObject(bundle) && isObject(bundle.result) ? bundle.result.error : undefined).toEqual(node.error);
  });

  it('answers as the bundle does when the first create fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const server = start(() => Promise.reject(new Error('database down')));
    const handle = await openParent(server);
    const node = await execute(server, handle, insertPages(1));
    const bundle: unknown = JSON.parse(await invoke('agentExecute', JSON.stringify({
      services: ['pageBackend'], prepares: ['page'], document: { blocks: [] }, actor: { id: 'agent', name: 'Agent', kind: 'agent' },
      batch: { commands: insertPages(1) }, createdPages: [], createPageFailure: { helper: 'as-is', error: HOST_FAILED },
    })));

    expect(isObject(bundle) && isObject(bundle.result) ? bundle.result.error : undefined).toEqual(node.error);
  });

  it('leaves out a page the parent already names, and answers the cause when none is left', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    writeFileSync(join(dir, 'parent.json'), JSON.stringify({ blocks: [{ id: 'old', type: 'page', data: { pageId: 'linked' } }] }));
    const createPage = vi.fn<(request: BlokPageCreateRequest) => Promise<string | null>>()
      .mockResolvedValueOnce('linked')
      .mockRejectedValueOnce(new Error('database down'));
    const server = start(createPage);
    const handle = await openParent(server);
    const result = await execute(server, handle, insertPages(2));

    expect(result.error).toEqual({ ...SERVER_STOP, commandIndex: 1 });
  });

  it('never asks the host for a batch of 26 page inserts', async () => {
    const createPage = vi.fn(() => Promise.resolve<string | null>('never'));
    const server = start(createPage);
    const handle = await openParent(server);

    expect(await execute(server, handle, insertPages(26))).toMatchObject({ ok: false, error: { code: 'INVALID_ARGS' } });
    expect(createPage).not.toHaveBeenCalled();
  });

  it('asks the host once across an undo and a redo of the insert', async () => {
    const createPage = vi.fn(() => Promise.resolve<string | null>('host-page-1'));
    const server = start(createPage);
    const handle = await openParent(server);

    expect(await execute(server, handle, insertPages(1))).toMatchObject({ ok: true });
    expect(await execute(server, handle, [{ name: 'history.undo', args: {} }])).toMatchObject({ ok: true });
    expect(await execute(server, handle, [{ name: 'history.redo', args: {} }])).toMatchObject({ ok: true });
    expect(createPage).toHaveBeenCalledTimes(1);
    expect(readFileSync(join(dir, 'parent.json'), 'utf-8')).toContain('"host-page-1"');
  });

  it('is never asked without page-map', async () => {
    const createPage = vi.fn(() => Promise.resolve<string | null>('host-page-1'));
    const server = start(createPage, { pageTitles: 'off' });
    const handle = await openParent(server);

    expect(await execute(server, handle, insertPages(1))).toMatchObject({ ok: false, error: { code: 'COMMAND_UNAVAILABLE' } });
    expect(createPage).not.toHaveBeenCalled();
  });
});

describe('createPageWebhook', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const request: BlokPageCreateRequest = {
    parentDocumentId: 'parent',
    principal: 'alice',
    actor: { id: 'agent:alice:e2e', name: 'e2e', kind: 'agent', onBehalfOf: 'alice', color: '#123456' },
    suggestedPageId: 'suggested',
  };
  const answer = (status: number, body: string): Response => new Response(body, { status });
  const sentBody = (call: number): unknown => {
    const body = fetchMock.mock.calls[call][1]?.body;

    return typeof body === 'string' ? JSON.parse(body) : undefined;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POSTs the request as JSON, with the actor as id, name and onBehalfOf', async () => {
    fetchMock.mockResolvedValueOnce(answer(200, '{"pageId":"host-1"}'));
    const hook = createPageWebhook('https://app.example/pages', { fetchImpl: fetchMock });

    expect(await hook(request)).toBe('host-1');
    const [url, init] = fetchMock.mock.calls[0];

    expect(url).toBe('https://app.example/pages');
    expect(init).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'manual' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(sentBody(0)).toEqual({
      parentDocumentId: 'parent',
      principal: 'alice',
      actor: { id: 'agent:alice:e2e', name: 'e2e', onBehalfOf: 'alice' },
      suggestedPageId: 'suggested',
    });
  });

  it('sends onBehalfOf as null when the actor has none', async () => {
    fetchMock.mockResolvedValueOnce(answer(200, '{"pageId":"host-1"}'));
    const hook = createPageWebhook('https://app.example/pages', { fetchImpl: fetchMock });

    await hook({ ...request, actor: { id: 'agent', name: 'Agent', kind: 'agent' } });
    expect(sentBody(0)).toMatchObject({ actor: { id: 'agent', name: 'Agent', onBehalfOf: null } });
  });

  it('answers null for a 200 with a null pageId: the host refused', async () => {
    fetchMock.mockResolvedValueOnce(answer(200, '{"pageId":null}'));

    expect(await createPageWebhook('https://app.example/pages', { fetchImpl: fetchMock })(request)).toBeNull();
  });

  it.each([
    ['a 500', 500, '{"pageId":"x"}'],
    ['a 201', 201, '{"pageId":"x"}'],
    ['a 302', 302, ''],
    ['a body without pageId', 200, '{}'],
    ['a pageId that is no string', 200, '{"pageId":7}'],
    ['a body that is no JSON', 200, 'nope'],
    ['a body that is an array', 200, '[]'],
  ])('throws on %s: a host error, not a refusal', async (_label, status, body) => {
    fetchMock.mockResolvedValueOnce(answer(status, body));

    await expect(createPageWebhook('https://app.example/pages', { fetchImpl: fetchMock })(request)).rejects.toThrow();
  });

  it('throws when the host cannot be reached', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(createPageWebhook('https://app.example/pages', { fetchImpl: fetchMock })(request)).rejects.toThrow('fetch failed');
  });
});
