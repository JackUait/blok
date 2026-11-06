/**
 * Black-box MCP conformance: drives one blok-mcp binary over stdio and HTTP
 * and checks it answers like the Node server, which is the oracle.
 *
 *   node scripts/test-mcp-conformance.mjs --target node|csharp|go|rust
 *     [--suite NAME]... [--test-name-pattern PATTERN] [--update] [--host go|csharp|rust]
 *
 * How a target is launched (LAUNCH below is the only place that says so):
 *   node    `node scripts/build-mcp.mjs`, then `node packages/mcp/bin/blok-mcp.mjs`.
 *   csharp  `dotnet build packages/server/dotnet/Blok.Mcp/Blok.Mcp.csproj -c Release -o <tmp>`,
 *           then the apphost `<tmp>/Blok.Mcp`.
 *   go      `go build -o <tmp>/blok-mcp ./cmd/blok-mcp` in packages/server/go.
 *   rust    `cargo build --release --locked -p blok-mcp` in packages/server/rust,
 *           then `target/release/blok-mcp` (copied out).
 * The binary gets only the flags and env vars a case names, exactly as a user
 * would pass them. There is no test-only build: the corpus suite maps the
 * spawned agent id to the golden one instead (see corpus.test.ts).
 *
 * How to add a case:
 *   1. Add an entry to a file in test/unit/mcp-conformance/fixtures/. One case
 *      is one JSON object with a unique "name". The format is described in
 *      test/unit/mcp-conformance/exchange.ts.
 *   2. Leave its "expect" fields out, and run
 *      `node scripts/test-mcp-conformance.mjs --target node --suite <file> --update`.
 *      Node writes what it answered into the fixture.
 *   3. Read the recorded answers. They are the contract for every port.
 *   A case with "fsVariants" (letter case of file names) is recorded once per
 *   kind of disk: run --update as above, then again with TMPDIR on a
 *   case-sensitive volume (macOS: `hdiutil create -fs 'Case-sensitive APFS'`),
 *   adding `--test-name-pattern '<case name>'` so only that case is re-recorded.
 * A case that fails on --target node after an engine change is regenerated the
 * same way; read the diff before committing it.
 *
 * The live suite also needs a sync host. `--host` picks which one (default go),
 * built the way scripts/test-server-conformance.mjs builds its conformance host,
 * and handed to the suite as BLOK_CONFORMANCE_SERVER. Its cases are recorded
 * from Node like every other suite; see live-room.ts for the room steps.
 */
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const suffix = process.platform === 'win32' ? '.exe' : '';

const SUITES = [
  'protocol',
  'tool-args',
  'corpus',
  'files-source',
  'endpoint-source',
  'cli',
  'http',
  'approvals',
  'tickets',
  'live',
];

const LIVE_SUITE = 'live';

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { ...options, stdio: 'inherit' });

    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      reject(new Error(`${command} exited with ${code === null ? `signal ${signal ?? 'unknown'}` : `code ${code}`}`));
    });
  });
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function missing(target, what) {
  return new Error(`The ${target} MCP target is not built yet: ${what}`);
}

const LAUNCH = {
  node: {
    async build() {
      await run(process.execPath, [join(repositoryRoot, 'scripts/build-mcp.mjs')], { cwd: repositoryRoot });

      return [process.execPath, join(repositoryRoot, 'packages/mcp/bin/blok-mcp.mjs')];
    },
  },
  csharp: {
    project: 'packages/server/dotnet/Blok.Mcp/Blok.Mcp.csproj',
    async build(temporaryDirectory) {
      const project = join(repositoryRoot, this.project);

      if (!await exists(project)) {
        throw missing('csharp', `${this.project} does not exist.`);
      }
      const output = join(temporaryDirectory, 'csharp-mcp');

      await run('dotnet', ['build', project, '--configuration', 'Release', '--output', output], { cwd: repositoryRoot });

      return [join(output, `Blok.Mcp${suffix}`)];
    },
  },
  go: {
    package: 'packages/server/go/cmd/blok-mcp',
    async build(temporaryDirectory) {
      if (!await exists(join(repositoryRoot, this.package))) {
        throw missing('go', `${this.package} does not exist.`);
      }
      const binary = join(temporaryDirectory, 'go-mcp', `blok-mcp${suffix}`);

      await run('go', ['build', '-o', binary, './cmd/blok-mcp'], { cwd: join(repositoryRoot, 'packages/server/go') });

      return [binary];
    },
  },
  rust: {
    crate: 'blok-mcp',
    async build(temporaryDirectory) {
      const workspace = join(repositoryRoot, 'packages/server/rust');
      const crates = join(workspace, 'crates');
      const manifests = await Promise.all((await readdir(crates)).map(async (name) => {
        const path = join(crates, name, 'Cargo.toml');

        return await exists(path) ? readFile(path, 'utf8') : '';
      }));

      if (!manifests.some((text) => new RegExp(`^name = "${this.crate}"$`, 'm').test(text))) {
        throw missing('rust', `no crate in ${relative(repositoryRoot, crates)} is named ${this.crate}.`);
      }
      const binary = join(temporaryDirectory, 'rust-mcp', `blok-mcp${suffix}`);

      await run('cargo', ['build', '--release', '--locked', '-p', this.crate], { cwd: workspace });
      await mkdir(dirname(binary), { recursive: true });
      await copyFile(join(workspace, 'target/release', `blok-mcp${suffix}`), binary);

      return [binary];
    },
  },
};

/** The sync host for the live suite: the same conformance builds test-server-conformance.mjs makes. */
const HOSTS = {
  go: async (temporaryDirectory) => {
    const binary = join(temporaryDirectory, 'go-host', `blok-server${suffix}`);

    await run('go', ['build', '-tags', 'conformance', '-o', binary, './cmd/blok-server'], { cwd: join(repositoryRoot, 'packages/server/go') });

    return binary;
  },
  csharp: async (temporaryDirectory) => {
    const output = join(temporaryDirectory, 'csharp-host');

    await run('dotnet', [
      'build', join(repositoryRoot, 'packages/server/dotnet/Blok.Server.Host/Blok.Server.Host.csproj'),
      '--configuration', 'Release', '--output', output, '-p:BlokServerConformance=true',
    ], { cwd: repositoryRoot });

    return join(output, `Blok.Server.Host${suffix}`);
  },
  rust: async (temporaryDirectory) => {
    const workspace = join(repositoryRoot, 'packages/server/rust');
    const binary = join(temporaryDirectory, 'rust-host', `blok-server${suffix}`);

    await run('cargo', ['build', '--release', '--locked', '-p', 'blok-server', '--features', 'conformance'], { cwd: workspace });
    await mkdir(dirname(binary), { recursive: true });
    await copyFile(join(workspace, 'target/release', `blok-server${suffix}`), binary);

    return binary;
  },
};

function usage() {
  return new Error(
    'Usage: node scripts/test-mcp-conformance.mjs --target node|csharp|go|rust ' +
    '[--suite NAME]... [--test-name-pattern PATTERN] [--update (node only)] [--host go|csharp|rust (live only)]\n' +
    `Suites: ${SUITES.join(', ')}.`,
  );
}

function selectedOptions(args) {
  const known = new Set(['--target', '--suite', '--test-name-pattern', '--update', '--host']);
  const valueFlags = new Set(['--target', '--suite', '--test-name-pattern', '--host']);

  for (let index = 0; index < args.length; index += 1) {
    if (!known.has(args[index])) {
      throw usage();
    }
    if (valueFlags.has(args[index])) {
      const value = args[index + 1];

      if (value === undefined || value === '' || value.startsWith('--')) {
        throw usage();
      }
      index += 1;
    }
  }

  const targetIndex = args.indexOf('--target');
  const target = targetIndex >= 0 ? args[targetIndex + 1] : undefined;
  const filterIndex = args.indexOf('--test-name-pattern');
  const testNamePattern = filterIndex >= 0 ? args[filterIndex + 1] : undefined;
  const suites = args.flatMap((arg, index) => (arg === '--suite' ? [args[index + 1]] : []));
  const update = args.includes('--update');
  const hostIndex = args.indexOf('--host');
  const host = hostIndex >= 0 ? args[hostIndex + 1] : 'go';

  if (
    target === undefined ||
    !Object.hasOwn(HOSTS, host) ||
    !Object.hasOwn(LAUNCH, target) ||
    (update && target !== 'node') ||
    suites.some((suite) => !SUITES.includes(suite))
  ) {
    throw usage();
  }

  return { target, testNamePattern, update, host, suites: suites.length > 0 ? suites : SUITES };
}

/**
 * Vitest exits 0 when nothing ran, and a test that skips itself reads as a
 * pass. So every run must execute something, and, unless a name pattern
 * filtered the run, every test must have run.
 */
async function requireExecutedTests(reportPath, testNamePattern) {
  let report;

  try {
    report = JSON.parse(await readFile(reportPath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read the vitest report at ${reportPath}: ${error instanceof Error ? error.message : error}`);
  }

  // -t reports every test it filters out as skipped.
  const notRun = testNamePattern !== undefined ? [] : (report.testResults ?? []).flatMap((file) => (file.assertionResults ?? [])
    .filter((test) => test.status !== 'passed' && test.status !== 'failed')
    .map((test) => `${relative(repositoryRoot, file.name)}: ${test.fullName} (${test.status})`));

  if (notRun.length > 0) {
    throw new Error(`These conformance tests did not run:\n${notRun.join('\n')}`);
  }

  const executed = (report.numPassedTests ?? 0) + (report.numFailedTests ?? 0);

  if (executed === 0) {
    throw new Error(
      testNamePattern === undefined
        ? 'The run executed no test.'
        : `--test-name-pattern ${JSON.stringify(testNamePattern)} ran no test. It is a CASE-SENSITIVE ` +
          'regular expression matched against the full test name.',
    );
  }
}

async function main() {
  const options = selectedOptions(process.argv.slice(2));
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'blok-mcp-conformance-'));

  try {
    const command = await LAUNCH[options.target].build(temporaryDirectory);
    const syncHost = options.suites.includes(LIVE_SUITE) ? await HOSTS[options.host](temporaryDirectory) : undefined;
    const reportPath = join(temporaryDirectory, 'vitest-report.json');
    const vitestArgs = [
      join(repositoryRoot, 'node_modules/vitest/vitest.mjs'),
      'run',
      '--project=unit',
      '--maxWorkers=2',
      ...options.suites.map((suite) => `test/unit/mcp-conformance/${suite}.test.ts`),
      '--reporter=default',
      '--reporter=json',
      `--outputFile.json=${reportPath}`,
      ...(options.testNamePattern === undefined ? [] : ['-t', options.testNamePattern]),
    ];

    console.log(`MCP conformance — target ${options.target}: ${JSON.stringify(command)}${syncHost === undefined ? '' : `, live host ${options.host}`}`);
    await run(process.execPath, vitestArgs, {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        BLOK_MCP_CONFORMANCE_COMMAND: JSON.stringify(command),
        BLOK_MCP_CONFORMANCE_TARGET: options.target,
        ...(syncHost !== undefined && { BLOK_CONFORMANCE_SERVER: syncHost }),
        ...(options.update && { BLOK_MCP_CONFORMANCE_UPDATE: '1' }),
      },
    });
    await requireExecutedTests(reportPath, options.testNamePattern);
    console.log(`MCP conformance passed for ${options.target} (suites: ${options.suites.join(', ')}).`);
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
