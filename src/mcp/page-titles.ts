import type { AgentSession } from '../../types/agent';
import { AgentFailure } from '../shared/agent/errors';
import type { AgentPorts } from '../shared/agent/types';

import type { Caller, DispatcherDeps } from './dispatcher';
import { isMcpSurfaceError } from './errors';

/**
 * Headless page.rename / page.setIcon: open the target page's own document
 * with the same opener (mode, authorize, tickets) as blok_open.
 */
export const createOpenPageDocument = (
  deps: { open: DispatcherDeps['open']; caller: Caller },
): NonNullable<AgentPorts['openPageDocument']> => async (pageId, actor) => {
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
    execute: (batch) => session.execute(batch),
    log: () => [],
    // execute already saved (stored) or waited for acks (live), so close has nothing to flush.
    close: () => {
      void session.close('closed').catch((error: unknown) => console.error('blok-mcp: closing a page target failed', error));
    },
  };

  return agent;
};
