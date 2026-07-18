import { describe, expect, it, vi } from 'vitest';

const loadVerifier = async () => import('../../../scripts/verify-docs-release.mjs');

describe('docs release verification', () => {
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

    expect(RELEASE_PACKAGES.map(({ name }: { name: string }) => name)).toEqual([
      '@bloklabs/core',
      '@bloklabs/react',
      '@bloklabs/vue',
      '@bloklabs/angular',
      '@bloklabs/cli',
    ]);
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
});
