// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCli } from '../../../src/mcp/index';

class CliExit extends Error {
  constructor(public readonly code: number | string | null | undefined) {
    super('CLI requested exit');
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(process, 'exit').mockImplementation(code => {
    throw new CliExit(code);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runCli configuration boundary', () => {
  it('reports invalid options on stderr and requests exit code 2', async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('CLI configuration deadline exceeded')), 2_000);
    });

    try {
      await expect(Promise.race([runCli(['--schema', 'invalid'], {}), deadline]))
        .rejects.toMatchObject({ code: 2 });
      expect(console.error).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('blok-mcp: --schema'));
      expect(process.exit).toHaveBeenCalledExactlyOnceWith(2);
    } finally {
      clearTimeout(timer);
    }
  });
});
