import type { AgentApprovalRequest, AgentApprover, AgentBatch, AgentError, AgentExecuteOptions, AgentResult, AgentSession, DocumentView, ViewArgs } from '../../../../types/agent';
import type { AgentToolResult, AgentTurn } from '../../../../types/api';
import { AgentFailure } from '../../../shared/agent/errors';
import { modelAnswer } from '../../../shared/agent/model-answer';
import { parseToolCall, refusedBatch, toolErrorAnswer, type ToolCall } from '../../../shared/agent/tool-call';

export const AGENT_TOOL_NAMES = ['blok_read', 'blok_describe', 'blok_execute'] as const;

const TOOL_NAMES = new Set<string>(AGENT_TOOL_NAMES);

const isToolName = (name: string): name is typeof AGENT_TOOL_NAMES[number] => TOOL_NAMES.has(name);

type TurnSession = Omit<AgentSession, 'execute'> & {
  // The real executor validates unknown wire input, not only typed batches.
  execute(batch: unknown, options?: AgentExecuteOptions): Promise<AgentResult>;
};

export interface AgentTurnHooks {
  onExecuted(result: Extract<AgentResult, { ok: true }>): void;
  onClosed(reason: 'end' | 'stop'): void;
  isEditorDestroyed(): boolean;
  /** The sub-page document a page block points at, for a call with `page`. Absent: `page` is refused. */
  openPage?(blockId: string): Promise<TurnSession & { close(): void }>;
  /** Asks the person. `signal` aborts when the turn stops. Absent: an approval-gated command is refused. */
  approve?(request: AgentApprovalRequest, signal: AbortSignal): Promise<boolean>;
}

export const cancelledError = (): AgentError => ({
  code: 'CANCELLED',
  message: 'This turn was stopped or ended. Nothing was applied.',
  retryable: false,
});

const asToolError = (name: string, error: AgentError): AgentToolResult => ({
  content: JSON.stringify(toolErrorAnswer(name, error)),
  isError: true,
});

const answered = (value: unknown): AgentToolResult => ({ content: JSON.stringify(value), isError: false });

const batchAnswer = (result: AgentResult): AgentToolResult => ({ content: JSON.stringify(modelAnswer(result)), isError: !result.ok });

/** Each turn's Discard undo. Kept off AgentTurn, so no tool call or host-built model loop reaches it. */
const personUndos = new WeakMap<AgentTurn, () => Promise<AgentResult>>();

/**
 * One history.undo for the person's Discard. It puts back what the turn changed, so an unlock it
 * makes is the person's own state coming back, and it does not ask them.
 */
export const undoForPerson = (turn: AgentTurn): Promise<AgentResult> =>
  personUndos.get(turn)?.() ?? turn.execute({ commands: [{ name: 'history.undo', args: {} }] });

export function createAgentTurn(session: TurnSession, hooks: AgentTurnHooks): AgentTurn {
  const controller = new AbortController();
  const state = { closed: false, tail: Promise.resolve() };
  const ask = hooks.approve;
  // A stopped or ended turn never asks; the person's answer goes back to the batch.
  const approve: AgentApprover | undefined = ask === undefined ? undefined : (request) => (state.closed || controller.signal.aborted
    ? Promise.resolve(false)
    : ask(request, controller.signal));
  const runOptions: AgentExecuteOptions = { signal: controller.signal, ...(approve !== undefined && { approve }) };

  const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
    const run = state.tail.then(job);

    state.tail = run.then(() => undefined, () => undefined);

    return run;
  };

  const execute = (batch: unknown, options: AgentExecuteOptions = runOptions): Promise<AgentResult> => {
    const accepted = !state.closed;

    return enqueue(async (): Promise<AgentResult> => {
      if (!accepted || controller.signal.aborted) {
        return refusedBatch(cancelledError());
      }

      const result = await session.execute(batch, options);

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
      return asToolError(name, cancelledError());
    }
    if (!isToolName(name)) {
      return asToolError(name, {
        code: 'UNKNOWN_COMMAND',
        message: `There is no tool "${name}". The tools are blok_read, blok_describe and blok_execute.`,
        retryable: false,
        details: { valid: [...AGENT_TOOL_NAMES] },
      });
    }

    const parsed = parseToolCall(name, input, { pages: hooks.openPage !== undefined });

    if (!parsed.ok) {
      return asToolError(name, parsed.error);
    }

    try {
      return await runCall(parsed.call);
    } catch (error) {
      if (error instanceof AgentFailure) {
        return asToolError(name, error.error);
      }

      throw error;
    }
  };

  const runCall = async (toolCall: ToolCall): Promise<AgentToolResult> => {
    if (toolCall.name === 'blok_describe') {
      const { query } = toolCall;

      return answered(await enqueue(() => {
        if (controller.signal.aborted) {
          throw new AgentFailure(cancelledError());
        }

        return Promise.resolve(session.describe(query));
      }));
    }
    if (toolCall.page !== undefined && hooks.openPage !== undefined) {
      return onPage(hooks.openPage, toolCall.page, toolCall);
    }

    return toolCall.name === 'blok_read'
      ? answered(await read(toolCall.view))
      : batchAnswer(await execute(toolCall.batch));
  };

  /** A read or batch on a sub-page's own document. It opens, runs and closes in the turn's queue. */
  const onPage = (
    open: NonNullable<AgentTurnHooks['openPage']>,
    page: string,
    toolCall: Exclude<ToolCall, { name: 'blok_describe' }>,
  ): Promise<AgentToolResult> => {
    const accepted = !state.closed;

    return enqueue(async (): Promise<AgentToolResult> => {
      if (!accepted || controller.signal.aborted) {
        throw new AgentFailure(cancelledError());
      }
      const pageSession = await open(page);

      try {
        return toolCall.name === 'blok_read'
          ? answered(await pageSession.read(toolCall.view))
          : batchAnswer(await pageSession.execute(toolCall.batch, runOptions));
      } finally {
        pageSession.close();
      }
    });
  };

  const turn: AgentTurn = {
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

  personUndos.set(turn, () => execute(
    { commands: [{ name: 'history.undo', args: {} }] },
    { signal: controller.signal, approve: () => Promise.resolve(true) },
  ));

  return turn;
}
