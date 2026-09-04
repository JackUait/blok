// @vitest-environment node
/**
 * LAW: the E2E web server must start from packages this repo installs, never
 * from a package fetched at test time.
 *
 * `npx <pkg>` silently falls back to downloading a package the workspace does
 * not declare. That download sits inside Playwright's `webServer.timeout`, so a
 * slow or unreachable registry does not read as a network problem — it reads as
 * "Timed out waiting 120000ms from config.webServer", on every shard of every
 * browser at once. It cost a full day of red E2E across eleven jobs while the
 * only commit in range touched CHANGELOG.md.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../..');

const packageJson = JSON.parse(
  readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'),
) as { devDependencies?: Record<string, string>; dependencies?: Record<string, string> };

const playwrightConfig = readFileSync(resolve(REPO_ROOT, 'playwright.config.ts'), 'utf8');

const declared = {
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
};

/** Package names invoked through `npx` / `npm exec` in the Playwright config. */
const invokedPackages = (source: string): string[] => {
  const names: string[] = [];

  for (const match of source.matchAll(/\b(?:npx|npm exec)\s+(?:--[\w-]+\s+)*([@\w][\w./@-]*)/g)) {
    names.push(match[1].startsWith('@') ? match[1].split('/').slice(0, 2).join('/') : match[1]);
  }

  return names;
};

describe('E2E web server', () => {
  it('invokes at least one package, or this law is watching nothing', () => {
    expect(invokedPackages(playwrightConfig).length).toBeGreaterThan(0);
  });

  it('runs only packages the workspace installs', () => {
    const undeclared = invokedPackages(playwrightConfig).filter((name) => !(name in declared));

    expect(undeclared).toEqual([]);
  });
});
