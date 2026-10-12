import type { AgentBatch, AgentCommand, ViewArgs } from '../../types/agent';

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

const ok = (structuredContent: Record<string, unknown>): ToolOutcome => ({
  structuredContent: structuredContent,
  isError: false,
});

export const createToolDispatcher = (
  deps: DispatcherDeps,
): ((name: string, args: Record<string, unknown>, caller: Caller) => Promise<ToolOutcome>) => {
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

  const openDocument = async (args: Record<string, unknown>, caller: Caller): Promise<ToolOutcome> => {
    const write = args.write === true;

    requireScope(caller, write ? 'blok.write' : 'blok.read');
    if (typeof args.documentId !== 'string' || args.documentId === '' || args.documentId.length > 512) {
      throw surfaceError('INVALID_ARGS', 'documentId must be a string of 1 to 512 characters.');
    }
    const mode = args.mode === 'live' || args.mode === 'stored' ? args.mode : 'auto';
    const session = await deps.open({ documentId: args.documentId, mode, write }, caller);

    try {
      const view = typeof args.view === 'object' && args.view !== null ? await session.read(args.view) : undefined;
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
    const batch: AgentBatch = {
      commands: args.commands as AgentCommand[],
      ...(typeof args.expectRevision === 'string' && { expectRevision: args.expectRevision }),
    };
    const result = await onHandle(caller, handleOf(args), true, session => session.execute(batch));

    return { structuredContent: result as unknown as Record<string, unknown>, isError: !result.ok };
  };

  return async (name, args, caller): Promise<ToolOutcome> => {
    try {
      switch (name) {
        case 'blok_list_documents': {
          requireScope(caller, 'blok.read');
          const limit = typeof args.limit === 'number' ? Math.min(Math.max(Math.trunc(args.limit), 1), 100) : 25;
          const request: ListRequest = {
            limit,
            ...(typeof args.query === 'string' && { query: args.query }),
            ...(typeof args.cursor === 'string' && { cursor: args.cursor }),
          };

          return ok({ ...await deps.list(request, caller) });
        }
        case 'blok_open':
          return await openDocument(args, caller);
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
      if (!isMcpSurfaceError(thrown)) {
        throw thrown;
      }

      return {
        structuredContent: name === 'blok_execute'
          ? failedResult(thrown.agentError)
          : { error: thrown.agentError },
        isError: true,
      };
    }
  };
};
