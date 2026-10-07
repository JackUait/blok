#!/usr/bin/env node
// Writes <site>/build-info.json: which commit, release family and content the
// deploy artifact holds, so the live site can be checked against the build.
// It also writes the same JSON to a proof file whose name is unique to this
// build, which the live check polls.
//
// Usage: node scripts/docs-build-info.mjs <siteDir> [--sources <file.json>]
// --sources is assemble-site.mjs's record of the root and archive release tags.
// In CI it also writes `sha`, `manifest`, `proof` (the proof file's path) and
// `root_tag` to $GITHUB_OUTPUT.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const BUILD_INFO_FILE = 'build-info.json';

const PROOF_DIR = 'build-info';

// Only this script's own output, at the site root: hashing it would change the
// hash it records.
const isOwnOutput = (file) => file === BUILD_INFO_FILE || file.startsWith(`${PROOF_DIR}/`);

const listDeployedFiles = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .filter((file) => !isOwnOutput(file))
    .sort();

/** One hash over every deployed file: path and bytes both count. */
export const contentManifest = (dir) => {
  const files = listDeployedFiles(dir);
  const hash = createHash('sha256');
  for (const file of files) {
    const fileHash = createHash('sha256').update(readFileSync(join(dir, file))).digest('hex');
    hash.update(`${file}\0${fileHash}\n`);
  }
  return { hash: hash.digest('hex'), files: files.length };
};

const readRootRelease = (dir) => {
  const path = join(dir, 'versions.json');
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')).latest ?? null;
};

/**
 * The proof file's path. The CDN drops query strings from its cache key and
 * caches both 200s and 404s, so the live check can only trust a name no
 * earlier deploy used. SHA and manifest alone repeat: a rerun, or two deploys
 * with the same bytes, would reuse the name. The run id and attempt make it
 * unique in CI; a local build has neither, so its build time stands in.
 */
export const proofPath = ({ sha, manifestHash, runId, runAttempt, builtAt }) => {
  const parts = runId ? [sha, manifestHash, runId, runAttempt ?? ''] : [sha, manifestHash, 'local', builtAt];
  return `/${PROOF_DIR}/${createHash('sha256').update(parts.join('\n')).digest('hex')}.json`;
};

/**
 * The root and archives are release snapshots built from their tags; only
 * /next/ comes from `sha`. `sources` names the tags.
 *
 * @param {{ dir: string, sha: string, version: string, runId?: string | null, runAttempt?: string | null, builtAt: string,
 *   sources?: { rootTag?: string | null, rootCommit?: string | null, archiveTags?: string[] } }} options
 */
export const createBuildInfo = ({ dir, sha, version, runId = null, runAttempt = null, builtAt, sources = {} }) => {
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error(`build info needs a full commit sha, got ${sha}`);
  const manifest = contentManifest(dir);
  const info = {
    sha,
    version,
    root: readRootRelease(dir),
    manifestHash: manifest.hash,
    files: manifest.files,
    builtAt,
    runId: runId || null,
    runAttempt: runAttempt || null,
    rootTag: sources.rootTag ?? null,
    rootCommit: sources.rootCommit ?? null,
    nextCommit: sha,
    archiveTags: sources.archiveTags ?? [],
  };
  return { ...info, proof: proofPath(info) };
};

export const writeBuildInfo = (dir, info) => {
  const json = `${JSON.stringify(info, null, 2)}\n`;
  writeFileSync(join(dir, BUILD_INFO_FILE), json);
  const proof = join(dir, info.proof.slice(1));
  mkdirSync(join(proof, '..'), { recursive: true });
  writeFileSync(proof, json);
};

const main = () => {
  const { positionals, values } = parseArgs({ options: { sources: { type: 'string' } }, allowPositionals: true });
  const target = positionals[0];
  if (!target) {
    console.error('Usage: docs-build-info.mjs <siteDir> [--sources <file.json>]');
    process.exit(1);
  }
  const dir = resolve(target);
  const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
  const info = createBuildInfo({
    dir,
    sha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
    version: JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    builtAt: new Date().toISOString(),
    sources: values.sources ? JSON.parse(readFileSync(resolve(values.sources), 'utf8')) : {},
  });
  writeBuildInfo(dir, info);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `sha=${info.sha}\nmanifest=${info.manifestHash}\nproof=${info.proof}\nroot_tag=${info.rootTag ?? ''}\n`,
    );
  }
  console.log(
    `${BUILD_INFO_FILE}: ${info.sha} ${info.version} root=${info.root} (${info.rootTag} @ ${info.rootCommit}) `
    + `archives=${info.archiveTags.join(',')} ${info.files} files ${info.manifestHash} proof=${info.proof}`,
  );
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
