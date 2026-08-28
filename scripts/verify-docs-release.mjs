import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { isReleaseVersion } from './release-version.mjs';

export const RELEASE_PACKAGES = [
  { name: '@bloklabs/core', manifestPath: 'package.json' },
  { name: '@bloklabs/react', manifestPath: 'packages/react/package.json' },
  { name: '@bloklabs/vue', manifestPath: 'packages/vue/package.json' },
  { name: '@bloklabs/angular', manifestPath: 'packages/angular/package.json' },
  { name: '@bloklabs/cli', manifestPath: 'packages/cli/package.json' },
  { name: '@bloklabs/presets', manifestPath: 'packages/presets/package.json' },
  { name: '@bloklabs/server', manifestPath: 'packages/server/package.json' },
];

export const SERVER_NUGET_PACKAGES = [
  'Blok.Server',
  'Blok.Server.AspNetCore',
];

export const SERVER_RELEASE_ASSETS = [
  'blok-server_darwin_amd64.tar.gz',
  'blok-server_darwin_arm64.tar.gz',
  'blok-server_linux_amd64.tar.gz',
  'blok-server_linux_arm64.tar.gz',
  'blok-server_linux_musl_amd64.tar.gz',
  'blok-server_linux_musl_arm64.tar.gz',
  'blok-server_windows_amd64.zip',
  'blok-server_windows_arm64.zip',
  'checksums.txt',
];

const GHCR_MANIFEST_ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

export function releaseVersionFromTag(tag) {
  const version = tag.startsWith('v') ? tag.slice(1) : '';

  if (!isReleaseVersion(version)) {
    throw new Error(`Invalid package release tag: ${tag}`);
  }

  return version;
}

export function assertLockstepManifestVersions(version, manifests) {
  const mismatches = manifests
    .filter((manifest) => manifest.version !== version)
    .map((manifest) => `${manifest.name} has version ${manifest.version}`);

  if (mismatches.length > 0) {
    throw new Error(`Package manifests do not match ${version}: ${mismatches.join('; ')}`);
  }
}

const waitFor = (milliseconds) => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

export async function lookupNpmVersion(name, version) {
  const packagePath = encodeURIComponent(name);
  const versionPath = encodeURIComponent(version);
  const response = await fetch(`https://registry.npmjs.org/${packagePath}/${versionPath}`, {
    headers: { accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`npm registry returned ${response.status}`);
  }

  const manifest = await response.json();

  return manifest.version;
}

export async function lookupNuGetVersion(packageId, version, fetchImpl = fetch) {
  const packagePath = packageId.toLowerCase();
  const response = await fetchImpl(
    `https://api.nuget.org/v3-flatcontainer/${packagePath}/index.json`,
    { headers: { accept: 'application/json' } },
  );

  if (!response.ok) {
    throw new Error(`NuGet registry returned ${response.status}`);
  }

  const index = await response.json();
  const versions = Array.isArray(index.versions) ? index.versions : [];
  const publishedVersion = versions.find((candidate) => candidate === version);

  if (publishedVersion === undefined) {
    throw new Error('version not found');
  }

  return publishedVersion;
}

export async function lookupGitHubReleaseAssets(tag, fetchImpl = fetch) {
  const response = await fetchImpl(
    `https://api.github.com/repos/JackUait/blok/releases/tags/${encodeURIComponent(tag)}`,
    {
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      },
    },
  );

  if (!response.ok) {
    throw new Error(`GitHub release API returned ${response.status}`);
  }

  const release = await response.json();

  if (!Array.isArray(release.assets)) {
    throw new Error('GitHub release assets are missing');
  }

  return release.assets
    .map((asset) => asset?.name)
    .filter((name) => typeof name === 'string');
}

export async function lookupGhcrVersion(version, fetchImpl = fetch) {
  const manifestUrl =
    `https://ghcr.io/v2/jackuait/blok-server/manifests/${encodeURIComponent(version)}`;
  const manifestHeaders = { accept: GHCR_MANIFEST_ACCEPT };
  let response = await fetchImpl(manifestUrl, { headers: manifestHeaders });

  if (response.status === 401) {
    const tokenUrl =
      'https://ghcr.io/token?service=ghcr.io&scope=repository%3Ajackuait%2Fblok-server%3Apull';
    const tokenResponse = await fetchImpl(tokenUrl, {
      headers: { accept: 'application/json' },
    });

    if (!tokenResponse.ok) {
      throw new Error(`GHCR token service returned ${tokenResponse.status}`);
    }

    const tokenBody = await tokenResponse.json();
    const token = typeof tokenBody.token === 'string'
      ? tokenBody.token
      : tokenBody.access_token;

    if (typeof token !== 'string' || token.length === 0) {
      throw new Error('GHCR token service returned no token');
    }

    response = await fetchImpl(manifestUrl, {
      headers: {
        ...manifestHeaders,
        authorization: `Bearer ${token}`,
      },
    });
  }

  if (!response.ok) {
    throw new Error(`GHCR registry returned ${response.status}`);
  }

  return version;
}

export async function verifyPublishedPackageVersions(version, {
  attempts = 6,
  lookupVersion = lookupNpmVersion,
  onRetry = () => {},
  packageNames = RELEASE_PACKAGES.map(({ name }) => name),
  retryDelayMs = 10_000,
  wait = waitFor,
} = {}) {
  let failures = [];

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const results = await Promise.all(packageNames.map(async (name) => {
      try {
        const publishedVersion = await lookupVersion(name, version);

        return publishedVersion === version
          ? null
          : `${name} published ${publishedVersion}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        return `${name} unavailable (${message})`;
      }
    }));

    failures = results.filter((result) => result !== null);

    if (failures.length === 0) {
      return;
    }

    if (attempt < attempts) {
      onRetry({ attempt, failures });
      await wait(retryDelayMs);
    }
  }

  throw new Error(`Package release ${version} is not fully published: ${failures.join('; ')}`);
}

export async function verifyPublishedServerDelivery(version, {
  attempts = 12,
  lookupNuGetVersion: lookupNuGet = lookupNuGetVersion,
  lookupReleaseAssets = lookupGitHubReleaseAssets,
  lookupContainerVersion = lookupGhcrVersion,
  nugetPackageIds = SERVER_NUGET_PACKAGES,
  onRetry = () => {},
  requiredAssets = SERVER_RELEASE_ASSETS,
  retryDelayMs = 10_000,
  wait = waitFor,
} = {}) {
  let failures = [];

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    failures = [];

    for (const packageId of nugetPackageIds) {
      try {
        const publishedVersion = await lookupNuGet(packageId, version);

        if (publishedVersion !== version) {
          failures.push(`${packageId} published ${publishedVersion}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        failures.push(`${packageId} unavailable (${message})`);
      }
    }

    try {
      const assets = await lookupReleaseAssets(`v${version}`);
      const missingAssets = requiredAssets.filter((name) => !assets.includes(name));

      if (missingAssets.length > 0) {
        failures.push(`missing release assets: ${missingAssets.join(', ')}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      failures.push(`release assets unavailable (${message})`);
    }

    try {
      const publishedVersion = await lookupContainerVersion(version);

      if (publishedVersion !== version) {
        failures.push(
          `ghcr.io/jackuait/blok-server:${version} resolved ${publishedVersion}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      failures.push(
        `ghcr.io/jackuait/blok-server:${version} unavailable (${message})`,
      );
    }

    if (failures.length === 0) {
      return;
    }

    if (attempt < attempts) {
      onRetry({ attempt, failures });
      await wait(retryDelayMs);
    }
  }

  throw new Error(
    `Server delivery ${version} is not fully published: ${failures.join('; ')}`,
  );
}

export async function verifyDocsRelease(tag) {
  const version = releaseVersionFromTag(tag);
  const manifests = RELEASE_PACKAGES.map(({ name, manifestPath }) => {
    const manifestUrl = new URL(`../${manifestPath}`, import.meta.url);
    const manifest = JSON.parse(readFileSync(manifestUrl, 'utf-8'));

    return { name, version: manifest.version };
  });

  assertLockstepManifestVersions(version, manifests);
  await verifyPublishedPackageVersions(version, {
    onRetry: ({ attempt, failures }) => {
      console.warn(
        `Package registry verification attempt ${attempt} failed: ${failures.join('; ')}`,
      );
    },
  });
  await verifyPublishedServerDelivery(version, {
    onRetry: ({ attempt, failures }) => {
      console.warn(
        `Server delivery verification attempt ${attempt} failed: ${failures.join('; ')}`,
      );
    },
  });

  return version;
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const tag = process.argv[2];

  if (!tag) {
    console.error('Usage: node scripts/verify-docs-release.mjs <release-tag>');
    process.exitCode = 1;
  } else {
    try {
      const version = await verifyDocsRelease(tag);

      console.log(`Verified published package family and server delivery ${version}.`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }
}
