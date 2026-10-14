// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Caller } from '../../../src/mcp/dispatcher';
import { assembleMcp, type AssembledMcp } from '../../../src/mcp/server';

const caller: Caller = { principal: 'alice', clientName: 'e2e', scopes: null };

describe('stored mode through the MCP dispatcher', () => {
  let dir: string;
  let mcp: AssembledMcp;
  const file = (id: string): Record<string, unknown> => {
    const parsed: unknown = JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf-8'));

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`${id}.json is not a JSON object`);
    }

    return { ...parsed };
  };

  const openWrite = async (documentId: string): Promise<string> => {
    const opened = await mcp.dispatch('blok_open', { documentId, write: true }, caller);

    expect(opened.isError).toBe(false);

    return opened.structuredContent.handle as string;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), 'blok-mcp-stored-'));
    mcp = assembleMcp({ transport: { kind: 'stdio' }, auth: { kind: 'none' }, source: { kind: 'files', dir } });
  });

  afterEach(async () => {
    await mcp.stop();
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('inserts a paragraph, saves it, and stamps lastEditedBy with the agent id', async () => {
    const handle = await openWrite('doc');
    const outcome = await mcp.dispatch('blok_execute', {
      handle,
      commands: [{ name: 'block.insert', args: { type: 'paragraph', id: 'p1', data: { text: 'Hello' } } }],
    }, caller);

    expect(outcome.structuredContent).toMatchObject({ ok: true, delivery: { durable: true } });
    const saved = file('doc') as { blocks: Array<{ id: string; lastEditedBy?: string; data: { text: unknown } }> };

    expect(saved.blocks.map((block) => block.id)).toEqual(['p1']);
    expect(saved.blocks[0].lastEditedBy).toBe('agent:alice:e2e');
    expect(Array.isArray(saved.blocks[0].data.text)).toBe(true);
  });

  it('runs two parallel executes on one handle and saves both (Review Focus 1)', async () => {
    const handle = await openWrite('doc');
    const insert = (id: string) => mcp.dispatch('blok_execute', {
      handle, commands: [{ name: 'block.insert', args: { type: 'paragraph', id, data: { text: id } } }],
    }, caller);
    const [first, second] = await Promise.all([insert('a'), insert('b')]);

    expect(first.structuredContent).toMatchObject({ ok: true });
    expect(second.structuredContent).toMatchObject({ ok: true });
    expect((file('doc') as { blocks: Array<{ id: string }> }).blocks.map((block) => block.id).sort()).toEqual(['a', 'b']);
  });

  it('writes the page title into OutputData.title (01 D-1)', async () => {
    const handle = await openWrite('doc');

    await mcp.dispatch('blok_execute', { handle, commands: [{ name: 'doc.setTitle', args: { title: 'Q3 plan' } }] }, caller);
    expect(file('doc').title).toBe('Q3 plan');
  });

  it('undoes its own last batch and saves the result', async () => {
    const handle = await openWrite('doc');

    await mcp.dispatch('blok_execute', { handle, commands: [{ name: 'block.insert', args: { type: 'paragraph', id: 'p1', data: { text: 'x' } } }] }, caller);
    const undone = await mcp.dispatch('blok_execute', { handle, commands: [{ name: 'history.undo', args: {} }] }, caller);

    expect(undone.structuredContent).toMatchObject({ ok: true });
    expect((file('doc') as { blocks: unknown[] }).blocks).toEqual([]);
  });

  it('reports DOCUMENT_CHANGED when the file changes underneath, then works after re-read', async () => {
    const handle = await openWrite('doc');

    writeFileSync(join(dir, 'doc.json'), JSON.stringify({ blocks: [{ id: 'theirs', type: 'paragraph', data: { text: 'mine' } }] }));
    const stale = await mcp.dispatch('blok_execute', { handle, commands: [{ name: 'block.insert', args: { type: 'paragraph', id: 'p1', data: { text: 'x' } } }] }, caller);

    expect(stale.structuredContent).toMatchObject({ ok: false, error: { code: 'DOCUMENT_CHANGED' } });
    const retry = await mcp.dispatch('blok_execute', { handle, commands: [{ name: 'block.insert', args: { type: 'paragraph', id: 'p1', data: { text: 'x' } } }] }, caller);

    expect(retry.structuredContent).toMatchObject({ ok: true });
    expect((file('doc') as { blocks: Array<{ id: string }> }).blocks.map((block) => block.id)).toEqual(['theirs', 'p1']);
  });

  it('opens a file whose rich fields hold HTML, and reads segments (Review Focus 5)', async () => {
    writeFileSync(join(dir, 'legacy.json'), JSON.stringify({ blocks: [{ id: 'h', type: 'paragraph', data: { text: '<b>bold</b> text' } }] }));
    const opened = await mcp.dispatch('blok_open', { documentId: 'legacy', view: {} }, caller);

    expect(opened.isError).toBe(false);
    expect(JSON.stringify(opened.structuredContent.view)).not.toContain('<b>');
  });

  it('answers SOURCE_UNAVAILABLE for an unparseable file (Review Focus 5)', async () => {
    writeFileSync(join(dir, 'broken.json'), '{blocks');
    const opened = await mcp.dispatch('blok_open', { documentId: 'broken' }, caller);

    expect(opened.structuredContent).toEqual({ error: expect.objectContaining({ code: 'SOURCE_UNAVAILABLE' }) });
  });

  it('refuses writes on a read-only handle', async () => {
    const handle = (await mcp.dispatch('blok_open', { documentId: 'doc' }, caller)).structuredContent.handle;
    const outcome = await mcp.dispatch('blok_execute', { handle, commands: [{ name: 'block.insert', args: { type: 'paragraph', data: { text: 'x' } } }] }, caller);

    expect(outcome.structuredContent).toMatchObject({ ok: false, error: { code: 'READ_ONLY' } });
  });

  it('answers model-fixable core errors as tool errors, not protocol errors', async () => {
    const handle = await openWrite('doc');
    const read = await mcp.dispatch('blok_read', { handle, detail: 'bogus' }, caller);
    const described = await mcp.dispatch('blok_describe', { handle, tool: 'nosuchtool' }, caller);
    const opened = await mcp.dispatch('blok_open', { documentId: 'doc', view: { nope: 1 } }, caller);

    expect(read).toEqual({ isError: true, structuredContent: { error: expect.objectContaining({ code: 'INVALID_ARGS' }) } });
    expect(described).toEqual({ isError: true, structuredContent: { error: expect.objectContaining({ code: 'UNKNOWN_TOOL' }) } });
    expect(opened).toEqual({ isError: true, structuredContent: { error: expect.objectContaining({ code: 'INVALID_ARGS' }) } });
    expect(mcp.handles.count('alice')).toBe(1);
  });

  it.each([null, 'block.insert', ['block.insert'], {}, { name: 7 }, { name: 'block.insert' }, { name: 'block.insert', args: null }, { name: 'block.insert', args: 'x' }])('refuses command entry %j as INVALID_ARGS without saving', async (entry) => {
    const handle = await openWrite('doc');
    const outcome = await mcp.dispatch('blok_execute', { handle, commands: [entry] }, caller);

    expect(outcome).toMatchObject({ isError: true, structuredContent: { ok: false, error: { code: 'INVALID_ARGS' } } });
  });

  it('keeps a non-string expectRevision as a refusal instead of dropping the guard', async () => {
    const handle = await openWrite('doc');
    const outcome = await mcp.dispatch('blok_execute', {
      handle, expectRevision: 5, commands: [{ name: 'block.insert', args: { type: 'paragraph', id: 'p1', data: { text: 'x' } } }],
    }, caller);

    expect(outcome).toMatchObject({ isError: true, structuredContent: { ok: false, error: { code: 'INVALID_ARGS' } } });
    expect(() => file('doc')).toThrow();
  });

  it('skips the save of a page.rename that leaves this document unchanged', async () => {
    await mcp.stop();
    mcp = assembleMcp({ transport: { kind: 'stdio' }, auth: { kind: 'none' }, source: { kind: 'files', dir }, pageTitles: 'page-map' });
    writeFileSync(join(dir, 'parent.json'), JSON.stringify({ blocks: [{ id: 'pb', type: 'page', data: { pageId: 'child' } }] }));
    writeFileSync(join(dir, 'child.json'), JSON.stringify({ blocks: [], title: 'Old' }));
    const renamer = await openWrite('parent');
    const editor = await openWrite('parent');
    const edited = await mcp.dispatch('blok_execute', {
      handle: editor, commands: [{ name: 'block.insert', args: { type: 'paragraph', id: 'theirs', data: { text: 'x' } } }],
    }, caller);

    expect(edited.isError).toBe(false);
    const renamed = await mcp.dispatch('blok_execute', {
      handle: renamer, commands: [{ name: 'page.rename', args: { id: 'pb', title: 'New name' } }],
    }, caller);

    expect(renamed).toMatchObject({
      isError: false,
      structuredContent: { ok: true, results: [{ pageId: 'child', applied: true }], delivery: { durable: false, pending: false, serverSequence: null, savedVersion: null } },
    });
    expect(file('child').title).toBe('New name');
    expect((file('parent') as { blocks: Array<{ id: string }> }).blocks.map((block) => block.id)).toEqual(['pb', 'theirs']);
  });

  it('lists the directory', async () => {
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ blocks: [], title: 'Alpha' }));
    const listed = await mcp.dispatch('blok_list_documents', {}, caller);

    expect(listed.structuredContent).toEqual({ documents: [{ id: 'a', title: 'Alpha', live: false }], nextCursor: null, supported: true });
  });
});
