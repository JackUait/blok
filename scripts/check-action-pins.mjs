#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA = /^[0-9a-f]{40}$/;
const USES = /^\s*(?:-\s+)?uses:\s*['"]?([^'"\s#]+)/gm;

const RETRIES = 3;
const RETRY_DELAY_MS = 500;

export function collectUses(source) {
  return Array.from(source.matchAll(USES), (match) => match[1]);
}

export function parseActionRef(uses) {
  const at = uses.lastIndexOf('@');
  const [owner, repo, ...rest] = uses.slice(0, at).split('/');

  return { owner, repo, subpath: rest.join('/'), ref: uses.slice(at + 1) };
}

/** Local (`./`) and container (`docker://`) steps are outside the pin policy. */
const isRegistryAction = (uses) =>
  !uses.startsWith('.') && !uses.startsWith('docker://') && uses.includes('@');

/**
 * Walks every `uses:` reachable from `sources`, following pinned actions into
 * their own action.yml, and returns every reference that is not a 40-character
 * SHA. GitHub's pin policy walks composite actions the same way, so a nested
 * unpinned reference kills the job at "Set up job" even when every reference
 * written in this repository is pinned.
 */
export async function findUnpinnedPins({ sources, readAction }) {
  const violations = [];
  const visited = new Set();
  const queue = sources.map((source) => ({ from: source.label, text: source.text }));

  while (queue.length > 0) {
    const { from, text } = queue.shift();

    for (const uses of collectUses(text)) {
      if (!isRegistryAction(uses)) {
        continue;
      }

      const action = parseActionRef(uses);

      if (!SHA.test(action.ref)) {
        violations.push({ from, uses });
        continue;
      }

      if (visited.has(uses)) {
        continue;
      }
      visited.add(uses);

      const definition = await readAction(action);

      if (definition !== null) {
        queue.push({ from: uses, text: definition });
      }
    }
  }

  return violations;
}

const sleep = (ms) => new Promise((done) => {
  setTimeout(done, ms);
});

/**
 * A missing action.yml means a reusable workflow or a repository without one,
 * which has no nested steps to check. Anything else must throw: a swallowed
 * network error would turn this gate into a green no-op.
 */
async function fetchActionYaml({ owner, repo, subpath, ref }) {
  const directory = subpath === '' ? '' : `${subpath}/`;
  let lastError = null;

  for (let attempt = 0; attempt < RETRIES; attempt += 1) {
    if (attempt > 0) {
      await sleep(RETRY_DELAY_MS * attempt);
    }

    try {
      const responses = await Promise.all(['action.yml', 'action.yaml'].map((file) =>
        fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${directory}${file}`),
      ));
      const found = responses.find((response) => response.ok);

      if (found !== undefined) {
        return await found.text();
      }

      if (responses.every((response) => response.status === 404)) {
        return null;
      }

      lastError = new Error(
        `${owner}/${repo}@${ref}: ${responses.map((response) => response.status).join(', ')}`,
      );
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Could not read ${owner}/${repo}@${ref}: ${lastError?.message ?? 'unknown'}`);
}

function collectWorkflowFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return collectWorkflowFiles(path);
    }

    return /\.ya?ml$/.test(entry.name) ? [path] : [];
  });
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const root = resolve(process.argv[2] ?? '.github');

  if (!statSync(root).isDirectory()) {
    console.error(`Not a directory: ${root}`);
    process.exit(1);
  }

  const sources = collectWorkflowFiles(root).map((path) => ({
    label: path,
    text: readFileSync(path, 'utf8'),
  }));
  const violations = await findUnpinnedPins({ sources, readAction: fetchActionYaml });

  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`${violation.from} uses ${violation.uses} without a full commit SHA`);
    }
    console.error(
      '\nGitHub rejects these at "Set up job". Pin the reference, or move to a release '
      + 'of the parent action whose own action.yml pins it.',
    );
    process.exit(1);
  }

  console.log(`Every action reachable from ${root} is pinned to a full commit SHA.`);
}
