// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync, linkSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

  it('refuses a hidden file or a file in a hidden folder, even through a symlink', async () => {
    mkdirSync(join(state.root, '.git'));
    writeFileSync(join(state.root, '.env'), 'SECRET=1');
    writeFileSync(join(state.root, '.git', 'config'), 'token');
    writeFileSync(join(state.root, 'pics', '.hidden.png'), 'hidden');
    symlinkSync(join(state.root, '.env'), join(state.root, 'pics', 'env.png'));
    const read = createLocalFileReader(state.root);

    expect(await Promise.all(['.env', '.git/config', 'pics/.hidden.png', 'pics/env.png'].map(async (path) => (await refusal(read(path, 100)))?.error?.code)))
      .toEqual(['PRECONDITION_FAILED', 'PRECONDITION_FAILED', 'PRECONDITION_FAILED', 'PRECONDITION_FAILED']);
    expect((await read('./pics/cat.png', 100)).name).toBe('cat.png');
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

  it('refuses a hard link to a file outside the root', async () => {
    linkSync(join(state.base, 'secret.png'), join(state.root, 'linked.png'));
    const read = createLocalFileReader(state.root);

    expect((await refusal(read('linked.png', 100)))?.error?.code).toBe('PRECONDITION_FAILED');
  });

  it('refuses a read whose parent folder is swapped for a symlink out of the root after the check', async () => {
    mkdirSync(join(state.base, 'outside'));
    writeFileSync(join(state.base, 'outside', 'cat.png'), 'outside-bytes');
    const swap = (): void => {
      renameSync(join(state.root, 'pics'), join(state.base, 'pics-moved'));
      symlinkSync(join(state.base, 'outside'), join(state.root, 'pics'));
    };
    const read = createLocalFileReader(state.root, { afterResolve: async () => swap() });
    const answer = await refusal(read('pics/cat.png', 100));

    expect(answer?.error?.code).toBe('PRECONDITION_FAILED');
  });

  it('gives one answer for a missing file and a file outside the root, so it tells nothing about the disk', async () => {
    const read = createLocalFileReader(state.root);
    const outside = await refusal(read('../secret.png', 100));
    const missing = await refusal(read('../nothing-here.png', 100));
    const inside = await refusal(read('pics/none.png', 100));

    expect(outside?.error?.message.replace('../secret.png', 'X')).toBe(missing?.error?.message.replace('../nothing-here.png', 'X'));
    expect(inside?.error?.message.replace('pics/none.png', 'X')).toBe(missing?.error?.message.replace('../nothing-here.png', 'X'));
  });

  it('reads under a root given in another letter case on a case-insensitive disk', async () => {
    const upper = state.root.replace(/root$/, 'ROOT');

    // A case-sensitive disk has no such folder, so there is nothing to check.
    if (!existsSync(upper)) {
      return;
    }
    const read = createLocalFileReader(upper);

    expect((await read('pics/cat.png', 100)).name).toBe('cat.png');
  });

  it('refuses a root that is not a folder', () => {
    expect(() => createLocalFileReader(join(state.base, 'secret.png'))).toThrow(/folder/);
    expect(() => createLocalFileReader(join(state.base, 'missing'))).toThrow(/folder/);
  });
});
