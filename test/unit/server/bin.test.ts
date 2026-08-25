// @vitest-environment node
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createArchive } from '../../../scripts/publish-server.mjs';
import {
  cacheRoot,
  checksumFor,
  fallbackMessage,
  installBinary,
  resolveTarget,
  supportedTargets,
} from '../../../packages/server/bin/blok-server.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const wrapperPath = join(repositoryRoot, 'packages', 'server', 'bin', 'blok-server.mjs');

function requiredTarget(platform: string, arch: string) {
  const target = resolveTarget(platform, arch);

  if (target === null) {
    throw new Error(`Missing test target ${platform}/${arch}`);
  }

  return target;
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') {
    return input;
  }

  if (input instanceof URL) {
    return input.href;
  }

  return input.url;
}

function releaseFetch(target: ReturnType<typeof requiredTarget>, archive: Buffer) {
  const digest = createHash('sha256').update(archive).digest('hex');
  const checksums = `${digest}  ${target.archive}\n`;

  return vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const url = requestUrl(input);

    if (url.endsWith('/checksums.txt')) {
      return new Response(checksums);
    }

    if (url.endsWith(`/${target.archive}`)) {
      return new Response(archive);
    }

    return new Response('', { status: 404, statusText: 'Not Found' });
  });
}

describe('blok-server npm wrapper', () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    vi.clearAllMocks();
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'blok-server-wrapper-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  describe('resolveTarget', () => {
    it.each([
      ['darwin', 'x64', 'darwin', 'amd64', 'osx-x64', 'blok-server_darwin_amd64.tar.gz', 'blok-server'],
      ['darwin', 'arm64', 'darwin', 'arm64', 'osx-arm64', 'blok-server_darwin_arm64.tar.gz', 'blok-server'],
      ['linux', 'x64', 'linux', 'amd64', 'linux-x64', 'blok-server_linux_amd64.tar.gz', 'blok-server'],
      ['linux', 'arm64', 'linux', 'arm64', 'linux-arm64', 'blok-server_linux_arm64.tar.gz', 'blok-server'],
      ['win32', 'x64', 'windows', 'amd64', 'win-x64', 'blok-server_windows_amd64.zip', 'blok-server.exe'],
      ['win32', 'arm64', 'windows', 'arm64', 'win-arm64', 'blok-server_windows_arm64.zip', 'blok-server.exe'],
    ])(
      '%s/%s preserves %s/%s and resolves %s',
      (platform, arch, os, archiveArch, rid, archive, binary) => {
        expect(resolveTarget(platform, arch)).toEqual({
          os,
          arch: archiveArch,
          rid,
          archive,
          binary,
        });
      },
    );

    it.each([
      ['sunos', 'x64'],
      ['linux', 'ppc64'],
      ['aix', 's390x'],
    ])('returns null for the unpublished %s/%s rather than guessing a URL', (platform, arch) => {
      expect(resolveTarget(platform, arch)).toBeNull();
    });

    it('every published target appears in the message an unsupported platform gets', () => {
      const listed = supportedTargets();

      expect(listed).toContain('darwin/arm64');
      expect(listed).toContain('win32/x64');
      expect(listed.every((entry) => resolveTarget(...entry.split('/') as [string, string]) !== null)).toBe(true);
    });
  });

  describe('checksumFor', () => {
    const digest = 'a'.repeat(64);
    const other = 'b'.repeat(64);
    const checksums = [
      `${other}  blok-server_linux_amd64.tar.gz`,
      `${digest}  blok-server_darwin_arm64.tar.gz`,
      '',
    ].join('\n');

    it('reads the digest for the exact asset', () => {
      expect(checksumFor(checksums, 'blok-server_darwin_arm64.tar.gz')).toBe(digest);
    });

    it('returns null when the asset is unlisted, so the caller aborts verification', () => {
      expect(checksumFor(checksums, 'blok-server_windows_arm64.zip')).toBeNull();
    });

    it('does not match an asset whose name merely starts the same', () => {
      expect(checksumFor(`${digest}  blok-server_darwin_arm64.tar.gz.sig`, 'blok-server_darwin_arm64.tar.gz'))
        .toBeNull();
    });

    it('rejects a line whose first token is not a sha256 digest', () => {
      expect(checksumFor('not-a-digest  blok-server_linux_amd64.tar.gz', 'blok-server_linux_amd64.tar.gz'))
        .toBeNull();
    });
  });

  describe('installBinary', () => {
    const target = requiredTarget('darwin', 'arm64');

    it('verifies and extracts the archive binary into place', async () => {
      const executable = Buffer.from('published executable');
      const archive = await createArchive(target, executable);
      const destination = join(temporaryDirectory, target.binary);

      await installBinary({
        version: '1.10.1',
        target,
        destination,
        fetchImpl: releaseFetch(target, archive),
      });

      expect(readFileSync(destination)).toEqual(executable);
    });

    it('rejects a mismatched checksum without leaving an executable', async () => {
      const archive = await createArchive(target, Buffer.from('published executable'));
      const destination = join(temporaryDirectory, target.binary);
      const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
        const url = requestUrl(input);

        if (url.endsWith('/checksums.txt')) {
          return new Response(`${'0'.repeat(64)}  ${target.archive}\n`);
        }

        return new Response(archive);
      });

      await expect(installBinary({
        version: '1.10.1',
        target,
        destination,
        fetchImpl,
      })).rejects.toThrow('checksum mismatch');
      expect(existsSync(destination)).toBe(false);
    });

    it('leaves no executable after a failed extraction and succeeds on retry', async () => {
      const destination = join(temporaryDirectory, target.binary);
      const incompleteArchive = await createArchive(
        { ...target, binary: 'not-blok-server' },
        Buffer.from('partial executable'),
      );

      await expect(installBinary({
        version: '1.10.1',
        target,
        destination,
        fetchImpl: releaseFetch(target, incompleteArchive),
      })).rejects.toThrow(`did not contain ${target.binary}`);
      expect(existsSync(destination)).toBe(false);

      const executable = Buffer.from('complete executable');
      const archive = await createArchive(target, executable);

      await installBinary({
        version: '1.10.1',
        target,
        destination,
        fetchImpl: releaseFetch(target, archive),
      });

      expect(readFileSync(destination)).toEqual(executable);
    });
  });

  describe('cache execution', () => {
    it('executes an existing current-platform binary without downloading', () => {
      const target = requiredTarget(process.platform, process.arch);
      const packageJson = JSON.parse(
        readFileSync(join(repositoryRoot, 'packages', 'server', 'package.json'), 'utf8'),
      ) as { version: string };
      const versionDirectory = join(temporaryDirectory, packageJson.version);
      const binary = join(versionDirectory, target.binary);

      mkdirSync(versionDirectory, { recursive: true });
      linkSync(process.execPath, binary);
      chmodSync(binary, 0o755);

      const result = spawnSync(
        process.execPath,
        [
          wrapperPath,
          '-e',
          `process.stdout.write('cached wrapper execution')`,
        ],
        {
          cwd: repositoryRoot,
          encoding: 'utf8',
          env: {
            ...process.env,
            BLOK_SERVER_CACHE_DIR: temporaryDirectory,
            PATH: '',
          },
        },
      );

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe('cached wrapper execution');
    });
  });

  describe('cacheRoot', () => {
    it('honours the override, for machines where the home directory is read-only', () => {
      expect(cacheRoot({ BLOK_SERVER_CACHE_DIR: '/opt/blok-cache' }, 'linux')).toBe('/opt/blok-cache');
    });

    it('follows XDG on linux', () => {
      expect(cacheRoot({ XDG_CACHE_HOME: '/xdg' }, 'linux')).toBe(join('/xdg', 'blok-server'));
      expect(cacheRoot({}, 'linux')).toBe(join(homedir(), '.cache', 'blok-server'));
    });

    it('uses the platform cache location on darwin and windows', () => {
      expect(cacheRoot({}, 'darwin')).toBe(join(homedir(), 'Library', 'Caches', 'blok-server'));
      expect(cacheRoot({ LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' }, 'win32'))
        .toBe(join('C:\\Users\\x\\AppData\\Local', 'blok-server', 'Cache'));
    });
  });

  describe('fallbackMessage', () => {
    it('offers the unchanged image at the same version with a reachable published port', () => {
      const message = fallbackMessage('1.10.1', 'network unreachable');

      expect(message).toContain('network unreachable');
      expect(message).toContain('ghcr.io/jackuait/blok-server:1.10.1');
      expect(message).toContain('--listen 0.0.0.0:4000');
      expect(message).toContain('-p 4000:4000');
    });
  });
});
