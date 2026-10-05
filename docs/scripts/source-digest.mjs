// Node half of the page fingerprint (docs/src/seo/page-fingerprint.ts), kept out
// of src/ because the app's tsconfig has no Node types.
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

/** Content digest of a repo-relative file or directory. Tests are not page content. */
const digestSource = (repoPath) =>
  sha(
    listFiles(path.join(REPO_ROOT, repoPath))
      .filter((file) => !/\.test\.[jt]sx?$/.test(file))
      .map((file) => `${path.relative(REPO_ROOT, file)}:${sha(fs.readFileSync(file))}`)
      .join('\n'),
  );

export const nodeDigests = { digestSource, hash: (input) => sha(input).slice(0, 16) };
