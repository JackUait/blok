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

function selectedOptions(args) {
  const targetIndex = args.indexOf('--target');
  const target = targetIndex >= 0 ? args[targetIndex + 1] : 'csharp';
  const filterIndex = args.indexOf('--test-name-pattern');
  const testNamePattern = filterIndex >= 0 ? args[filterIndex + 1] : undefined;

  if (
    target !== 'csharp' ||
    (filterIndex >= 0 && (testNamePattern === undefined || testNamePattern === ''))
  ) {
    throw new Error(
      'Usage: node scripts/test-server-conformance.mjs [--target csharp] ' +
      '[--test-name-pattern PATTERN]',
    );
  }

  return { testNamePattern };
}

async function main() {
  const options = selectedOptions(process.argv.slice(2));
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'blok-server-conformance-'));
  const executableSuffix = process.platform === 'win32' ? '.exe' : '';
  const ordinaryDirectory = join(temporaryDirectory, 'csharp-ordinary');
  const conformanceDirectory = join(temporaryDirectory, 'csharp-conformance');
  const hostProject = join(
    repositoryRoot,
    'packages/server/dotnet/Blok.Server.Host/Blok.Server.Host.csproj',
  );

  try {
    await run('dotnet', [
      'build',
      hostProject,
      '--configuration',
      'Release',
      '--output',
      ordinaryDirectory,
    ], {
      cwd: repositoryRoot,
    });
    await run('dotnet', [
      'build',
      hostProject,
      '--configuration',
      'Debug',
      '--output',
      conformanceDirectory,
      '-p:DefineConstants=BLOK_SERVER_CONFORMANCE',
    ], {
      cwd: repositoryRoot,
    });

    const vitestArgs = [
      join(repositoryRoot, 'node_modules/vitest/vitest.mjs'),
      'run',
      '--project=unit',
      'test/unit/server-conformance/server-contract.test.ts',
      'test/unit/server-conformance/sync-contract.test.ts',
    ];

    if (options.testNamePattern !== undefined) {
      vitestArgs.push('-t', options.testNamePattern);
    }

    await run(process.execPath, vitestArgs, {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        BLOK_CONFORMANCE_ORDINARY_SERVER: join(
          ordinaryDirectory,
          `Blok.Server.Host${executableSuffix}`,
        ),
        BLOK_CONFORMANCE_SERVER: join(
          conformanceDirectory,
          `Blok.Server.Host${executableSuffix}`,
        ),
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
