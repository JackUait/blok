// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDocumentAgentSession } from '../../../../src/shared/agent';
import { DEFAULT_UPLOAD_LIMITS } from '../../../../src/shared/tool-actions/upload';
import * as audioDefaults from '../../../../src/tools/audio/constants';
import * as fileDefaults from '../../../../src/tools/file/constants';
import * as imageDefaults from '../../../../src/tools/image/constants';
import { Uploader as ImageUploader } from '../../../../src/tools/image/uploader';
import * as videoDefaults from '../../../../src/tools/video/constants';
import { createHeadlessAgentSetup, loadStoredDocument } from '../../../../src/view/agent-runtime';
import type { AgentActor, AgentResult } from '../../../../types/agent';
import type { OutputData } from '../../../../types/data-formats/output-data';
import type { UploadContext } from '../../../../types/configs/uploader';

const ACTOR: AgentActor = { id: 'agent-test', name: 'Agent', kind: 'agent', onBehalfOf: 'human-1' };

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const base64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

interface Upload { name: string; type: string; size: number; text: string; ctx: UploadContext }

const fakeUploader = (answer: (file: File) => { url: string; fileName?: string; size?: number; mimeType?: string } = file => ({ url: `https://cdn.test/${file.name}` })) => {
  const uploads: Upload[] = [];
  const uploadByFile = vi.fn(async (file: File, ctx: UploadContext) => {
    uploads.push({ name: file.name, type: file.type, size: file.size, text: await file.text(), ctx });

    return answer(file);
  });

  return { uploads, uploadByFile };
};

const open = (
  seed: OutputData,
  uploader?: Record<string, unknown>,
  uploadsFiles = uploader !== undefined
) => {
  const setup = createHeadlessAgentSetup({ runtime: 'node', services: uploader === undefined ? [] : ['uploader'], uploadsFiles });

  return createDocumentAgentSession({
    document: loadStoredDocument(structuredClone(seed), setup.richTextFieldsFor),
    tools: setup.tools, contract: setup.contract, actor: ACTOR, ports: setup.ports,
    ...(uploader !== undefined && { services: { uploader } }),
  });
};

const run = (session: ReturnType<typeof open>, name: string, args: Record<string, unknown>): Promise<AgentResult> =>
  session.execute({ commands: [{ name, args }] });

const errorOf = (result: AgentResult) => (result.ok ? undefined : result.error);

const EMPTY: OutputData = { blocks: [] };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('<tool>.uploadFile sends bytes through the host uploader, as a person\'s pick does', () => {
  it('inserts an image with what the image tool saves after an upload', async () => {
    const host = fakeUploader();
    const session = open(EMPTY, host);
    const result = await run(session, 'image.uploadFile', { data: base64(PNG), fileName: 'photo.png', position: 'end' });

    expect(errorOf(result)).toBeUndefined();
    expect(host.uploads).toEqual([expect.objectContaining({ name: 'photo.png', type: 'image/png', size: PNG.length, ctx: { kind: 'image', tool: 'image' } })]);
    const block = session.output().blocks[0];

    expect(block).toMatchObject({ type: 'image', data: { url: 'https://cdn.test/photo.png', fileName: 'photo.png' }, createdBy: 'human-1', createdWith: 'agent-test' });
    expect(block.data).not.toHaveProperty('variants');
  });

  it('saves on a file card what the host reports, and lets the host\'s fileName win', async () => {
    const host = fakeUploader(file => (file.name === 'report.pdf'
      ? { url: 'https://cdn.test/f1', fileName: 'stored.pdf', size: 11, mimeType: 'application/pdf' }
      : { url: 'https://cdn.test/f2' }));
    const session = open(EMPTY, host);

    expect(errorOf(await run(session, 'file.uploadFile', { data: base64(PNG), fileName: 'report.pdf', position: 'end' }))).toBeUndefined();
    expect(errorOf(await run(session, 'file.uploadFile', { data: base64(PNG), fileName: 'notes.txt', position: 'end' }))).toBeUndefined();
    expect(host.uploads[0]).toMatchObject({ type: 'application/pdf', ctx: { kind: 'file', tool: 'file' } });
    // The file tool keeps only the host's size and type after a host upload (src/tools/file/index.ts resultDelta).
    expect(session.output().blocks.map(block => block.data)).toEqual([
      { url: 'https://cdn.test/f1', fileName: 'stored.pdf', size: 11, mimeType: 'application/pdf' },
      { url: 'https://cdn.test/f2', fileName: 'notes.txt' },
    ]);
  });

  it('saves fileName and mimeType on audio and video', async () => {
    const host = fakeUploader();
    const session = open(EMPTY, host);

    expect(errorOf(await run(session, 'audio.uploadFile', { data: base64(PNG), fileName: 'song.mp3', position: 'end' }))).toBeUndefined();
    expect(errorOf(await run(session, 'video.uploadFile', { data: base64(PNG), fileName: 'clip.mp4', position: 'end' }))).toBeUndefined();
    expect(session.output().blocks.map(block => [block.type, block.data])).toEqual([
      ['audio', { url: 'https://cdn.test/song.mp3', fileName: 'song.mp3', mimeType: 'audio/mpeg' }],
      ['video', { url: 'https://cdn.test/clip.mp4', fileName: 'clip.mp4', mimeType: 'video/mp4' }],
    ]);
  });

  it('decodes padded base64 to the exact bytes', async () => {
    const host = fakeUploader();
    const session = open(EMPTY, host);

    expect(errorOf(await run(session, 'file.uploadFile', { data: btoa('hi?>~'), fileName: 'a.txt', position: 'end' }))).toBeUndefined();
    expect(errorOf(await run(session, 'file.uploadFile', { data: btoa('ab'), fileName: 'b.txt', position: 'end' }))).toBeUndefined();
    expect(host.uploads.map(upload => upload.text)).toEqual(['hi?>~', 'ab']);
  });

  it('cleans the file name: no path, no control or bidi characters', async () => {
    const host = fakeUploader();
    const session = open(EMPTY, host);

    expect(errorOf(await run(session, 'image.uploadFile', { data: base64(PNG), fileName: '../evil‮gnp.png', position: 'end' }))).toBeUndefined();
    expect(host.uploads[0].name).toBe('evilgnp.png');
  });

  it('reads a path through the host\'s reader, and sends only its base name', async () => {
    const host = fakeUploader();
    const readLocal = vi.fn(async () => ({ bytes: PNG, name: 'cat.png' }));
    const session = open(EMPTY, { ...host, readLocal });

    expect(errorOf(await run(session, 'image.uploadFile', { path: 'pics/cat.png', position: 'end' }))).toBeUndefined();
    expect(readLocal).toHaveBeenCalledWith('pics/cat.png', 30 * 1024 * 1024);
    expect(host.uploads[0]).toMatchObject({ name: 'cat.png', type: 'image/png' });
  });
});

describe('<tool>.uploadFile refuses what a person\'s upload refuses, before any upload', () => {
  it('is unavailable with reason host when the host has no file uploader', async () => {
    const session = open(EMPTY);
    const error = errorOf(await run(session, 'image.uploadFile', { data: base64(PNG), fileName: 'a.png', position: 'end' }));

    expect(error).toMatchObject({ code: 'COMMAND_UNAVAILABLE', details: { reason: 'host' } });
  });

  it('fails closed with reason host when the contract says yes but the service has no uploadByFile', async () => {
    const session = open(EMPTY, { uploadByUrl: vi.fn() }, true);
    const error = errorOf(await run(session, 'image.uploadFile', { data: base64(PNG), fileName: 'a.png', position: 'end' }));

    expect(error).toMatchObject({ code: 'COMMAND_UNAVAILABLE', details: { reason: 'host' } });
  });

  it('refuses a path when the host reads no local files', async () => {
    const host = fakeUploader();
    const session = open(EMPTY, host);
    const error = errorOf(await run(session, 'image.uploadFile', { path: '/etc/passwd.png', position: 'end' }));

    expect(error).toMatchObject({ code: 'COMMAND_UNAVAILABLE', details: { reason: 'host' } });
    expect(host.uploadByFile).not.toHaveBeenCalled();
  });

  it('refuses an oversized payload from its length, before decoding it', async () => {
    const host = fakeUploader();
    const session = open(EMPTY, { ...host, limits: () => ({ maxSize: 6 }) });
    // Eight characters decode to at most six bytes. The bad character would fail a decode, so this answer comes before one.
    const error = errorOf(await run(session, 'image.uploadFile', { data: 'AAAA*AAAAAAA', fileName: 'a.png', position: 'end' }));

    expect(error).toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(error?.message).toMatch(/too large/i);
    expect(host.uploadByFile).not.toHaveBeenCalled();
  });

  it('refuses bytes past the cap after decoding too', async () => {
    const host = fakeUploader();
    const session = open(EMPTY, { ...host, limits: () => ({ maxSize: 7 }) });
    const error = errorOf(await run(session, 'image.uploadFile', { data: 'AAAAAAAAAAAA', fileName: 'a.png', position: 'end' }));

    expect(error?.message).toMatch(/too large/i);
    expect(host.uploadByFile).not.toHaveBeenCalled();
  });

  it('refuses data that is not strict base64', async () => {
    const host = fakeUploader();
    const session = open(EMPTY, host);
    const error = errorOf(await run(session, 'image.uploadFile', { data: 'AA*A', fileName: 'a.png', position: 'end' }));

    expect(error).toMatchObject({ code: 'INVALID_ARGS' });
    expect(host.uploadByFile).not.toHaveBeenCalled();
  });

  it('refuses a mimeType that disagrees with the file name', async () => {
    const host = fakeUploader();
    const session = open(EMPTY, host);
    const error = errorOf(await run(session, 'image.uploadFile', { data: base64(PNG), fileName: 'page.html', mimeType: 'image/png', position: 'end' }));

    expect(error).toMatchObject({ code: 'INVALID_ARGS' });
    expect(host.uploadByFile).not.toHaveBeenCalled();
  });

  it('refuses a type the tool does not take, as the image tool\'s image/* default does', async () => {
    const host = fakeUploader();
    const session = open(EMPTY, host);
    const error = errorOf(await run(session, 'image.uploadFile', { data: base64(PNG), fileName: 'page.html', position: 'end' }));

    expect(error).toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(error?.message).toMatch(/text\/html/);
    expect(host.uploadByFile).not.toHaveBeenCalled();
  });

  it('refuses a type outside the host\'s own list', async () => {
    const host = fakeUploader();
    const session = open(EMPTY, { ...host, limits: () => ({ types: ['image/png'] }) });
    const error = errorOf(await run(session, 'image.uploadFile', { data: base64(PNG), fileName: 'a.jpg', position: 'end' }));

    expect(error).toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(host.uploadByFile).not.toHaveBeenCalled();
  });

  it('never uploads when the placement is bad', async () => {
    const host = fakeUploader();
    const session = open(EMPTY, host);
    const error = errorOf(await run(session, 'image.uploadFile', { data: base64(PNG), fileName: 'a.png', parentId: 'missing', position: 'end' }));

    expect(error).toBeDefined();
    expect(host.uploadByFile).not.toHaveBeenCalled();
  });

  it('runs alone in its batch', async () => {
    const host = fakeUploader();
    const session = open(EMPTY, host);
    const upload = { name: 'image.uploadFile', args: { data: base64(PNG), fileName: 'a.png', position: 'end' } };
    const result = await session.execute({ commands: [upload, upload] });

    expect(errorOf(result)).toMatchObject({ code: 'INVALID_ARGS' });
    expect(host.uploadByFile).not.toHaveBeenCalled();
  });

  it('needs exactly one of data and path, and a fileName with data', async () => {
    const host = fakeUploader();
    const session = open(EMPTY, { ...host, readLocal: vi.fn() });

    expect(errorOf(await run(session, 'image.uploadFile', { fileName: 'a.png', position: 'end' }))).toMatchObject({ code: 'INVALID_ARGS' });
    expect(errorOf(await run(session, 'image.uploadFile', { data: base64(PNG), path: 'a.png', fileName: 'a.png', position: 'end' }))).toMatchObject({ code: 'INVALID_ARGS' });
    expect(errorOf(await run(session, 'image.uploadFile', { data: base64(PNG), position: 'end' }))).toMatchObject({ code: 'INVALID_ARGS' });
    expect(host.uploadByFile).not.toHaveBeenCalled();
  });

  it('reports the stored asset as orphaned when the batch fails after the upload', async () => {
    const host = fakeUploader(() => ({ url: '' }));
    const session = open(EMPTY, host);
    const error = errorOf(await run(session, 'image.uploadFile', { data: base64(PNG), fileName: 'a.png', position: 'end' }));

    expect(error).toMatchObject({ code: 'ORPHANED_SIDE_EFFECT' });
    expect(session.output().blocks).toEqual([]);
  });
});

describe('an SVG with a script goes where a person\'s SVG goes', () => {
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';

  it('a person\'s pick of it reaches the host uploader unchanged, and a types list without SVG refuses it', async () => {
    const uploadByFile = vi.fn(async (_file: File) => ({ url: 'https://cdn.test/x.svg' }));
    const svg = new File([SVG], 'x.svg', { type: 'image/svg+xml' });

    await new ImageUploader({ uploader: { uploadByFile } }).handleFile(svg);
    expect(await uploadByFile.mock.calls[0][0].text()).toBe(SVG);
    await expect(new ImageUploader({ uploader: { uploadByFile }, types: ['image/png'] }).handleFile(svg)).rejects.toMatchObject({ code: 'UNSUPPORTED_TYPE' });
  });

  it('reaches the host unchanged as image/svg+xml under the image/* default, like the image tool\'s pick', async () => {
    const host = fakeUploader();
    const session = open(EMPTY, host);

    expect(errorOf(await run(session, 'image.uploadFile', { data: btoa(SVG), fileName: 'x.svg', position: 'end' }))).toBeUndefined();
    expect(host.uploads[0]).toMatchObject({ type: 'image/svg+xml', text: SVG });
  });

  it('is refused when the host\'s types leave SVG out', async () => {
    const host = fakeUploader();
    const session = open(EMPTY, { ...host, limits: () => ({ types: ['image/png', 'image/jpeg'] }) });
    const error = errorOf(await run(session, 'image.uploadFile', { data: btoa(SVG), fileName: 'x.svg', position: 'end' }));

    expect(error).toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(host.uploadByFile).not.toHaveBeenCalled();
  });
});

describe('the agent\'s default limits', () => {
  it('are the media tools\' own defaults', () => {
    expect(DEFAULT_UPLOAD_LIMITS).toEqual({
      image: { types: [...imageDefaults.DEFAULT_MIME_TYPES], maxSize: imageDefaults.DEFAULT_MAX_SIZE },
      audio: { types: [...audioDefaults.DEFAULT_MIME_TYPES], maxSize: audioDefaults.DEFAULT_MAX_SIZE },
      video: { types: [...videoDefaults.DEFAULT_MIME_TYPES], maxSize: videoDefaults.DEFAULT_MAX_SIZE },
      file: { maxSize: fileDefaults.DEFAULT_MAX_SIZE },
    });
  });
});

describe('host limits that leave a field undefined or garbled', () => {
  it('keeps the default types when the host returns types: undefined', async () => {
    const host = fakeUploader();
    const session = open(EMPTY, { ...host, limits: () => ({ types: undefined, maxSize: undefined }) });
    const error = errorOf(await run(session, 'image.uploadFile', { data: btoa('<html></html>'), fileName: 'page.html', position: 'end' }));

    expect(error).toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(host.uploadByFile).not.toHaveBeenCalled();
  });

  it('keeps the default size cap when the host returns maxSize: undefined', async () => {
    const host = fakeUploader();
    const readLocal = vi.fn(async () => ({ bytes: PNG, name: 'cat.png' }));
    const session = open(EMPTY, { ...host, readLocal, limits: () => ({ maxSize: undefined }) });

    expect(errorOf(await run(session, 'image.uploadFile', { path: 'cat.png', position: 'end' }))).toBeUndefined();
    // The cap the reader gets is the image tool's 30 MiB default, not undefined (which no size passes).
    expect(readLocal).toHaveBeenCalledWith('cat.png', 30 * 1024 * 1024);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 0, 1.5, '10'])('fails closed on maxSize %s', async (maxSize) => {
    const host = fakeUploader();
    const session = open(EMPTY, { ...host, limits: () => ({ maxSize }) });
    const error = errorOf(await run(session, 'image.uploadFile', { data: base64(PNG), fileName: 'a.png', position: 'end' }));

    expect(error).toBeDefined();
    expect(host.uploadByFile).not.toHaveBeenCalled();
  });

  it('fails closed on types that are not a list of strings', async () => {
    const host = fakeUploader();
    const session = open(EMPTY, { ...host, limits: () => ({ types: 'image/*' }) });
    const error = errorOf(await run(session, 'image.uploadFile', { data: base64(PNG), fileName: 'a.png', position: 'end' }));

    expect(error).toBeDefined();
    expect(host.uploadByFile).not.toHaveBeenCalled();
  });
});

describe('the session log', () => {
  it('keeps upload bytes out of the log', async () => {
    const host = fakeUploader();
    const session = open(EMPTY, host);
    const data = base64(PNG);

    expect(errorOf(await run(session, 'image.uploadFile', { data, fileName: 'a.png', position: 'end' }))).toBeUndefined();
    expect(JSON.stringify(session.log())).not.toContain(data);
    expect(session.log()[0].args).toMatchObject({ fileName: 'a.png', data: expect.stringMatching(/16 base64 characters/) });
  });

  it('keeps upload bytes out of the log when the envelope is refused', async () => {
    const session = open(EMPTY, fakeUploader());
    const data = base64(PNG);

    await session.execute({ commands: [{ name: 'image.uploadFile', args: { data, fileName: 'a.png' }, bogus: 1 }] } as never);
    expect(JSON.stringify(session.log())).not.toContain(data);
  });
});

describe('base64 decoding', () => {
  it('uses the host\'s decoder when it has one', async () => {
    const host = fakeUploader();
    const decodeBase64 = vi.fn((data: string) => Uint8Array.from(atob(data), char => char.charCodeAt(0)));
    const session = open(EMPTY, { ...host, decodeBase64 });

    expect(errorOf(await run(session, 'file.uploadFile', { data: btoa('hello'), fileName: 'a.txt', position: 'end' }))).toBeUndefined();
    expect(decodeBase64).toHaveBeenCalledWith(btoa('hello'));
    expect(host.uploads[0].text).toBe('hello');
  });
});
