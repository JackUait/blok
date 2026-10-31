#!/usr/bin/env node
/**
 * Proves the Go module works for a consumer and the release host build
 * stamps its version.
 *
 * A consumer of packages/server/go/vX.Y.Z downloads only the files git
 * tracks in that directory, so the module is copied from `git ls-files`
 * first: a gitignored file a build needs (an embedded bundle) fails here.
 * The fixture under test/fixtures/go-server-consumer is then pointed at the
 * copy, built, and probed under /api/blok behind its own authentication.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildServerRuntime } from './build-server-runtime.mjs';
import { runAndProbe } from './lib/server-probes.mjs';
import { GO_TARGETS, buildCommand } from './publish-server-go.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const moduleDirectory = 'packages/server/go';
const modulePath = 'github.com/JackUait/blok/packages/server/go';
const fixtureDirectory = join(repositoryRoot, 'test/fixtures/go-server-consumer');
const hostVersion = '0.0.0-go-module';
const consumerVersion = 'package-fixture';

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });

    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }

      reject(new Error(
        `${command} ${args.join(' ')} exited with ${code === null ? `signal ${signal ?? 'unknown'}` : `code ${code}`}`,
      ));
    });
  });
}

/** Copies the module's tracked files, as the tagged module zip holds them. */
async function copyTrackedModule(destination) {
  const tracked = execFileSync('git', ['ls-files', '-z', '--', moduleDirectory], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).split('\0').filter(Boolean);

  assert(tracked.includes(`${moduleDirectory}/go.mod`), `${moduleDirectory}/go.mod is not tracked`);

  for (const file of tracked) {
    const target = join(destination, file.slice(moduleDirectory.length + 1));

    await mkdir(dirname(target), { recursive: true });
    await cp(join(repositoryRoot, file), target);
  }
}

function nativeTarget() {
  const goos = { darwin: 'darwin', linux: 'linux', win32: 'windows' }[process.platform];
  const goarch = { x64: 'amd64', arm64: 'arm64' }[process.arch];
  const target = GO_TARGETS.find((entry) => entry.goos === goos && entry.goarch === goarch);

  assert.notEqual(target, undefined, `No Go release target for ${process.platform}/${process.arch}`);

  return target;
}

async function main() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'blok-server-go-module-'));
  const copiedModule = join(temporaryRoot, 'module');
  const consumer = join(temporaryRoot, 'consumer');
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const consumerExecutable = join(temporaryRoot, `blok-server-consumer${suffix}`);
  const hostExecutable = join(temporaryRoot, 'host', `blok-server${suffix}`);

  try {
    await copyTrackedModule(copiedModule);
    await cp(fixtureDirectory, consumer, { recursive: true });
    await run('go', ['mod', 'edit', `-replace=${modulePath}=${copiedModule}`], { cwd: consumer });
    // Default -mod=readonly: the fixture's go.sum must already be complete.
    await run('go', ['build', '-o', consumerExecutable, '.'], { cwd: consumer });

    // Like the C# fixture's manifest hash check: the binary carries the
    // bundle a fresh build of src/view/server-runtime.ts gives.
    const bundle = await readFile(await buildServerRuntime(join(temporaryRoot, 'runtime')));
    const embedded = await readFile(join(copiedModule, 'internal/jsruntime/blok-server-runtime.js'));
    const binary = await readFile(consumerExecutable);

    assert(embedded.equals(bundle), 'The module\'s runtime bundle is not a fresh build');
    assert(binary.includes(bundle), 'The consumer binary does not embed the runtime bundle');

    await runAndProbe(
      consumerExecutable,
      (port) => ['-listen', `127.0.0.1:${port}`],
      {},
      '/api/blok',
      consumerVersion,
      true,
    );

    const target = nativeTarget();
    const host = buildCommand(target, hostVersion, hostExecutable);

    await run(host.command, host.args, {
      cwd: copiedModule,
      env: { ...process.env, ...host.env },
    });
    await runAndProbe(
      hostExecutable,
      (port) => ['--listen', `127.0.0.1:${port}`, '--storage-dir', ''],
      {},
      '',
      hostVersion,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

try {
  await main();
  console.log('Go module consumer and release host build passed.');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
