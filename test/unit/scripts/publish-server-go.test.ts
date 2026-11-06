// @vitest-environment node
import { gunzipSync } from 'node:zlib';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CHECKSUMS_FILE,
  GO_MCP_TARGETS,
  GO_TARGETS,
  buildCommand,
} from '../../../scripts/publish-server-go.mjs';
import { TARGETS, createArchive } from '../../../scripts/publish-server.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const scriptPath = join(repositoryRoot, 'scripts', 'publish-server-go.mjs');

describe('publish-server-go', () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    vi.clearAllMocks();
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'blok-publish-server-go-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  // A static binary (cgo off) has no libc to match, so there is no musl pair.
  it('maps exactly six Go archives to their GOOS and GOARCH', () => {
    expect(GO_TARGETS).toEqual([
      { goos: 'darwin', goarch: 'amd64', archive: 'blok-server-go_darwin_amd64.tar.gz', binary: 'blok-server' },
      { goos: 'darwin', goarch: 'arm64', archive: 'blok-server-go_darwin_arm64.tar.gz', binary: 'blok-server' },
      { goos: 'linux', goarch: 'amd64', archive: 'blok-server-go_linux_amd64.tar.gz', binary: 'blok-server' },
      { goos: 'linux', goarch: 'arm64', archive: 'blok-server-go_linux_arm64.tar.gz', binary: 'blok-server' },
      { goos: 'windows', goarch: 'amd64', archive: 'blok-server-go_windows_amd64.zip', binary: 'blok-server.exe' },
      { goos: 'windows', goarch: 'arm64', archive: 'blok-server-go_windows_arm64.zip', binary: 'blok-server.exe' },
    ]);
    expect(CHECKSUMS_FILE).toBe('checksums-go.txt');
  });

  // blok-mcp ships beside the Go server, under names no server archive uses.
  it('maps exactly six Go MCP archives that build cmd/blok-mcp', () => {
    expect(GO_MCP_TARGETS).toEqual([
      { goos: 'darwin', goarch: 'amd64', archive: 'blok-mcp-go_darwin_amd64.tar.gz', binary: 'blok-mcp', command: './cmd/blok-mcp' },
      { goos: 'darwin', goarch: 'arm64', archive: 'blok-mcp-go_darwin_arm64.tar.gz', binary: 'blok-mcp', command: './cmd/blok-mcp' },
      { goos: 'linux', goarch: 'amd64', archive: 'blok-mcp-go_linux_amd64.tar.gz', binary: 'blok-mcp', command: './cmd/blok-mcp' },
      { goos: 'linux', goarch: 'arm64', archive: 'blok-mcp-go_linux_arm64.tar.gz', binary: 'blok-mcp', command: './cmd/blok-mcp' },
      { goos: 'windows', goarch: 'amd64', archive: 'blok-mcp-go_windows_amd64.zip', binary: 'blok-mcp.exe', command: './cmd/blok-mcp' },
      { goos: 'windows', goarch: 'arm64', archive: 'blok-mcp-go_windows_arm64.zip', binary: 'blok-mcp.exe', command: './cmd/blok-mcp' },
    ]);

    const target = GO_MCP_TARGETS.find((entry) => entry.goos === 'linux' && entry.goarch === 'amd64');

    expect(target && buildCommand(target, '2.0.1', '/scratch/blok-mcp').args).toEqual([
      'build',
      '-trimpath',
      '-ldflags',
      '-s -w -X main.version=2.0.1',
      '-o',
      '/scratch/blok-mcp',
      './cmd/blok-mcp',
    ]);
  });

  // The npm wrapper downloads the C# names and checksums.txt. Sharing one
  // would swap the binary it runs.
  it('never reuses a C# archive name or the C# checksums file', () => {
    const csharpNames = new Set([...TARGETS.map((target) => target.archive), 'checksums.txt']);

    expect([...GO_TARGETS, ...GO_MCP_TARGETS].map((target) => target.archive).concat(CHECKSUMS_FILE)
      .filter((name) => csharpNames.has(name))).toEqual([]);
  });

  it('builds a static, trimmed binary with the version stamped in', () => {
    const target = GO_TARGETS.find((entry) => entry.goos === 'linux' && entry.goarch === 'arm64');

    expect(target).toBeDefined();
    expect(target && buildCommand(target, '1.10.1-beta.2', '/scratch/linux_arm64/blok-server')).toEqual({
      command: 'go',
      args: [
        'build',
        '-trimpath',
        '-ldflags',
        '-s -w -X main.version=1.10.1-beta.2',
        '-o',
        '/scratch/linux_arm64/blok-server',
        './cmd/blok-server',
      ],
      cwd: join(repositoryRoot, 'packages/server/go'),
      env: { CGO_ENABLED: '0', GOOS: 'linux', GOARCH: 'arm64' },
    });
  });

  it.each(GO_TARGETS)('archives only $binary at the root of $archive', async (target) => {
    const executable = Buffer.from(`binary for ${target.goos}/${target.goarch}\n`);
    const archive = await createArchive(target, executable);

    if (target.archive.endsWith('.zip')) {
      expect(archive.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
      expect(archive.includes(Buffer.from(target.binary))).toBe(true);

      return;
    }

    const tar = gunzipSync(archive);

    expect(tar.subarray(0, 100).toString('utf8').replace(/\0[\s\S]*$/, '')).toBe(target.binary);
  });

  it('dry-run prints every build and archive without go or release writes', () => {
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

    expect(lines).toHaveLength((GO_TARGETS.length + GO_MCP_TARGETS.length) * 2 + 1);

    for (const target of [...GO_TARGETS, ...GO_MCP_TARGETS]) {
      const command = 'command' in target ? target.command : './cmd/blok-server';

      expect(lines).toContain(
        `CGO_ENABLED=0 GOOS=${target.goos} GOARCH=${target.goarch} go build -trimpath -ldflags -s -w -X main.version=1.10.1 ` +
        `-o ${join('<scratch>', `${target.goos}_${target.goarch}`, target.binary)} ${command}`,
      );
      expect(lines).toContain(
        `archive ${join('<scratch>', `${target.goos}_${target.goarch}`, target.binary)} -> ${join(output, target.archive)}`,
      );
    }
    expect(lines.at(-1)).toBe(`checksums -> ${join(output, 'checksums-go.txt')}`);
  });

  it('refuses a version that is not a release version', () => {
    const result = spawnSync(process.execPath, [scriptPath, '--version', 'v1.10.1', '--dry-run'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('publish-server-go: invalid version: v1.10.1');
  });
});
