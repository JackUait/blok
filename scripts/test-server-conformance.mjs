import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }

      reject(new Error(
        `${command} exited with ${code === null ? `signal ${signal ?? 'unknown'}` : `code ${code}`}`,
      ));
    });
  });
}

function selectedTarget(args) {
  const targetIndex = args.indexOf('--target');
  const target = targetIndex >= 0 ? args[targetIndex + 1] : undefined;

  if (target !== 'go') {
    throw new Error('Usage: node scripts/test-server-conformance.mjs --target go');
  }

  return target;
}

async function main() {
  selectedTarget(process.argv.slice(2));

  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'blok-server-conformance-'));
  const executableSuffix = process.platform === 'win32' ? '.exe' : '';
  const ordinaryExecutable = join(temporaryDirectory, `blok-server-ordinary${executableSuffix}`);
  const conformanceExecutable = join(temporaryDirectory, `blok-server-conformance${executableSuffix}`);

  try {
    await run('go', ['build', '-o', ordinaryExecutable, './cmd/blok-server'], {
      cwd: join(repositoryRoot, 'packages/server'),
    });
    await run('go', ['build', '-tags', 'conformance', '-o', conformanceExecutable, './cmd/blok-server'], {
      cwd: join(repositoryRoot, 'packages/server'),
    });
    await run(process.execPath, [
      join(repositoryRoot, 'node_modules/vitest/vitest.mjs'),
      'run',
      '--project=unit',
      'test/unit/server-conformance/server-contract.test.ts',
    ], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        BLOK_CONFORMANCE_ORDINARY_SERVER: ordinaryExecutable,
        BLOK_CONFORMANCE_SERVER: conformanceExecutable,
      },
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
