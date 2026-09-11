// @vitest-environment node
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runInOwnProcessGroup, findOrphanedWorkers, reapOrphanedWorkers } from '../../../scripts/mutant-sweep.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'sweep-timeout-'));

const spawned: number[] = [];

const hangScript = (pidFile: string, exitCode: number) => {
  const script = join(scratch, `hang-${spawned.length}-${Date.now()}.sh`);

  // The grandchild's stdio goes to /dev/null: inheriting the pipe would keep it
  // open and block spawnSync past the parent's exit, which is a property of the
  // pipe and not of anything under test.
  writeFileSync(script, [
    "node -e 'setInterval(()=>{},1000)' >/dev/null 2>&1 &",
    `echo $! > ${pidFile}`,
    exitCode === 0 ? 'exit 0' : 'wait',
  ].join('\n'));

  return script;
};

const runScript = (script: string, timeout: number) => runInOwnProcessGroup('zsh', [script], timeout);

const readPid = (pidFile: string) => {
  const pid = Number(readFileSync(pidFile, 'utf8').trim());

  spawned.push(pid);

  return pid;
};

// `process.kill(pid, 0)` is not enough: right after a SIGKILL the process is a
// zombie that still answers to signal 0, and the assertion would fail on a
// process the kernel has already killed. `ps` reports the state, where a zombie
// and a reaped process are both dead.
const isAlive = (pid: number) => {
  const { stdout } = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
  const state = stdout.trim();

  return state !== '' && !state.startsWith('Z');
};

afterEach(() => {
  for (const pid of spawned.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already reaped by the code under test.
    }
  }
});

describe('runInOwnProcessGroup', () => {
  // The child here is vitest and the grandchild is a `forks.js` worker. A
  // timeout kills the direct child only, so the worker survives, reparents to
  // PID 1 and spins with nothing left to reap it. Measured 2026-09-11: eight
  // such orphans, nineteen hours, about 640% of an eleven-core machine.
  it('leaves no worker alive when the timeout fires', () => {
    const pidFile = join(scratch, `pid-${Date.now()}`);

    runScript(hangScript(pidFile, 1), 2000);

    expect(isAlive(readPid(pidFile))).toBe(false);
  });

  // Killing the group unconditionally would be a different bug: a run that
  // finishes normally must not have its process group shot out from under it.
  it('leaves a normally-finished run alone', () => {
    const pidFile = join(scratch, `pid-${Date.now()}`);

    runScript(hangScript(pidFile, 0), 30000);

    expect(isAlive(readPid(pidFile))).toBe(true);
  });
});

describe('findOrphanedWorkers', () => {
  const worker = (pid: number, ppid: number, command = '/repo/node_modules/vitest/dist/workers/forks.js') =>
    `  ${pid}   ${ppid} ${command}`;

  it('selects a worker whose parent is gone', () => {
    expect(findOrphanedWorkers(worker(4242, 1))).toEqual([4242]);
  });

  // The whole selector rests on this: a worker whose vitest parent is alive is
  // doing its job, and killing it would abort a run that is still going.
  it('ignores a worker whose vitest parent is still alive', () => {
    expect(findOrphanedWorkers(worker(4242, 999))).toEqual([]);
  });

  it('ignores a long-lived node process that is not a vitest worker', () => {
    expect(findOrphanedWorkers(worker(4242, 1, '/repo/node_modules/vite/bin/vite.js'))).toEqual([]);
  });

  it('finds every orphan in one pass', () => {
    const ps = [worker(11, 1), worker(22, 7), worker(33, 1)].join('\n');

    expect(findOrphanedWorkers(ps)).toEqual([11, 33]);
  });

  // Why the selector keys on the worker's own command line and not on the
  // checkout it belongs to: a sweep runs in a worktree whose `scripts/` is a
  // real directory but whose `node_modules` is a symlink to the main checkout's.
  // Node resolves that symlink into the worker's argv, so the path in the
  // command line names the MAIN repo while the sweep runs in the worktree. Any
  // filter comparing the two would find nothing exactly where sweeps happen.
  it('matches a worktree worker whose argv names the shared node_modules', () => {
    const fromWorktree = worker(
      4242,
      1,
      '/main/node_modules/vitest/dist/workers/forks.js',
    );

    expect(findOrphanedWorkers(fromWorktree)).toEqual([4242]);
  });
});

/**
 * The selector can be right about every column offset and still reap nothing,
 * because `ps` itself is the thing being parsed. These drive real processes
 * through the real `ps`.
 */
describe('reapOrphanedWorkers', () => {
  const workerArgv = join(resolve(__dirname, '../../..'), 'node_modules/vitest/dist/workers/forks.js');

  const parentOf = (pid: number) => {
    const { stdout } = spawnSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' });

    return Number(stdout.trim());
  };

  const waitForParentOne = async (pid: number) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (parentOf(pid) === 1) {
        return;
      }

      await new Promise((done) => setTimeout(done, 20));
    }
  };

  it('kills a real orphaned worker', async () => {
    const pidFile = join(scratch, `orphan-${Date.now()}`);
    const script = join(scratch, `orphan-${Date.now()}.sh`);

    // The shell exits at once, so its child reparents to PID 1 — the state the
    // eight leaked workers were in.
    writeFileSync(script, [
      `node -e 'setInterval(()=>{},1000)' ${workerArgv} >/dev/null 2>&1 &`,
      `echo $! > ${pidFile}`,
    ].join('\n'));

    spawnSync('zsh', [script], { encoding: 'utf8' });

    const orphan = readPid(pidFile);

    await waitForParentOne(orphan);

    expect(isAlive(orphan)).toBe(true);

    reapOrphanedWorkers();

    expect(isAlive(orphan)).toBe(false);
  });

  // The counterpart: the same command line, but with a parent that is still
  // running. Killing this one would abort a sweep mid-run.
  it('spares an identical worker whose parent is still alive', () => {
    const control = spawn('node', ['-e', 'setInterval(()=>{},1000)', workerArgv], { stdio: 'ignore' });

    spawned.push(control.pid ?? 0);

    expect(parentOf(control.pid ?? 0)).not.toBe(1);

    reapOrphanedWorkers();

    expect(isAlive(control.pid ?? 0)).toBe(true);
  });
});
