import { constants, realpathSync, statSync } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
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

/**
 * Reads files under one folder for uploads. The root is resolved once, so a path that resolves
 * (through `..` or a symlink) outside it is refused. Only regular files are read: opening a FIFO
 * or a device could block or never end.
 */
export const createLocalFileReader = (root: string): ((path: string, maxBytes: number) => Promise<{ bytes: Uint8Array; name: string }>) => {
  const realRoot = (() => {
    try {
      const real = realpathSync(root);

      return statSync(real).isDirectory() ? real : null;
    } catch {
      return null;
    }
  })() ?? (() => {
    throw new McpConfigError(`The upload root "${root}" is not a folder`);
  })();
  const inside = (real: string): boolean => real === realRoot || real.startsWith(realRoot.endsWith(sep) ? realRoot : realRoot + sep);

  return async (path, maxBytes) => {
    if (path === '' || path.length > MAX_PATH || path.includes('\0')) {
      throw failure('INVALID_ARGS', `path must be 1 to ${MAX_PATH} characters with no NUL byte.`, { path: '/path' });
    }
    const real = await realpath(resolve(realRoot, path)).catch(() => refuse(`There is no file "${path}" under the upload folder.`));

    if (!inside(real)) {
      refuse(`"${path}" is outside the upload folder. Only files under it can be uploaded.`);
    }
    const before = await stat(real);

    if (!before.isFile()) {
      refuse(`"${path}" is not a regular file.`);
    }
    if (before.size > maxBytes) {
      tooLarge(before.size, maxBytes);
    }
    // NOFOLLOW and NONBLOCK: a swap to a symlink or a FIFO after the checks fails here instead of following or hanging.
    const handle = await open(real, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
      .catch(() => refuse(`"${path}" could not be opened.`));

    try {
      const opened = await handle.stat();

      if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev) {
        refuse(`"${path}" changed while it was being read.`);
      }
      // One byte past the cap tells a file that grew meanwhile from one that fits.
      const buffer = new Uint8Array(Math.min(opened.size, maxBytes) + 1);
      const total = await fill(handle, buffer, 0);

      if (total > maxBytes) {
        tooLarge(total, maxBytes);
      }

      return { bytes: buffer.slice(0, total), name: basename(real) };
    } finally {
      await handle.close();
    }
  };
};
