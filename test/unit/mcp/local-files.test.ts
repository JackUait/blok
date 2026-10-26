// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLocalFileReader } from '../../../src/mcp/local-files';

describe('createLocalFileReader keeps reads inside its root', () => {
  const state: { base: string; root: string } = { base: '', root: '' };

  beforeEach(() => {
    vi.clearAllMocks();
    // tmpdir() is a symlink on macOS (/var -> /private/var): the reader must still work under it.
    state.base = mkdtempSync(join(tmpdir(), 'blok-mcp-upload-'));
    state.root = join(state.base, 'root');
    mkdirSync(join(state.root, 'pics'), { recursive: true });
    writeFileSync(join(state.root, 'pics', 'cat.png'), 'cat-bytes');
    writeFileSync(join(state.base, 'secret.png'), 'secret');
  });

  afterEach(() => {
    rmSync(state.base, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const refusal = async (read: Promise<unknown>) => read.then(() => undefined, (thrown: unknown) => thrown as { error?: { code: string; message: string } });

  it('reads a file under the root and names it by its base name', async () => {
    const read = createLocalFileReader(state.root);
    const file = await read('pics/cat.png', 100);

    expect(new TextDecoder().decode(file.bytes)).toBe('cat-bytes');
    expect(file.name).toBe('cat.png');
  });

  it('refuses ../ out of the root', async () => {
    const read = createLocalFileReader(state.root);

    expect((await refusal(read('../secret.png', 100)))?.error?.code).toBe('PRECONDITION_FAILED');
    expect((await refusal(read('pics/../../secret.png', 100)))?.error?.code).toBe('PRECONDITION_FAILED');
  });

  it('refuses an absolute path outside the root', async () => {
    const read = createLocalFileReader(state.root);

    expect((await refusal(read(join(state.base, 'secret.png'), 100)))?.error?.code).toBe('PRECONDITION_FAILED');
    expect((await refusal(read('/etc/hosts', 100)))?.error?.code).toBe('PRECONDITION_FAILED');
  });

  it('takes an absolute path that is inside the root', async () => {
    const read = createLocalFileReader(state.root);

    expect((await read(join(realpathSync(state.root), 'pics', 'cat.png'), 100)).name).toBe('cat.png');
  });

  it('refuses a symlink that points out of the root, and a linked folder that does', async () => {
    symlinkSync(join(state.base, 'secret.png'), join(state.root, 'link.png'));
    symlinkSync(state.base, join(state.root, 'out'));
    const read = createLocalFileReader(state.root);

    expect((await refusal(read('link.png', 100)))?.error?.code).toBe('PRECONDITION_FAILED');
    expect((await refusal(read('out/secret.png', 100)))?.error?.code).toBe('PRECONDITION_FAILED');
  });

  it('refuses a device file, a FIFO and a folder', async () => {
    const fifo = join(state.root, 'pipe.png');

    execFileSync('mkfifo', [fifo]);
    const read = createLocalFileReader(state.root);

    expect((await refusal(read('pipe.png', 100)))?.error?.message).toMatch(/not a regular file/);
    expect((await refusal(read('pics', 100)))?.error?.message).toMatch(/not a regular file/);
    // /dev/null is outside the root; a root that holds it must still refuse it.
    const devRoot = createLocalFileReader('/dev');

    expect((await refusal(devRoot('null', 100)))?.error?.message).toMatch(/not a regular file/);
  });

  it('refuses a file past the size cap without reading it', async () => {
    const read = createLocalFileReader(state.root);

    expect((await refusal(read('pics/cat.png', 3)))?.error?.message).toMatch(/too large/);
  });

  it('refuses a missing file, an empty path and a NUL byte', async () => {
    const read = createLocalFileReader(state.root);

    expect((await refusal(read('pics/none.png', 100)))?.error?.code).toBe('PRECONDITION_FAILED');
    expect((await refusal(read('', 100)))?.error?.code).toBe('INVALID_ARGS');
    expect((await refusal(read('pics/cat.png\0.txt', 100)))?.error?.code).toBe('INVALID_ARGS');
  });

  it('refuses a root that is not a folder', () => {
    expect(() => createLocalFileReader(join(state.base, 'secret.png'))).toThrow(/folder/);
    expect(() => createLocalFileReader(join(state.base, 'missing'))).toThrow(/folder/);
  });
});
