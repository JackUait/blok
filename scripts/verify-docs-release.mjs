import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const RELEASE_PACKAGES = [
  { name: '@bloklabs/core', manifestPath: 'package.json' },
  { name: '@bloklabs/react', manifestPath: 'packages/react/package.json' },
  { name: '@bloklabs/vue', manifestPath: 'packages/vue/package.json' },
  { name: '@bloklabs/angular', manifestPath: 'packages/angular/package.json' },
  { name: '@bloklabs/cli', manifestPath: 'packages/cli/package.json' },
];

const RELEASE_TAG_PATTERN = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)$/;

export function releaseVersionFromTag(tag) {
  const match = RELEASE_TAG_PATTERN.exec(tag);

  if (!match) {
    throw new Error(`Invalid package release tag: ${tag}`);
  }

  return match[1];
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

      console.log(`Verified published package family ${version}.`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }
}
