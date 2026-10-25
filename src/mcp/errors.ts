import type { AgentError, AgentErrorCode, AgentResult } from '../../types/agent';
import type { Delivery, McpExecuteResult } from './session';

export type { Delivery } from './session';

const RETRYABLE = new Set<AgentErrorCode>(['ROOM_SYNC_TIMEOUT', 'SOURCE_UNAVAILABLE', 'DOCUMENT_CHANGED', 'HANDLE_LIMIT']);

export class McpSurfaceError extends Error {
  public readonly agentError: AgentError;

  constructor(code: AgentErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'McpSurfaceError';
    this.agentError = { code, message, retryable: RETRYABLE.has(code), ...(details !== undefined && { details }) };
  }
}

export const surfaceError = (code: AgentErrorCode, message: string, details?: Record<string, unknown>): McpSurfaceError =>
  new McpSurfaceError(code, message, details);

export const isMcpSurfaceError = (value: unknown): value is McpSurfaceError => value instanceof McpSurfaceError;

export const NO_DELIVERY: Delivery = Object.freeze({ durable: false, pending: false, serverSequence: null, savedVersion: null });

export const failedResult = (error: AgentError, warnings: AgentResult['warnings'] = []): McpExecuteResult => ({
  ok: false,
  error,
  warnings,
  delivery: NO_DELIVERY,
});

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/**
 * Whether a batch holds a known writing command. The batch is unchecked wire input: core's
 * checkEnvelope refuses a malformed one later, so this must not throw on it.
 * Unknown names do not count as writes; core answers them with UNKNOWN_COMMAND.
 */
export const isWriteBatch = (batch: unknown, readOnlyByName: ReadonlyMap<string, boolean | undefined>): boolean => {
  const commands = isRecord(batch) ? batch.commands : undefined;

  return Array.isArray(commands) && commands.some((command: unknown) =>
    isRecord(command) && typeof command.name === 'string' && readOnlyByName.get(command.name) === false);
};
