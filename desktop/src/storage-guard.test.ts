import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StaleFileError, readFile, writeFile } from './storage';

interface Bridge { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> }

function installBridge(invoke: Bridge['invoke']): void {
  (window as unknown as { __TAURI_INTERNALS__?: Bridge }).__TAURI_INTERNALS__ = { invoke };
}

/**
 * The app held each document in memory and rewrote it whole on every save,
 * checking nothing. Anything that touched the file underneath — an agent over
 * MCP, another window, a sync tool — was silently overwritten. A whole page of
 * work was lost that way.
 */
describe('storage overwrite guard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { __TAURI_INTERNALS__?: Bridge }).__TAURI_INTERNALS__;
  });

  it('sends the fingerprint of what it read, so a save cannot clobber a newer file', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    installBridge(async (command, args) => {
      calls.push({ command, args });
      return command === 'load_workspace_file' ? '{"blocks":[]}' : null;
    });

    await readFile('doc');
    await writeFile('doc', '{"blocks":[1]}');

    const save = calls.find((c) => c.command === 'save_workspace_file');
    expect(typeof save?.args?.expected).toBe('string');
    expect((save?.args?.expected as string).length).toBeGreaterThan(0);
  });

  it('raises StaleFileError when the file changed underneath, instead of overwriting', async () => {
    installBridge(async (command) => {
      if (command === 'load_workspace_file') return '{"blocks":[]}';
      throw new Error('stale workspace file');
    });

    await readFile('doc');
    await expect(writeFile('doc', '{"blocks":[1]}')).rejects.toBeInstanceOf(StaleFileError);
  });

  it('saves a file it never read without a fingerprint, so new documents still work', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    installBridge(async (command, args) => { calls.push({ command, args }); return null; });

    await writeFile('brand-new', '{}');
    const save = calls.find((c) => c.command === 'save_workspace_file');
    expect(save?.args?.expected).toBeUndefined();
  });
});
