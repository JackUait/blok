import type { AgentSession } from '../../types/agent';
import { AgentFailure, failure } from '../shared/agent/errors';
import type { AgentPorts } from '../shared/agent/types';

import type { Caller, DispatcherDeps } from './dispatcher';
import { failedResult, isMcpSurfaceError, surfaceError } from './errors';

/**
 * Headless page.rename / page.setIcon: open the target page's own document
 * with the same opener (mode, authorize, tickets) as blok_open.
 */
export const createOpenPageDocument = (
  deps: { open: DispatcherDeps['open']; caller: Caller; documentId?: string },
): NonNullable<AgentPorts['openPageDocument']> => async (pageId, actor) => {
  // A second save of the open document would make this handle's version stale.
  if (pageId === deps.documentId) {
    throw failure('INVALID_ARGS', 'This page block points at the document you have open. Use doc.setTitle or doc.setIcon instead.', { details: { pageId } });
  }
  // 01's executor keeps only an AgentFailure's code; anything else becomes TOOL_ACTION_FAILED.
  const session = await deps.open({ documentId: pageId, mode: 'auto', write: true }, deps.caller).catch((thrown: unknown) => {
    throw isMcpSurfaceError(thrown)
      ? new AgentFailure({ ...thrown.agentError, details: { ...thrown.agentError.details, pageId } })
      : thrown;
  });
  const agent: AgentSession & { close(): void } = {
    id: `page:${pageId}`,
    actor,
    read: (args) => session.read(args ?? {}),
    describe: (query) => session.describe(query ?? {}),
    // close() follows at once and drops unacked rows, so a pending write is a failed one.
    execute: async (batch) => {
      const result = await session.execute(batch);

      return result.ok && result.delivery.pending
        ? failedResult(surfaceError('SOURCE_UNAVAILABLE', 'The room did not confirm the page write in time. It was not saved; try again.', { pending: true }).agentError, result.warnings)
        : result;
    },
    log: () => [],
    // execute already saved (stored) or waited for acks (live), so close has nothing to flush.
    close: () => {
      void session.close('closed').catch((error: unknown) => console.error('blok-mcp: closing a page target failed', error));
    },
  };

  return agent;
};
