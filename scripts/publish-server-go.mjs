#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createArchive, parseArgs, renderChecksums } from './publish-server.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const moduleDirectory = join(repositoryRoot, 'packages/server/go');

// These names must never match publish-server.mjs's: the npm wrapper
// downloads blok-server_<os>_<arch> and checksums.txt, and runs the C# host.
export const CHECKSUMS_FILE = 'checksums-go.txt';

export const GO_TARGETS = [
  { goos: 'darwin', goarch: 'amd64', archive: 'blok-server-go_darwin_amd64.tar.gz', binary: 'blok-server' },
  { goos: 'darwin', goarch: 'arm64', archive: 'blok-server-go_darwin_arm64.tar.gz', binary: 'blok-server' },
  { goos: 'linux', goarch: 'amd64', archive: 'blok-server-go_linux_amd64.tar.gz', binary: 'blok-server' },
  { goos: 'linux', goarch: 'arm64', archive: 'blok-server-go_linux_arm64.tar.gz', binary: 'blok-server' },
  { goos: 'windows', goarch: 'amd64', archive: 'blok-server-go_windows_amd64.zip', binary: 'blok-server.exe' },
  { goos: 'windows', goarch: 'arm64', archive: 'blok-server-go_windows_arm64.zip', binary: 'blok-server.exe' },
];

// The Go blok-mcp. Its checksums go into the same checksums-go.txt.
export const GO_MCP_TARGETS = GO_TARGETS.map((target) => ({
  ...target,
  archive: target.archive.replace('blok-server-go_', 'blok-mcp-go_'),
  binary: target.binary.replace('blok-server', 'blok-mcp'),
  command: './cmd/blok-mcp',
}));

const ALL_TARGETS = [...GO_TARGETS, ...GO_MCP_TARGETS];

/**
 * The binary reads its /health version from main.version. Build info is no
 * substitute: a local build reports "(devel)" and a module build "v1.2.3".
 *
 * @param {(typeof GO_TARGETS)[number] & { command?: string }} target
 * @param {string} version
 * @param {string} output - the binary path
 * @returns {{ command: string, args: string[], cwd: string, env: Record<string, string> }}
 */
export function buildCommand(target, version, output) {
  return {
    command: 'go',
    args: [
      'build',
      '-trimpath',
      '-ldflags',
      `-s -w -X main.version=${version}`,
      '-o',
      output,
      target.command ?? './cmd/blok-server',
    ],
    cwd: moduleDirectory,
    env: { CGO_ENABLED: '0', GOOS: target.goos, GOARCH: target.goarch },
  };
}

/** @param {ReturnType<typeof buildCommand>} command */
function describeCommand(command) {
  const environment = Object.entries(command.env).map(([name, value]) => `${name}=${value}`);

  return [...environment, command.command, ...command.args].join(' ');
}

/**
 * @param {{ version: string, output: string, dryRun: boolean }} options
 */
export async function publishGoArtifacts(options) {
  if (options.dryRun) {
    for (const target of ALL_TARGETS) {
      const binary = join('<scratch>', `${target.goos}_${target.goarch}`, target.binary);

      console.log(describeCommand(buildCommand(target, options.version, binary)));
      console.log(`archive ${binary} -> ${join(options.output, target.archive)}`);
    }
    console.log(`checksums -> ${join(options.output, CHECKSUMS_FILE)}`);

    return;
  }

  const scratch = mkdtempSync(join(tmpdir(), 'blok-server-go-publish-'));
  const archives = [];

  try {
    mkdirSync(options.output, { recursive: true });

    for (const target of ALL_TARGETS) {
      const binary = join(scratch, `${target.goos}_${target.goarch}`, target.binary);
      const command = buildCommand(target, options.version, binary);

      console.log(describeCommand(command));

      const built = spawnSync(command.command, command.args, {
        cwd: command.cwd,
        env: { ...process.env, ...command.env },
        stdio: 'inherit',
      });

      if (built.error) {
        throw new Error(`could not run go: ${built.error.message}`);
      }

      if (built.status !== 0) {
        throw new Error(`go build exited with ${built.status} for ${target.goos}/${target.goarch}`);
      }

      const contents = await createArchive(target, readFileSync(binary));

      writeFileSync(join(options.output, target.archive), contents);
      archives.push({ name: target.archive, contents });
    }

    writeFileSync(join(options.output, CHECKSUMS_FILE), renderChecksums(archives));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function main() {
  try {
    await publishGoArtifacts(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(`publish-server-go: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
