/**
 * Architectural enforcement: the jsdom Web Storage guard law.
 *
 * Node 26 enables Web Storage by default, and its built-in `localStorage`
 * global shadows the one jsdom installs (vitest's `populateGlobal` refuses to
 * overwrite globals that already exist on `globalThis`). `--localstorage-file`
 * is never provided, so Node's own accessor returns `undefined` and every
 * `localStorage.*` call in a jsdom test throws "Cannot read properties of
 * undefined" — usually surfacing as an unrelated-looking teardown error,
 * because construction already failed earlier. Disabling Node's implementation
 * (`--no-experimental-webstorage`, exported via NODE_OPTIONS at config-module
 * evaluation time, i.e. before the pool spawns a worker) lets jsdom's through.
 *
 * Regression this law exists for: the Node 26 upgrade added the guard to the
 * ROOT vitest config only. `grep -rn "no-experimental-webstorage"` returned
 * exactly ONE hit repo-wide, and nothing asserted the second jsdom surface —
 * docs/vitest.config.ts — needed it too. The docs suite went 630/924 red on the
 * newly pinned Node 26.5.0 and took the `docs-tests` job (which gates the docs
 * deploy) down with it. A guard that only one config happens to have is a guard
 * one refactor away from being lost again.
 *
 * The law, mechanically enforced below:
 *
 * 1. Every `vitest.config.*` / `vitest.workspace.*` in the repo is ENUMERATED
 *    by directory walk — a newly added project cannot dodge the scan by being
 *    unknown to this file. A config is "jsdom-bearing" if its source declares
 *    `environment: 'jsdom'` (or 'happy-dom').
 * 2. Every jsdom-bearing config must be guarded, and the guard must take effect
 *    BEFORE `export default` (a call from inside a plugin hook or a
 *    `defineConfig` callback runs after workers are already spawned — too late).
 *    Two spellings are accepted, because the EFFECT is what matters, not the
 *    syntax:
 *      a) calling `enableJsdomWebStorageGuard()` from the shared helper, or
 *      b) mutating `process.env.NODE_OPTIONS` inline with the flag, or
 *      c) the owning package.json running vitest behind a `NODE_OPTIONS=…`
 *         prefix that carries the flag.
 * 3. package.json scripts that run vitest with a CLI `--environment jsdom`
 *    (a config-less route the file walk would miss) must carry the flag too.
 * 4. The shared helper must stay version-gated on
 *    `process.allowedNodeEnvironmentFlags`. Node 20 REJECTS the flag outright
 *    ("--no-experimental-webstorage is not allowed in NODE_OPTIONS") and every
 *    worker dies at startup; Node 20 also has no built-in Web Storage, so it
 *    does not need it. An unconditional copy breaks the whole suite there.
 * 5. Behavioural half: the helper actually appends the flag, is idempotent, and
 *    stays silent when the running Node rejects the flag.
 *
 * Known blind spots (textual scan): `environmentMatchGlobs`, a `defineProject`
 * living in a file not named `vitest.config.*`, and an environment injected by
 * a CLI flag from a runner that is not a package.json script are NOT caught.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../..');

const HELPER = join(REPO_ROOT, 'scripts/jsdom-webstorage-guard.mjs');

const WEBSTORAGE_OFF = '--no-experimental-webstorage';

/** Directories that never hold first-party config we control. */
const PRUNED_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.worktrees',
  '.yarn',
  'coverage',
  'test-results',
  'playwright-report',
  'blob-report',
  'storybook-static',
]);

const VITEST_CONFIG = /^vitest\.(config|workspace)\.(ts|mts|cts|js|mjs|cjs)$/;

/** `environment: 'jsdom'` inside a config object. */
const JSDOM_ENVIRONMENT = /environment:\s*['"](jsdom|happy-dom)['"]/;

/** `--environment jsdom` / `--environment=jsdom` on a vitest command line. */
const JSDOM_CLI_ENVIRONMENT = /--environment[=\s]+(jsdom|happy-dom)/;

/** A call to the shared helper (the import statement has no `(`). */
const HELPER_CALL = /enableJsdomWebStorageGuard\s*\(/;

/** An inline `process.env.NODE_OPTIONS = …` mutation. */
const NODE_OPTIONS_MUTATION = /process\.env\.NODE_OPTIONS\s*=/;

interface PackageManifest {
  scripts?: Record<string, string>;
}

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap(name => {
    const full = join(dir, name);

    if (statSync(full).isDirectory()) {
      return PRUNED_DIRS.has(name) ? [] : walk(full);
    }

    return [full];
  });

const REPO_FILES = walk(REPO_ROOT);

const VITEST_CONFIGS = REPO_FILES.filter(file => VITEST_CONFIG.test(file.slice(file.lastIndexOf('/') + 1)));

const PACKAGE_MANIFESTS = REPO_FILES.filter(file => file.endsWith('/package.json'));

const readManifestScripts = (manifest: string): Record<string, string> => {
  const parsed = JSON.parse(readFileSync(manifest, 'utf-8')) as PackageManifest;

  return parsed.scripts ?? {};
};

/**
 * Spelling (c): the package that owns this config runs vitest behind a
 * `NODE_OPTIONS=` prefix carrying the flag.
 */
const guardedByOwningPackageScript = (config: string): boolean => {
  const manifest = join(dirname(config), 'package.json');

  if (!existsSync(manifest)) {
    return false;
  }

  return Object.values(readManifestScripts(manifest)).some(
    script => script.includes('NODE_OPTIONS') && script.includes(WEBSTORAGE_OFF)
  );
};

describe('jsdom Web Storage guard law (Node 26 shadows jsdom localStorage)', () => {
  it('enumerates at least the two known jsdom vitest configs', () => {
    const found = VITEST_CONFIGS.map(file => relative(REPO_ROOT, file)).sort();

    expect(found, 'the config walk found nothing — the scan itself is broken').not.toEqual([]);
    expect(found).toContain('vitest.config.ts');
    expect(found).toContain('docs/vitest.config.ts');
  });

  it('every jsdom-bearing vitest config disables Node Web Storage before `export default`', () => {
    const jsdomConfigs = VITEST_CONFIGS.filter(file => JSDOM_ENVIRONMENT.test(readFileSync(file, 'utf-8')));

    expect(jsdomConfigs, 'no jsdom config was classified — the environment regex has drifted').not.toEqual([]);

    const violations = jsdomConfigs.flatMap(file => {
      const source = readFileSync(file, 'utf-8');
      const name = relative(REPO_ROOT, file);

      if (guardedByOwningPackageScript(file)) {
        return [];
      }

      const helperCall = source.search(HELPER_CALL);
      const inlineMutation = source.search(NODE_OPTIONS_MUTATION);
      const flagLiteral = source.includes(WEBSTORAGE_OFF);
      const inlineGuardIndex = flagLiteral ? inlineMutation : -1;
      const guardIndex = helperCall >= 0 ? helperCall : inlineGuardIndex;

      if (guardIndex < 0) {
        return [`${name}: runs jsdom but never disables Node's Web Storage`];
      }

      const exportIndex = source.search(/export\s+default/);

      if (exportIndex >= 0 && guardIndex > exportIndex) {
        return [`${name}: guard runs after \`export default\` — too late, workers are already spawned`];
      }

      return [];
    });

    expect(
      violations,
      `every jsdom vitest config must run with ${WEBSTORAGE_OFF} — call enableJsdomWebStorageGuard() ` +
        'from scripts/jsdom-webstorage-guard.mjs at the top of the config, above `export default`'
    ).toEqual([]);
  });

  it('every package.json script running vitest with a CLI jsdom environment carries the flag', () => {
    const violations = PACKAGE_MANIFESTS.flatMap(manifest =>
      Object.entries(readManifestScripts(manifest))
        .filter(([, script]) => script.includes('vitest') && JSDOM_CLI_ENVIRONMENT.test(script))
        .filter(([, script]) => !script.includes(WEBSTORAGE_OFF))
        .map(([name]) => `${relative(REPO_ROOT, manifest)}: script "${name}"`)
    );

    expect(
      violations,
      `a script selecting jsdom on the command line bypasses the config guard — prefix it with NODE_OPTIONS="${WEBSTORAGE_OFF}"`
    ).toEqual([]);
  });

  it('the shared guard is gated on allowedNodeEnvironmentFlags (Node 20 rejects the flag)', () => {
    const source = readFileSync(HELPER, 'utf-8');

    expect(
      source.includes('allowedNodeEnvironmentFlags'),
      'an unconditional guard kills every worker on Node 20, which rejects the flag and does not need it'
    ).toBe(true);
    expect(source).toContain(WEBSTORAGE_OFF);
  });
});

interface GuardRun {
  nodeOptions: string;
  returns: boolean[];
}

/**
 * Runs the real helper in a child Node process, so NODE_OPTIONS of the test
 * process (which already carries the flag) cannot contaminate the result.
 */
const runGuard = (options: { nodeOptions: string; calls: number; flagAllowed?: boolean }): GuardRun => {
  const stubFlags =
    options.flagAllowed === false
      ? `Object.defineProperty(process, 'allowedNodeEnvironmentFlags', { value: new Set(), configurable: true });`
      : '';

  const script = [
    stubFlags,
    `const { enableJsdomWebStorageGuard } = await import(${JSON.stringify(pathToFileURL(HELPER).href)});`,
    `const returns = [];`,
    `for (let i = 0; i < ${options.calls}; i++) { returns.push(enableJsdomWebStorageGuard()); }`,
    `process.stdout.write(JSON.stringify({ nodeOptions: process.env.NODE_OPTIONS ?? '', returns }));`,
  ].join('\n');

  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf-8',
    env: { ...process.env, NODE_OPTIONS: options.nodeOptions },
  });

  if (result.status !== 0) {
    throw new Error(`guard probe failed (${String(result.status)}): ${result.stderr}`);
  }

  return JSON.parse(result.stdout) as GuardRun;
};

describe('jsdom Web Storage guard behaviour', () => {
  const flagAllowed = process.allowedNodeEnvironmentFlags.has(WEBSTORAGE_OFF);

  it.runIf(flagAllowed)('appends the flag to NODE_OPTIONS when this Node accepts it', () => {
    const run = runGuard({ nodeOptions: '', calls: 1 });

    expect(run.returns).toEqual([true]);
    expect(run.nodeOptions).toBe(WEBSTORAGE_OFF);
  });

  it.runIf(flagAllowed)('preserves existing NODE_OPTIONS entries', () => {
    const run = runGuard({ nodeOptions: '--max-old-space-size=512', calls: 1 });

    expect(run.nodeOptions).toContain('--max-old-space-size=512');
    expect(run.nodeOptions).toContain(WEBSTORAGE_OFF);
  });

  it.runIf(flagAllowed)('is idempotent — a second call does not double-append', () => {
    const run = runGuard({ nodeOptions: '', calls: 2 });

    expect(run.returns).toEqual([true, false]);
    expect(run.nodeOptions.split(WEBSTORAGE_OFF)).toHaveLength(2);
  });

  it('never appends the flag when the running Node rejects it', () => {
    const run = runGuard({ nodeOptions: '', calls: 1, flagAllowed: false });

    expect(run.returns).toEqual([false]);
    expect(run.nodeOptions).toBe('');
  });
});
