// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadAuthorizeHook } from '../../../src/mcp/auth/authorize';
import { McpConfigError } from '../../../src/mcp/config';
import type { Caller } from '../../../src/mcp/dispatcher';
import type { BlokMcpOptions } from '../../../src/mcp/options';
import { assembleMcp } from '../../../src/mcp/server';

const dirs: string[] = [];
const tempDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));

  dirs.push(dir);

  return dir;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  vi.restoreAllMocks();
});

describe('loadAuthorizeHook', () => {
  const fetchMock = vi.fn<typeof fetch>();

  it('loads a module default export', async () => {
    const dir = tempDir('blok-mcp-authz-');

    writeFileSync(join(dir, 'authz.mjs'), 'export default async (principal, doc, write) => principal === "alice" && (!write || doc === "mine");');
    const hook = await loadAuthorizeHook('./authz.mjs', { cwd: dir });

    expect(await hook('alice', 'mine', true)).toBe(true);
    expect(await hook('alice', 'theirs', true)).toBe(false);
    expect(await hook('bob', 'mine', false)).toBe(false);
  });

  it('refuses a module without a default function', async () => {
    const dir = tempDir('blok-mcp-authz-');

    writeFileSync(join(dir, 'bad.mjs'), 'export const x = 1;');
    await expect(loadAuthorizeHook('./bad.mjs', { cwd: dir })).rejects.toBeInstanceOf(McpConfigError);
  });

  it('reports a missing module as a config error, not a raw import failure', async () => {
    const dir = tempDir('blok-mcp-authz-');

    await expect(loadAuthorizeHook('./missing.mjs', { cwd: dir }))
      .rejects.toThrow(new McpConfigError(`--authorize ./missing.mjs: no module at ${join(dir, 'missing.mjs')}`));
  });

  it('bounds the webhook with a timeout signal and denies when it aborts', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('The operation timed out.', 'TimeoutError'));
    const hook = await loadAuthorizeHook('https://app/authz', { fetchImpl: fetchMock });

    expect(await hook('alice', 'd', false)).toBe(false);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('asks a webhook and fails closed', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ allowed: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response('nope', { status: 500 }))
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(new Response('not json', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ allowed: 'yes' }), { status: 200 }));
    const hook = await loadAuthorizeHook('https://app/authz', { fetchImpl: fetchMock });

    expect(await hook('alice', 'd', true)).toBe(true);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST');
    const body = fetchMock.mock.calls[0]?.[1]?.body;

    expect(typeof body === 'string' ? JSON.parse(body) : body).toEqual({ principal: 'alice', documentId: 'd', write: true });
    expect(await hook('alice', 'd', true)).toBe(false);
    expect(await hook('alice', 'd', true)).toBe(false);
    expect(await hook('alice', 'd', true)).toBe(false);
    expect(await hook('alice', 'd', true)).toBe(false);
  });
});

describe('authorize through the dispatcher', () => {
  const bob: Caller = { principal: 'bob', clientName: 'c', scopes: null };

  const filesMcp = (dir: string, authorize?: BlokMcpOptions['authorize']): ReturnType<typeof assembleMcp> => assembleMcp({
    transport: { kind: 'stdio' },
    auth: { kind: 'none' },
    source: { kind: 'files', dir },
    ...(authorize !== undefined && { authorize }),
  });

  it('answers FORBIDDEN before touching the source', async () => {
    const dir = tempDir('blok-mcp-authz-open-');
    const authorize = vi.fn(async (principal: string) => principal === 'alice');
    const mcp = filesMcp(dir, authorize);

    try {
      writeFileSync(join(dir, 'doc.json'), '{blocks');
      expect((await mcp.dispatch('blok_open', { documentId: 'doc', write: true }, bob)).structuredContent)
        .toEqual({ error: expect.objectContaining({ code: 'FORBIDDEN' }) });
      expect(authorize).toHaveBeenCalledWith('bob', 'doc', true);
    } finally {
      await mcp.stop();
    }
  });

  it('lists only the documents authorize lets the caller read', async () => {
    const dir = tempDir('blok-mcp-authz-list-');
    const authorize = vi.fn(async (_principal: string, documentId: string) => documentId !== 'secret');
    const mcp = filesMcp(dir, authorize);

    try {
      writeFileSync(join(dir, 'open.json'), JSON.stringify({ blocks: [], title: 'Open' }));
      writeFileSync(join(dir, 'secret.json'), JSON.stringify({ blocks: [], title: 'Secret' }));
      expect((await mcp.dispatch('blok_list_documents', {}, bob)).structuredContent).toEqual({
        documents: [{ id: 'open', title: 'Open', live: false }],
        nextCursor: null,
        supported: true,
      });
      expect(authorize).toHaveBeenCalledWith('bob', 'secret', false);
      expect(authorize).toHaveBeenCalledWith('bob', 'open', false);
    } finally {
      await mcp.stop();
    }
  });

  it('lists every document without an authorize hook', async () => {
    const dir = tempDir('blok-mcp-authz-list-');
    const mcp = filesMcp(dir);

    try {
      writeFileSync(join(dir, 'open.json'), JSON.stringify({ blocks: [] }));
      writeFileSync(join(dir, 'secret.json'), JSON.stringify({ blocks: [] }));
      const listed = (await mcp.dispatch('blok_list_documents', {}, bob)).structuredContent;

      expect(listed).toMatchObject({ documents: [{ id: 'open' }, { id: 'secret' }], supported: true });
    } finally {
      await mcp.stop();
    }
  });
});
