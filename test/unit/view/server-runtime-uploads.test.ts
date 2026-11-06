// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isObject } from '../../../src/shared/type-guards';
import { invoke } from '../../../src/view/server-runtime';

import type { AgentActor, AgentBatch } from '../../../types/agent';

/*
 * A host that cannot be called mid-batch runs uploads by replay: agentExecute stops at the first
 * upload call it has no answer for and names it, and the host sends the batch again with the answer.
 */

const actor: AgentActor = { id: 'agent-x', name: 'Agent', kind: 'agent' };
const mcp = { source: true, mode: 'stored', write: true, uploads: true };

const call = async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const response: unknown = JSON.parse(await invoke('agentExecute', JSON.stringify(input)));

  if (!isObject(response)) {
    throw new TypeError('agentExecute must return a JSON object.');
  }

  return response;
};

/** Runs the batch to its end, answering each upload call with `host`; returns the calls and the last output. */
const replay = async (
  batch: AgentBatch,
  uploads: Record<string, unknown>,
  host: (request: Record<string, unknown>) => unknown
): Promise<{ calls: Array<Record<string, unknown>>; output: Record<string, unknown> }> => {
  const answers: unknown[] = [];
  const calls: Array<Record<string, unknown>> = [];

  for (;;) {
    const output = await call({ mcp, document: { blocks: [] }, actor, batch, uploads: { ...uploads, answers }, documentText: 'compact' });
    const request = output.upload;

    if (!isObject(request)) {
      return { calls, output };
    }
    calls.push(request);
    answers.push(host(request));
  }
};

const blocksOf = (output: Record<string, unknown>): unknown[] => {
  const document = output.document;

  return isObject(document) && Array.isArray(document.blocks) ? document.blocks : [];
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('agentExecute uploads through a host that runs each upload between calls', () => {
  it('names the upload of base64 bytes, then saves the block the answer makes', async () => {
    const batch: AgentBatch = { commands: [{ name: 'file.uploadFile', args: { data: btoa('hello'), fileName: 'hello.txt' } }] };
    const { calls, output } = await replay(batch, {}, () => ({ url: 'https://cdn.test/hello.txt' }));

    expect(calls).toEqual([{ op: 'uploadByFile', fileName: 'hello.txt', type: 'text/plain', size: 5, kind: 'file', tool: 'file', data: btoa('hello') }]);
    expect(output.result).toMatchObject({ ok: true });
    expect(output.save).toBe(true);
    expect(blocksOf(output)).toEqual([expect.objectContaining({ type: 'file', data: { url: 'https://cdn.test/hello.txt', fileName: 'hello.txt' } })]);
  });

  it('reads a local path first, then uploads the read as that answer', async () => {
    const batch: AgentBatch = { commands: [{ name: 'image.uploadFile', args: { path: 'cat.png' } }] };
    const { calls, output } = await replay(batch, { root: true }, request =>
      (request.op === 'readLocal' ? { name: 'cat.png', size: 9 } : { url: 'https://cdn.test/cat.png' }));

    expect(calls).toEqual([
      { op: 'readLocal', path: 'cat.png', maxBytes: 30 * 1024 * 1024 },
      { op: 'uploadByFile', fileName: 'cat.png', type: 'image/png', size: 9, kind: 'image', tool: 'image', local: 0 },
    ]);
    expect(blocksOf(output)).toEqual([expect.objectContaining({ type: 'image', data: { url: 'https://cdn.test/cat.png', fileName: 'cat.png' } })]);
  });

  it('fails the batch with the host\'s refusal of a read, and never uploads', async () => {
    const refused = { code: 'PRECONDITION_FAILED', message: '"../x.png" is not a file under the upload folder.', path: '/path', retryable: false };
    const batch: AgentBatch = { commands: [{ name: 'image.uploadFile', args: { path: '../x.png' } }] };
    const { calls, output } = await replay(batch, { root: true }, () => ({ failure: refused }));

    expect(calls).toHaveLength(1);
    expect(output.result).toMatchObject({ ok: false, error: { ...refused, commandIndex: 0 } });
    expect(output.save).toBe(false);
  });

  it('fails a thrown upload as Node\'s prepare step does', async () => {
    const batch: AgentBatch = { commands: [{ name: 'file.uploadFile', args: { data: btoa('x'), fileName: 'a.txt' } }] };
    const { output } = await replay(batch, {}, () => ({ error: 'the CDN is down' }));

    expect(output.result).toMatchObject({ ok: false, error: { code: 'TOOL_ACTION_FAILED', message: 'A prepare step failed: the CDN is down', commandIndex: 0 } });
  });

  it('checks the host\'s limits on the read before any upload', async () => {
    const batch: AgentBatch = { commands: [{ name: 'image.uploadFile', args: { path: 'cat.png' } }] };
    const { calls, output } = await replay(batch, { root: true, limits: { image: { maxSize: 4 } } }, () => ({ name: 'cat.png', size: 9 }));

    expect(calls.map(request => request.op)).toEqual(['readLocal']);
    expect(calls[0]).toMatchObject({ maxBytes: 4 });
    expect(output.result).toMatchObject({ ok: false, error: { code: 'PRECONDITION_FAILED' } });
  });

  it('copies a linked file to the host when it uploads by URL', async () => {
    const document = { blocks: [{ id: 'i1', type: 'image', data: { url: 'https://cdn.test/old.png' } }] };
    const batch: AgentBatch = { commands: [{ name: 'image.setSource', args: { id: 'i1', url: 'https://elsewhere.test/a.png' } }] };
    const first = await call({ mcp, document, actor, batch, uploads: { byUrl: true, answers: [] } });

    expect(first.upload).toEqual({ op: 'uploadByUrl', url: 'https://elsewhere.test/a.png', kind: 'image', tool: 'image' });
    const done = await call({ mcp, document, actor, batch, uploads: { byUrl: true, answers: [{ url: 'https://cdn.test/a.png', fileName: 'a.png' }] } });

    expect(blocksOf(done)).toEqual([expect.objectContaining({ data: { url: 'https://cdn.test/a.png', fileName: 'a.png' } })]);
  });

  it('asks no upload on a read-only handle', async () => {
    const batch: AgentBatch = { commands: [{ name: 'file.uploadFile', args: { data: btoa('x'), fileName: 'a.txt' } }] };
    const output = await call({ mcp: { ...mcp, write: false }, document: { blocks: [] }, actor, batch, uploads: { answers: [] } });

    expect(output).not.toHaveProperty('upload');
    expect(output.result).toMatchObject({ ok: false, error: { code: 'READ_ONLY' } });
  });

  it('asks no upload for a batch that sends another command with it', async () => {
    const batch: AgentBatch = { commands: [
      { name: 'file.uploadFile', args: { data: btoa('x'), fileName: 'a.txt' } },
      { name: 'block.insert', args: { type: 'page', id: 'np', position: 'end' } },
    ] };
    const output = await call({ mcp, document: { blocks: [] }, actor, batch, uploads: { answers: [] } });

    expect(output).not.toHaveProperty('upload');
    expect(output.result).toMatchObject({ ok: false, error: { code: 'INVALID_ARGS', commandIndex: 0 } });
  });
});
