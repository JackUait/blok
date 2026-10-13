import type { AgentBatch, AgentCommand, AgentError, ViewArgs } from '../../types/agent';
import { AgentFailure, failure } from '../shared/agent/errors';

import { failedResult, isMcpSurfaceError, surfaceError } from './errors';
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

const isCommandShaped = (value: unknown): boolean =>
  isPlainObject(value) && typeof value.name === 'string';

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
    if (typeof args.documentId !== 'string' || args.documentId === '' || args.documentId.length > 512) {
      throw surfaceError('INVALID_ARGS', 'documentId must be a string of 1 to 512 characters.');
    }
    if (args.mode !== undefined && !MODES.has(args.mode)) {
      throw surfaceError('INVALID_ARGS', 'mode must be "auto", "live" or "stored".');
    }
    if (args.view !== undefined && !isPlainObject(args.view)) {
      throw surfaceError('INVALID_ARGS', 'view must be an object of blok_read arguments.');
    }
    const mode = args.mode === 'live' || args.mode === 'stored' ? args.mode : 'auto';

    // Opening can mint a ticket and join a room, so refuse at the cap first.
    deps.handles.assertRoom(caller.principal);
    const session = await deps.open({ documentId: args.documentId, mode, write }, caller);

    try {
      const view = isPlainObject(args.view) ? await session.read(args.view) : undefined;

      // Nobody would hold the handle: the catch below closes the session.
      if (signal?.aborted === true) {
        throw failure('CANCELLED', 'The request was cancelled before the document opened.');
      }
      const handle = deps.handles.add(caller.principal, args.documentId, session);

      return ok({
        handle,
        mode: session.mode,
        write: session.write,
        durability: session.durability,
        expiresAfterIdleMs: deps.handleIdleMs,
        contractRevision: session.contractRevision,
        ...(view !== undefined && { view }),
      });
    } catch (thrown) {
      await Promise.resolve().then(() => session.close('closed')).catch(() => undefined);
      throw thrown;
    }
  };

  const executeBatch = async (args: Record<string, unknown>, caller: Caller): Promise<ToolOutcome> => {
    requireScope(caller, 'blok.write');
    if (!Array.isArray(args.commands)) {
      throw surfaceError('INVALID_ARGS', 'commands must be an array of { name, args }.');
    }
    const badIndex = args.commands.findIndex(command => !isCommandShaped(command));

    // Sessions read command.name before core validates the batch.
    if (badIndex !== -1) {
      throw surfaceError('INVALID_ARGS', `commands[${badIndex}] must be an object with a string name.`);
    }
    // A non-string is passed on so core refuses it instead of dropping the guard.
    const batch = {
      commands: args.commands as AgentCommand[],
      ...(args.expectRevision !== undefined && { expectRevision: args.expectRevision }),
    } as AgentBatch;
    const result = await onHandle(caller, handleOf(args), true, session => session.execute(batch));

    return { structuredContent: result as unknown as Record<string, unknown>, isError: !result.ok };
  };

  return async (name, args, caller, options = {}): Promise<ToolOutcome> => {
    try {
      switch (name) {
        case 'blok_list_documents': {
          requireScope(caller, 'blok.read');

          return ok({ ...await deps.list(listRequestOf(args), caller) });
        }
        case 'blok_open':
          return await openDocument(args, caller, options.signal);
        case 'blok_read': {
          requireScope(caller, 'blok.read');
          const viewArgs = Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'handle'));
          const view = await onHandle(caller, handleOf(args), false, session => session.read(viewArgs as ViewArgs));

          return ok({ ...view });
        }
        case 'blok_describe': {
          requireScope(caller, 'blok.read');
          const query = {
            ...(typeof args.tool === 'string' && { tool: args.tool }),
            ...(typeof args.command === 'string' && { command: args.command }),
          };
          const slice = await onHandle(caller, handleOf(args), false, async session => session.describe(query));

          return ok({ ...slice });
        }
        case 'blok_execute':
          return await executeBatch(args, caller);
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
        structuredContent: name === 'blok_execute' ? failedResult(error) : { error },
        isError: true,
      };
    }
  };
};
