// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PAGE_CREATE_RULE } from '../../../src/agent/guidance';
import type { Caller } from '../../../src/mcp/dispatcher';
import { createOpenPageDocument } from '../../../src/mcp/page-titles';
import { assembleMcp, type AssembledMcp } from '../../../src/mcp/server';
import type { HandleSession, McpExecuteResult } from '../../../src/mcp/session';

const caller: Caller = { principal: 'alice', clientName: 'c', scopes: null };

describe('page titles through page-map', () => {
  let dir: string;
  let mcp: AssembledMcp;

  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), 'blok-mcp-pages-'));
    writeFileSync(join(dir, 'parent.json'), JSON.stringify({ blocks: [{ id: 'pb', type: 'page', data: { pageId: 'child' } }] }));
    writeFileSync(join(dir, 'child.json'), JSON.stringify({ blocks: [], title: 'Old' }));
  });

  afterEach(async () => {
    await mcp.stop();
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const openParent = async (): Promise<unknown> =>
    (await mcp.dispatch('blok_open', { documentId: 'parent', write: true }, caller)).structuredContent.handle;
  const childTitle = (): unknown => {
    const parsed: unknown = JSON.parse(readFileSync(join(dir, 'child.json'), 'utf-8'));

    return typeof parsed === 'object' && parsed !== null && 'title' in parsed ? parsed.title : undefined;
  };

  it('renames another page by writing its title into that page document', async () => {
    mcp = assembleMcp({ transport: { kind: 'stdio' }, auth: { kind: 'none' }, source: { kind: 'files', dir }, pageTitles: 'page-map' });
    const outcome = await mcp.dispatch('blok_execute', { handle: await openParent(), commands: [{ name: 'page.rename', args: { id: 'pb', title: 'New name' } }] }, caller);

    expect(outcome.structuredContent).toMatchObject({ ok: true, results: [{ pageId: 'child', applied: true }] });
    expect(childTitle()).toBe('New name');
  });

  it('refuses page.rename on a page block that points at the open document', async () => {
    writeFileSync(join(dir, 'parent.json'), JSON.stringify({ blocks: [{ id: 'pb', type: 'page', data: { pageId: 'parent' } }] }));
    mcp = assembleMcp({ transport: { kind: 'stdio' }, auth: { kind: 'none' }, source: { kind: 'files', dir }, pageTitles: 'page-map' });
    const outcome = await mcp.dispatch('blok_execute', { handle: await openParent(), commands: [{ name: 'page.rename', args: { id: 'pb', title: 'x' } }] }, caller);

    expect(outcome.structuredContent).toMatchObject({ ok: false, error: { code: 'INVALID_ARGS', details: { pageId: 'parent' } } });
  });

  it('is unavailable without page-map', async () => {
    mcp = assembleMcp({ transport: { kind: 'stdio' }, auth: { kind: 'none' }, source: { kind: 'files', dir } });
    const outcome = await mcp.dispatch('blok_execute', { handle: await openParent(), commands: [{ name: 'page.rename', args: { id: 'pb', title: 'x' } }] }, caller);

    expect(outcome.structuredContent).toMatchObject({ ok: false, error: { code: 'COMMAND_UNAVAILABLE', details: { reason: 'service' } } });
    expect(JSON.stringify(mcp.tools.find((tool) => tool.name === 'blok_execute')?.inputSchema)).not.toContain('"page.rename"');
  });

  it('runs the authorize check on the target page', async () => {
    mcp = assembleMcp({
      transport: { kind: 'stdio' }, auth: { kind: 'none' }, source: { kind: 'files', dir }, pageTitles: 'page-map',
      authorize: async (_principal, documentId) => documentId !== 'child',
    });
    const outcome = await mcp.dispatch('blok_execute', { handle: await openParent(), commands: [{ name: 'page.rename', args: { id: 'pb', title: 'x' } }] }, caller);

    expect(outcome.structuredContent).toMatchObject({ ok: false, error: { code: 'FORBIDDEN', details: { pageId: 'child' } } });
    expect(childTitle()).toBe('Old');
  });
});

describe('new sub-pages through page-map', () => {
  let dir: string;
  let mcp: AssembledMcp;

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
  const readDoc = (id: string): Record<string, unknown> => {
    const parsed: unknown = JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf-8'));

    return isRecord(parsed) ? parsed : {};
  };
  const pageIdIn = (id: string, blockId: string): unknown => {
    const blocks = readDoc(id).blocks;
    const block = Array.isArray(blocks) ? blocks.find((item: unknown) => isRecord(item) && item.id === blockId) : undefined;

    return isRecord(block) && isRecord(block.data) ? block.data.pageId : undefined;
  };
  const open = async (documentId: string): Promise<unknown> =>
    (await mcp.dispatch('blok_open', { documentId, write: true }, caller)).structuredContent.handle;
  const run = async (handle: unknown, commands: unknown[]): Promise<Record<string, unknown>> =>
    (await mcp.dispatch('blok_execute', { handle, commands }, caller)).structuredContent;
  const pageMap = (extra: Record<string, unknown> = {}): AssembledMcp => assembleMcp({
    transport: { kind: 'stdio' }, auth: { kind: 'none' }, source: { kind: 'files', dir }, pageTitles: 'page-map', ...extra,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), 'blok-mcp-new-pages-'));
    writeFileSync(join(dir, 'parent.json'), JSON.stringify({ blocks: [] }));
  });

  afterEach(async () => {
    await mcp.stop();
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('inserting a page block creates its document, which can then be named and written', async () => {
    mcp = pageMap();
    const parent = await open('parent');
    const inserted = await run(parent, [{ name: 'block.insert', args: { type: 'page', id: 'np', position: 'end' } }]);
    const pageId = pageIdIn('parent', 'np');

    expect(inserted).toMatchObject({ ok: true });
    expect(typeof pageId).toBe('string');
    expect(pageId).not.toBe('parent');
    expect(readDoc(String(pageId))).toMatchObject({ blocks: [] });

    expect(await run(parent, [{ name: 'page.rename', args: { id: 'np', title: 'Fresh' } }])).toMatchObject({ ok: true });
    expect(await run(parent, [{ name: 'page.setIcon', args: { id: 'np', icon: { type: 'emoji', value: '🌱' } } }])).toMatchObject({ ok: true });
    const child = await open(String(pageId));

    expect(await run(child, [{ name: 'block.insert', args: { type: 'paragraph', id: 'p1', data: { text: [{ text: 'Inside' }] } } }]))
      .toMatchObject({ ok: true });
    expect(readDoc(String(pageId))).toMatchObject({ title: 'Fresh', icon: { type: 'emoji', value: '🌱' }, blocks: [{ id: 'p1' }] });
  });

  it('a pageId the agent passes is replaced by the new document, and the named document stays as it was', async () => {
    writeFileSync(join(dir, 'other.json'), JSON.stringify({ blocks: [], title: 'Private' }));
    mcp = pageMap();
    const inserted = await run(await open('parent'), [{ name: 'block.insert', args: { type: 'page', id: 'np', data: { pageId: 'other' }, position: 'end' } }]);

    expect(inserted).toMatchObject({ ok: true });
    expect(pageIdIn('parent', 'np')).not.toBe('other');
    expect(readDoc('other')).toEqual({ blocks: [], title: 'Private' });
  });

  it('creates the document only when authorize lets the caller write it', async () => {
    mcp = pageMap({ authorize: async (_principal: string, documentId: string) => documentId === 'parent' });
    const outcome = await run(await open('parent'), [{ name: 'block.insert', args: { type: 'page', id: 'np', position: 'end' } }]);

    expect(outcome).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(readdirSync(dir).filter((name) => !name.startsWith('.'))).toEqual(['parent.json']);
    expect(readDoc('parent')).toEqual({ blocks: [] });
  });

  it('deleting a page block removes only the link: the page file stays as it was and authorize is never asked about it', async () => {
    writeFileSync(join(dir, 'parent.json'), JSON.stringify({ blocks: [{ id: 'pb', type: 'page', data: { pageId: 'kept' } }] }));
    writeFileSync(join(dir, 'kept.json'), JSON.stringify({ blocks: [], title: 'Kept' }));
    const asked: string[] = [];

    mcp = pageMap({ authorize: async (_principal: string, documentId: string) => {
      asked.push(documentId);

      return documentId === 'parent';
    } });
    const before = readFileSync(join(dir, 'kept.json'), 'utf-8');

    expect(await run(await open('parent'), [{ name: 'block.delete', args: { id: 'pb' } }])).toMatchObject({ ok: true });
    expect(readDoc('parent')).toMatchObject({ blocks: [] });
    expect(readFileSync(join(dir, 'kept.json'), 'utf-8')).toBe(before);
    expect(asked.filter((id) => id !== 'parent')).toEqual([]);
  });

  it('without page-map a page block is not insertable, and the refusal says how to turn it on', async () => {
    mcp = assembleMcp({ transport: { kind: 'stdio' }, auth: { kind: 'none' }, source: { kind: 'files', dir } });
    const outcome = await run(await open('parent'), [{ name: 'block.insert', args: { type: 'page', id: 'np', position: 'end' } }]);

    expect(outcome).toMatchObject({ ok: false, error: { code: 'COMMAND_UNAVAILABLE', details: { reason: 'host' } } });
    expect(JSON.stringify(outcome)).toContain('--page-titles page-map');
    const described = await mcp.dispatch('blok_describe', { handle: await open('parent'), tool: 'page' }, caller);

    expect(described.structuredContent).toMatchObject({ tool: { insertable: false, insertUnavailableReason: 'host' } });
  });

  it('tells the agent how to make a sub-page in stored mode and next to a sync service, and not without page-map', async () => {
    const live = pageMap({ sync: { url: 'wss://sync.test/sync' }, tickets: { kind: 'secret', secret: 'x'.repeat(32) } });
    const off = assembleMcp({ transport: { kind: 'stdio' }, auth: { kind: 'none' }, sync: { url: 'wss://sync.test/sync' } });

    try {
      expect(live.instructions).toContain(PAGE_CREATE_RULE);
      expect(off.instructions).not.toContain(PAGE_CREATE_RULE);
    } finally {
      await live.stop();
      await off.stop();
    }
    mcp = pageMap();
    expect(mcp.instructions).toContain(PAGE_CREATE_RULE);
  });

  it('blok_open says a page block the agent inserts gets its own new document, only where one does', async () => {
    const off = assembleMcp({ transport: { kind: 'stdio' }, auth: { kind: 'none' }, source: { kind: 'files', dir } });
    const openText = (server: AssembledMcp): string => server.tools.find((tool) => tool.name === 'blok_open')?.description ?? '';

    try {
      expect(openText(off)).not.toContain('A page block you insert');
    } finally {
      await off.stop();
    }
    mcp = pageMap();
    expect(openText(mcp)).toContain('A page block you insert gets a new, empty sub-page document');
  });
});

describe('createOpenPageDocument', () => {
  const actor = { id: 'agent:a', name: 'a', kind: 'agent' as const };
  const pendingWrite: McpExecuteResult = {
    ok: true, revision: '1', results: [], refs: {}, changed: { created: [], updated: [], moved: [], removed: [] }, warnings: [],
    delivery: { durable: false, pending: true, serverSequence: null, savedVersion: null },
  };
  const close = vi.fn<HandleSession['close']>();
  const session: HandleSession = {
    mode: 'live',
    write: true,
    durability: 'acknowledged',
    contractRevision: 'r',
    read: async () => ({ revision: '1', rootId: null, blocks: [] }),
    describe: () => { throw new Error('Unused describe dependency'); },
    execute: async () => pendingWrite,
    close,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    close.mockResolvedValue({ unsavedBatches: 1, hostRecordLags: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never reports a live page write the room did not acknowledge as applied', async () => {
    const page = await createOpenPageDocument({ open: async () => session, caller })('child', actor);
    const result = await page.execute({ commands: [{ name: 'doc.setTitle', args: { title: 'x' } }] });

    expect(result).toMatchObject({ ok: false, error: { code: 'SOURCE_UNAVAILABLE', retryable: true } });
  });
});
