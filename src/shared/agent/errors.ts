import type { AgentError, AgentErrorCode, AgentWarning, AgentWarningCode } from '../../../types/agent';

export const RETRYABLE_CODES: ReadonlySet<AgentErrorCode> = new Set<AgentErrorCode>(['STALE', 'CONFLICT', 'CANCELLED']);

export class AgentFailure extends Error {
  public readonly error: AgentError;

  constructor(error: AgentError) {
    super(error.message);
    this.name = 'AgentFailure';
    this.error = error;
  }
}

export const failure = (
  code: AgentErrorCode,
  message: string,
  extra: { commandIndex?: number; path?: string; details?: Record<string, unknown> } = {}
): AgentFailure => new AgentFailure({
  code,
  message,
  ...(extra.commandIndex !== undefined && { commandIndex: extra.commandIndex }),
  ...(extra.path !== undefined && { path: extra.path }),
  retryable: RETRYABLE_CODES.has(code),
  ...(extra.details !== undefined && { details: extra.details }),
});

export const warning = (
  code: AgentWarningCode,
  message: string,
  extra: Omit<AgentWarning, 'code' | 'message'> = {}
): AgentWarning => ({
  code,
  message,
  ...(extra.commandIndex !== undefined && { commandIndex: extra.commandIndex }),
  ...(extra.blockId !== undefined && { blockId: extra.blockId }),
  ...(extra.field !== undefined && { field: extra.field }),
});
