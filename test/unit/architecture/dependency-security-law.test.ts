import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type Version = readonly [major: number, minor: number, patch: number, prerelease?: string];

interface AdvisoryRule {
  readonly packageName: string;
  readonly advisories: string;
  readonly isVulnerable: (version: Version) => boolean;
}

const comparePrerelease = (left: string | undefined, right: string | undefined): number => {
  if (left === right) {
    return 0;
  }

  if (left === undefined) {
    return 1;
  }

  if (right === undefined) {
    return -1;
  }

  const leftIdentifiers = left.split('.');
  const rightIdentifiers = right.split('.');

  for (let index = 0; index < Math.max(leftIdentifiers.length, rightIdentifiers.length); index += 1) {
    const leftIdentifier = leftIdentifiers[index];
    const rightIdentifier = rightIdentifiers[index];

    if (leftIdentifier === undefined) {
      return -1;
    }

    if (rightIdentifier === undefined) {
      return 1;
    }

    const leftIsNumeric = /^\d+$/.test(leftIdentifier);
    const rightIsNumeric = /^\d+$/.test(rightIdentifier);

    if (leftIsNumeric && rightIsNumeric && leftIdentifier !== rightIdentifier) {
      return Number(leftIdentifier) - Number(rightIdentifier);
    }

    if (leftIsNumeric && rightIsNumeric) {
      continue;
    }

    if (leftIsNumeric) {
      return -1;
    }

    if (rightIsNumeric) {
      return 1;
    }

    if (leftIdentifier !== rightIdentifier) {
      return leftIdentifier < rightIdentifier ? -1 : 1;
    }
  }

  return 0;
};

const compareVersions = (left: Version, right: Version): number => {
  const leftCore: readonly number[] = [left[0], left[1], left[2]];
  const rightCore: readonly number[] = [right[0], right[1], right[2]];

  for (let index = 0; index < leftCore.length; index += 1) {
    const difference = leftCore[index] - rightCore[index];

    if (difference !== 0) {
      return difference;
    }
  }

  return comparePrerelease(left[3], right[3]);
};

const version = (value: string): Version => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);

  if (!match) {
    throw new Error(`Unsupported dependency version: ${value}`);
  }

  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4]];
};

const inRange = (value: Version, minimum: Version, maximum: Version): boolean =>
  compareVersions(value, minimum) >= 0 && compareVersions(value, maximum) <= 0;

const before = (value: Version, maximumExclusive: Version): boolean =>
  compareVersions(value, maximumExclusive) < 0;

const readResolvedVersions = (lockPath: string, packageName: string): string[] => {
  const lines = readFileSync(lockPath, 'utf8').split('\n');
  const header = new RegExp(`^"?${packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}@npm:`);
  const resolved = new Set<string>();
  let matchesPackage = false;

  for (const line of lines) {
    if (line.length > 0 && !line.startsWith(' ')) {
      matchesPackage = header.test(line);
      continue;
    }

    if (!matchesPackage) {
      continue;
    }

    const versionLine = /^  version: (\S+)$/.exec(line);

    if (versionLine) {
      resolved.add(versionLine[1]);
      matchesPackage = false;
    }
  }

  return [...resolved];
};

const ADVISORY_RULES: AdvisoryRule[] = [
  {
    packageName: 'tar',
    advisories: 'GHSA-r292-9mhp-454m, GHSA-w8wr-v893-vjvp, GHSA-23hp-3jrh-7fpw, GHSA-8x88-c5mf-7j5w, GHSA-gvwx-54wh-qm9j',
    isVulnerable: value => compareVersions(value, [7, 5, 20]) <= 0,
  },
  {
    packageName: 'postcss',
    advisories: 'GHSA-r28c-9q8g-f849, GHSA-6g55-p6wh-862q',
    isVulnerable: value => compareVersions(value, [8, 5, 17]) <= 0,
  },
  {
    packageName: 'fast-uri',
    advisories: 'GHSA-v2hh-gcrm-f6hx, GHSA-4c8g-83qw-93j6',
    isVulnerable: value =>
      inRange(value, [2, 3, 1], [2, 4, 2]) ||
      inRange(value, [3, 0, 0], [3, 1, 3]) ||
      inRange(value, [4, 0, 0], [4, 1, 0]),
  },
  {
    packageName: 'immutable',
    advisories: 'GHSA-xvcm-6775-5m9r, GHSA-v56q-mh7h-f735',
    isVulnerable: value =>
      before(value, [4, 3, 9]) ||
      (compareVersions(value, version('5.0.0-beta.1')) >= 0 && before(value, [5, 1, 8])),
  },
  {
    packageName: 'js-yaml',
    advisories: 'GHSA-52cp-r559-cp3m, GHSA-h67p-54hq-rp68',
    isVulnerable: value =>
      before(value, [3, 15, 0]) ||
      (compareVersions(value, [4, 0, 0]) >= 0 && before(value, [4, 3, 0])),
  },
  {
    packageName: 'brace-expansion',
    advisories: 'GHSA-3jxr-9vmj-r5cp',
    isVulnerable: value =>
      before(value, [1, 1, 16]) ||
      (value[0] === 2 && before(value, [2, 1, 2])) ||
      (value[0] >= 3 && before(value, [5, 0, 7])),
  },
  {
    packageName: 'esbuild',
    advisories: 'GHSA-g7r4-m6w7-qqqr',
    isVulnerable: value => compareVersions(value, [0, 27, 3]) >= 0 && before(value, [0, 28, 1]),
  },
  {
    packageName: 'vite',
    advisories: 'GHSA-v6wh-96g9-6wx3, GHSA-fx2h-pf6j-xcff',
    isVulnerable: value =>
      compareVersions(value, [6, 4, 2]) <= 0 ||
      inRange(value, [7, 0, 0], [7, 3, 4]) ||
      inRange(value, [8, 0, 0], [8, 0, 15]),
  },
  {
    packageName: '@babel/core',
    advisories: 'GHSA-4x5r-pxfx-6jf8',
    isVulnerable: value =>
      compareVersions(value, [7, 29, 0]) <= 0 ||
      (compareVersions(value, version('8.0.0-alpha.0')) >= 0 && before(value, version('8.0.0-rc.5'))),
  },
  {
    packageName: 'react-router',
    advisories: 'GHSA-qwww-vcr4-c8h2, GHSA-chx6-hx7r-mcp5, GHSA-wrjc-x8rr-h8h6, GHSA-h8fp-f39c-q6mh, GHSA-337j-9hxr-rhxg',
    isVulnerable: value => compareVersions(value, [6, 0, 0]) >= 0 && before(value, [8, 3, 0]),
  },
  {
    packageName: 'undici',
    advisories: 'GHSA-g8m3-5g58-fq7m, GHSA-p88m-4jfj-68fv, GHSA-hm92-r4w5-c3mj, GHSA-35p6-xmwp-9g52, GHSA-vmh5-mc38-953g, GHSA-pr7r-676h-xcf6',
    isVulnerable: value =>
      before(value, [6, 27, 0]) ||
      (compareVersions(value, [7, 0, 0]) >= 0 && before(value, [7, 28, 0])) ||
      (compareVersions(value, [8, 0, 0]) >= 0 && before(value, [8, 5, 0])),
  },
];

const ROOT_RULES = ADVISORY_RULES;
const DOCS_RULES = ADVISORY_RULES;

const findVulnerableResolutions = (lockPath: string, rules: AdvisoryRule[]): string[] =>
  rules.flatMap(rule =>
    readResolvedVersions(lockPath, rule.packageName)
      .filter(resolvedVersion => rule.isVulnerable(version(resolvedVersion)))
      .map(resolvedVersion => `${rule.packageName}@${resolvedVersion} (${rule.advisories})`)
  );

const findSourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return findSourceFiles(path);
    }

    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  });

const ADVISORY_BOUNDARIES = [
  { packageName: 'tar', vulnerable: ['7.5.20'], patched: ['7.5.21'] },
  { packageName: 'postcss', vulnerable: ['8.5.17'], patched: ['8.5.18'] },
  {
    packageName: 'fast-uri',
    vulnerable: ['2.4.2', '3.1.3', '4.1.0'],
    patched: ['2.4.3', '3.1.4', '4.1.1'],
  },
  {
    packageName: 'immutable',
    vulnerable: ['4.3.8', '5.0.0-beta.1', '5.1.7'],
    patched: ['4.3.9', '5.0.0-alpha.1', '5.1.8'],
  },
  {
    packageName: 'js-yaml',
    vulnerable: ['3.14.1', '4.2.9'],
    patched: ['3.15.0', '4.3.0'],
  },
  {
    packageName: 'brace-expansion',
    vulnerable: ['0.0.0', '1.1.15', '2.1.1', '3.0.0', '5.0.6'],
    patched: ['1.1.16', '2.1.2', '5.0.7'],
  },
  {
    packageName: 'esbuild',
    vulnerable: ['0.27.3', '0.28.0'],
    patched: ['0.27.2', '0.28.1'],
  },
  {
    packageName: 'vite',
    vulnerable: ['6.4.2', '7.3.4', '8.0.15'],
    patched: ['6.4.3', '7.3.5', '8.0.16'],
  },
  {
    packageName: '@babel/core',
    vulnerable: ['7.29.0', '8.0.0-alpha.0', '8.0.0-rc.4'],
    patched: ['7.29.6', '8.0.0-rc.6'],
  },
  {
    packageName: 'react-router',
    vulnerable: ['6.0.0', '7.11.0', '7.18.0', '8.2.9'],
    patched: ['5.3.4', '8.3.0'],
  },
  {
    packageName: 'undici',
    vulnerable: ['6.26.0', '7.27.2', '8.4.0'],
    patched: ['6.27.0', '7.28.0', '8.5.0'],
  },
] as const;

describe('dependency security law', () => {
  it('keeps the root dependency graph outside known vulnerable ranges', () => {
    const lockPath = join(__dirname, '../../../yarn.lock');

    expect(findVulnerableResolutions(lockPath, ROOT_RULES)).toEqual([]);
  });

  it('keeps the docs dependency graph outside known vulnerable ranges', () => {
    const lockPath = join(__dirname, '../../../docs/yarn.lock');

    expect(findVulnerableResolutions(lockPath, DOCS_RULES)).toEqual([]);
  });

  it('applies every advisory rule to both lockfiles', () => {
    const rootPackages = new Set(ROOT_RULES.map(rule => rule.packageName));
    const docsPackages = new Set(DOCS_RULES.map(rule => rule.packageName));

    expect(ROOT_RULES.filter(rule => !docsPackages.has(rule.packageName))).toEqual([]);
    expect(DOCS_RULES.filter(rule => !rootPackages.has(rule.packageName))).toEqual([]);
  });

  it.each(ADVISORY_BOUNDARIES)(
    'encodes every affected $packageName release line and patched boundary',
    ({ packageName, vulnerable, patched }) => {
      const rule = [...ROOT_RULES, ...DOCS_RULES].find(candidate => candidate.packageName === packageName) ??
        (() => { throw new Error(`Missing advisory rule for ${packageName}`); })();

      expect(vulnerable.filter(value => !rule.isVulnerable(version(value)))).toEqual([]);
      expect(patched.filter(value => rule.isVulnerable(version(value)))).toEqual([]);
    }
  );

  it('uses SemVer ASCII ordering for prerelease identifiers', () => {
    expect(compareVersions(version('1.0.0-ALPHA'), version('1.0.0-alpha'))).toBeLessThan(0);
  });

  it('keeps docs source imports on the React Router 8 package surface', () => {
    const sourceDirectory = join(__dirname, '../../../docs/src');
    const legacyImports = findSourceFiles(sourceDirectory)
      .filter(filePath => readFileSync(filePath, 'utf8').includes('react-router-dom'))
      .map(filePath => filePath.slice(sourceDirectory.length + 1));

    expect(legacyImports).toEqual([]);
  });
});
