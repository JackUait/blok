#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

import JSZip from 'jszip';

import { isReleaseVersion } from './release-version.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectPath = 'packages/server/dotnet/Blok.Server.Host/Blok.Server.Host.csproj';
const defaultOutput = '.server-release-dist';

export const TARGETS = [
  {
    platform: 'darwin',
    arch: 'x64',
    rid: 'osx-x64',
    archive: 'blok-server_darwin_amd64.tar.gz',
    binary: 'blok-server',
  },
  {
    platform: 'darwin',
    arch: 'arm64',
    rid: 'osx-arm64',
    archive: 'blok-server_darwin_arm64.tar.gz',
    binary: 'blok-server',
  },
  {
    platform: 'linux',
    arch: 'x64',
    rid: 'linux-x64',
    archive: 'blok-server_linux_amd64.tar.gz',
    binary: 'blok-server',
  },
  {
    platform: 'linux',
    arch: 'arm64',
    rid: 'linux-arm64',
    archive: 'blok-server_linux_arm64.tar.gz',
    binary: 'blok-server',
  },
  {
    platform: 'linux',
    arch: 'x64',
    rid: 'linux-musl-x64',
    archive: 'blok-server_linux_musl_amd64.tar.gz',
    binary: 'blok-server',
  },
  {
    platform: 'linux',
    arch: 'arm64',
    rid: 'linux-musl-arm64',
    archive: 'blok-server_linux_musl_arm64.tar.gz',
    binary: 'blok-server',
  },
  {
    platform: 'win32',
    arch: 'x64',
    rid: 'win-x64',
    archive: 'blok-server_windows_amd64.zip',
    binary: 'blok-server.exe',
  },
  {
    platform: 'win32',
    arch: 'arm64',
    rid: 'win-arm64',
    archive: 'blok-server_windows_arm64.zip',
    binary: 'blok-server.exe',
  },
];

/**
 * @param {string[]} args
 * @param {string} cwd
 * @returns {{ version: string, output: string, dryRun: boolean }}
 */
export function parseArgs(args, cwd = process.cwd()) {
  let version;
  let output = resolve(cwd, defaultOutput);
  let dryRun = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === '--version') {
      const value = args[index + 1];

      if (value === undefined || value.startsWith('--')) {
        throw new Error('--version needs a value');
      }

      version = value;
      index += 1;
      continue;
    }

    if (argument === '--output') {
      const value = args[index + 1];

      if (value === undefined || value.startsWith('--')) {
        throw new Error('--output needs a value');
      }

      output = resolve(cwd, value);
      index += 1;
      continue;
    }

    if (argument === '--dry-run') {
      dryRun = true;
      continue;
    }

    throw new Error(`unknown argument: ${argument}`);
  }

  if (version === undefined) {
    throw new Error('--version is required');
  }

  if (!isReleaseVersion(version)) {
    throw new Error(`invalid version: ${version}`);
  }

  return { version, output, dryRun };
}

/**
 * @param {(typeof TARGETS)[number]} target
 * @param {string} version
 * @param {string} publishDirectory
 * @returns {{ command: string, args: string[] }}
 */
export function publishCommand(target, version, publishDirectory) {
  return {
    command: 'dotnet',
    args: [
      'publish',
      projectPath,
      '--configuration',
      'Release',
      '--runtime',
      target.rid,
      '--self-contained',
      'true',
      '--output',
      publishDirectory,
      '-p:PublishSingleFile=true',
      '-p:DebugType=None',
      '-p:DebugSymbols=false',
      '-p:AssemblyName=blok-server',
      `-p:BlokServerVersion=${version}`,
      '-p:ContinuousIntegrationBuild=true',
    ],
  };
}

/**
 * @param {Buffer} header
 * @param {number} offset
 * @param {number} length
 * @param {string} value
 */
function writeTarField(header, offset, length, value) {
  header.write(value, offset, length, 'ascii');
}

/**
 * @param {string} name
 * @param {Buffer} contents
 * @returns {Buffer}
 */
function createTar(name, contents) {
  const header = Buffer.alloc(512);

  writeTarField(header, 0, 100, name);
  writeTarField(header, 100, 8, '0000755\0');
  writeTarField(header, 108, 8, '0000000\0');
  writeTarField(header, 116, 8, '0000000\0');
  writeTarField(header, 124, 12, `${contents.length.toString(8).padStart(11, '0')}\0`);
  writeTarField(header, 136, 12, '00000000000\0');
  header.fill(0x20, 148, 156);
  writeTarField(header, 156, 1, '0');
  writeTarField(header, 257, 6, 'ustar\0');
  writeTarField(header, 263, 2, '00');

  let checksum = 0;

  for (const byte of header) {
    checksum += byte;
  }

  writeTarField(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);

  const padding = Buffer.alloc((512 - (contents.length % 512)) % 512);

  return Buffer.concat([header, contents, padding, Buffer.alloc(1024)]);
}

/**
 * @param {{ archive: string, binary: string }} target
 * @param {Buffer} executable
 * @returns {Promise<Buffer>}
 */
export async function createArchive(target, executable) {
  if (target.archive.endsWith('.zip')) {
    const zip = new JSZip();

    zip.file(target.binary, executable, {
      binary: true,
      date: new Date(Date.UTC(1980, 0, 1)),
      unixPermissions: 0o100755,
    });

    return zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
      platform: 'UNIX',
      streamFiles: false,
    });
  }

  return gzipSync(createTar(target.binary, executable), {
    level: 9,
    mtime: 0,
  });
}

/**
 * @param {Array<{ name: string, contents: Buffer }>} archives
 * @returns {string}
 */
export function renderChecksums(archives) {
  const lines = archives
    .map(({ name, contents }) => ({
      name,
      digest: createHash('sha256').update(contents).digest('hex'),
    }))
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    .map(({ name, digest }) => `${digest}  ${name}`);

  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

/**
 * @param {{ version: string, output: string, dryRun: boolean }} options
 */
export async function publishArtifacts(options) {
  if (options.dryRun) {
    for (const target of TARGETS) {
      const publishDirectory = join('<scratch>', target.rid);
      const command = publishCommand(target, options.version, publishDirectory);

      console.log(`${command.command} ${command.args.join(' ')}`);
      console.log(
        `archive ${join(publishDirectory, target.binary)} -> ${join(options.output, target.archive)}`,
      );
    }

    return;
  }

  const scratch = mkdtempSync(join(tmpdir(), 'blok-server-publish-'));
  const archives = [];

  try {
    mkdirSync(options.output, { recursive: true });

    for (const target of TARGETS) {
      const publishDirectory = join(scratch, target.rid);
      const command = publishCommand(target, options.version, publishDirectory);

      console.log(`${command.command} ${command.args.join(' ')}`);

      const published = spawnSync(command.command, command.args, {
        cwd: repositoryRoot,
        stdio: 'inherit',
      });

      if (published.error) {
        throw new Error(`could not run dotnet: ${published.error.message}`);
      }

      if (published.status !== 0) {
        throw new Error(`dotnet publish exited with ${published.status} for ${target.rid}`);
      }

      const executable = readFileSync(join(publishDirectory, target.binary));
      const contents = await createArchive(target, executable);

      writeFileSync(join(options.output, target.archive), contents);
      archives.push({ name: target.archive, contents });
    }

    writeFileSync(join(options.output, 'checksums.txt'), renderChecksums(archives));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function main() {
  try {
    await publishArtifacts(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(`publish-server: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
