import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * One artifact per build:test step, chosen from the bundles the e2e fixtures
 * actually load. If ANY is missing the test build must run; freshness is
 * compared against the OLDEST of them so a partially completed build never
 * reads as fresh.
 */
export const REQUIRED_TEST_ARTIFACTS: string[] = [
  'dist/blok.mjs',
  'dist/tools.mjs',
  'dist/locales.mjs',
  'dist/blok.iife.js',
  'dist/blok.umd.js',
  'packages/react/dist/index.mjs',
  'packages/vue/dist/index.mjs',
  'packages/angular/dist/package.json',
  'test/playwright/fixtures/vendor/react.mjs',
  'test/playwright/fixtures/vendor/vue.mjs',
  'test/playwright/fixtures/vendor/angular/app.mjs',
];

/**
 * Every source tree and config that shapes the test bundles. A file newer
 * than the oldest artifact anywhere in these trees means a rebuild.
 */
export const BUILD_INPUTS: string[] = [
  'src',
  'packages/react/src',
  'packages/vue/src',
  'packages/angular/src',
  'scripts',
  'vite.config.mjs',
  'vite.config.iife.mjs',
  'vite.config.umd.mjs',
  'package.json',
  'tsconfig.json',
  'yarn.lock',
];

/**
 * Most recent modification time in a file or directory tree.
 */
const getMtime = (targetPath: string): number => {
  if (!existsSync(targetPath)) {
    return 0;
  }

  const stats = statSync(targetPath);

  if (stats.isFile()) {
    return stats.mtimeMs;
  }

  if (stats.isDirectory()) {
    let maxMtime = stats.mtimeMs;
    const entries = readdirSync(targetPath, { withFileTypes: true });

    for (const entry of entries) {
      // eslint-disable-next-line max-depth
      if (entry.name === 'node_modules' || entry.name === '.git') {
        continue;
      }
      maxMtime = Math.max(maxMtime, getMtime(path.resolve(targetPath, entry.name)));
    }

    return maxMtime;
  }

  return 0;
};

/**
 * True when every test-build artifact exists and none of the build inputs
 * changed after the oldest artifact was written.
 */
export const isTestBuildFresh = (projectRoot: string): boolean => {
  let oldestArtifactMtime = Infinity;

  for (const artifact of REQUIRED_TEST_ARTIFACTS) {
    const artifactPath = path.resolve(projectRoot, artifact);

    if (!existsSync(artifactPath)) {
      return false;
    }
    oldestArtifactMtime = Math.min(oldestArtifactMtime, statSync(artifactPath).mtimeMs);
  }

  return BUILD_INPUTS.every(
    (input) => getMtime(path.resolve(projectRoot, input)) <= oldestArtifactMtime
  );
};
