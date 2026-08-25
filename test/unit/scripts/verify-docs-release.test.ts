import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FAMILY } from '../../../scripts/release-manifest.mjs';

const loadVerifier = async () => import('../../../scripts/verify-docs-release.mjs');

describe('docs release verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts stable and prerelease version tags', async () => {
    const { releaseVersionFromTag } = await loadVerifier();

    expect(releaseVersionFromTag('v2.3.4')).toBe('2.3.4');
    expect(releaseVersionFromTag('v2.3.4-beta.5')).toBe('2.3.4-beta.5');
  });

  it('rejects tags that are not canonical package versions', async () => {
    const { releaseVersionFromTag } = await loadVerifier();

    expect(() => releaseVersionFromTag('docs-2.3.4')).toThrow('Invalid package release tag');
    expect(() => releaseVersionFromTag('v2.3')).toThrow('Invalid package release tag');
  });

  it('requires every lockstep manifest to match the release version', async () => {
    const { assertLockstepManifestVersions } = await loadVerifier();
    const manifests = [
      { name: '@bloklabs/core', version: '2.3.4' },
      { name: '@bloklabs/react', version: '2.3.3' },
    ];

    expect(() => assertLockstepManifestVersions('2.3.4', manifests))
      .toThrow('@bloklabs/react has version 2.3.3');
  });

  it('covers every package published by the lockstep release', async () => {
    const { RELEASE_PACKAGES } = await loadVerifier();

    expect(RELEASE_PACKAGES.map(({ name }: { name: string }) => name))
      .toEqual(FAMILY.map(({ npmName }) => npmName));
  });

  it('retries registry propagation before accepting the package release', async () => {
    const { verifyPublishedPackageVersions } = await loadVerifier();
    const attempts = new Map<string, number>();
    const lookupVersion = vi.fn(async (name: string) => {
      const attempt = (attempts.get(name) ?? 0) + 1;

      attempts.set(name, attempt);

      if (name === '@bloklabs/cli' && attempt === 1) {
        throw new Error('not found');
      }

      return '2.3.4';
    });
    const wait = vi.fn(async () => {});

    await verifyPublishedPackageVersions('2.3.4', {
      attempts: 2,
      lookupVersion,
      packageNames: ['@bloklabs/core', '@bloklabs/cli'],
      retryDelayMs: 1,
      wait,
    });

    expect(wait).toHaveBeenCalledOnce();
    expect(attempts.get('@bloklabs/cli')).toBe(2);
  });

  it('rejects a release when any package version is absent', async () => {
    const { verifyPublishedPackageVersions } = await loadVerifier();

    await expect(verifyPublishedPackageVersions('2.3.4', {
      attempts: 2,
      lookupVersion: async (name: string) => (
        name === '@bloklabs/vue' ? '2.3.3' : '2.3.4'
      ),
      packageNames: ['@bloklabs/core', '@bloklabs/vue'],
      retryDelayMs: 1,
      wait: async () => {},
    })).rejects.toThrow('@bloklabs/vue published 2.3.3');
  });

  it('pins the two NuGet packages, six host archives, and checksums', async () => {
    const { SERVER_NUGET_PACKAGES, SERVER_RELEASE_ASSETS } = await loadVerifier();

    expect(SERVER_NUGET_PACKAGES).toEqual([
      'Blok.Server',
      'Blok.Server.AspNetCore',
    ]);
    expect(SERVER_RELEASE_ASSETS).toEqual([
      'blok-server_darwin_amd64.tar.gz',
      'blok-server_darwin_arm64.tar.gz',
      'blok-server_linux_amd64.tar.gz',
      'blok-server_linux_arm64.tar.gz',
      'blok-server_windows_amd64.zip',
      'blok-server_windows_arm64.zip',
      'checksums.txt',
    ]);
  });

  it('looks up an exact version in the public NuGet flat-container index', async () => {
    const { lookupNuGetVersion } = await loadVerifier();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      versions: ['2.3.3', '2.3.4'],
    })));

    await expect(lookupNuGetVersion('Blok.Server.AspNetCore', '2.3.4', fetchImpl))
      .resolves.toBe('2.3.4');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.nuget.org/v3-flatcontainer/blok.server.aspnetcore/index.json',
      { headers: { accept: 'application/json' } },
    );
  });

  it('looks up the release assets from the tagged GitHub release', async () => {
    const { lookupGitHubReleaseAssets } = await loadVerifier();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      assets: [{ name: 'checksums.txt' }, { name: 'server.tar.gz' }],
    })));

    await expect(lookupGitHubReleaseAssets('v2.3.4', fetchImpl))
      .resolves.toEqual(['checksums.txt', 'server.tar.gz']);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/JackUait/blok/releases/tags/v2.3.4',
      {
        headers: {
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
        },
      },
    );
  });

  it('authenticates anonymously before checking the versioned GHCR manifest', async () => {
    const { lookupGhcrVersion } = await loadVerifier();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('', {
        status: 401,
        headers: {
          'www-authenticate': 'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:jackuait/blok-server:pull"',
        },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'registry-token' })))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    await expect(lookupGhcrVersion('2.3.4', fetchImpl)).resolves.toBe('2.3.4');

    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://ghcr.io/token?service=ghcr.io&scope=repository%3Ajackuait%2Fblok-server%3Apull',
      { headers: { accept: 'application/json' } },
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://ghcr.io/v2/jackuait/blok-server/manifests/2.3.4',
      {
        headers: {
          accept: 'application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json',
          authorization: 'Bearer registry-token',
        },
      },
    );
  });

  it('retries until NuGet, release assets, and the image are all observable', async () => {
    const { verifyPublishedServerDelivery } = await loadVerifier();
    let attempt = 0;
    const wait = vi.fn(async () => {});

    await verifyPublishedServerDelivery('2.3.4', {
      attempts: 2,
      lookupNuGetVersion: async () => '2.3.4',
      lookupReleaseAssets: async () => {
        attempt += 1;

        return attempt === 1 ? [] : ['a.tar.gz', 'checksums.txt'];
      },
      lookupContainerVersion: async () => {
        if (attempt === 1) {
          throw new Error('not found');
        }

        return '2.3.4';
      },
      nugetPackageIds: ['Blok.Server', 'Blok.Server.AspNetCore'],
      requiredAssets: ['a.tar.gz', 'checksums.txt'],
      retryDelayMs: 1,
      wait,
    });

    expect(wait).toHaveBeenCalledOnce();
  });

  it('names every missing server output after propagation retries are exhausted', async () => {
    const { verifyPublishedServerDelivery } = await loadVerifier();

    await expect(verifyPublishedServerDelivery('2.3.4', {
      attempts: 1,
      lookupNuGetVersion: async (name: string) => (
        name === 'Blok.Server' ? '2.3.3' : '2.3.4'
      ),
      lookupReleaseAssets: async () => [],
      lookupContainerVersion: async () => {
        throw new Error('manifest missing');
      },
      nugetPackageIds: ['Blok.Server', 'Blok.Server.AspNetCore'],
      requiredAssets: ['a.tar.gz', 'checksums.txt'],
      wait: async () => {},
    })).rejects.toThrow(
      'Blok.Server published 2.3.3; missing release assets: a.tar.gz, checksums.txt; ' +
      'ghcr.io/jackuait/blok-server:2.3.4 unavailable (manifest missing)',
    );
  });
});
