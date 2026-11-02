// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const probes = pathToFileURL(resolve(repositoryRoot, 'scripts/lib/server-probes.mjs')).href;

// Runs startProcess from a script started in "/", and prints the working
// directory the started process saw.
function workingDirectoryOf(options: string): string {
  const script = `
    import { once } from 'node:events';
    import { startProcess } from ${JSON.stringify(probes)};
    const running = startProcess(process.execPath, ['-e', 'process.stdout.write(process.cwd())'], ${options});
    await once(running.child, 'close');
    process.stdout.write(running.output());
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: '/', encoding: 'utf8' });

  expect(result.stderr).toBe('');

  return result.stdout;
}

describe('server-probes startProcess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ASP.NET takes its content root from the working directory, so a probe
  // must not depend on where the script was started.
  it('starts the host from the repository root by default', () => {
    expect(workingDirectoryOf('{}')).toBe(repositoryRoot);
  });

  it('lets a caller choose the working directory', () => {
    expect(workingDirectoryOf(`{ cwd: ${JSON.stringify(import.meta.dirname)} }`)).toBe(import.meta.dirname);
  });
});
