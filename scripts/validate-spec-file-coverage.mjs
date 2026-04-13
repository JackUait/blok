#!/usr/bin/env node
// Fails if any test/playwright/tests/**/*.spec.ts file is not discovered by
// Playwright's project testMatch configuration. Run in CI to prevent config drift.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve('test/playwright/tests');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (entry.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

const onDisk = new Set(walk(ROOT).map(p => path.resolve(p)));

// Route Playwright's JSON report to a temp file because the full --list
// output can exceed Node's default stdio buffer (ENOBUFS on large suites).
const jsonPath = path.join(tmpdir(), `playwright-list-${process.pid}.json`);
try {
  execFileSync(
    'yarn',
    ['playwright', 'test', '--list', '--reporter=json'],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'inherit'],
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: jsonPath },
    }
  );
} catch (err) {
  // Playwright exits non-zero when --list discovers zero tests in a project,
  // but still writes the JSON file. Only rethrow if the file is missing.
  try {
    statSync(jsonPath);
  } catch {
    throw err;
  }
}
const json = JSON.parse(readFileSync(jsonPath, 'utf8'));
try { unlinkSync(jsonPath); } catch { /* ignore */ }

// Playwright reports spec `file` entries relative to the config's rootDir,
// so resolve them against that root to normalize against the on-disk set.
const rootDir = json.config?.rootDir ?? ROOT;
const discovered = new Set();
const collectFiles = (node) => {
  if (!node) return;
  if (node.file) discovered.add(path.resolve(rootDir, node.file));
  for (const suite of node.suites ?? []) collectFiles(suite);
  for (const spec of node.specs ?? []) collectFiles(spec);
};
for (const suite of json.suites ?? []) collectFiles(suite);

const orphans = [...onDisk]
  .filter(f => !discovered.has(f))
  .map(f => path.relative(process.cwd(), f))
  .sort();

if (orphans.length > 0) {
  console.error(`\nERROR: ${orphans.length} spec files are not matched by any Playwright project:\n`);
  for (const f of orphans) console.error(`  ${f}`);
  console.error(`\nFix: add the files to CROSS_BROWSER_TESTS / LOGIC_TESTS, or rely on a catch-all project (see playwright.config.ts).`);
  process.exit(1);
}

console.log(`OK: all ${onDisk.size} spec files are matched.`);
