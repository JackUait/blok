import type { AgentBatch, AgentError, AgentResult, AgentSession, DocumentView, ViewArgs } from '../../../../types/agent';
import type { AgentToolResult, AgentTurn } from '../../../../types/api';
import { AgentFailure } from '../../../shared/agent/errors';
import { modelAnswer } from '../../../shared/agent/model-answer';

export const AGENT_TOOL_NAMES = ['blok_read', 'blok_describe', 'blok_execute'] as const;

const TOOL_NAMES = new Set<string>(AGENT_TOOL_NAMES);

type TurnSession = Omit<AgentSession, 'execute'> & {
  // The real executor validates unknown wire input, not only typed batches.
  execute(batch: unknown, options?: { signal?: AbortSignal }): Promise<AgentResult>;
};

export interface AgentTurnHooks {
  onExecuted(result: Extract<AgentResult, { ok: true }>): void;
  onClosed(reason: 'end' | 'stop'): void;
  isEditorDestroyed(): boolean;
  /** The sub-page document a page block points at, for a call with `page`. Absent: `page` is refused. */
  openPage?(blockId: string): Promise<TurnSession & { close(): void }>;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: AgentError };

const invalid = (message: string, path?: string): Parsed<never> => ({
  ok: false,
  error: { code: 'INVALID_ARGS', message, retryable: true, ...(path === undefined ? {} : { path }) },
});

export const cancelledError = (): AgentError => ({
  code: 'CANCELLED',
  message: 'This turn was stopped or ended. Nothing was applied.',
  retryable: false,
});

const asToolError = (error: AgentError): AgentToolResult => ({
  content: JSON.stringify({ ok: false, error, warnings: [] }),
  isError: true,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseInput = (input: unknown): Parsed<Record<string, unknown>> => {
  const state: { raw: unknown } = { raw: input ?? {} };

  if (typeof input === 'string') {
    try {
      state.raw = input.trim() === '' ? {} : JSON.parse(input);
    } catch {
      return invalid('The tool input is not valid JSON. Send a JSON object.');
    }
  }

  if (!isRecord(state.raw)) {
    return invalid('The tool input must be a JSON object.');
  }

  // parseArguments (src/agent-models/shared.ts) and the dev AI route send this for arguments that did not parse.
  if (Object.hasOwn(state.raw, 'invalidJson')) {
    return invalid('The tool input is not valid JSON, so nothing ran. Send the call again as a JSON object.');
  }

  return { ok: true, value: state.raw };
};

const toQuery = (value: Record<string, unknown>): Parsed<{ tool?: string; command?: string }> => {
  const { tool, command } = value;

  if (tool !== undefined && typeof tool !== 'string') {
    return invalid('`tool` must be a string.', '/tool');
  }
  if (command !== undefined && typeof command !== 'string') {
    return invalid('`command` must be a string.', '/command');
  }

  return {
    ok: true,
    value: { ...(tool === undefined ? {} : { tool }), ...(command === undefined ? {} : { command }) },
  };
};

const toBatch = (value: Record<string, unknown>): Parsed<Record<string, unknown>> => {
  if (!Array.isArray(value.commands)) {
    return invalid('`commands` must be an array of { name, args }.', '/commands');
  }
  if (value.expectRevision !== undefined && typeof value.expectRevision !== 'string') {
    return invalid('`expectRevision` must be a string.', '/expectRevision');
  }

  // Command validation belongs to the executor, including malformed array entries.
  return { ok: true, value };
};

export function createAgentTurn(session: TurnSession, hooks: AgentTurnHooks): AgentTurn {
  const controller = new AbortController();
  const state = { closed: false, tail: Promise.resolve() };

  const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
    const run = state.tail.then(job);

    state.tail = run.then(() => undefined, () => undefined);

    return run;
  };

  const execute = (batch: unknown): Promise<AgentResult> => {
    const accepted = !state.closed;

    return enqueue(async (): Promise<AgentResult> => {
      if (!accepted || controller.signal.aborted) {
        return { ok: false, error: cancelledError(), warnings: [] };
      }

      const result = await session.execute(batch, { signal: controller.signal });

      // An applied result survives closure, but must not publish a late cursor.
      if (result.ok && !state.closed) {
        hooks.onExecuted(result);
      }

      return result;
    });
  };

  const read = (args?: ViewArgs): Promise<DocumentView> => {
    const accepted = !state.closed;

    return enqueue(() => {
      if (!accepted || controller.signal.aborted) {
        throw new AgentFailure(cancelledError());
      }

      return session.read(args);
    });
  };

  const describe: AgentSession['describe'] = query => {
    if (state.closed) {
      throw new AgentFailure(cancelledError());
    }

    return session.describe(query);
  };

  const close = (reason: 'end' | 'stop'): void => {
    if (state.closed) {
      return;
    }
    state.closed = true;
    if (reason === 'stop') {
      controller.abort();
    }

    try {
      hooks.onClosed(reason);
    } finally {
      void state.tail.then(() => session.close());
    }
  };

  const call = async (name: string, input: unknown): Promise<AgentToolResult> => {
    if (hooks.isEditorDestroyed()) {
      throw new Error('editor.agent: the editor was destroyed. Open a new turn on a live editor.');
    }
    if (state.closed) {
      return asToolError(cancelledError());
    }
    if (!TOOL_NAMES.has(name)) {
      return asToolError({
        code: 'UNKNOWN_COMMAND',
        message: `There is no tool "${name}". The tools are blok_read, blok_describe and blok_execute.`,
        retryable: false,
        details: { valid: [...AGENT_TOOL_NAMES] },
      });
    }

    const parsed = parseInput(input);

    if (!parsed.ok) {
      return asToolError(parsed.error);
    }
    if (parsed.value.page !== undefined && name !== 'blok_describe') {
      return callPage(name, parsed.value);
    }

    try {
      if (name === 'blok_read') {
        return { content: JSON.stringify(await read(parsed.value)), isError: false };
      }
      if (name === 'blok_describe') {
        const query = toQuery(parsed.value);

        return query.ok
          ? {
            content: JSON.stringify(await enqueue(() => {
              if (controller.signal.aborted) {
                throw new AgentFailure(cancelledError());
              }

              return Promise.resolve(session.describe(query.value));
            })),
            isError: false,
          }
          : asToolError(query.error);
      }

      const batch = toBatch(parsed.value);

      if (!batch.ok) {
        return asToolError(batch.error);
      }
      const result = await execute(batch.value);

      return { content: JSON.stringify(modelAnswer(result)), isError: !result.ok };
    } catch (error) {
      if (error instanceof AgentFailure) {
        return asToolError(error.error);
      }

      throw error;
    }
  };

  /** A read or batch on a sub-page's own document. It opens, runs and closes in the turn's queue. */
  const callPage = async (name: string, value: Record<string, unknown>): Promise<AgentToolResult> => {
    const { page, ...rest } = value;

    if (typeof page !== 'string' || page === '') {
      return asToolError({ code: 'INVALID_ARGS', message: '`page` must be the id of a page block.', retryable: true, path: '/page' });
    }
    if (hooks.openPage === undefined) {
      return asToolError({ code: 'COMMAND_UNAVAILABLE', message: 'This editor cannot open sub-page documents. Omit `page`.', retryable: false });
    }
    const batch = name === 'blok_execute' ? toBatch(rest) : null;

    if (batch !== null && !batch.ok) {
      return asToolError(batch.error);
    }
    const open = hooks.openPage;
    const accepted = !state.closed;

    try {
      return await enqueue(async (): Promise<AgentToolResult> => {
        if (!accepted || controller.signal.aborted) {
          throw new AgentFailure(cancelledError());
        }
        const session = await open(page);

        try {
          if (batch === null) {
            return { content: JSON.stringify(await session.read(rest)), isError: false };
          }
          const result = await session.execute(batch.value, { signal: controller.signal });

          return { content: JSON.stringify(modelAnswer(result)), isError: !result.ok };
        } finally {
          session.close();
        }
      });
    } catch (error) {
      if (error instanceof AgentFailure) {
        return asToolError(error.error);
      }

      throw error;
    }
  };

  return {
    get id(): string {
      return session.id;
    },
    get actor() {
      return session.actor;
    },
    signal: controller.signal,
    read,
    describe,
    // Host options cannot replace the turn's cancellation signal.
    execute: (batch: AgentBatch) => execute(batch),
    log: () => session.log(),
    close: () => close('end'),
    call,
    end: () => close('end'),
    stop: () => close('stop'),
  };
}
