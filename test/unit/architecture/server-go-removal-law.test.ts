import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../..');

const trackedFiles = execFileSync('git', ['ls-files', '-z'], {
  cwd: repoRoot,
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean);

const isHistoricalMarkdownPlan = (path: string): boolean =>
  path.startsWith('docs/plans/') && path.endsWith('.md');

// Split the patterns so the law does not flag itself.
const forbiddenReferencePattern = [
  ['actions/setup-', 'go'].join(''),
  [
    '(^|[^[:alnum:]_])',
    ['g', 'o'].join(''),
    '[[:space:]]+',
    '(build|test|vet|run|install|generate)',
    '([[:space:]]|$)',
  ].join(''),
  ['gore', 'leaser'].join(''),
  ['CGO_', 'ENABLED'].join(''),
  ['\\.gore', 'leaser-dist'].join(''),
].join('|');

const findForbiddenReferences = (cwd: string, noIndex = false) => {
  const args = ['grep'];

  if (noIndex) {
    args.push('--no-index');
  }

  args.push('-l', '-z', '-E', forbiddenReferencePattern, '--');

  if (noIndex) {
    args.push('.');
  }

  return spawnSync('git', args, { cwd, encoding: 'utf8' });
};

const assertMutationDetected = (
  temporaryRoot: string,
  fixturePath: string,
  original: string,
  mutation: string,
): void => {
  writeFileSync(fixturePath, mutation);

  try {
    const result = findForbiddenReferences(temporaryRoot, true);
    const forbiddenFiles = result.stdout.split('\0').filter(Boolean);

    expect(result.status).toBe(0);
    expect(forbiddenFiles.some((path) =>
      path.endsWith('retired-command.txt'))).toBe(true);
  } finally {
    writeFileSync(fixturePath, original);
    expect(readFileSync(fixturePath, 'utf8')).toBe(original);
  }
};

describe('server implementation removal law', () => {
  it('has no tracked Go implementation or module files', () => {
    const releaseConfig = ['.gore', 'leaser.yaml'].join('');
    const forbiddenFiles = trackedFiles.filter((path) =>
      path.endsWith('.go') ||
      path === 'go.mod' ||
      path.endsWith('/go.mod') ||
      path === 'go.sum' ||
      path.endsWith('/go.sum') ||
      path === releaseConfig ||
      path.endsWith(`/${releaseConfig}`));

    expect(forbiddenFiles).toEqual([]);
  });

  it('has no active Go build or release references', () => {
    const result = findForbiddenReferences(repoRoot);
    const forbiddenFiles = result.stdout
      .split('\0')
      .filter(Boolean)
      .filter((path) => !isHistoricalMarkdownPlan(path));

    expect([0, 1], result.stderr).toContain(result.status);
    expect(forbiddenFiles).toEqual([]);
  }, 10_000);

  it('detects every retired command spelling in controlled mutations', () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'blok-server-command-law-'));
    const fixturePath = join(temporaryRoot, 'retired-command.txt');
    const original = 'safe fixture\n';
    const retiredCommand = ['g', 'o'].join('');
    const mutations = [
      `${retiredCommand}  build ./...\n`,
      `${retiredCommand}\ttest ./...\n`,
      `${retiredCommand} \t vet ./...\n`,
      `${retiredCommand} run example.com/tool@v1.2.3\n`,
      `${retiredCommand} install example.com/tool@v1.2.3\n`,
      `${retiredCommand} generate ./...\n`,
    ];
    writeFileSync(fixturePath, original);

    try {
      for (const mutation of mutations) {
        assertMutationDetected(
          temporaryRoot,
          fixturePath,
          original,
          mutation,
        );
      }
    } finally {
      writeFileSync(fixturePath, original);
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('has no Go token in the conformance harness', () => {
    const source = readFileSync(
      resolve(repoRoot, 'scripts/test-server-conformance.mjs'),
      'utf8',
    );
    const retiredTarget = ['g', 'o'].join('');
    const retiredTargetToken = new RegExp(`\\b${retiredTarget}\\b`);

    expect(source).not.toMatch(retiredTargetToken);
  });

  it('rejects the retired target before build or temporary work', () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'blok-server-rejection-'));

    try {
      const retiredTarget = ['g', 'o'].join('');
      const forbiddenTemporaryRoot = join(temporaryRoot, 'must-not-exist');
      const result = spawnSync(
        process.execPath,
        [
          resolve(repoRoot, 'scripts/test-server-conformance.mjs'),
          '--target',
          retiredTarget,
        ],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: '',
            TEMP: forbiddenTemporaryRoot,
            TMP: forbiddenTemporaryRoot,
            TMPDIR: forbiddenTemporaryRoot,
          },
        },
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe(
        'Usage: node scripts/test-server-conformance.mjs [--target csharp] ' +
        '[--test-name-pattern PATTERN]\n',
      );
      expect(readdirSync(temporaryRoot)).toEqual([]);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
