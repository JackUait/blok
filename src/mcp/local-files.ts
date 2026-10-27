import { constants, realpathSync, statSync } from 'node:fs';
import { lstat, open, realpath, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { basename, resolve, sep } from 'node:path';

import { failure } from '../shared/agent/errors';

import { McpConfigError } from './config';

const MAX_PATH = 4096;

const refuse = (message: string): never => {
  throw failure('PRECONDITION_FAILED', message, { path: '/path' });
};

const tooLarge = (size: number, maxBytes: number): never =>
  refuse(`The file is too large: ${size} bytes, and this host takes at most ${maxBytes}.`);

/** Reads into `buffer` until it is full or the file ends, and returns the byte count. */
const fill = async (handle: FileHandle, buffer: Uint8Array, from: number): Promise<number> => {
  if (from >= buffer.length) {
    return from;
  }
  const { bytesRead } = await handle.read(buffer, from, buffer.length - from, from);

  return bytesRead === 0 ? from : fill(handle, buffer, from + bytesRead);
};

/** Test seam: runs between resolving the path and opening it, where a swap would land. */
export interface LocalFileReaderHooks {
  afterResolve?(): Promise<void>;
}

/**
 * Reads files under one folder for uploads. A path that resolves (through `..`, a symlink or a
 * parent swapped during the read) outside it is refused, and so is a hard-linked file, whose
 * other name may be outside. Only regular files are read: a FIFO or a device could block or never end.
 */
export const createLocalFileReader = (
  root: string,
  hooks: LocalFileReaderHooks = {}
): ((path: string, maxBytes: number) => Promise<{ bytes: Uint8Array<ArrayBuffer>; name: string }>) => {
  // .native, like fs/promises realpath: the JS one keeps the given letter case, so a root in
  // another case would never prefix the on-disk paths the reads resolve to.
  const realRoot = (() => {
    try {
      const real = realpathSync.native(root);

      return statSync(real).isDirectory() ? real : null;
    } catch {
      return null;
    }
  })() ?? (() => {
    throw new McpConfigError(`The upload root "${root}" is not a folder`);
  })();
  const inside = (real: string): boolean => real === realRoot || real.startsWith(realRoot.endsWith(sep) ? realRoot : realRoot + sep);
  // One answer for missing and outside, so a refusal tells nothing about the rest of the disk.
  const notHere = (path: string): never => refuse(`"${path}" is not a file under the upload folder.`);
  const resolveInside = async (path: string): Promise<string> => {
    const real = await realpath(resolve(realRoot, path)).catch(() => notHere(path));

    return inside(real) ? real : notHere(path);
  };

  return async (path, maxBytes) => {
    if (path === '' || path.length > MAX_PATH || path.includes('\0')) {
      throw failure('INVALID_ARGS', `path must be 1 to ${MAX_PATH} characters with no NUL byte.`, { path: '/path' });
    }
    const real = await resolveInside(path);

    await hooks.afterResolve?.();
    const before = await stat(real).catch(() => notHere(path));

    if (!before.isFile()) {
      refuse(`"${path}" is not a regular file.`);
    }
    if (before.size > maxBytes) {
      tooLarge(before.size, maxBytes);
    }
    // NOFOLLOW only guards the last part of the path, so the open fd is checked again below.
    const handle = await open(real, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
      .catch(() => refuse(`"${path}" could not be opened.`));

    try {
      const opened = await handle.stat();

      if (!opened.isFile() || opened.nlink !== 1) {
        refuse(`"${path}" is not a regular file with one name.`);
      }
      // The open file must be the one the path names now, from inside the root. With one link,
      // that inside name is its only name.
      const again = await resolveInside(path);
      const named = await lstat(again).catch(() => notHere(path));

      if (named.ino !== opened.ino || named.dev !== opened.dev) {
        refuse(`"${path}" changed while it was being read.`);
      }
      // One byte past the cap tells a file that grew meanwhile from one that fits.
      const buffer = new Uint8Array(Math.min(opened.size, maxBytes) + 1);
      const total = await fill(handle, buffer, 0);

      if (total > maxBytes) {
        tooLarge(total, maxBytes);
      }

      return { bytes: buffer.slice(0, total), name: basename(again) };
    } finally {
      await handle.close();
    }
  };
};
