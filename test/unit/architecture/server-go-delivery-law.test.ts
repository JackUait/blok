// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

import { resolveTarget } from '../../../packages/server/bin/blok-server.mjs';
import { CHECKSUMS_FILE, GO_TARGETS } from '../../../scripts/publish-server-go.mjs';
import { TARGETS } from '../../../scripts/publish-server.mjs';

type Step = { name?: string; run?: string; uses?: string; with?: Record<string, string> };
type Workflow = {
  on?: { push?: { tags?: string[] } } | string | string[];
  jobs: Record<string, { steps?: Step[] }>;
};

const repoRoot = resolve(import.meta.dirname, '../../..');
const read = (path: string): string => readFileSync(resolve(repoRoot, path), 'utf8');
const RELEASE_WORKFLOW = '.github/workflows/release-server.yml';
const WRAPPER = 'packages/server/bin/blok-server.mjs';
const SETUP_GO_ACTION = 'actions/setup-go@b7ad1dad31e06c5925ef5d2fc7ad053ef454303e';
const GO_ARCHIVES = [
  'blok-server-go_darwin_amd64.tar.gz',
  'blok-server-go_darwin_arm64.tar.gz',
  'blok-server-go_linux_amd64.tar.gz',
  'blok-server-go_linux_arm64.tar.gz',
  'blok-server-go_windows_amd64.zip',
  'blok-server-go_windows_arm64.zip',
];

/** Every archive name the wrapper can resolve, on every platform it knows. */
const wrapperArchives = (resolve: typeof resolveTarget): string[] =>
  ['darwin', 'linux', 'win32', 'freebsd'].flatMap((platform) =>
    ['x64', 'arm64', 'ia32'].flatMap((arch) =>
      (['glibc', 'musl'] as const).flatMap((libc) => {
        const target = resolve(platform, arch, libc);

        return target === null ? [] : [target.archive];
      })));

/** The wrapper source names a Go archive or the Go checksums file. */
const wrapperNamesGo = (source: string): boolean =>
  /blok-server-go|checksums-go/.test(source);

const releaseSteps = (source: string): Step[] =>
  (parse(source) as Workflow).jobs['release-server']?.steps ?? [];

const stepRun = (steps: Step[], name: string): string =>
  steps.find((step) => step.name === name)?.run ?? '';

/** GitHub's tag filter glob: `*` stops at `/`, `**` does not. */
const globMatches = (pattern: string, ref: string): boolean => {
  const expression = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*');

  return new RegExp(`^${expression}$`).test(ref);
};

describe('server Go delivery law', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('the npm wrapper runs the C# host only', () => {
    it('never resolves a Go archive', () => {
      const archives = wrapperArchives(resolveTarget);

      expect(archives).toEqual(expect.arrayContaining(TARGETS.map((target) => target.archive)));
      expect(archives.filter((name) => GO_ARCHIVES.includes(name))).toEqual([]);
      expect(archives.filter((name) => name.startsWith('blok-server-go_'))).toEqual([]);
    });

    it('never names a Go archive or the Go checksums file', () => {
      expect(wrapperNamesGo(read(WRAPPER))).toBe(false);
    });

    describe('catches controlled mutations', () => {
      it('a wrapper that resolves the Go archive name', () => {
        const goWrapper: typeof resolveTarget = (platform, arch, libc) => {
          const target = resolveTarget(platform, arch, libc);

          return target === null ? null : { ...target, archive: target.archive.replace('blok-server_', 'blok-server-go_') };
        };

        expect(wrapperArchives(goWrapper).filter((name) => GO_ARCHIVES.includes(name))).not.toEqual([]);
      });

      it('a wrapper that reads the Go checksums file', () => {
        expect(wrapperNamesGo("const CHECKSUMS_FILE = 'checksums-go.txt';")).toBe(true);
        expect(wrapperNamesGo("const CHECKSUMS_FILE = 'checksums.txt';")).toBe(false);
      });
    });
  });

  describe('the Go archive set', () => {
    it('is exactly six archives and checksums-go.txt, apart from every C# name', () => {
      expect(GO_TARGETS.map((target) => target.archive)).toEqual(GO_ARCHIVES);
      expect(CHECKSUMS_FILE).toBe('checksums-go.txt');
      expect(GO_ARCHIVES.filter((name) => TARGETS.some((target) => target.archive === name))).toEqual([]);
    });

    it('is built, smoked, uploaded and verified by the release workflow', () => {
      const source = read(RELEASE_WORKFLOW);
      const steps = releaseSteps(source);
      const names = steps.map((step) => step.name ?? '');
      const build = stepRun(steps, 'Build Go host artifacts');
      const upload = stepRun(steps, 'Upload release assets');
      const verify = stepRun(steps, 'Verify published server delivery');
      const requiredAssets = /required_assets=\(([\s\S]*?)\)/.exec(verify)?.[1] ?? '';

      expect(steps.find((step) => step.name === 'Setup Go')).toMatchObject({
        uses: SETUP_GO_ACTION,
        with: {
          'go-version-file': 'packages/server/go/go.mod',
          'cache-dependency-path': 'packages/server/go/go.sum',
        },
      });
      expect(build).toContain('node scripts/publish-server-go.mjs --version "$BLOK_SERVER_VERSION" --output .server-release-dist');
      for (const name of [...GO_ARCHIVES, CHECKSUMS_FILE]) {
        expect(upload).toContain(`.server-release-dist/${name}`);
        expect(requiredAssets.split(/\s+/)).toContain(name);
      }

      const order = [
        'Wait for successful CI',
        'Test and vet Go server',
        'Build Go host artifacts',
        'Smoke Go archives',
        'Publish NuGet packages',
        'Upload release assets',
        'Verify published server delivery',
        'Publish the draft GitHub release',
      ].map((name) => names.indexOf(name));

      expect(order.every((index) => index >= 0)).toBe(true);
      expect([...order].sort((left, right) => left - right)).toEqual(order);
    });

    it('smokes the stamped version and the linux archive on Alpine', () => {
      const smoke = stepRun(releaseSteps(read(RELEASE_WORKFLOW)), 'Smoke Go archives');

      expect(smoke).toContain('blok-server-go_linux_amd64.tar.gz');
      expect(smoke).toContain('{\\"status\\":\\"ok\\",\\"version\\":\\"$BLOK_SERVER_VERSION\\"}');
      expect(smoke).toMatch(/docker run --rm --platform linux\/amd64[\s\S]*alpine:/);
    });
  });

  describe('the Go module tag', () => {
    const goTag = 'packages/server/go/v1.17.0';

    it('starts no tag-triggered workflow', () => {
      const directory = resolve(repoRoot, '.github/workflows');
      const matching = readdirSync(directory)
        .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
        .flatMap((name) => {
          const on = (parse(read(join('.github/workflows', name))) as Workflow).on;
          const tags = typeof on === 'object' && !Array.isArray(on) ? on.push?.tags ?? [] : [];

          return tags.filter((pattern) => globMatches(pattern, goTag)).map((pattern) => `${name}: ${pattern}`);
        });

      expect(matching).toEqual([]);
    });

    it('catches a filter that would match it', () => {
      expect(globMatches('v*', goTag)).toBe(false);
      expect(globMatches('v*', 'v1.17.0')).toBe(true);
      expect(globMatches('**', goTag)).toBe(true);
      expect(globMatches('packages/*/go/v*', goTag)).toBe(true);
    });
  });
});
