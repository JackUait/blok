#!/usr/bin/env node
// Writes <site>/build-info.json: which commit, release family and content the
// deploy artifact holds, so the live site can be checked against the build.
//
// Usage: node scripts/docs-build-info.mjs <siteDir>
// In CI it also writes `sha` and `manifest` to $GITHUB_OUTPUT.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUILD_INFO_FILE = 'build-info.json';

const CONTENT_FILE = /\.(html|md)$/;

const listContentFiles = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && CONTENT_FILE.test(entry.name))
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();

/** One hash over every HTML and markdown file: path and bytes both count. */
export const contentManifest = (dir) => {
  const files = listContentFiles(dir);
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

export const createBuildInfo = ({ dir, sha, version, runId = null, builtAt }) => {
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error(`build info needs a full commit sha, got ${sha}`);
  const manifest = contentManifest(dir);
  return {
    sha,
    version,
    root: readRootRelease(dir),
    manifestHash: manifest.hash,
    files: manifest.files,
    builtAt,
    runId: runId || null,
  };
};

export const writeBuildInfo = (dir, info) => {
  writeFileSync(join(dir, BUILD_INFO_FILE), `${JSON.stringify(info, null, 2)}\n`);
};

const main = () => {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: docs-build-info.mjs <siteDir>');
    process.exit(1);
  }
  const dir = resolve(target);
  const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
  const info = createBuildInfo({
    dir,
    sha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
    version: JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version,
    runId: process.env.GITHUB_RUN_ID,
    builtAt: new Date().toISOString(),
  });
  writeBuildInfo(dir, info);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `sha=${info.sha}\nmanifest=${info.manifestHash}\n`);
  }
  console.log(`${BUILD_INFO_FILE}: ${info.sha} ${info.version} root=${info.root} ${info.files} files ${info.manifestHash}`);
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
