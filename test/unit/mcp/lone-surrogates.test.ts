// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEndpointSource } from '../../../src/mcp/sources/endpoint';
import { createFilesSource } from '../../../src/mcp/sources/files';
import { checkCall } from '../../../src/shared/mcp/calls';
import { invoke } from '../../../src/view/server-runtime';

// Escaped in the JSON text, as a client or a file carries them: "\ud800" alone, "\udc00" alone.
const LONE_TEXT = '{"title":"t\\udc00","blocks":[{"id":"p1","type":"paragraph","data":{"text":"x\\ud800y"}}]}';
const FIXED = { title: 't\uFFFD', blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'x\uFFFDy' } }] };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a lone UTF-16 surrogate becomes U+FFFD', () => {
  const dir = { path: '' };

  beforeEach(() => {
    dir.path = mkdtempSync(join(tmpdir(), 'blok-mcp-surrogate-'));
  });

  afterEach(() => {
    rmSync(dir.path, { recursive: true, force: true });
  });

  it('in a document the files source reads', async () => {
    writeFileSync(join(dir.path, 'doc.json'), LONE_TEXT);

    expect((await createFilesSource(dir.path).load('doc')).raw).toEqual(FIXED);
  });

  it('in the bytes the files source writes back', async () => {
    writeFileSync(join(dir.path, 'doc.json'), LONE_TEXT);
    const source = createFilesSource(dir.path);
    const loaded = await source.load('doc');

    await source.save('doc', loaded.raw, { ifVersion: loaded.version });
    const text = readFileSync(join(dir.path, 'doc.json'), 'utf-8');

    expect(text).not.toMatch(/\\ud[89a-f]/i);
    expect(text).toContain('x\uFFFDy');
  });

  it('in a document the endpoint source reads', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(LONE_TEXT, { status: 200 }));

    expect((await createEndpointSource({ url: 'http://host/docs', endpointAuth: 'a' }, fetchImpl).load('doc')).raw).toEqual(FIXED);
  });

  it('in the ids and titles the endpoint list answers', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{"documents":[{"id":"a\\ud800","title":"b\\udfff"}]}', { status: 200 }));
    const source = createEndpointSource({ url: 'http://host/docs', endpointAuth: 'a', list: 'http://host/list' }, fetchImpl);

    expect((await source.list?.({ limit: 5 }))?.documents).toEqual([{ id: 'a\uFFFD', title: 'b\uFFFD' }]);
  });

  it('in the text a call writes, keys included', () => {
    const args: Record<string, unknown> = JSON.parse(
      '{"handle":"h","commands":[{"name":"block.insert","args":{"type":"paragraph","position":"end","data":{"text":"a\\ud800b","k\\udc00":1}}}]}'
    );
    const step = checkCall('blok_execute', args, null);

    expect(step).toMatchObject({ tool: 'blok_execute' });
    expect(JSON.stringify(step)).not.toMatch(/\\ud[89a-f]/i);
    expect(JSON.stringify(step)).toContain('a\uFFFDb');
    expect(JSON.stringify(step)).toContain('k\uFFFD');
  });

  it('in a documentId blok_open is given', () => {
    expect(checkCall('blok_open', { documentId: 'a\ud800b' }, null)).toMatchObject({ documentId: 'a\uFFFDb' });
  });

  it('keeps a valid surrogate pair', () => {
    expect(checkCall('blok_open', { documentId: 'a😀b' }, null)).toMatchObject({ documentId: 'a😀b' });
  });

  it('at the edges and next to a pair', () => {
    expect(checkCall('blok_open', { documentId: '\udc00\ud800\ud800\udc00x\ud800' }, null))
      .toMatchObject({ documentId: '\uFFFD\uFFFD\ud800\udc00x\uFFFD' });
  });

  it('in the title a file listing shows', async () => {
    const answer: unknown = JSON.parse(await invoke('mcpFilesList', JSON.stringify({ entries: [{ id: 'doc', text: LONE_TEXT }], limit: 5 })));

    expect(answer).toEqual({ documents: [{ id: 'doc', title: 't\uFFFD' }], nextCursor: null });
  });

  it('for every host that reads a file through the bundle', async () => {
    const answer: unknown = JSON.parse(await invoke('mcpParseDocument', JSON.stringify({ id: 'doc', text: LONE_TEXT })));

    expect(answer).toEqual({ document: FIXED });
  });
});
