import type { AgentSession } from '../../types/agent';
import { AgentFailure, failure } from '../shared/agent/errors';
import type { AgentPorts } from '../shared/agent/types';

import type { Caller, DispatcherDeps } from './dispatcher';
import { isMcpSurfaceError } from './errors';
import type { HandleSession } from './session';

/**
 * Headless page.rename / page.setIcon: open the target page's own document
 * with the same opener (mode, authorize, tickets) as blok_open.
 */
export const createOpenPageDocument = (
  deps: {
    open: DispatcherDeps['open'];
    caller: Caller;
    isOpenDocument?: (pageId: string) => Promise<boolean>;
    track?: (closing: Promise<unknown>) => void;
    /** A live page write the room did not acknowledge in time. */
    unconfirmed?: () => void;
  },
): NonNullable<AgentPorts['openPageDocument']> => async (pageId, actor) => {
  // A second save of the open document would make this handle's version stale.
  if (await deps.isOpenDocument?.(pageId) === true) {
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
    // The write went out but no ack came; it may still land. The batch that made it says so in its delivery.
    execute: async (batch, options) => {
      const result = await session.execute(batch, options);

      if (result.ok && result.delivery.pending) {
        deps.unconfirmed?.();
      }

      return result;
    },
    log: () => [],
    // execute already saved (stored) or waited for acks (live), so close has nothing to flush.
    // The caller does not wait for close, so the server tracks it for shutdown.
    close: () => {
      deps.track?.(session.close('closed').catch((error: unknown) => console.error('blok-mcp: closing a page target failed', error)));
    },
  };

  return agent;
};

/**
 * A batch whose page.rename or page.setIcon went out unacknowledged is not durable, even when
 * the open document's own part was saved. Calls on one handle run one at a time, so a count
 * taken around execute belongs to that batch.
 */
export const createPageDeliveryTracker = (): { unconfirmed(): void; wrap(session: HandleSession): HandleSession } => {
  const state = { unconfirmed: 0 };

  return {
    unconfirmed: () => {
      state.unconfirmed += 1;
    },
    // Patched in place: a live session's durability is a getter that a spread would freeze.
    wrap: (session) => {
      const execute = session.execute.bind(session);

      Object.assign(session, {
        execute: async (...args: Parameters<HandleSession['execute']>) => {
          const before = state.unconfirmed;
          const result = await execute(...args);

          return result.ok && state.unconfirmed !== before
            ? { ...result, delivery: { ...result.delivery, durable: false, pending: true } }
            : result;
        },
      });

      return session;
    },
  };
};
