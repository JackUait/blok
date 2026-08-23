import { join } from 'node:path';
import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  cacheRoot,
  checksumFor,
  fallbackMessage,
  resolveTarget,
  supportedTargets,
} from '../../../packages/server/bin/blok-server.mjs';

/**
 * The wrapper's decisions, exercised without the network. Importing the module
 * at all is part of the contract: it must not start a download on import.
 */
describe('blok-server npm wrapper', () => {
  describe('resolveTarget', () => {
    it.each([
      [ 'darwin', 'arm64', 'blok-server_darwin_arm64.tar.gz', 'blok-server' ],
      [ 'darwin', 'x64', 'blok-server_darwin_amd64.tar.gz', 'blok-server' ],
      [ 'linux', 'x64', 'blok-server_linux_amd64.tar.gz', 'blok-server' ],
      [ 'linux', 'arm64', 'blok-server_linux_arm64.tar.gz', 'blok-server' ],
      // Windows archives are zips, and the binary inside carries .exe.
      [ 'win32', 'x64', 'blok-server_windows_amd64.zip', 'blok-server.exe' ],
      [ 'win32', 'arm64', 'blok-server_windows_arm64.zip', 'blok-server.exe' ],
    ])('%s/%s resolves to %s', (platform, arch, archive, binary) => {
      expect(resolveTarget(platform, arch)).toMatchObject({ archive, binary });
    });

    it.each([
      [ 'sunos', 'x64' ],
      [ 'linux', 'ppc64' ],
      [ 'aix', 's390x' ],
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

    it('returns null when the asset is unlisted, so the caller can abort instead of skipping verification', () => {
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
    it('offers the container at the same version, bound so the published port reaches it', () => {
      const message = fallbackMessage('1.10.1', 'network unreachable');

      expect(message).toContain('network unreachable');
      expect(message).toContain('ghcr.io/jackuait/blok-server:1.10.1');
      // The service defaults to loopback; without this the container answers nobody.
      expect(message).toContain('--listen 0.0.0.0:4000');
      expect(message).toContain('-p 4000:4000');
    });
  });
});
