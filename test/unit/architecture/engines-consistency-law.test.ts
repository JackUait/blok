import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

/**
 * ENGINES CONSISTENCY LAW
 *
 * A published package's `engines.node` range is a promise to consumers: "install me on any
 * Node in this range and it will work". npm enforces it transitively — if a runtime dependency
 * rejects the Node version the consumer is on, they get EBADENGINE even though OUR range said
 * yes. So a package's declared range MUST be a subset of the intersection of every runtime
 * dependency's range.
 *
 * This drifted once already: packages/cli declared `>=20.19.0` while its only runtime dep
 * (jsdom 29) declares `^20.19.0 || ^22.13.0 || >=24.0.0`, so Node 21.x and 23.x consumers hit
 * EBADENGINE. Nothing checked it, which is why nobody noticed.
 *
 * Deliberately zero-dependency (no `semver` import) — the repo does not declare semver as a
 * direct dependency, and this invariant must stay checkable in a no-install context.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

type Version = [number, number, number];

const parseVersion = (raw: string): Version => {
  const parts = raw.trim().replace(/^v/, '').split('.');
  const nums = [ 0, 1, 2 ].map((index) => {
    const value = Number.parseInt(parts[index] ?? '0', 10);

    return Number.isNaN(value) ? 0 : value;
  });

  return [ nums[0], nums[1], nums[2] ];
};

const compare = (a: Version, b: Version): number => {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1;
    }
  }

  return 0;
};

/**
 * Evaluates a single comparator (`>=20.19.0`, `^22.13.0`, `<23`, `*`, …) against a version.
 */
const satisfiesComparator = (version: Version, comparator: string): boolean => {
  const token = comparator.trim();

  if (token === '' || token === '*' || token === 'x') {
    return true;
  }

  const match = /^(>=|<=|>|<|=|\^|~)?\s*v?(.+)$/.exec(token);

  if (match === null) {
    throw new Error(`Unsupported version comparator: "${comparator}"`);
  }

  const operator = match[1] ?? '=';
  const bound = parseVersion(match[2]);
  const diff = compare(version, bound);

  switch (operator) {
    case '>=': return diff >= 0;
    case '>': return diff > 0;
    case '<=': return diff <= 0;
    case '<': return diff < 0;
    case '=': return diff === 0;
    case '^': {
      const upper: Version = bound[0] > 0
        ? [ bound[0] + 1, 0, 0 ]
        : [ 0, bound[1] + 1, 0 ];

      return diff >= 0 && compare(version, upper) < 0;
    }
    case '~': return diff >= 0 && compare(version, [ bound[0], bound[1] + 1, 0 ]) < 0;
    default: throw new Error(`Unsupported version comparator: "${comparator}"`);
  }
};

const satisfiesRange = (version: Version, range: string): boolean =>
  range.split('||').some((clause) =>
    clause.trim().split(/\s+/).every((comparator) => satisfiesComparator(version, comparator)));

/**
 * Node versions probed for membership. Covers every major from 18 to 30 plus the minor
 * boundaries real engines ranges are written against (`.13`, `.19`).
 */
const candidateVersions = (): Version[] => {
  const versions: Version[] = [];

  for (let major = 18; major <= 30; major++) {
    for (const [ minor, patch ] of [ [ 0, 0 ], [ 12, 0 ], [ 13, 0 ], [ 18, 3 ], [ 19, 0 ], [ 99, 0 ] ]) {
      versions.push([ major, minor, patch ]);
    }
  }

  return versions;
};

const readManifest = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;

/**
 * Resolves an installed dependency's manifest, checking the package-local node_modules first
 * (workspaces can install non-hoisted copies) then the hoisted root.
 */
const readInstalledDependency = (packageDir: string, name: string): Record<string, unknown> | null => {
  for (const base of [ join(packageDir, 'node_modules'), join(repoRoot, 'node_modules') ]) {
    const manifestPath = join(base, ...name.split('/'), 'package.json');

    if (existsSync(manifestPath)) {
      return readManifest(manifestPath);
    }
  }

  return null;
};

const publishedPackages = [ 'cli', 'react', 'vue', 'angular' ].map((name) => ({
  name,
  dir: join(repoRoot, 'packages', name),
}));

describe('engines consistency law', () => {
  describe('range helper', () => {
    it.each([
      [ '>=20.19.0', '20.19.0', true ],
      [ '>=20.19.0', '20.18.3', false ],
      [ '^20.19.0 || ^22.13.0 || >=24.0.0', '21.0.0', false ],
      [ '^20.19.0 || ^22.13.0 || >=24.0.0', '22.12.0', false ],
      [ '^20.19.0 || ^22.13.0 || >=24.0.0', '22.13.0', true ],
      [ '^20.19.0 || ^22.13.0 || >=24.0.0', '23.99.0', false ],
      [ '^20.19.0 || ^22.13.0 || >=24.0.0', '26.0.0', true ],
      [ '>=20 <23', '22.0.0', true ],
      [ '>=20 <23', '23.0.0', false ],
    ])('%s vs %s', (range, version, expected) => {
      expect(satisfiesRange(parseVersion(version), range)).toBe(expected);
    });
  });

  it.each(publishedPackages)('$name declares no Node version its runtime deps reject', ({ dir }) => {
    const manifest = readManifest(join(dir, 'package.json'));
    const engines = manifest.engines as { node?: string } | undefined;
    const declared = engines?.node;
    const dependencies = (manifest.dependencies ?? {}) as Record<string, string>;
    const depNames = Object.keys(dependencies);

    if (depNames.length === 0) {
      return;
    }

    expect(
      declared,
      `${String(manifest.name)} ships runtime dependencies but declares no engines.node`
    ).toBeTypeOf('string');

    const violations: string[] = [];

    for (const depName of depNames) {
      const depManifest = readInstalledDependency(dir, depName);

      expect(depManifest, `${depName} is not installed — cannot verify engines`).not.toBeNull();

      const depRange = (depManifest?.engines as { node?: string } | undefined)?.node;

      if (depRange === undefined) {
        continue;
      }

      const rejected = candidateVersions()
        .filter((version) => satisfiesRange(version, declared as string))
        .filter((version) => !satisfiesRange(version, depRange))
        .map((version) => version.join('.'));

      if (rejected.length > 0) {
        violations.push(
          `${depName} requires "${depRange}" but our "${String(declared)}" admits ${rejected.join(', ')}`
        );
      }
    }

    expect(violations, violations.join('\n')).toEqual([]);
  });
});
