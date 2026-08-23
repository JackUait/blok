#!/usr/bin/env node
/**
 * npm wrapper for the blok-server Go binary.
 *
 * The package ships no binary. On first run it resolves the archive goreleaser
 * published for this platform on the GitHub release matching this package's
 * version, verifies it against that release's checksums.txt, unpacks it into a
 * cache directory, and execs it. Later runs go straight to the cached binary.
 *
 * The version is the family version, not a server version: every release moves
 * it whether or not the Go sources changed, which is why .github/workflows/
 * release-server.yml publishes archives on EVERY tag and skips only the image.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = 'https://github.com/JackUait/blok';
const IMAGE = 'ghcr.io/jackuait/blok-server';
const CHECKSUMS_FILE = 'checksums.txt';

const here = dirname(fileURLToPath(import.meta.url));

/** Mirrors the goos/goarch matrix in .goreleaser.yaml. */
const PLATFORMS = { darwin: 'darwin', linux: 'linux', win32: 'windows' };
const ARCHITECTURES = { x64: 'amd64', arm64: 'arm64' };

/**
 * @param {string} platform - process.platform
 * @param {string} arch - process.arch
 * @returns {{ os: string, arch: string, archive: string, binary: string } | null}
 */
export function resolveTarget(platform, arch) {
  const os = PLATFORMS[platform];
  const goarch = ARCHITECTURES[arch];

  if (os === undefined || goarch === undefined) {
    return null;
  }

  // Must match archives.name_template + format_overrides in .goreleaser.yaml.
  return {
    os,
    arch: goarch,
    archive: `blok-server_${os}_${goarch}.${os === 'windows' ? 'zip' : 'tar.gz'}`,
    binary: os === 'windows' ? 'blok-server.exe' : 'blok-server',
  };
}

/** Every platform this wrapper can serve, for the error message. */
export function supportedTargets() {
  return Object.keys(PLATFORMS)
    .flatMap((platform) => Object.keys(ARCHITECTURES).map((arch) => `${platform}/${arch}`));
}

/**
 * Read one asset's expected digest out of a goreleaser checksums file, whose
 * lines are `<sha256><two spaces><filename>`.
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
 * First of the candidate roots that actually accepts a write. A cache that
 * cannot be written is not an error yet — the temp directory is a fine second
 * home for a single run — so this only throws when nothing is writable.
 *
 * @param {string[]} candidates
 * @returns {string}
 */
function firstWritable(candidates) {
  const failures = [];

  for (const candidate of candidates) {
    try {
      mkdirSync(candidate, { recursive: true });

      const probe = join(candidate, `.write-probe-${process.pid}`);

      writeFileSync(probe, '');
      rmSync(probe, { force: true });

      return candidate;
    } catch (error) {
      failures.push(`${candidate} (${error.message})`);
    }
  }

  throw new Error(`no writable cache directory: ${failures.join('; ')}`);
}

/**
 * @param {string} url
 * @returns {Promise<Buffer>}
 */
async function download(url) {
  const response = await fetch(url);

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
 * @param {{ version: string, target: ReturnType<typeof resolveTarget>, destination: string }} opts
 */
async function fetchBinary({ version, target, destination }) {
  const base = `${REPO}/releases/download/v${version}`;
  // A 404 here means an unsigned download, so it aborts the run rather than
  // falling through to "verification unavailable, running it anyway".
  const checksums = (await download(`${base}/${CHECKSUMS_FILE}`)).toString('utf-8');
  const expected = checksumFor(checksums, target.archive);

  if (expected === null) {
    throw new Error(`${CHECKSUMS_FILE} for v${version} does not list ${target.archive}`);
  }

  const scratch = mkdtempSync(join(dirname(destination), '.download-'));

  try {
    const archive = await download(`${base}/${target.archive}`);
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
 * @param {string} version
 * @param {string} reason
 * @returns {string}
 */
export function fallbackMessage(version, reason) {
  return [
    `blok-server: ${reason}`,
    '',
    'The same build is published as a container image — run that instead:',
    // The service defaults to loopback, which nothing outside the container can
    // reach, so the published port needs an explicit bind address to match.
    `  docker run -p 4000:4000 ${IMAGE}:${version} --listen 0.0.0.0:4000`,
    '',
    `Or download it by hand: ${REPO}/releases/tag/v${version}`,
  ].join('\n');
}

async function main() {
  const { version } = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf-8'));
  const target = resolveTarget(process.platform, process.arch);

  if (target === null) {
    console.error(fallbackMessage(
      version,
      `no binary is published for ${process.platform}/${process.arch} (published: ${supportedTargets().join(', ')})`
    ));
    process.exit(1);
  }

  let binary;

  try {
    const root = firstWritable([
      join(cacheRoot(process.env, process.platform), version),
      join(tmpdir(), 'blok-server', version),
    ]);

    binary = join(root, target.binary);

    if (!existsSync(binary)) {
      await fetchBinary({ version, target, destination: binary });
    }
  } catch (error) {
    console.error(fallbackMessage(version, error.message));
    process.exit(1);
  }

  const result = spawnSync(binary, process.argv.slice(2), { stdio: 'inherit' });

  if (result.error) {
    console.error(fallbackMessage(version, `could not start ${binary}: ${result.error.message}`));
    process.exit(1);
  }

  process.exit(result.status ?? 1);
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
