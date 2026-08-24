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
  const target = targetIndex >= 0 ? args[targetIndex + 1] : undefined;
  const filterIndex = args.indexOf('--test-name-pattern');
  const testNamePattern = filterIndex >= 0 ? args[filterIndex + 1] : undefined;

  if (
    (target !== 'go' && target !== 'csharp') ||
    (filterIndex >= 0 && (testNamePattern === undefined || testNamePattern === ''))
  ) {
    throw new Error(
      'Usage: node scripts/test-server-conformance.mjs --target go|csharp ' +
      '[--test-name-pattern PATTERN]',
    );
  }

  return { target, testNamePattern };
}

async function main() {
  const options = selectedOptions(process.argv.slice(2));
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'blok-server-conformance-'));
  const executableSuffix = process.platform === 'win32' ? '.exe' : '';
  const ordinaryExecutable = join(temporaryDirectory, `blok-server-ordinary${executableSuffix}`);
  const conformanceExecutable = join(temporaryDirectory, `blok-server-conformance${executableSuffix}`);

  try {
    if (options.target === 'go') {
      await run('go', ['build', '-o', ordinaryExecutable, './cmd/blok-server'], {
        cwd: join(repositoryRoot, 'packages/server'),
      });
      await run('go', ['build', '-tags', 'conformance', '-o', conformanceExecutable, './cmd/blok-server'], {
        cwd: join(repositoryRoot, 'packages/server'),
      });
    } else {
      await run('dotnet', [
        'build',
        join(repositoryRoot, 'packages/server/dotnet/Blok.Server.Host/Blok.Server.Host.csproj'),
        '--configuration',
        'Release',
        '--output',
        temporaryDirectory,
      ], {
        cwd: repositoryRoot,
      });
    }

    const vitestArgs = [
      join(repositoryRoot, 'node_modules/vitest/vitest.mjs'),
      'run',
      '--project=unit',
      'test/unit/server-conformance/server-contract.test.ts',
    ];

    if (options.testNamePattern !== undefined) {
      vitestArgs.push('-t', options.testNamePattern);
    }

    const serverEnvironment = options.target === 'go'
      ? {
        BLOK_CONFORMANCE_ORDINARY_SERVER: ordinaryExecutable,
        BLOK_CONFORMANCE_SERVER: conformanceExecutable,
      }
      : {
        BLOK_CONFORMANCE_ORDINARY_SERVER: join(
          temporaryDirectory,
          `Blok.Server.Host${executableSuffix}`,
        ),
        BLOK_CONFORMANCE_SERVER: join(
          temporaryDirectory,
          `Blok.Server.Host${executableSuffix}`,
        ),
      };

    await run(process.execPath, vitestArgs, {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        ...serverEnvironment,
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
