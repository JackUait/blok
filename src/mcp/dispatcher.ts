import type { AgentApprover, AgentBatch } from '../../types/agent';
import { failure } from '../shared/agent/errors';
import type { ToolCall } from '../shared/agent/tool-call';
import {
  checkCall, errorOutcome, executeOutcome, listFollowUp, listingAnswer, modelFixable, openAnswer, pickDocument,
  type ListRequest, type ListResult, type OpenMode, type ToolOutcome,
} from '../shared/mcp/calls';

import { surfaceError } from './errors';
import type { HandleTable } from './handles';
import type { HandleSession } from './session';

export { LIFECYCLE_ARGUMENTS, UnknownToolError } from '../shared/mcp/calls';
export type { ListRequest, ListResult, ToolOutcome } from '../shared/mcp/calls';

export interface Caller {
  principal: string;
  clientName: string;
  scopes: readonly string[] | null;
}

export interface OpenRequest {
  documentId: string;
  mode: OpenMode;
  write: boolean;
}

export interface CallOptions {
  /** Aborted when the client cancels or its connection closes. */
  signal?: AbortSignal;
  /** The client's way to ask its person (MCP elicitation). Absent when the client has none. */
  approve?: AgentApprover;
}

export interface DispatcherDeps {
  handles: HandleTable;
  open(request: OpenRequest, caller: Caller): Promise<HandleSession>;
  list(request: ListRequest, caller: Caller): Promise<ListResult>;
  stillAllowed(caller: Caller, documentId: string, write: boolean): Promise<boolean>;
  handleIdleMs: number;
}

const ok = (structuredContent: Record<string, unknown>): ToolOutcome => ({
  structuredContent: structuredContent,
  isError: false,
});

export const createToolDispatcher = (
  deps: DispatcherDeps,
): ((name: string, args: Record<string, unknown>, caller: Caller, options?: CallOptions) => Promise<ToolOutcome>) => {
  const listDocuments = async (request: ListRequest, caller: Caller): Promise<ListResult & { queryMatched?: false }> => {
    const listing = await deps.list(request, caller);
    const followUp = listFollowUp(request, listing);

    return listingAnswer(listing, followUp === null ? undefined : await deps.list(followUp.relist, caller));
  };

  const onHandle = <T>(
    caller: Caller,
    handle: string,
    write: boolean,
    operation: (session: HandleSession) => Promise<T>,
  ): Promise<T> => deps.handles.use(handle, caller.principal, async (session, documentId) => {
    if (!(await deps.stillAllowed(caller, documentId, write))) {
      throw surfaceError('FORBIDDEN', 'You no longer have access to this document.');
    }

    return operation(session);
  });

  type OpenStep = { mode: OpenMode; write: boolean; view?: Record<string, unknown> } & ({ documentId: string } | { find: { query?: string } });

  const openDocument = async (step: OpenStep, caller: Caller, signal?: AbortSignal): Promise<ToolOutcome> => {
    if (!('find' in step)) {
      return openFound(step, step.documentId, undefined, caller, signal);
    }
    const picked = pickDocument(step.find, await listDocuments({ limit: 25, ...step.find }, caller));

    return 'listing' in picked
      ? ok({ ...picked.listing })
      : openFound(step, picked.id, { documentId: picked.id, title: picked.title }, caller, signal);
  };

  const openFound = async (
    step: OpenStep,
    documentId: string,
    found: { documentId: string; title: string | null } | undefined,
    caller: Caller,
    signal?: AbortSignal,
  ): Promise<ToolOutcome> => {
    // Opening can mint a ticket and join a room, so refuse at the cap first.
    const room = deps.handles.assertRoom(caller.principal);

    // Only a shared store answers later; the in-memory table keeps today's timing.
    if (room instanceof Promise) {
      await room;
    }
    const session = await deps.open({ documentId, mode: step.mode, write: step.write }, caller);

    try {
      const view = step.view === undefined ? undefined : await session.read(step.view);

      // Nobody would hold the handle: the catch below closes the session.
      if (signal?.aborted === true) {
        throw failure('CANCELLED', 'The request was cancelled before the document opened.');
      }
      const added = deps.handles.add(caller.principal, documentId, session);
      const handle = typeof added === 'string' ? added : await added;

      return ok(openAnswer({
        handle,
        session,
        expiresAfterIdleMs: deps.handleIdleMs,
        ...(found !== undefined && { found }),
        ...(view !== undefined && { view }),
      }));
    } catch (thrown) {
      await Promise.resolve().then(() => session.close('closed')).catch(() => undefined);
      throw thrown;
    }
  };

  const runCall = async (session: HandleSession, call: ToolCall, options: CallOptions): Promise<ToolOutcome> => {
    if (call.name === 'blok_read') {
      return ok({ ...await session.read(call.view) });
    }
    if (call.name === 'blok_describe') {
      return ok({ ...session.describe(call.query) });
    }
    // Unchecked on purpose: core's checkEnvelope refuses a malformed batch, as it does for Ask AI.
    const batch = call.batch as unknown as AgentBatch;
    const result = await (options.approve === undefined ? session.execute(batch) : session.execute(batch, { approve: options.approve }));

    return executeOutcome(result);
  };

  const closeHandle = async (caller: Caller, handle: string): Promise<ToolOutcome> => {
    // A refused or failed check still closes, so the handle does not keep its --max-handles slot.
    // An unknown handle fails again in remove. remove waits for use, so it must run outside the callback.
    const refusal = await deps.handles.peek(handle, caller.principal, async (documentId) => {
      if (!(await deps.stillAllowed(caller, documentId, false))) {
        throw surfaceError('FORBIDDEN', 'You no longer have access to this document.');
      }
    }).then(() => null, (thrown: unknown) => ({ thrown }));
    const session = await deps.handles.remove(handle, caller.principal);
    const summary = await session.close('closed');

    if (refusal !== null) {
      throw refusal.thrown;
    }

    return ok({ closed: true, ...summary });
  };

  return async (name, args, caller, options = {}): Promise<ToolOutcome> => {
    try {
      const step = checkCall(name, args, caller.scopes);

      switch (step.tool) {
        case 'blok_list_documents':
          return ok({ ...await listDocuments(step.list, caller) });
        case 'blok_open':
          return await openDocument(step, caller, options.signal);
        case 'blok_close':
          return await closeHandle(caller, step.handle);
        case 'blok_read':
        case 'blok_describe':
        case 'blok_execute':
          return await onHandle(caller, step.handle, step.write, session => runCall(session, step.call, options));
      }
    } catch (thrown) {
      const error = modelFixable(thrown);

      if (error === null) {
        throw thrown;
      }

      return errorOutcome(name, error);
    }
  };
};
