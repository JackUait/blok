import type { AgentBatch, AgentError } from '../../types/agent';
import { AgentFailure, failure } from '../shared/agent/errors';
import { modelAnswer } from '../shared/agent/model-answer';
import { parseToolCall, toolErrorAnswer, unknownArgument, type AgentToolName, type ToolCall } from '../shared/agent/tool-call';

import { isMcpSurfaceError, NO_DELIVERY, surfaceError } from './errors';
import type { HandleRegistry } from './handles';
import type { HandleSession } from './session';

export interface Caller {
  principal: string;
  clientName: string;
  scopes: readonly string[] | null;
}

export interface ToolOutcome {
  structuredContent: Record<string, unknown>;
  isError: boolean;
}

export interface OpenRequest {
  documentId: string;
  mode: 'auto' | 'live' | 'stored';
  write: boolean;
}

export interface CallOptions {
  /** Aborted when the client cancels or its connection closes. */
  signal?: AbortSignal;
}

export interface ListRequest {
  query?: string;
  cursor?: string;
  limit: number;
}

export interface ListResult {
  documents: Array<{ id: string; title: string | null; live: boolean }>;
  nextCursor: string | null;
  supported: boolean;
}

export interface DispatcherDeps {
  handles: HandleRegistry<HandleSession>;
  open(request: OpenRequest, caller: Caller): Promise<HandleSession>;
  list(request: ListRequest, caller: Caller): Promise<ListResult>;
  stillAllowed(caller: Caller, documentId: string, write: boolean): Promise<boolean>;
  handleIdleMs: number;
}

export class UnknownToolError extends Error {
  public constructor(name: string) {
    super(`Unknown tool: ${name}`);
    this.name = 'UnknownToolError';
  }
}

const requireScope = (caller: Caller, scope: 'blok.read' | 'blok.write'): void => {
  if (caller.scopes !== null && !caller.scopes.includes(scope)) {
    throw surfaceError('FORBIDDEN', `This call needs the ${scope} scope.`, { requiredScope: scope });
  }
};

const handleOf = (args: Record<string, unknown>): string => {
  if (typeof args.handle !== 'string' || args.handle === '') {
    throw surfaceError('INVALID_ARGS', 'handle must be the string blok_open returned.');
  }

  return args.handle;
};

const MODES: ReadonlySet<unknown> = new Set(['auto', 'live', 'stored']);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The arguments each lifecycle tool takes: its inputSchema properties (src/mcp/tools.ts). Others are refused.
 * The core tools take `handle` plus what src/shared/agent/tool-call.ts accepts.
 */
export const LIFECYCLE_ARGUMENTS: Readonly<Record<string, readonly string[]>> = {
  blok_list_documents: ['query', 'cursor', 'limit'],
  blok_open: ['documentId', 'query', 'mode', 'write', 'view'],
  blok_close: ['handle'],
};

const refuseUnknownArguments = (name: string, args: Record<string, unknown>): void => {
  const accepted = Object.hasOwn(LIFECYCLE_ARGUMENTS, name) ? LIFECYCLE_ARGUMENTS[name] : undefined;
  const extra = accepted === undefined ? null : unknownArgument(name, args, accepted);

  if (extra !== null) {
    throw new AgentFailure(extra);
  }
};

const CORE_SCOPES: Readonly<Record<AgentToolName, 'blok.read' | 'blok.write'>> = {
  blok_read: 'blok.read',
  blok_describe: 'blok.read',
  blok_execute: 'blok.write',
};

const isCoreTool = (name: string): name is AgentToolName => Object.hasOwn(CORE_SCOPES, name);

// Core throws AgentFailure for model-fixable input (a bad view, an unknown tool).
const modelFixable = (thrown: unknown): AgentError | null => {
  if (isMcpSurfaceError(thrown)) {
    return thrown.agentError;
  }

  return thrown instanceof AgentFailure ? thrown.error : null;
};

const listRequestOf = (args: Record<string, unknown>): ListRequest => {
  if ((args.limit !== undefined && typeof args.limit !== 'number')
    || (args.query !== undefined && typeof args.query !== 'string')
    || (args.cursor !== undefined && typeof args.cursor !== 'string')) {
    throw surfaceError('INVALID_ARGS', 'limit must be a number; query and cursor must be strings.');
  }

  return {
    limit: typeof args.limit === 'number' ? Math.min(Math.max(Math.trunc(args.limit), 1), 100) : 25,
    ...(typeof args.query === 'string' && { query: args.query }),
    ...(typeof args.cursor === 'string' && { cursor: args.cursor }),
  };
};

const ok = (structuredContent: Record<string, unknown>): ToolOutcome => ({
  structuredContent: structuredContent,
  isError: false,
});

export const createToolDispatcher = (
  deps: DispatcherDeps,
): ((name: string, args: Record<string, unknown>, caller: Caller, options?: CallOptions) => Promise<ToolOutcome>) => {
  // A miss on the first page lists everything, so the model does not call again without query.
  const listDocuments = async (request: ListRequest, caller: Caller): Promise<ListResult & { queryMatched?: false }> => {
    const listing = await deps.list(request, caller);
    const missed = request.query !== undefined && request.cursor === undefined && listing.supported && listing.documents.length === 0;

    return missed ? { ...await deps.list({ limit: request.limit }, caller), queryMatched: false } : { ...listing };
  };

  // Without an id, blok_open opens only a document it cannot get wrong: the one document when no query is
  // given, or the one whose id or title equals the query. A part-match could be the wrong document.
  const findDocument = async (query: unknown, caller: Caller): Promise<{ id: string; title: string | null } | { listing: ListResult }> => {
    requireScope(caller, 'blok.read');
    const trimmed = typeof query === 'string' ? query.trim() : '';
    const needle = trimmed.toLowerCase();
    const listing = await listDocuments({ limit: 25, ...(trimmed !== '' && { query: trimmed }) }, caller);
    const candidates = needle === ''
      ? listing.documents
      : listing.documents.filter(doc => doc.id.toLowerCase() === needle || doc.title?.trim().toLowerCase() === needle);

    // With more pages, another exact match could be on one of them.
    if (candidates.length !== 1 || listing.nextCursor !== null) {
      return { listing };
    }

    return { id: candidates[0].id, title: candidates[0].title };
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

  const openDocument = async (args: Record<string, unknown>, caller: Caller, signal?: AbortSignal): Promise<ToolOutcome> => {
    if (args.write !== undefined && typeof args.write !== 'boolean') {
      throw surfaceError('INVALID_ARGS', 'write must be true or false.');
    }
    const write = args.write === true;

    requireScope(caller, write ? 'blok.write' : 'blok.read');
    if (args.documentId !== undefined
      && (typeof args.documentId !== 'string' || args.documentId === '' || args.documentId.length > 512)) {
      throw surfaceError('INVALID_ARGS', 'documentId must be a string of 1 to 512 characters.');
    }
    if (args.documentId === undefined && args.query !== undefined && typeof args.query !== 'string') {
      throw surfaceError('INVALID_ARGS', 'query must be a string.');
    }
    if (args.mode !== undefined && !MODES.has(args.mode)) {
      throw surfaceError('INVALID_ARGS', 'mode must be "auto", "live" or "stored".');
    }
    if (args.view !== undefined && !isPlainObject(args.view)) {
      throw surfaceError('INVALID_ARGS', 'view must be an object of blok_read arguments.');
    }
    const mode = args.mode === 'live' || args.mode === 'stored' ? args.mode : 'auto';
    const found = typeof args.documentId === 'string' ? null : await findDocument(args.query, caller);

    if (found !== null && 'listing' in found) {
      return ok({ ...found.listing });
    }
    const documentId = found === null ? String(args.documentId) : found.id;

    // Opening can mint a ticket and join a room, so refuse at the cap first.
    deps.handles.assertRoom(caller.principal);
    const session = await deps.open({ documentId, mode, write }, caller);

    try {
      const view = isPlainObject(args.view) ? await session.read(args.view) : undefined;

      // Nobody would hold the handle: the catch below closes the session.
      if (signal?.aborted === true) {
        throw failure('CANCELLED', 'The request was cancelled before the document opened.');
      }
      const handle = deps.handles.add(caller.principal, documentId, session);

      return ok({
        handle,
        mode: session.mode,
        write: session.write,
        durability: session.durability,
        expiresAfterIdleMs: deps.handleIdleMs,
        contractRevision: session.contractRevision,
        ...(found !== null && { documentId, title: found.title }),
        ...(session.exists !== undefined && { exists: session.exists }),
        ...(view !== undefined && { view }),
      });
    } catch (thrown) {
      await Promise.resolve().then(() => session.close('closed')).catch(() => undefined);
      throw thrown;
    }
  };

  // MCP reaches a sub-page with blok_open on its pageId, so `page` is refused here as Ask AI refuses it without sub-pages.
  const coreCall = async (name: AgentToolName, args: Record<string, unknown>, caller: Caller): Promise<ToolOutcome> => {
    requireScope(caller, CORE_SCOPES[name]);
    const handle = handleOf(args);
    const parsed = parseToolCall(name, Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'handle')), { pages: false });

    if (!parsed.ok) {
      throw new AgentFailure(parsed.error);
    }

    return onHandle(caller, handle, name === 'blok_execute', session => runCall(session, parsed.call));
  };

  const runCall = async (session: HandleSession, call: ToolCall): Promise<ToolOutcome> => {
    if (call.name === 'blok_read') {
      return ok({ ...await session.read(call.view) });
    }
    if (call.name === 'blok_describe') {
      return ok({ ...session.describe(call.query) });
    }
    // Unchecked on purpose: core's checkEnvelope refuses a malformed batch, as it does for Ask AI.
    const result = await session.execute(call.batch as unknown as AgentBatch);

    return { structuredContent: modelAnswer(result), isError: !result.ok };
  };

  return async (name, args, caller, options = {}): Promise<ToolOutcome> => {
    try {
      refuseUnknownArguments(name, args);
      if (isCoreTool(name)) {
        return await coreCall(name, args, caller);
      }
      switch (name) {
        case 'blok_list_documents': {
          requireScope(caller, 'blok.read');

          return ok({ ...await listDocuments(listRequestOf(args), caller) });
        }
        case 'blok_open':
          return await openDocument(args, caller, options.signal);
        case 'blok_close': {
          requireScope(caller, 'blok.read');
          const handle = handleOf(args);

          await onHandle(caller, handle, false, async () => undefined);
          // remove waits for use, so it must run outside the callback.
          const session = await deps.handles.remove(handle, caller.principal);
          const summary = await session.close('closed');

          return ok({ closed: true, ...summary });
        }
        default:
          throw new UnknownToolError(name);
      }
    } catch (thrown) {
      const error = modelFixable(thrown);

      if (error === null) {
        throw thrown;
      }

      return {
        structuredContent: name === 'blok_execute' ? { ...toolErrorAnswer(name, error), delivery: NO_DELIVERY } : toolErrorAnswer(name, error),
        isError: true,
      };
    }
  };
};
