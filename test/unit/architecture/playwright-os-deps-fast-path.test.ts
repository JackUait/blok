/**
 * The OS-deps script must not run `apt-get update` when the image's package
 * lists and the seeded .debs already satisfy Playwright: update waits about
 * 20s per index when the mirror's DNS fails. Runs against stubbed npx, sudo
 * and apt-get.
 */
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const script = resolve(
  __dirname,
  '../../../.github/actions/setup-playwright-browsers/install-os-deps.sh',
);

const MISSING_OUTPUT = [
  'Missing system dependencies (3):',
  '  fonts-ipafont-gothic',
  '  libstdc++6',
  '  xfonts-scalable:amd64',
].join('\n');

type Stub = {
  /** Exit codes for each `install-deps --dry-run` call, in order. */
  dryRunExits: number[];
  /** What the first dry run prints. */
  dryRunOutput: string;
  aptInstallExit?: number;
  fullInstallExit?: number;
};

let dir = '';

const writeStub = (name: string, body: string): void => {
  const path = join(dir, name);

  writeFileSync(path, `#!/bin/bash\n${body}\n`);
  chmodSync(path, 0o755);
};

const run = (stub: Stub): { calls: string[]; status: number | null } => {
  const log = join(dir, 'calls.log');
  const counter = join(dir, 'dry-runs');

  writeFileSync(log, '');
  writeFileSync(counter, '0');
  writeStub('sudo', '"$@"');
  writeStub('apt-get', `echo "apt-get $*" >> "${log}"; exit ${stub.aptInstallExit ?? 0}`);
  writeStub(
    'npx',
    [
      `echo "npx $*" >> "${log}"`,
      'if [[ " $* " == *" --dry-run "* ]]; then',
      `  n=$(cat "${counter}"); echo $((n + 1)) > "${counter}"`,
      `  codes=(${stub.dryRunExits.join(' ')})`,
      `  if (( n == 0 )); then printf '%s\\n' "${stub.dryRunOutput}"; fi`,
      '  exit "${codes[$n]:-0}"',
      'fi',
      `exit ${stub.fullInstallExit ?? 0}`,
    ].join('\n'),
  );

  const result = spawnSync('bash', [script, 'chromium', 'firefox'], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ''}` },
    encoding: 'utf8',
  });
  const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean);

  return { calls, status: result.status };
};

describe('Playwright OS-deps fast path (install-os-deps.sh)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), 'pw-os-deps-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it('touches no apt at all when every dependency is already installed', () => {
    const { calls, status } = run({
      dryRunExits: [0],
      dryRunOutput: 'All system dependencies are installed.',
    });

    expect(calls.filter((call) => call.startsWith('apt-get'))).toEqual([]);
    expect(calls).toEqual(['npx playwright install-deps --dry-run chromium firefox']);
    expect(status).toBe(0);
  });

  it('installs only the missing packages without apt-get update, then re-checks', () => {
    const { calls, status } = run({ dryRunExits: [1, 0], dryRunOutput: MISSING_OUTPUT });

    expect(calls.some((call) => call.includes('update'))).toBe(false);
    expect(calls.some((call) => call === 'npx playwright install-deps chromium firefox')).toBe(
      false,
    );
    expect(calls).toEqual([
      'npx playwright install-deps --dry-run chromium firefox',
      'apt-get install -y --no-install-recommends fonts-ipafont-gothic libstdc++6 xfonts-scalable:amd64',
      'npx playwright install-deps --dry-run chromium firefox',
    ]);
    expect(status).toBe(0);
  });

  it('falls back to the full install-deps when the dry run names no package', () => {
    const { calls, status } = run({
      dryRunExits: [1],
      dryRunOutput: "'apt-get install -s' exited with code 100:\nE: Unable to locate package libfoo",
    });

    expect(calls.at(-1)).toBe('npx playwright install-deps chromium firefox');
    expect(calls.filter((call) => call.startsWith('apt-get'))).toEqual([]);
    expect(status).toBe(0);
  });

  it('falls back to the full install-deps when the offline install fails', () => {
    const { calls, status } = run({
      dryRunExits: [1],
      dryRunOutput: MISSING_OUTPUT,
      aptInstallExit: 100,
    });

    expect(calls.at(-1)).toBe('npx playwright install-deps chromium firefox');
    expect(status).toBe(0);
  });

  it('falls back to the full install-deps when the re-check still finds gaps', () => {
    const { calls, status } = run({ dryRunExits: [1, 1], dryRunOutput: MISSING_OUTPUT });

    expect(calls.at(-1)).toBe('npx playwright install-deps chromium firefox');
    expect(status).toBe(0);
  });

  it('fails the step when the full install-deps fails', () => {
    const { calls, status } = run({
      dryRunExits: [1],
      dryRunOutput: 'nothing parseable',
      fullInstallExit: 1,
    });

    expect(calls.at(-1)).toBe('npx playwright install-deps chromium firefox');
    expect(status).not.toBe(0);
  });
});
