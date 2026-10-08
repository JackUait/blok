// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentFailure, failure, RETRYABLE_CODES, warning } from '../../../../src/shared/agent/errors';
import { CORE_COMMAND_NAMES, isReservedNamespace, RESERVED_NAMESPACES, splitCommandName } from '../../../../src/shared/agent/names';
import { RESERVED_NAMESPACES as MANIFEST_RESERVED_NAMESPACES } from '../../../../src/shared/tool-manifest';

import type { AgentError, AgentErrorCode, CoreCommandName } from '../../../../types/agent';

const retryability: { [Code in AgentErrorCode]: readonly [Code, boolean] } = {
  INVALID_ARGS: ['INVALID_ARGS', false],
  UNKNOWN_COMMAND: ['UNKNOWN_COMMAND', false],
  UNKNOWN_TOOL: ['UNKNOWN_TOOL', false],
  BLOCK_NOT_FOUND: ['BLOCK_NOT_FOUND', false],
  FIELD_NOT_RICH_TEXT: ['FIELD_NOT_RICH_TEXT', false],
  FIELD_NOT_WRITABLE: ['FIELD_NOT_WRITABLE', false],
  RANGE_OUT_OF_BOUNDS: ['RANGE_OUT_OF_BOUNDS', false],
  RANGE_NOT_FOUND: ['RANGE_NOT_FOUND', false],
  PLACEMENT_REFUSED: ['PLACEMENT_REFUSED', false],
  CONVERSION_UNSUPPORTED: ['CONVERSION_UNSUPPORTED', false],
  DATA_REJECTED: ['DATA_REJECTED', false],
  PRECONDITION_FAILED: ['PRECONDITION_FAILED', false],
  COMMAND_UNAVAILABLE: ['COMMAND_UNAVAILABLE', false],
  READ_ONLY: ['READ_ONLY', false],
  STALE: ['STALE', true],
  CONFLICT: ['CONFLICT', true],
  UNDO_NOT_OWN: ['UNDO_NOT_OWN', false],
  NOTHING_TO_UNDO: ['NOTHING_TO_UNDO', false],
  CANCELLED: ['CANCELLED', true],
  TOOL_ACTION_FAILED: ['TOOL_ACTION_FAILED', false],
  ORPHANED_SIDE_EFFECT: ['ORPHANED_SIDE_EFFECT', false],
  APPLY_FAILED: ['APPLY_FAILED', false],
  UNKNOWN_HANDLE: ['UNKNOWN_HANDLE', false],
  HANDLE_LIMIT: ['HANDLE_LIMIT', false],
  FORBIDDEN: ['FORBIDDEN', false],
  ROOM_SYNC_TIMEOUT: ['ROOM_SYNC_TIMEOUT', false],
  ROOM_RESET: ['ROOM_RESET', false],
  REJECTED: ['REJECTED', false],
  VERSION_SKEW: ['VERSION_SKEW', false],
  DOCUMENT_CHANGED: ['DOCUMENT_CHANGED', false],
  STORED_WRITE_FORBIDDEN: ['STORED_WRITE_FORBIDDEN', false],
  SOURCE_UNAVAILABLE: ['SOURCE_UNAVAILABLE', false],
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('agent errors', () => {
  it.each(Object.values(retryability))('%s has retryable=%s', (code, retryable) => {
    expect(failure(code, 'x').error.retryable).toBe(retryable);
    expect(RETRYABLE_CODES.has(code)).toBe(retryable);
  });

  it('exposes only the three retryable codes', () => {
    expect([...RETRYABLE_CODES].sort()).toStrictEqual(['CANCELLED', 'CONFLICT', 'STALE']);
  });

  it('retains the typed payload and Error identity', () => {
    const error: AgentError = { code: 'INVALID_ARGS', message: 'Invalid arguments.', retryable: false };
    const thrown = new AgentFailure(error);

    expect(thrown.error).toBe(error);
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toBeInstanceOf(AgentFailure);
    expect(thrown.name).toBe('AgentFailure');
    expect(thrown.message).toBe('Invalid arguments.');
  });

  it('carries index, path and details', () => {
    const thrown = failure('BLOCK_NOT_FOUND', 'Block "z" not found.', {
      commandIndex: 2,
      path: '/commands/2/args/id',
      details: { id: 'z' },
    });

    expect(thrown.error).toStrictEqual({
      code: 'BLOCK_NOT_FOUND',
      message: 'Block "z" not found.',
      commandIndex: 2,
      path: '/commands/2/args/id',
      retryable: false,
      details: { id: 'z' },
    });
    expect(thrown).toBeInstanceOf(AgentFailure);
  });

  it('preserves index zero, an empty path and false or zero details', () => {
    const details = { enabled: false, count: 0 };
    const thrown = failure('INVALID_ARGS', 'm', { commandIndex: 0, path: '', details });

    expect(thrown.error).toStrictEqual({
      code: 'INVALID_ARGS',
      message: 'm',
      commandIndex: 0,
      path: '',
      retryable: false,
      details: { enabled: false, count: 0 },
    });
    expect(thrown.error.details).toBe(details);
  });

  it('omits absent failure metadata', () => {
    expect(failure('INVALID_ARGS', 'm').error).toStrictEqual({
      code: 'INVALID_ARGS',
      message: 'm',
      retryable: false,
    });
  });

  it('omits explicit undefined failure metadata', () => {
    expect(failure('INVALID_ARGS', 'm', {
      commandIndex: undefined,
      path: undefined,
      details: undefined,
    }).error).toStrictEqual({
      code: 'INVALID_ARGS',
      message: 'm',
      retryable: false,
    });
  });
});

describe('agent warnings', () => {
  it('omits absent warning metadata', () => {
    expect(warning('SANITIZED', 'm')).toStrictEqual({ code: 'SANITIZED', message: 'm' });
  });

  it('carries all defined warning fields', () => {
    expect(warning('DEMOTED', 'm', {
      commandIndex: 2,
      blockId: 'a',
      field: 'text',
    })).toStrictEqual({
      code: 'DEMOTED',
      message: 'm',
      commandIndex: 2,
      blockId: 'a',
      field: 'text',
    });
  });

  it('omits explicit undefined warning fields while retaining defined fields', () => {
    expect(warning('SANITIZED', 'm', {
      commandIndex: undefined,
      blockId: 'a',
      field: undefined,
    })).toStrictEqual({ code: 'SANITIZED', message: 'm', blockId: 'a' });
  });

  it('preserves index zero and empty string warning fields', () => {
    expect(warning('UNKNOWN_MARK_DROPPED', 'm', {
      commandIndex: 0,
      blockId: '',
      field: '',
    })).toStrictEqual({
      code: 'UNKNOWN_MARK_DROPPED',
      message: 'm',
      commandIndex: 0,
      blockId: '',
      field: '',
    });
  });
});

describe('command names', () => {
  it('lists exactly the 18 core commands', () => {
    const expected = [
      'doc.read', 'doc.find', 'doc.setTitle', 'doc.setIcon',
      'block.insert', 'block.update', 'block.delete', 'block.move', 'block.convert', 'block.duplicate',
      'text.insert', 'text.delete', 'text.replace', 'text.format',
      'markdown.insert', 'markdown.export',
      'history.undo', 'history.redo',
    ] satisfies readonly CoreCommandName[];

    expect(CORE_COMMAND_NAMES).toStrictEqual(expected);
  });

  it.each([
    { name: 'column_list.create', namespace: 'column_list', action: 'create' },
    { name: 'a.b.c', namespace: 'a', action: 'b.c' },
  ])('splits $name at the first dot', ({ name, namespace, action }) => {
    expect(splitCommandName(name)).toStrictEqual({ namespace, action });
  });

  it.each(['nodot', '.x', 'x.', ''])('rejects the incomplete command name "%s"', name => {
    expect(splitCommandName(name)).toBeNull();
  });

  it('re-exports the manifest reserved namespace binding', () => {
    expect(RESERVED_NAMESPACES).toBe(MANIFEST_RESERVED_NAMESPACES);
  });

  it.each(['doc', 'block', 'text', 'markdown', 'history'])('reserves the %s namespace', namespace => {
    expect(isReservedNamespace(namespace)).toBe(true);
  });

  it.each(['table', 'Doc', 'doc.read', ''])('does not reserve "%s"', namespace => {
    expect(isReservedNamespace(namespace)).toBe(false);
  });
});
