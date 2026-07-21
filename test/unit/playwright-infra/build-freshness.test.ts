import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BUILD_INPUTS,
  REQUIRED_TEST_ARTIFACTS,
  isTestBuildFresh,
} from '../../playwright/build-freshness';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Creates a file (and its parent dirs) with the given mtime offset from a
 * fixed epoch, so tests control relative recency without sleeping.
 */
const writeFileAt = (root: string, relPath: string, mtimeMs: number): void => {
  const filePath = join(root, relPath);

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, 'x');
  utimesSync(filePath, new Date(mtimeMs), new Date(mtimeMs));
};

describe('isTestBuildFresh', () => {
  let root: string;
  const epoch = Date.now() - 24 * HOUR_MS;

  const writeAllArtifacts = (mtimeMs: number): void => {
    for (const artifact of REQUIRED_TEST_ARTIFACTS) {
      writeFileAt(root, artifact, mtimeMs);
    }
  };

  const writeAllInputs = (mtimeMs: number): void => {
    for (const input of BUILD_INPUTS) {
      // Directory inputs get a representative file; file inputs are written as-is.
      const isDir = !input.includes('.');

      writeFileAt(root, isDir ? join(input, 'file.ts') : input, mtimeMs);
      if (isDir) {
        utimesSync(join(root, input), new Date(mtimeMs), new Date(mtimeMs));
      }
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    root = mkdtempSync(join(tmpdir(), 'blok-freshness-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it('reports stale when any required artifact is missing', () => {
    writeAllInputs(epoch);
    writeAllArtifacts(epoch + HOUR_MS);
    rmSync(join(root, REQUIRED_TEST_ARTIFACTS[0]));

    expect(isTestBuildFresh(root)).toBe(false);
  });

  it('reports fresh when every artifact exists and is newer than every input', () => {
    writeAllInputs(epoch);
    writeAllArtifacts(epoch + HOUR_MS);

    expect(isTestBuildFresh(root)).toBe(true);
  });

  it('reports stale when a source file is newer than the oldest artifact', () => {
    writeAllInputs(epoch);
    writeAllArtifacts(epoch + HOUR_MS);
    writeFileAt(root, join('src', 'blok.ts'), epoch + 2 * HOUR_MS);

    expect(isTestBuildFresh(root)).toBe(false);
  });

  it('reports stale when an adapter source is newer than the oldest artifact', () => {
    writeAllInputs(epoch);
    writeAllArtifacts(epoch + HOUR_MS);
    writeFileAt(root, join('packages', 'react', 'src', 'useBlok.ts'), epoch + 2 * HOUR_MS);

    expect(isTestBuildFresh(root)).toBe(false);
  });

  it('reports stale when an adapter build config is newer than the oldest artifact', () => {
    writeAllInputs(epoch);
    writeAllArtifacts(epoch + HOUR_MS);
    writeFileAt(root, join('packages', 'react', 'vite.config.mjs'), epoch + 2 * HOUR_MS);

    expect(isTestBuildFresh(root)).toBe(false);
  });

  it('reports stale when an adapter package.json is newer than the oldest artifact', () => {
    writeAllInputs(epoch);
    writeAllArtifacts(epoch + HOUR_MS);
    writeFileAt(root, join('packages', 'vue', 'package.json'), epoch + 2 * HOUR_MS);

    expect(isTestBuildFresh(root)).toBe(false);
  });

  it('ignores build outputs under packages/*/dist so a finished build stays fresh', () => {
    writeAllInputs(epoch);
    writeAllArtifacts(epoch + HOUR_MS);
    // ng-packagr writes more into packages/angular/dist after the oldest
    // artifact lands; that is output, not input.
    writeFileAt(root, join('packages', 'angular', 'dist', 'fesm2022', 'blok.mjs'), epoch + 2 * HOUR_MS);

    expect(isTestBuildFresh(root)).toBe(true);
  });

  it('ignores the directory mtime bump that writing dist/ causes in its parent', () => {
    writeAllInputs(epoch);
    writeAllArtifacts(epoch + HOUR_MS);
    // Creating packages/angular/dist bumps packages/angular's own mtime;
    // that must not count as an input change or e2e would rebuild forever.
    utimesSync(
      join(root, 'packages', 'angular'),
      new Date(epoch + 2 * HOUR_MS),
      new Date(epoch + 2 * HOUR_MS)
    );

    expect(isTestBuildFresh(root)).toBe(true);
  });

  it('stays fresh when a watched input path does not exist', () => {
    writeAllInputs(epoch);
    writeAllArtifacts(epoch + HOUR_MS);
    rmSync(join(root, 'scripts'), { recursive: true, force: true });

    expect(isTestBuildFresh(root)).toBe(true);
  });

  it('covers the bundles the e2e fixtures actually load', () => {
    // test.html loads dist/blok.mjs + dist/tools.mjs; adapter fixtures load
    // the workspace dists and the vendor bundles; iife/umd/locales have
    // dedicated specs. A missing entry here means a stale-artifact run.
    for (const expected of [
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
    ]) {
      expect(REQUIRED_TEST_ARTIFACTS, `${expected} must be a required artifact`).toContain(expected);
    }
  });

  it('watches every build input that shapes the test bundles', () => {
    for (const expected of [
      'src',
      // Whole workspace tree, not per-package hand-picks: build configs,
      // package.json and tsconfig files shape the adapter bundles too.
      'packages',
      'scripts',
      'vite.config.mjs',
      'vite.config.iife.mjs',
      'vite.config.umd.mjs',
      'package.json',
      'tsconfig.json',
      'yarn.lock',
    ]) {
      expect(BUILD_INPUTS, `${expected} must be a watched input`).toContain(expected);
    }
  });

  it('watches every root vite config that exists in the repo', () => {
    // Drift guard for the one part of BUILD_INPUTS still hand-maintained.
    // Adding vite.config.<x>.mjs without listing it here would silently test
    // a stale bundle.
    const repoRoot = resolve(__dirname, '..', '..', '..');
    const rootViteConfigs = readdirSync(repoRoot).filter((name) =>
      /^vite\.config(\..+)?\.mjs$/.test(name)
    );

    expect(rootViteConfigs.length).toBeGreaterThan(0);
    for (const config of rootViteConfigs) {
      expect(BUILD_INPUTS, `${config} must be a watched input`).toContain(config);
    }
  });
});
