// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentError, AgentErrorCode, AgentResult } from '../../../types/agent';
import {
  failedResult,
  isMcpSurfaceError,
  McpSurfaceError,
  NO_DELIVERY,
  surfaceError,
} from '../../../src/mcp/errors';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('surface errors', () => {
  it('creates a catchable surface error without throwing', () => {
    expect(() => surfaceError('UNKNOWN_HANDLE', 'Open this document again.')).not.toThrow();
    const error = surfaceError('UNKNOWN_HANDLE', 'Open this document again.');

    expect(error.agentError).toEqual({
      code: 'UNKNOWN_HANDLE',
      message: 'Open this document again.',
      retryable: false,
    });
    expect(error).toBeInstanceOf(McpSurfaceError);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Open this document again.');
    expect(error.name).toBe('McpSurfaceError');
    expect(isMcpSurfaceError(error)).toBe(true);
  });

  const retryability: Array<{ code: AgentErrorCode; retryable: boolean }> = [
    { code: 'ROOM_SYNC_TIMEOUT', retryable: true },
    { code: 'SOURCE_UNAVAILABLE', retryable: true },
    { code: 'DOCUMENT_CHANGED', retryable: true },
    { code: 'HANDLE_LIMIT', retryable: true },
    { code: 'UNKNOWN_HANDLE', retryable: false },
    { code: 'FORBIDDEN', retryable: false },
    { code: 'ROOM_RESET', retryable: false },
    { code: 'REJECTED', retryable: false },
    { code: 'VERSION_SKEW', retryable: false },
    { code: 'STORED_WRITE_FORBIDDEN', retryable: false },
    { code: 'STALE', retryable: false },
    { code: 'CONFLICT', retryable: false },
    { code: 'CANCELLED', retryable: false },
  ];

  it.each(retryability)('reports $code retryable=$retryable', ({ code, retryable }) => {
    expect(surfaceError(code, 'Request failed.').agentError.retryable).toBe(retryable);
  });

  it('preserves rejection details', () => {
    const error = surfaceError('REJECTED', 'Update refused.', {
      rejectionCode: 'oversized-update',
      limit: 1024,
    });

    expect(error.agentError.details).toEqual({
      rejectionCode: 'oversized-update',
      limit: 1024,
    });
  });

  it('omits details when none were supplied', () => {
    expect(surfaceError('FORBIDDEN', 'Access denied.').agentError).not.toHaveProperty('details');
  });

  it('recognizes a directly constructed surface error', () => {
    const error = new McpSurfaceError('FORBIDDEN', 'Access denied.');

    expect(isMcpSurfaceError(error)).toBe(true);
    expect(error.agentError).toEqual({
      code: 'FORBIDDEN',
      message: 'Access denied.',
      retryable: false,
    });
  });

  it.each([
    undefined,
    null,
    false,
    0,
    'McpSurfaceError',
    new Error('Access denied.'),
    {
      name: 'McpSurfaceError',
      message: 'Access denied.',
      agentError: { code: 'FORBIDDEN', message: 'Access denied.', retryable: false },
    },
  ])('rejects a non-surface value %#', (value: unknown) => {
    expect(() => isMcpSurfaceError(value)).not.toThrow();
    expect(isMcpSurfaceError(value)).toBe(false);
  });

  it('returns a pre-session failure without a revision or delivery claim', () => {
    const error: AgentError = {
      code: 'UNKNOWN_HANDLE',
      message: 'Handle expired.',
      retryable: false,
    };
    expect(() => failedResult(error)).not.toThrow();
    const result = failedResult(error);

    expect('revision' in result).toBe(false);
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'UNKNOWN_HANDLE',
        message: 'Handle expired.',
        retryable: false,
      },
      warnings: [],
      delivery: {
        durable: false,
        pending: false,
        serverSequence: null,
        savedVersion: null,
      },
    });
    expect(result.delivery).toBe(NO_DELIVERY);
  });

  it('retains supplied warnings and error context in a failure', () => {
    const error: AgentError = {
      code: 'DATA_REJECTED',
      message: 'Invalid data.',
      retryable: false,
      commandIndex: 2,
      path: '/commands/2/args',
      details: { field: 'title' },
    };
    const warnings: AgentResult['warnings'] = [{
      code: 'SANITIZED',
      message: 'Unsupported mark removed.',
      commandIndex: 1,
      blockId: 'paragraph-1',
      field: 'text',
    }];
    const result = failedResult(error, warnings);

    expect(result.warnings).toEqual([{
      code: 'SANITIZED',
      message: 'Unsupported mark removed.',
      commandIndex: 1,
      blockId: 'paragraph-1',
      field: 'text',
    }]);
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'DATA_REJECTED',
        message: 'Invalid data.',
        retryable: false,
        commandIndex: 2,
        path: '/commands/2/args',
        details: { field: 'title' },
      },
    });
    expect('revision' in result).toBe(false);
    expect(result.delivery).toEqual({
      durable: false,
      pending: false,
      serverSequence: null,
      savedVersion: null,
    });
  });

  it('never claims durable or pending work in NO_DELIVERY', () => {
    expect(NO_DELIVERY).toEqual({
      durable: false,
      pending: false,
      serverSequence: null,
      savedVersion: null,
    });
  });
});
