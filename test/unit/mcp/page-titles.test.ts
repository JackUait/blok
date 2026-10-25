// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
