// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isMcpSurfaceError } from '../../../src/mcp/errors';
import { resolveMode } from '../../../src/mcp/mode';

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();

    return undefined;
  } catch (thrown) {
    return isMcpSurfaceError(thrown) ? thrown.agentError.code : 'other';
  }
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveMode', () => {
  it('auto picks live when a sync URL is configured, else stored', () => {
    expect(resolveMode('auto', true)).toBe('live');
    expect(resolveMode('auto', false)).toBe('stored');
  });

  it('refuses stored next to a sync service', () => {
    expect(codeOf(() => resolveMode('stored', true))).toBe('STORED_WRITE_FORBIDDEN');
    expect(resolveMode('stored', false)).toBe('stored');
  });

  it('refuses live without a sync URL', () => {
    expect(codeOf(() => resolveMode('live', false))).toBe('INVALID_ARGS');
    expect(resolveMode('live', true)).toBe('live');
  });
});
