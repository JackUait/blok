// @vitest-environment node

// A host that should refuse its flags but starts anyway, or a test that never
// stops its server, must not leave a process running after that test.

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { runServerCommand, startServer } from './run-against';

const directory = mkdtempSync(join(tmpdir(), 'blok-harness-cleanup-'));

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

// Writes its pid, then never exits on its own.
const NEVER_EXITS = [
  '-e',
  "require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000);",
];

// Serves /health and prints the listening line, like a host that should have
// refused its flags but started anyway.
const STARTS_ANYWAY = [
  '-e',
  [
    "const [pidFile, , listen] = process.argv.slice(1);",
    "require('node:fs').writeFileSync(pidFile, String(process.pid));",
    "const [host, port] = listen.split(':');",
    "require('node:http').createServer((q, s) => s.end('{}')).listen(Number(port), host, () => {",
    "  process.stderr.write('fake listening on ' + listen + '\\n');",
    '});',
  ].join('\n'),
];

function pidFrom(file: string): number {
  return Number(readFileSync(file, 'utf8'));
}

async function waitForFile(file: string): Promise<void> {
  const deadline = Date.now() + 5_000;

  while (!existsSync(file)) {
    if (Date.now() > deadline) {
      throw new Error(`${file} never appeared`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

describe('the harness kills what a test leaves running', () => {
  const commandPidFile = join(directory, 'command.pid');
  const serverPidFile = join(directory, 'server.pid');

  it('leaves a command that never exits behind', async () => {
    void runServerCommand({
      command: process.execPath,
      args: [...NEVER_EXITS, commandPidFile],
      timeoutMs: 60_000,
    }).catch(() => undefined);

    await waitForFile(commandPidFile);
    expect(isAlive(pidFrom(commandPidFile))).toBe(true);
  });

  it('has killed that command once its test finished', () => {
    expect(isAlive(pidFrom(commandPidFile))).toBe(false);
  });

  it('leaves a started server behind without stopping it', async () => {
    await startServer({
      command: process.execPath,
      args: [...STARTS_ANYWAY, serverPidFile, '--listen', '127.0.0.1:0'],
    });

    expect(isAlive(pidFrom(serverPidFile))).toBe(true);
  });

  it('has killed that server once its test finished', () => {
    expect(isAlive(pidFrom(serverPidFile))).toBe(false);
  });
});
