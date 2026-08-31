// @vitest-environment node
import { gunzipSync } from 'node:zlib';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TARGETS,
  assertMuslOverridesPresent,
  createArchive,
  parseArgs,
  publishCommand,
  renderChecksums,
} from '../../../scripts/publish-server.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const scriptPath = join(repositoryRoot, 'scripts', 'publish-server.mjs');

function targetFor(rid: string) {
  const target = TARGETS.find((entry) => entry.rid === rid);

  if (target === undefined) {
    throw new Error(`Missing test target ${rid}`);
  }

  return target;
}

function tarEntries(archive: Buffer): Array<{ name: string; mode: string; uid: string; gid: string; mtime: string; body: Buffer }> {
  const tar = gunzipSync(archive);
  const entries = [];
  let offset = 0;

  while (offset + 512 <= tar.length && tar[offset] !== 0) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const size = Number.parseInt(header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim(), 8);
    const bodyStart = offset + 512;

    entries.push({
      name,
      mode: header.subarray(100, 108).toString('ascii').replace(/\0.*$/, '').trim(),
      uid: header.subarray(108, 116).toString('ascii').replace(/\0.*$/, '').trim(),
      gid: header.subarray(116, 124).toString('ascii').replace(/\0.*$/, '').trim(),
      mtime: header.subarray(136, 148).toString('ascii').replace(/\0.*$/, '').trim(),
      body: tar.subarray(bodyStart, bodyStart + size),
    });

    offset = bodyStart + Math.ceil(size / 512) * 512;
  }

  return entries;
}

describe('publish-server', () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    vi.clearAllMocks();
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'blok-publish-server-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('maps exactly the eight external assets to their .NET RIDs', () => {
    expect(TARGETS).toEqual([
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
    ]);
  });

  it('parses the required version, optional output, and dry-run flag', () => {
    expect(parseArgs(
      ['--version', '1.10.1-beta.2', '--output', 'artifacts', '--dry-run'],
      '/repo',
    )).toEqual({
      version: '1.10.1-beta.2',
      output: resolve('/repo', 'artifacts'),
      dryRun: true,
    });
  });

  it.each([
    [[], '--version is required'],
    [['--version', 'v1.10.1'], 'invalid version'],
    [['--version', '1.10.1+build.1'], 'invalid version'],
    [['--version', '1.10.1', '--output'], '--output needs a value'],
    [['--version', '1.10.1', '--unknown'], 'unknown argument'],
  ])('rejects invalid arguments %#', (args, message) => {
    expect(() => parseArgs(args, '/repo')).toThrow(message);
  });

  it('constructs the exact self-contained single-file publish command', () => {
    expect(publishCommand(
      targetFor('osx-x64'),
      '1.10.1',
      '/scratch/osx-x64',
    )).toEqual({
      command: 'dotnet',
      args: [
        'publish',
        'packages/server/dotnet/Blok.Server.Host/Blok.Server.Host.csproj',
        '--configuration',
        'Release',
        '--runtime',
        'osx-x64',
        '--self-contained',
        'true',
        '--output',
        '/scratch/osx-x64',
        '-p:PublishSingleFile=true',
        '-p:IncludeNativeLibrariesForSelfExtract=true',
        '-p:DebugType=None',
        '-p:DebugSymbols=false',
        '-p:AssemblyName=blok-server',
        '-p:BlokServerVersion=1.10.1',
        '-p:ContinuousIntegrationBuild=true',
      ],
    });
  });

  it.each(TARGETS)('archives only $binary at the root of $archive', async (target) => {
    const executable = Buffer.from(`binary for ${target.rid}\n`);
    const archive = await createArchive(target, executable);

    if (target.archive.endsWith('.zip')) {
      const zip = await JSZip.loadAsync(archive);
      const files = Object.values(zip.files).filter((entry) => !entry.dir);

      expect(files.map((entry) => entry.name)).toEqual([target.binary]);
      await expect(files[0]?.async('nodebuffer')).resolves.toEqual(executable);

      return;
    }

    const entries = tarEntries(archive);

    expect(entries.map((entry) => entry.name)).toEqual([target.binary]);
    expect(entries[0]?.body).toEqual(executable);
  });

  it('fixes tar and zip metadata so the same executable produces identical bytes', async () => {
    const executable = Buffer.from('same executable');

    const firstTar = await createArchive(targetFor('osx-arm64'), executable);
    const secondTar = await createArchive(targetFor('osx-arm64'), executable);
    const [tarEntry] = tarEntries(firstTar);

    expect(secondTar).toEqual(firstTar);
    expect(tarEntry).toMatchObject({
      name: 'blok-server',
      mode: '0000755',
      uid: '0000000',
      gid: '0000000',
      mtime: '00000000000',
    });

    const firstZip = await createArchive(targetFor('win-arm64'), executable);
    const secondZip = await createArchive(targetFor('win-arm64'), executable);

    expect(secondZip).toEqual(firstZip);
    expect(firstZip.readUInt16LE(10)).toBe(0);
    expect(firstZip.readUInt16LE(12)).toBe(33);
  });

  it('renders sorted lowercase SHA-256 lines with two spaces and a trailing newline', () => {
    expect(renderChecksums([
      { name: 'z.zip', contents: Buffer.from('b') },
      { name: 'a.tar.gz', contents: Buffer.from('a') },
    ])).toBe(
      'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb  a.tar.gz\n' +
      '3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d  z.zip\n',
    );
  });

  it('dry-run prints all eight publish/archive operations without dotnet or release writes', () => {
    const output = join(temporaryDirectory, 'release');
    const result = spawnSync(
      process.execPath,
      [scriptPath, '--version', '1.10.1', '--output', output, '--dry-run'],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        env: { ...process.env, PATH: '' },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(output)).toBe(false);

    const lines = result.stdout.trim().split('\n');

    expect(lines).toHaveLength(TARGETS.length * 2);

    for (const target of TARGETS) {
      expect(lines.some((line) => line.includes(`--runtime ${target.rid}`))).toBe(true);
      expect(lines.some((line) => line.includes(target.archive))).toBe(true);
    }
  });

  it('refuses a musl publish while a CI-built libyrs override is missing', () => {
    const check = (): void => assertMuslOverridesPresent(TARGETS, temporaryDirectory);

    expect(check).toThrow(
      'packages/server/dotnet/Blok.Server.Host/runtimes/linux-musl-x64/native/libyrs.so',
    );
    expect(check).toThrow(
      'packages/server/dotnet/Blok.Server.Host/runtimes/linux-musl-arm64/native/libyrs.so',
    );
    expect(check).toThrow('build-musl-yffi');
  });

  it('accepts a publish once both musl overrides are staged', () => {
    for (const rid of ['linux-musl-x64', 'linux-musl-arm64']) {
      const override = join(
        temporaryDirectory,
        `packages/server/dotnet/Blok.Server.Host/runtimes/${rid}/native/libyrs.so`,
      );

      mkdirSync(dirname(override), { recursive: true });
      writeFileSync(override, 'stub');
    }

    expect(() => assertMuslOverridesPresent(TARGETS, temporaryDirectory)).not.toThrow();
  });
});
