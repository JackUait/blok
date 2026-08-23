import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * SERVER RELEASE WIRING LAW
 *
 * Nothing in this repo auto-iterates workspaces. Every release step reads an
 * explicit list, so a package missing from one list does not fail — it silently
 * drops out of that step and nobody notices until a consumer installs a version
 * that was never published. `@bloklabs/presets` proved it: it was added to
 * `FAMILY` without being added to the exact-list assertion that mirrors FAMILY,
 * and that test sat red on main.
 *
 * This law pins EVERY list a published package has to appear in, one assertion
 * per list with its own failure message, so the next package added learns the
 * full set from one red run instead of from a missing npm tarball.
 *
 * Where a list can be derived from another (metadata law coverage, the
 * build graph, the FAMILY mirror test) the assertion is derived rather than
 * hard-coded — that way it guards every future package, not just this one.
 */

const repoRoot = resolve(__dirname, '../../..');

const read = (path: string): string => readFileSync(join(repoRoot, path), 'utf-8');

const readJson = <T>(path: string): T => JSON.parse(read(path)) as T;

const SERVER_NPM_NAME = '@bloklabs/server';
const SERVER_GPR_NAME = '@dodopizza/blok-server';
const SERVER_MANIFEST = 'packages/server/package.json';
const RELEASE_WORKFLOW = '.github/workflows/release-server.yml';

type FamilyEntry = { npmName: string; gprName: string; manifestPath: string; packDir: string };

const loadFamily = async (): Promise<FamilyEntry[]> => {
  const { FAMILY } = (await import('../../../scripts/release-manifest.mjs')) as { FAMILY: FamilyEntry[] };

  return FAMILY;
};

/**
 * Pull one `const NAME = [ ... ]` array literal out of a script's source, so an
 * assertion is about the actual list and not a stray mention elsewhere in the file.
 */
const extractArrayLiteral = (source: string, constName: string): string => {
  const start = source.indexOf(`${constName} = [`);

  expect(start, `${constName} is not declared as an array literal`).toBeGreaterThan(-1);

  const end = source.indexOf('];', start);

  expect(end, `${constName} has no closing bracket`).toBeGreaterThan(start);

  return source.slice(start, end);
};

describe('server release wiring', () => {
  it('list 1/7 — scripts/release.mjs WORKSPACE_MANIFESTS stamps the family version onto the server manifest', () => {
    const manifests = extractArrayLiteral(read('scripts/release.mjs'), 'WORKSPACE_MANIFESTS');

    expect(
      manifests,
      `${SERVER_MANIFEST} is absent from WORKSPACE_MANIFESTS — the server would stay pinned at the previous version forever and its manifest would never be committed`
    ).toContain(`'${SERVER_MANIFEST}'`);
  });

  it('list 2/7 — scripts/release-manifest.mjs FAMILY is what actually publishes the server', async () => {
    const family = await loadFamily();
    const entry = family.find((item) => item.npmName === SERVER_NPM_NAME);

    expect(entry, `${SERVER_NPM_NAME} is absent from FAMILY — nothing publishes it to npm or the GitHub Packages mirror`).toBeDefined();
    expect(entry?.gprName, 'GitHub Packages forces the @dodopizza scope and cannot carry slashes').toBe(SERVER_GPR_NAME);
    expect(entry?.manifestPath).toBe(SERVER_MANIFEST);
    expect(entry?.packDir).toBe('packages/server');
  });

  it('list 3/7 — every FAMILY package is covered by the package metadata law', async () => {
    const family = await loadFamily();
    const law = read('test/unit/architecture/package-metadata-law.test.ts');
    const uncovered = family.filter((entry) => !law.includes(`name: '${entry.npmName}'`));

    expect(
      uncovered.map((entry) => entry.npmName),
      'these packages publish an npm page nothing checks for keywords, links or a README'
    ).toEqual([]);
  });

  it('list 4/7 — every FAMILY package is covered by the exact-list mirror test', async () => {
    const family = await loadFamily();
    const mirror = read('test/unit/scripts/release-manifest.test.ts');
    const uncovered = family.filter((entry) => !mirror.includes(`'${entry.npmName}'`));

    expect(
      uncovered.map((entry) => entry.npmName),
      'the FAMILY mirror assertion in test/unit/scripts/release-manifest.test.ts is stale'
    ).toEqual([]);
  });

  it('list 5/7 — scripts/build-all.mjs covers every workspace that declares a build script', async () => {
    const { buildTasks } = (await import('../../../scripts/build-all.mjs')) as {
      buildTasks: (opts?: { mode?: string; withCli?: boolean }) => { name: string }[];
    };
    const tasks = new Set(buildTasks({ withCli: true }).map((task) => task.name));
    const family = await loadFamily();

    // The root package is built by `main`/`iife`/`umd`/`locales`, not by one
    // task named after it; every workspace gets a task named for its directory.
    const workspaceDirs = family
      .map((entry) => /^packages\/([^/]+)\//.exec(entry.manifestPath)?.[1])
      .filter((dir): dir is string => dir !== undefined);

    const missing = workspaceDirs.filter((dir) => {
      const scripts = readJson<{ scripts?: Record<string, string> }>(`packages/${dir}/package.json`).scripts ?? {};

      return 'build' in scripts && !tasks.has(dir);
    });

    expect(
      missing,
      'these packages declare a build script but nothing in the release build graph runs it'
    ).toEqual([]);

    // The inverse for the server specifically: it has no build script (goreleaser
    // compiles the Go binary), so a build-all entry would run a command that does
    // not exist. Absence here is deliberate, not an oversight.
    expect(readJson<{ scripts?: Record<string, string> }>(SERVER_MANIFEST).scripts).toBeUndefined();
    expect(tasks.has('server')).toBe(false);
  });

  it('list 6/7 — every FAMILY package is covered by the docs deploy gate', async () => {
    const family = await loadFamily();
    // deploy-docs.yml blocks the docs deploy until every name here is resolvable
    // on npm, so an omission ships docs describing a version nobody can install.
    // Its own test lives outside test/unit/architecture/ and would not be caught
    // by the gate this law is run under.
    const verifier = read('scripts/verify-docs-release.mjs');
    const uncovered = family.filter((entry) => !verifier.includes(`'${entry.npmName}'`));

    expect(
      uncovered.map((entry) => entry.npmName),
      'RELEASE_PACKAGES in scripts/verify-docs-release.mjs is stale'
    ).toEqual([]);
  });

  it('list 7/7 — CI runs the Go suite', () => {
    const ci = parse(read('.github/workflows/ci.yml')) as { jobs: Record<string, { steps?: { run?: string }[] }> };

    expect(ci.jobs.server, 'no `server` job in ci.yml — the Go suite would never run').toBeDefined();
    expect(
      (ci.jobs.server.steps ?? []).map((step) => step.run).join('\n')
    ).toContain('go test ./...');
  });

  it('keeps the server package on the family version', () => {
    const root = readJson<{ version: string }>('package.json');
    const server = readJson<{ version: string }>(SERVER_MANIFEST);

    expect(server.version, 'the service takes the family version — lockstep is the point').toBe(root.version);
  });

  it('publishes the binaries and the image from a tag-triggered workflow', () => {
    expect(
      existsSync(join(repoRoot, RELEASE_WORKFLOW)),
      'ci.yml has no tag trigger, so the goreleaser run needs its own workflow'
    ).toBe(true);

    const workflow = parse(read(RELEASE_WORKFLOW)) as {
      on?: { push?: { tags?: string[] } };
      jobs: Record<string, { if?: string; permissions?: Record<string, string>; steps?: { run?: string; uses?: string }[] }>;
    };

    expect(workflow.on?.push?.tags, 'must fire on the v* tag scripts/release.mjs pushes').toContain('v*');

    const job = workflow.jobs['release-server'];

    expect(job, 'missing the release-server job').toBeDefined();
    // mirror.yml pushes every v* tag to dodopizza/blok, where this workflow would
    // fire again with no GHCR credentials and no matching GitHub release.
    expect(job.if, 'the job must not run on the mirror repository').toContain('github.repository');
    // contents: write uploads the release assets; packages: write pushes to GHCR.
    expect(job.permissions).toMatchObject({ contents: 'write', packages: 'write' });

    const source = read(RELEASE_WORKFLOW);

    expect(
      (job.steps ?? []).map((step) => step.uses ?? '').join('\n'),
      'nothing runs goreleaser'
    ).toMatch(/goreleaser\/goreleaser-action/);
    // A release that did not touch the server re-tags the previous image instead
    // of pushing an identical one, but must still publish binaries — the npm
    // wrapper resolves them from the release matching its own (family) version.
    expect(source, 'an unchanged server must still ship binaries').toContain('--skip=docker');
    expect(source, 'an unchanged server must reuse the previous image digest').toContain('imagetools create');
  });

  it('builds the Go module from the repo-root goreleaser config without clobbering the editor bundle', () => {
    const config = parse(read('.goreleaser.yaml')) as {
      dist?: string;
      builds: { dir?: string; main?: string }[];
      checksum?: { name_template?: string };
      archives?: { name_template?: string }[];
      dockers?: { dockerfile?: string; image_templates?: string[] }[];
    };

    // Paths are relative to the config, which sits at the repo root — a JS project's root.
    expect(config.builds[0].dir).toBe('packages/server');
    expect(existsSync(join(repoRoot, 'packages/server', config.builds[0].main ?? '')), 'main does not resolve').toBe(true);

    // goreleaser's default output dir is ./dist — the same directory vite writes
    // the editor bundle into, and `goreleaser release --clean` empties it.
    expect(config.dist, 'goreleaser must not write into the editor build output').not.toBe('dist');
    expect(config.dist).toBeTruthy();

    // The npm wrapper builds these exact filenames; goreleaser's defaults embed
    // the project name and version, which the wrapper would then have to guess.
    expect(config.checksum?.name_template).toBe('checksums.txt');
    expect(config.archives?.[0].name_template).toBeTruthy();

    expect(existsSync(join(repoRoot, config.dockers?.[0].dockerfile ?? '')), 'Dockerfile does not resolve').toBe(true);
  });

  it('ships an npm wrapper that verifies what it downloads', () => {
    const wrapper = read('packages/server/bin/blok-server.mjs');

    expect(wrapper, 'the wrapper must verify the download against the checksums file').toContain('checksums.txt');
    expect(wrapper).toContain('createHash');
    expect(wrapper, 'a blocked download must still leave a path').toContain('ghcr.io/jackuait/blok-server');
    // npm installs the bin as a symlink and Node realpaths import.meta.url but not
    // argv[1]; comparing them raw makes every `npx` run exit 0 having done nothing.
    expect(wrapper, 'the direct-run guard must realpath argv[1]').toMatch(/realpathSync\(process\.argv\[1\]\)/);
  });
});
