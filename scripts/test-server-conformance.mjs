import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
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

// interop builds both servers and runs only INTEROP_SUITES: one directory,
// written by one server and served by the other.
const TARGETS = ['csharp', 'go', 'interop', 'rust'];

const INTEROP_SUITES = ['journal-interop-contract'];

const SUITES = [
  'harness-contract',
  'server-contract',
  'sync-contract',
  'blok-client-contract',
  'protocol-v2-contract',
  'mcp-agent-participant',
  'routing-contract',
  'host-cli-contract',
  'http-host-contract',
  'page-transfer-sidecar',
  'sync-transport-contract',
  'collab-http-contract',
];

// Suites that live outside test/unit/server-conformance.
const SUITE_PATHS = {
  'page-transfer-sidecar': 'test/unit/view/page-transfer-sidecar.server.test.ts',
};

function selectedOptions(args) {
  const targetIndex = args.indexOf('--target');
  const target = targetIndex >= 0 ? args[targetIndex + 1] : 'csharp';
  const filterIndex = args.indexOf('--test-name-pattern');
  const testNamePattern = filterIndex >= 0 ? args[filterIndex + 1] : undefined;
  const configurationIndex = args.indexOf('--configuration');
  const configuration = configurationIndex >= 0 ? args[configurationIndex + 1] : 'Debug';
  const suites = args.flatMap((arg, index) => (arg === '--suite' ? [args[index + 1]] : []));

  const allowed = target === 'interop' ? INTEROP_SUITES : SUITES;

  // Go and Rust have no Debug or Release choice here, so --configuration would mean nothing.
  if (
    !TARGETS.includes(target) ||
    ((target === 'go' || target === 'rust') && configurationIndex >= 0) ||
    (filterIndex >= 0 && (testNamePattern === undefined || testNamePattern === '')) ||
    !JOURNAL_CONFIGURATIONS.includes(configuration) ||
    suites.some((suite) => !allowed.includes(suite))
  ) {
    throw new Error(
      'Usage: node scripts/test-server-conformance.mjs [--target csharp|go|interop|rust] ' +
      '[--suite NAME]... [--test-name-pattern PATTERN] [--configuration Debug|Release (csharp and interop)]',
    );
  }

  return { target, testNamePattern, configuration, suites: suites.length > 0 ? suites : allowed };
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

async function buildCsharp(options, temporaryDirectory, executableSuffix, withOrdinary = true) {
  const ordinaryDirectory = join(temporaryDirectory, 'csharp-ordinary');
  const conformanceDirectory = join(temporaryDirectory, 'csharp-conformance');
  const hostProject = join(
    repositoryRoot,
    'packages/server/dotnet/Blok.Server.Host/Blok.Server.Host.csproj',
  );

  announceConfigurations(options.configuration);

  if (withOrdinary) {
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
  }
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

  return {
    ordinary: join(ordinaryDirectory, `Blok.Server.Host${executableSuffix}`),
    conformance: join(conformanceDirectory, `Blok.Server.Host${executableSuffix}`),
  };
}

function announceGo() {
  console.log('Conformance binaries — go: ordinary build, and one with -tags conformance.');
}

/** No -ldflags version stamp: the suite expects /health to report "dev". */
async function buildGo(temporaryDirectory, executableSuffix) {
  const ordinary = join(temporaryDirectory, 'go-ordinary', `blok-server${executableSuffix}`);
  const conformance = join(temporaryDirectory, 'go-conformance', `blok-server${executableSuffix}`);
  const moduleDirectory = join(repositoryRoot, 'packages/server/go');

  announceGo();

  await run('go', ['build', '-o', ordinary, './cmd/blok-server'], { cwd: moduleDirectory });
  await run('go', [
    'build',
    '-tags',
    'conformance',
    '-o',
    conformance,
    './cmd/blok-server',
  ], { cwd: moduleDirectory });

  return { ordinary, conformance };
}

function announceRust() {
  console.log('Conformance binaries — rust: release build, and one with --features conformance.');
}

/**
 * Both builds share one target directory, so the second only relinks. Each
 * binary is copied out at once: the next build writes the same path.
 */
async function buildRust(temporaryDirectory, executableSuffix) {
  const workspace = join(repositoryRoot, 'packages/server/rust');
  const built = join(workspace, 'target/release', `blok-server${executableSuffix}`);
  const binaries = {
    ordinary: join(temporaryDirectory, 'rust-ordinary', `blok-server${executableSuffix}`),
    conformance: join(temporaryDirectory, 'rust-conformance', `blok-server${executableSuffix}`),
  };

  announceRust();

  for (const [kind, features] of [['ordinary', []], ['conformance', ['--features', 'conformance']]]) {
    await run('cargo', ['build', '--release', '--locked', '-p', 'blok-server', ...features], { cwd: workspace });
    await mkdir(dirname(binaries[kind]), { recursive: true });
    await copyFile(built, binaries[kind]);
  }

  return binaries;
}

function announceSuites(options) {
  const all = options.suites === SUITES || options.suites === INTEROP_SUITES;
  console.log(`Conformance suites: ${all ? 'all' : options.suites.join(', ')}.`);
}

function announce(options) {
  announceSuites(options);
  if (options.target === 'rust') {
    announceRust();
    return;
  }
  if (options.target !== 'csharp') {
    announceGo();
  }
  if (options.target !== 'go') {
    announceConfigurations(options.configuration);
  }
}

/** Both conformance builds, each under its own name; no suite here needs an ordinary host. */
async function buildBoth(options, temporaryDirectory, executableSuffix) {
  const csharp = await buildCsharp(options, temporaryDirectory, executableSuffix, false);
  const go = await buildGo(temporaryDirectory, executableSuffix);

  return {
    ordinary: csharp.ordinary,
    conformance: csharp.conformance,
    interop: {
      BLOK_CONFORMANCE_CSHARP_SERVER: csharp.conformance,
      BLOK_CONFORMANCE_GO_SERVER: go.conformance,
    },
  };
}

async function main() {
  const options = selectedOptions(process.argv.slice(2));
  announceSuites(options);
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'blok-server-conformance-'));
  const executableSuffix = process.platform === 'win32' ? '.exe' : '';

  try {
    const build = {
      csharp: buildCsharp,
      go: (_options, ...rest) => buildGo(...rest),
      interop: buildBoth,
      rust: (_options, ...rest) => buildRust(...rest),
    };
    const binaries = await build[options.target](options, temporaryDirectory, executableSuffix);

    const vitestArgs = [
      join(repositoryRoot, 'node_modules/vitest/vitest.mjs'),
      'run',
      '--project=unit',
      ...options.suites.map((suite) => SUITE_PATHS[suite] ?? `test/unit/server-conformance/${suite}.test.ts`),
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
        BLOK_CONFORMANCE_ORDINARY_SERVER: binaries.ordinary,
        BLOK_CONFORMANCE_SERVER: binaries.conformance,
        BLOK_CONFORMANCE_TARGET: options.target,
        ...binaries.interop,
      },
    });

    if (options.testNamePattern !== undefined) {
      await requireExecutedTests(reportPath, options.testNamePattern);
    }

    announce(options);
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
