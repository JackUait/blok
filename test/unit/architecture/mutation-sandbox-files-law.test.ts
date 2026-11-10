// @vitest-environment node
/**
 * Stryker runs the unit tests in a copy of the repo that leaves out everything
 * `ignorePatterns` in stryker.config.json matches. A test that reads a left-out
 * file dies with ENOENT in the dry run, and the whole Mutation job goes red.
 *
 * This reads the paths a test names as string literals. A path built from
 * pieces (`join(ROOT, 'docs', name)`) is out of its reach.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, normalize, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildImporterIndex } from '../../../scripts/mutation-scope.mjs';

type Rule = { negate: boolean; match: (path: string, partial?: boolean) => boolean };
type MinimatchModule = {
  Minimatch: new (pattern: string, options: Record<string, boolean>) => Rule;
};

const ROOT = resolve(__dirname, '../../..');
const read = (path: string): string => readFileSync(resolve(ROOT, path), 'utf8');

// Stryker's own copy: another version could read a pattern another way.
const strykerRequire = createRequire(createRequire(__filename).resolve('@stryker-mutator/core/package.json'));
const { Minimatch } = strykerRequire('minimatch') as MinimatchModule;

/**
 * The file walk of Stryker's ProjectReader.resolveInputFileNames, over paths
 * instead of a directory tree. An ignored directory is never entered, so a `!`
 * pattern must also reach every directory above the file it brings back.
 */
const sandboxFilter = (patterns: string[]): ((path: string) => boolean) => {
  const rules = patterns.map((pattern) => new Minimatch(pattern, { dot: true, flipNegate: true, nocase: true }));
  const known = new Map<string, boolean>();

  const matchesFile = (name: string, path: string, rule: Rule): boolean =>
    rule.match(name) || rule.match(path) || rule.match(`/${path}`);
  const matchesDirectory = (name: string, path: string, rule: Rule): boolean =>
    matchesFile(name, path, rule) ||
    rule.match(`/${path}/`) ||
    rule.match(`${path}/`) ||
    (rule.negate && (rule.match(`/${path}`, true) || rule.match(path, true)));

  const included = (path: string, isDirectory: boolean): boolean => {
    const key = `${isDirectory ? 'd' : 'f'}:${path}`;
    const cached = known.get(key);

    if (cached !== undefined) {
      return cached;
    }

    const parent = dirname(path);
    const name = path.slice(path.lastIndexOf('/') + 1);
    const result = (parent === '.' || included(parent, true)) && rules.reduce(
      (kept, rule) => {
        if (rule.negate === kept) {
          return kept;
        }

        const hit = isDirectory ? matchesDirectory(name, path, rule) : matchesFile(name, path, rule);

        return hit ? rule.negate : kept;
      },
      true,
    );

    known.set(key, result);

    return result;
  };

  return (path) => included(path, false);
};

const LITERAL = /(['"`])((?:(?!\1)[^\\\n])+)\1/g;

/**
 * The repo paths a file names, read from the repo root and from its own folder.
 */
const namedPaths = (file: string, text: string): string[] => {
  const paths: string[] = [];

  for (const [, , literal] of text.matchAll(LITERAL)) {
    if (!literal.includes('/') || literal.startsWith('/')) {
      continue;
    }

    const fromRoot = literal.replace(/^(?:\.{1,2}\/)+/, '').replace(/\/$/, '');

    // A bare top-level name (`./docs`) is usually a value, not a file.
    if (fromRoot.includes('/')) {
      paths.push(fromRoot);
    }
    paths.push(normalize(join(dirname(file), literal)).replace(/\/$/, ''));
  }

  return paths;
};

describe('sandboxFilter', () => {
  it('drops what a pattern matches and keeps what a later ! pattern brings back', () => {
    const inSandbox = sandboxFilter(['public/**', '!public/samples/*.docx', '*.png']);

    expect(inSandbox('public/samples/a.docx')).toBe(true);
    expect(inSandbox('public/samples/a.txt')).toBe(false);
    expect(inSandbox('public/index.html')).toBe(false);
    expect(inSandbox('src/logo.png')).toBe(false);
    expect(inSandbox('src/blok.ts')).toBe(true);
  });
});

describe('mutation sandbox files', () => {
  const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 })
    .split('\n')
    .filter((path) => path !== '');
  const { ignorePatterns } = JSON.parse(read('stryker.config.json')) as { ignorePatterns: string[] };
  const inSandbox = sandboxFilter(ignorePatterns);
  const leftOut = tracked.filter((path) => !inSandbox(path));
  const leftOutFiles = new Set(leftOut);
  const leftOutFolders = new Set(
    [...new Set(leftOut.map((path) => dirname(path)))].filter(
      (folder) => !tracked.some((path) => path.startsWith(`${folder}/`) && inSandbox(path)),
    ),
  );

  // Only a test that imports a source file can be picked for a run, and
  // vitest.mutation.config.ts runs test/unit alone.
  const tests = tracked.filter((path) => /\.test\.tsx?$/.test(path));
  const importers = buildImporterIndex({
    testFiles: tests,
    sourceFiles: tracked.filter((path) => path.startsWith('src/') && /\.tsx?$/.test(path) && !path.endsWith('.d.ts')),
    readFile: read,
  }) as Map<string, string[]>;
  const pickable = [...new Set([...importers.values()].flat())]
    .filter((test) => test.startsWith('test/unit/'))
    .sort();

  it('finds the files the sandbox leaves out and the tests a run can pick', () => {
    expect(leftOut.length).toBeGreaterThan(100);
    expect(leftOutFiles.has('packages/server/dotnet/Blok.Server/Blok.Server.csproj')).toBe(true);
    expect(pickable.length).toBeGreaterThan(1000);
    expect(pickable).toContain('test/unit/mcp/readme.test.ts');
  });

  it('copies every file a pickable test names into the sandbox', () => {
    const missing = pickable.flatMap((test) =>
      [...new Set(namedPaths(test, read(test)))]
        .filter((path) => leftOutFiles.has(path) || leftOutFolders.has(path))
        .map((path) => `${test} reads ${path}`),
    );

    // Fix: add a `!<path>` line after the pattern that drops it in stryker.config.json.
    expect(missing).toEqual([]);
  });
});
