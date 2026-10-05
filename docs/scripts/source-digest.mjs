// Node half of the page fingerprint (docs/src/seo/page-fingerprint.ts), kept out
// of src/ because the app's tsconfig has no Node types.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const sha = (value) => createHash('sha256').update(value).digest('hex');

const listFiles = (absolute) =>
  fs.statSync(absolute).isDirectory()
    ? fs
        .readdirSync(absolute)
        .sort()
        .flatMap((name) => listFiles(path.join(absolute, name)))
    : [absolute];

// Only files git would commit: a stray ignored file (.DS_Store, build scratch)
// exists on one machine only, and CI could then never reproduce the ledger.
const committableFiles = (repoPath) =>
  new Set(
    execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', repoPath], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
      .split('\0')
      .filter(Boolean),
  );

const NOT_PAGE_CONTENT = /\.test(\.deferred)?\.[jt]sx?$|[/\\]__snapshots__[/\\]/;

/**
 * Content digest of a repo-relative file or directory. Changing what goes into
 * it moves every hash: migrate the ledger's hashes and keep its dates, never
 * re-date by running the update script.
 */
const digestSource = (repoPath) => {
  const committable = committableFiles(repoPath);
  return sha(
    listFiles(path.join(REPO_ROOT, repoPath))
      .filter((file) => committable.has(path.relative(REPO_ROOT, file)) && !NOT_PAGE_CONTENT.test(file))
      .map((file) => `${path.relative(REPO_ROOT, file)}:${sha(fs.readFileSync(file))}`)
      .join('\n'),
  );
};

export const nodeDigests = { digestSource, hash: (input) => sha(input).slice(0, 16) };
