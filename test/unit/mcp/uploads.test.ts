// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkOptionSafety, McpConfigError } from '../../../src/mcp/config';
import type { Caller } from '../../../src/mcp/dispatcher';
import type { BlokMcpOptions } from '../../../src/mcp/options';
import { assembleMcp, type AssembledMcp } from '../../../src/mcp/server';
import type { UploadContext } from '../../../types/configs/uploader';

const caller: Caller = { principal: 'alice', clientName: 'uploads', scopes: null };

describe('blok-mcp uploads a file through the host uploader', () => {
  const state: { dir: string; files: string; mcp?: AssembledMcp } = { dir: '', files: '' };
  const uploadByFile = vi.fn(async (file: File, _ctx: UploadContext) => ({ url: `https://cdn.test/${file.name}` }));

  const start = (uploads?: BlokMcpOptions['uploads']): AssembledMcp => {
    state.mcp = assembleMcp({
      transport: { kind: 'stdio' }, auth: { kind: 'none' }, source: { kind: 'files', dir: state.dir },
      ...(uploads !== undefined && { uploads }),
    });

    return state.mcp;
  };

  const open = async (mcp: AssembledMcp, write: boolean): Promise<string> => {
    const opened = await mcp.dispatch('blok_open', { documentId: 'doc', write }, caller);

    return opened.structuredContent.handle as string;
  };

  const saved = (): Array<{ type: string; data: Record<string, unknown> }> =>
    (JSON.parse(readFileSync(join(state.dir, 'doc.json'), 'utf-8')) as { blocks: Array<{ type: string; data: Record<string, unknown> }> }).blocks;

  beforeEach(() => {
    vi.clearAllMocks();
    state.dir = mkdtempSync(join(tmpdir(), 'blok-mcp-docs-'));
    state.files = join(state.dir, 'uploads');
    mkdirSync(state.files);
    writeFileSync(join(state.files, 'cat.png'), 'png-bytes');
    writeFileSync(join(state.dir, 'doc.json'), JSON.stringify({ blocks: [] }));
  });

  afterEach(async () => {
    await state.mcp?.stop();
    state.mcp = undefined;
    rmSync(state.dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('uploads a path under the upload root and saves the image block', async () => {
    const mcp = start({ uploader: { uploadByFile }, root: state.files });
    const outcome = await mcp.dispatch('blok_execute', {
      handle: await open(mcp, true),
      commands: [{ name: 'image.uploadFile', args: { path: 'cat.png' } }],
    }, caller);

    expect(outcome.structuredContent).toMatchObject({ ok: true, delivery: { durable: true } });
    expect(uploadByFile).toHaveBeenCalledTimes(1);
    expect(saved()).toEqual([expect.objectContaining({ type: 'image', data: { url: 'https://cdn.test/cat.png', fileName: 'cat.png' } })]);
  });

  it('uploads base64 bytes with a fileName', async () => {
    const mcp = start({ uploader: { uploadByFile } });
    const outcome = await mcp.dispatch('blok_execute', {
      handle: await open(mcp, true),
      commands: [{ name: 'file.uploadFile', args: { data: btoa('hello'), fileName: 'hello.txt' } }],
    }, caller);

    expect(outcome.structuredContent).toMatchObject({ ok: true });
    expect(saved()[0].data).toEqual({ url: 'https://cdn.test/hello.txt', fileName: 'hello.txt' });
  });

  it('refuses a path out of the root, and never calls the uploader', async () => {
    writeFileSync(join(state.dir, 'secret.png'), 'secret');
    const mcp = start({ uploader: { uploadByFile }, root: state.files });
    const outcome = await mcp.dispatch('blok_execute', {
      handle: await open(mcp, true),
      commands: [{ name: 'image.uploadFile', args: { path: '../secret.png' } }],
    }, caller);

    expect(outcome.structuredContent).toMatchObject({ ok: false, error: { code: 'PRECONDITION_FAILED' } });
    expect(uploadByFile).not.toHaveBeenCalled();
  });

  it('applies the host\'s limits', async () => {
    const mcp = start({ uploader: { uploadByFile }, root: state.files, limits: { image: { maxSize: 4 } } });
    const outcome = await mcp.dispatch('blok_execute', {
      handle: await open(mcp, true),
      commands: [{ name: 'image.uploadFile', args: { path: 'cat.png' } }],
    }, caller);

    expect(outcome.structuredContent).toMatchObject({ ok: false, error: { code: 'PRECONDITION_FAILED' } });
    expect(uploadByFile).not.toHaveBeenCalled();
  });

  it('never uploads on a read-only handle', async () => {
    const mcp = start({ uploader: { uploadByFile }, root: state.files });
    const outcome = await mcp.dispatch('blok_execute', {
      handle: await open(mcp, false),
      commands: [{ name: 'image.uploadFile', args: { path: 'cat.png' } }],
    }, caller);

    expect(outcome.structuredContent).toMatchObject({ ok: false, error: { code: 'READ_ONLY' } });
    expect(uploadByFile).not.toHaveBeenCalled();
  });

  it('without an uploader, answers COMMAND_UNAVAILABLE with reason host', async () => {
    const mcp = start();
    const outcome = await mcp.dispatch('blok_execute', {
      handle: await open(mcp, true),
      commands: [{ name: 'image.uploadFile', args: { data: btoa('x'), fileName: 'a.png' } }],
    }, caller);

    expect(outcome.structuredContent).toMatchObject({ ok: false, error: { code: 'COMMAND_UNAVAILABLE', details: { reason: 'host' } } });
  });

  it('without a root, refuses a path with reason host', async () => {
    const mcp = start({ uploader: { uploadByFile } });
    const outcome = await mcp.dispatch('blok_execute', {
      handle: await open(mcp, true),
      commands: [{ name: 'image.uploadFile', args: { path: join(state.files, 'cat.png') } }],
    }, caller);

    expect(outcome.structuredContent).toMatchObject({ ok: false, error: { code: 'COMMAND_UNAVAILABLE', details: { reason: 'host' } } });
    expect(uploadByFile).not.toHaveBeenCalled();
  });
});

describe('checkOptionSafety and uploads', () => {
  const http: BlokMcpOptions = {
    transport: { kind: 'http', listen: '127.0.0.1:0' }, auth: { kind: 'none' },
    authorize: async () => true, source: { kind: 'files', dir: '.' },
  };
  const uploader = { uploadByFile: async () => ({ url: 'https://cdn.test/x' }) };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses an upload root over HTTP: a remote caller would read this machine\'s disk', () => {
    expect(() => checkOptionSafety({ ...http, uploads: { uploader, root: '.' } })).toThrow(McpConfigError);
    expect(() => checkOptionSafety({ ...http, uploads: { uploader } })).not.toThrow();
  });

  it('refuses a limit that is not a positive whole number of bytes', () => {
    const stdio: BlokMcpOptions = { transport: { kind: 'stdio' }, auth: { kind: 'none' } };

    expect(() => checkOptionSafety({ ...stdio, uploads: { uploader, limits: { image: { maxSize: 0 } } } })).toThrow(McpConfigError);
    expect(() => checkOptionSafety({ ...stdio, uploads: { uploader, limits: { image: { maxSize: 1.5 } } } })).toThrow(McpConfigError);
    expect(() => checkOptionSafety({ ...stdio, uploads: { uploader, limits: { image: { maxSize: Number.NaN } } } })).toThrow(McpConfigError);
  });

  it('refuses limits of the wrong shape', () => {
    const stdio: BlokMcpOptions = { transport: { kind: 'stdio' }, auth: { kind: 'none' } };
    const bad = (limits: unknown): BlokMcpOptions => ({ ...stdio, uploads: { uploader, limits: limits as never } });

    expect(() => checkOptionSafety(bad({ pdf: { maxSize: 10 } }))).toThrow(McpConfigError);
    expect(() => checkOptionSafety(bad({ image: { types: 'image/*' } }))).toThrow(McpConfigError);
    expect(() => checkOptionSafety(bad({ image: { types: [1] } }))).toThrow(McpConfigError);
    expect(() => checkOptionSafety(bad({ image: null }))).toThrow(McpConfigError);
    expect(() => checkOptionSafety(bad([]))).toThrow(McpConfigError);
    expect(() => checkOptionSafety(bad({ image: { types: ['image/png'], maxSize: 10 } }))).not.toThrow();
  });
});
