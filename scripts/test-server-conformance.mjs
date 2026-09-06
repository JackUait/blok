import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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

/**
 * The ordinary host stands in for the shipped binary, so it is always Release.
 * `--configuration` selects the journal host, the one every durability proof
 * drives, and it defaults to Debug because that is what CI has always built.
 */
const ORDINARY_CONFIGURATION = 'Release';
const JOURNAL_CONFIGURATIONS = ['Debug', 'Release'];

function selectedOptions(args) {
  const targetIndex = args.indexOf('--target');
  const target = targetIndex >= 0 ? args[targetIndex + 1] : 'csharp';
  const filterIndex = args.indexOf('--test-name-pattern');
  const testNamePattern = filterIndex >= 0 ? args[filterIndex + 1] : undefined;
  const configurationIndex = args.indexOf('--configuration');
  const configuration = configurationIndex >= 0 ? args[configurationIndex + 1] : 'Debug';

  if (
    target !== 'csharp' ||
    (filterIndex >= 0 && (testNamePattern === undefined || testNamePattern === '')) ||
    !JOURNAL_CONFIGURATIONS.includes(configuration)
  ) {
    throw new Error(
      'Usage: node scripts/test-server-conformance.mjs [--target csharp] ' +
      '[--test-name-pattern PATTERN] [--configuration Debug|Release]',
    );
  }

  return { testNamePattern, configuration };
}

/**
 * Printed before the builds and again after the run: the first is scrolled away
 * by two dotnet builds, and the second is what anyone reading the summary sees.
 * Whoever runs this must never have to guess which binary was proved.
 */
function announceConfigurations(configuration) {
  console.log(
    `Conformance hosts — ordinary host: ${ORDINARY_CONFIGURATION}, ` +
    `journal host: ${configuration}.`,
  );
}

/**
 * Vitest exits 0 when `-t` selects nothing, which reads exactly like a suite
 * that passed — so a mistyped or wrongly-cased pattern silently proves
 * nothing. The JSON report is the only place the run says how many tests it
 * actually executed.
 */
async function requireExecutedTests(reportPath, testNamePattern) {
  let report;

  try {
    report = JSON.parse(await readFile(reportPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Could not read the vitest report at ${reportPath}: ` +
      `${error instanceof Error ? error.message : error}`,
    );
  }

  const total = report.numTotalTests ?? 0;
  const skipped = (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0);

  if (total - skipped > 0) {
    return;
  }

  throw new Error(
    `--test-name-pattern ${JSON.stringify(testNamePattern)} ran no test ` +
    `(${total} collected, ${skipped} skipped). It is a CASE-SENSITIVE regular expression ` +
    'matched against the full test name, and vitest exits 0 when it selects nothing.',
  );
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
    announceConfigurations(options.configuration);

    await run('dotnet', [
      'build',
      hostProject,
      '--configuration',
      ORDINARY_CONFIGURATION,
      '--output',
      ordinaryDirectory,
    ], {
      cwd: repositoryRoot,
    });
    await run('dotnet', [
      'build',
      hostProject,
      '--configuration',
      options.configuration,
      '--output',
      conformanceDirectory,
      '-p:BlokServerConformance=true',
    ], {
      cwd: repositoryRoot,
    });

    const vitestArgs = [
      join(repositoryRoot, 'node_modules/vitest/vitest.mjs'),
      'run',
      '--project=unit',
      'test/unit/server-conformance/server-contract.test.ts',
      'test/unit/server-conformance/sync-contract.test.ts',
      'test/unit/server-conformance/blok-client-contract.test.ts',
      'test/unit/server-conformance/protocol-v2-contract.test.ts',
    ];

    const reportPath = join(temporaryDirectory, 'vitest-report.json');

    if (options.testNamePattern !== undefined) {
      vitestArgs.push(
        '-t', options.testNamePattern,
        '--reporter=default',
        '--reporter=json',
        `--outputFile.json=${reportPath}`,
      );
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

    if (options.testNamePattern !== undefined) {
      await requireExecutedTests(reportPath, options.testNamePattern);
    }

    announceConfigurations(options.configuration);
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
