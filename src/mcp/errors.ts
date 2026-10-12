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
