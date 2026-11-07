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

  it('refuses a hidden file, and never calls the uploader', async () => {
    writeFileSync(join(state.files, '.env'), 'SECRET=1');
    const mcp = start({ uploader: { uploadByFile }, root: state.files });
    const outcome = await mcp.dispatch('blok_execute', {
      handle: await open(mcp, true),
      commands: [{ name: 'file.uploadFile', args: { path: '.env' } }],
    }, caller);

    expect(outcome.structuredContent).toMatchObject({ ok: false, error: { code: 'PRECONDITION_FAILED' } });
    expect(uploadByFile).not.toHaveBeenCalled();
  });

  it('checks the type of the file on disk, not of the fileName the agent gives it', async () => {
    writeFileSync(join(state.files, 'notes.txt'), 'not an image');
    const mcp = start({ uploader: { uploadByFile }, root: state.files });
    const outcome = await mcp.dispatch('blok_execute', {
      handle: await open(mcp, true),
      commands: [{ name: 'image.uploadFile', args: { path: 'notes.txt', fileName: 'cat.png' } }],
    }, caller);

    expect(outcome.structuredContent).toMatchObject({ ok: false });
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

describe('blok-mcp keeps a host uploader\'s error out of the agent\'s answer', () => {
  const SECRET = 'connect ECONNREFUSED db.internal:5432 (password=hunter2)';
  const state: { dir: string; mcp?: AssembledMcp } = { dir: '' };

  const start = (uploader: NonNullable<BlokMcpOptions['uploads']>['uploader']): AssembledMcp => {
    state.mcp = assembleMcp({
      transport: { kind: 'stdio' }, auth: { kind: 'none' }, source: { kind: 'files', dir: state.dir }, uploads: { uploader },
    });

    return state.mcp;
  };

  const execute = async (mcp: AssembledMcp, commands: Array<{ name: string; args: Record<string, unknown> }>): Promise<Record<string, unknown>> => {
    const opened = await mcp.dispatch('blok_open', { documentId: 'doc', write: true }, caller);
    const outcome = await mcp.dispatch('blok_execute', { handle: opened.structuredContent.handle, commands }, caller);

    return outcome as unknown as Record<string, unknown>;
  };

  const upload = [{ name: 'file.uploadFile', args: { data: btoa('hello'), fileName: 'hello.txt' } }];

  beforeEach(() => {
    vi.clearAllMocks();
    state.dir = mkdtempSync(join(tmpdir(), 'blok-mcp-docs-'));
    writeFileSync(join(state.dir, 'doc.json'), JSON.stringify({ blocks: [{ id: 'img', type: 'image', data: { url: 'https://cdn.test/a.png' } }] }));
  });

  afterEach(async () => {
    await state.mcp?.stop();
    state.mcp = undefined;
    rmSync(state.dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('answers a generic TOOL_ACTION_FAILED for a thrown uploadByFile, and logs the error to stderr', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const thrown = new Error(SECRET);
    const outcome = await execute(start({ uploadByFile: () => Promise.reject(thrown) }), upload);

    expect(JSON.stringify(outcome)).not.toContain('hunter2');
    expect(outcome.structuredContent).toMatchObject({ ok: false, error: { code: 'TOOL_ACTION_FAILED', message: 'The upload failed.', commandIndex: 0 } });
    expect(logged).toHaveBeenCalledWith('blok-mcp: the host uploader failed', thrown);
  });

  it('answers the same for an uploader that throws before it returns a promise', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const outcome = await execute(start({
      uploadByFile: () => {
        throw new Error(SECRET);
      },
    }), upload);

    expect(JSON.stringify(outcome)).not.toContain('hunter2');
    expect(outcome.structuredContent).toMatchObject({ ok: false, error: { code: 'TOOL_ACTION_FAILED', message: 'The upload failed.' } });
  });

  it('answers the same for a thrown uploadByUrl in setSource', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const outcome = await execute(start({
      uploadByFile: () => Promise.reject(new Error('unused')),
      uploadByUrl: () => Promise.reject(new Error(SECRET)),
    }), [{ name: 'image.setSource', args: { id: 'img', url: 'https://cdn.test/b.png' } }]);

    expect(JSON.stringify(outcome)).not.toContain('hunter2');
    expect(outcome.structuredContent).toMatchObject({ ok: false, error: { code: 'TOOL_ACTION_FAILED', message: 'The upload failed.', commandIndex: 0 } });
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it('shows the agent an error\'s agentMessage, which the host wrote for it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const outcome = await execute(start({
      uploadByFile: () => Promise.reject(Object.assign(new Error(SECRET), { agentMessage: 'Your storage quota is full.' })),
    }), upload);

    expect(JSON.stringify(outcome)).not.toContain('hunter2');
    expect(outcome.structuredContent).toMatchObject({ ok: false, error: { code: 'TOOL_ACTION_FAILED', message: 'Your storage quota is full.' } });
  });

  it('keeps Blok\'s own refusals word for word, and never calls the uploader', async () => {
    const uploadByFile = vi.fn(() => Promise.reject(new Error(SECRET)));
    const outcome = await execute(start({ uploadByFile }), [{ name: 'image.uploadFile', args: { data: btoa('hi'), fileName: 'a.txt' } }]);

    expect(outcome.structuredContent).toMatchObject({
      ok: false, error: { code: 'PRECONDITION_FAILED', message: 'This host does not take text/plain for image. It takes: image/*.' },
    });
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
