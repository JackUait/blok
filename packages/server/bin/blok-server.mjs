#!/usr/bin/env node
/**
 * npm wrapper for the published blok-server binary.
 *
 * The package ships no binary. On first run it resolves the archive published
 * for this platform on the matching GitHub release, verifies checksums.txt,
 * unpacks it into a cache directory, and runs it. Later runs use the cache.
 *
 * The release and npm package use the same family version.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = 'https://github.com/JackUait/blok';
const IMAGE = 'ghcr.io/jackuait/blok-server';
const CHECKSUMS_FILE = 'checksums.txt';
const DOWNLOAD_TIMEOUT_MS = 30_000;

const here = dirname(fileURLToPath(import.meta.url));

const PLATFORMS = { darwin: 'darwin', linux: 'linux', win32: 'windows' };
const ARCHITECTURES = { x64: 'amd64', arm64: 'arm64' };
const RUNTIMES = {
  darwin: { x64: 'osx-x64', arm64: 'osx-arm64' },
  linux: { x64: 'linux-x64', arm64: 'linux-arm64' },
  win32: { x64: 'win-x64', arm64: 'win-arm64' },
};

/**
 * @param {{ header?: { glibcVersionRuntime?: string } }} [report] Node process report.
 * @returns {'glibc' | 'musl'} Linux C library.
 */
export function detectLinuxLibc(
  report = process.report === undefined ? undefined : process.report.getReport(),
) {
  return report?.header?.glibcVersionRuntime === undefined ? 'musl' : 'glibc';
}

/**
 * @param {string} platform - process.platform
 * @param {string} arch - process.arch
 * @param {'glibc' | 'musl'} [libc] Linux C library.
 * @returns {{ os: string, arch: string, rid: string, archive: string, binary: string } | null}
 */
export function resolveTarget(platform, arch, libc = 'glibc') {
  const os = PLATFORMS[platform];
  const archiveArch = ARCHITECTURES[arch];
  const rid = platform === 'linux' && libc === 'musl'
    ? RUNTIMES.linux?.[arch]?.replace('linux-', 'linux-musl-')
    : RUNTIMES[platform]?.[arch];

  if (os === undefined || archiveArch === undefined || rid === undefined) {
    return null;
  }

  const archiveOs = platform === 'linux' && libc === 'musl'
    ? 'linux_musl'
    : os;

  return {
    os,
    arch: archiveArch,
    rid,
    archive: `blok-server_${archiveOs}_${archiveArch}.${os === 'windows' ? 'zip' : 'tar.gz'}`,
    binary: os === 'windows' ? 'blok-server.exe' : 'blok-server',
  };
}

/** Every platform this wrapper can serve, for the error message. */
export function supportedTargets() {
  return Object.keys(PLATFORMS)
    .flatMap((platform) => Object.keys(ARCHITECTURES).map((arch) => `${platform}/${arch}`));
}

/**
 * Read one asset's expected digest from a release checksums file, whose lines
 * are `<sha256><two spaces><filename>`.
 *
 * @param {string} contents - checksums.txt body
 * @param {string} assetName - the archive filename to look up
 * @returns {string | null} lowercase hex digest, or null when unlisted
 */
export function checksumFor(contents, assetName) {
  for (const line of contents.split('\n')) {
    const [digest, name] = line.trim().split(/\s+/);

    if (name === assetName && /^[0-9a-f]{64}$/i.test(digest ?? '')) {
      return digest.toLowerCase();
    }
  }

  return null;
}

/**
 * Where the binary is cached. The env override exists for locked-down machines
 * where the home directory is read-only but some other path is not.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string} platform - process.platform
 * @returns {string}
 */
export function cacheRoot(env, platform) {
  if (env.BLOK_SERVER_CACHE_DIR) {
    return env.BLOK_SERVER_CACHE_DIR;
  }

  if (platform === 'win32') {
    return join(env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'blok-server', 'Cache');
  }

  if (platform === 'darwin') {
    return join(homedir(), 'Library', 'Caches', 'blok-server');
  }

  return join(env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'blok-server');
}

/**
 * Use the persistent cache when it is writable. Otherwise make a private,
 * per-run directory so another local user cannot predict the launcher path.
 *
 * @param {string} persistentRoot
 * @param {string} temporaryParent
 * @returns {{ root: string, temporary: boolean }}
 */
export function prepareInstallRoot(persistentRoot, temporaryParent = tmpdir()) {
  let persistentFailure;

  try {
    mkdirSync(persistentRoot, { recursive: true });

    const probe = mkdtempSync(join(persistentRoot, '.write-probe-'));

    rmSync(probe, { recursive: true, force: true });

    return { root: persistentRoot, temporary: false };
  } catch (error) {
    persistentFailure = `${persistentRoot} (${error.message})`;
  }

  let temporaryRoot;

  try {
    temporaryRoot = mkdtempSync(join(temporaryParent, 'blok-server-'));
    chmodSync(temporaryRoot, 0o700);

    return { root: temporaryRoot, temporary: true };
  } catch (error) {
    if (temporaryRoot !== undefined) {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }

    throw new Error(
      `no writable cache directory: ${persistentFailure}; ${temporaryParent} (${error.message})`,
    );
  }
}

/**
 * @param {string} url
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<Buffer>}
 */
async function download(url, fetchImpl) {
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`GET ${url} → ${response.status} ${response.statusText}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

/**
 * Download, verify and unpack the archive, leaving the binary at `destination`.
 *
 * Everything happens inside a scratch directory next to the destination, and the
 * finished binary is moved into place with a single rename: a run interrupted at
 * any point leaves a scratch directory, never a truncated binary at the path the
 * next run would execute.
 *
 * @param {{
 *   version: string,
 *   target: NonNullable<ReturnType<typeof resolveTarget>>,
 *   destination: string,
 *   fetchImpl?: typeof fetch,
 * }} opts
 */
export async function installBinary({ version, target, destination, fetchImpl = fetch }) {
  const base = `${REPO}/releases/download/v${version}`;
  // A 404 here means an unsigned download, so the run must stop.
  const checksums = (
    await download(`${base}/${CHECKSUMS_FILE}`, fetchImpl)
  ).toString('utf-8');
  const expected = checksumFor(checksums, target.archive);

  if (expected === null) {
    throw new Error(`${CHECKSUMS_FILE} for v${version} does not list ${target.archive}`);
  }

  const scratch = mkdtempSync(join(dirname(destination), '.download-'));

  try {
    const archive = await download(`${base}/${target.archive}`, fetchImpl);
    const actual = createHash('sha256').update(archive).digest('hex');

    if (actual !== expected) {
      throw new Error(`checksum mismatch for ${target.archive}: expected ${expected}, got ${actual}`);
    }

    const archivePath = join(scratch, target.archive);

    writeFileSync(archivePath, archive);

    // -xf, never -xzf: bsdtar (macOS, and tar.exe on Windows) detects gzip and
    // zip on its own, and -z would reject the Windows zip outright.
    const extracted = spawnSync('tar', ['-xf', archivePath, '-C', scratch], { stdio: 'inherit' });

    if (extracted.error) {
      throw new Error(`could not run tar: ${extracted.error.message}`);
    }

    if (extracted.status !== 0) {
      throw new Error(`tar exited with ${extracted.status} unpacking ${target.archive}`);
    }

    const unpacked = join(scratch, target.binary);

    if (!existsSync(unpacked)) {
      throw new Error(`${target.archive} did not contain ${target.binary}`);
    }

    chmodSync(unpacked, 0o755);

    try {
      renameSync(unpacked, destination);
    } catch (error) {
      // A concurrent run may have won the race; its binary passed the same
      // checksum, so it is just as good. Windows rejects rename-over-existing.
      if (!existsSync(destination)) {
        throw error;
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Run the native host while keeping the npm wrapper responsive to termination.
 *
 * @param {string} binary
 * @param {string[]} args
 * @returns {Promise<{ code: number | null, signal: NodeJS.Signals | null }>}
 */
export function runBinary(binary, args) {
  const child = spawn(binary, args, { stdio: 'inherit' });

  return new Promise((resolvePromise, reject) => {
    const forwardSigint = () => child.kill('SIGINT');
    const forwardSigterm = () => child.kill('SIGTERM');
    const removeSignalHandlers = () => {
      process.off('SIGINT', forwardSigint);
      process.off('SIGTERM', forwardSigterm);
    };

    process.on('SIGINT', forwardSigint);
    process.on('SIGTERM', forwardSigterm);

    child.once('error', (error) => {
      removeSignalHandlers();
      reject(error);
    });
    child.once('exit', (code, signal) => {
      removeSignalHandlers();
      resolvePromise({ code, signal });
    });
  });
}

/**
 * @param {string} version
 * @param {string} reason
 * @returns {string}
 */
export function fallbackMessage(version, reason) {
  return [
    `blok-server: ${reason}`,
    '',
    'The same build is published as a container image — run that instead:',
    `  docker run --network host ${IMAGE}:${version} --listen 127.0.0.1:4000 --auth proxy`,
    '',
    `Or download it by hand: ${REPO}/releases/tag/v${version}`,
  ].join('\n');
}

async function main() {
  const { version } = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf-8'));
  const libc = process.platform === 'linux' ? detectLinuxLibc() : 'glibc';
  const target = resolveTarget(process.platform, process.arch, libc);

  if (target === null) {
    console.error(fallbackMessage(
      version,
      `no binary is published for ${process.platform}/${process.arch} (published: ${supportedTargets().join(', ')})`
    ));
    process.exit(1);
  }

  let binary;
  let temporaryRoot;

  try {
    const prepared = prepareInstallRoot(
      join(cacheRoot(process.env, process.platform), version, target.rid),
    );

    binary = join(prepared.root, target.binary);
    temporaryRoot = prepared.temporary ? prepared.root : undefined;

    if (!existsSync(binary)) {
      await installBinary({ version, target, destination: binary });
    }
  } catch (error) {
    if (temporaryRoot !== undefined) {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }

    console.error(fallbackMessage(version, error.message));
    process.exit(1);
  }

  let result;

  try {
    result = await runBinary(binary, process.argv.slice(2));
  } catch (error) {
    console.error(fallbackMessage(version, `could not start ${binary}: ${error.message}`));
    process.exit(1);
  } finally {
    if (temporaryRoot !== undefined) {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }

  if (result.signal !== null) {
    process.kill(process.pid, result.signal);
    return;
  }

  process.exit(result.code ?? 1);
}

// Importing this file (the unit tests do) must not start a download.
//
// argv[1] MUST be realpath'd: npm installs a bin as node_modules/.bin/blok-server,
// a symlink to this file, and Node resolves import.meta.url through that symlink
// while leaving argv[1] as the link. Comparing them raw makes every `npx` run
// exit 0 having done nothing at all.
let isDirectRun = false;

if (process.argv[1] !== undefined) {
  try {
    isDirectRun = import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    isDirectRun = false;
  }
}

if (isDirectRun) {
  await main();
}
