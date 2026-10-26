import type {
  AgentModel,
  AgentModelMessage,
  AgentModelStreamEvent,
  AgentModelTool,
  AgentHostTool,
  AgentRun,
  AgentRunResult,
  AgentThinkingLevel,
  AgentToolResult,
  AgentTurn,
} from '../../../../types/api';
import { runAssistantLoop } from '../../../agent/assistant-loop';
import { isLongNote, shortenNote } from '../../../agent/note';

/** What Discard did with the sub-pages: restored, or kept because someone changed them after the agent. */
export interface PageRestore {
  restored: number;
  kept: string[];
}

/** 'partial': some of the run's edits stay. 'none': nothing was reverted. 'restored': the run restored a version, which stays. */
export type DiscardOutcome = 'all' | 'partial' | 'none' | 'restored';

export interface AgentRunDeps {
  turn: AgentTurn;
  model: AgentModel;
  maxSteps: number;
  /** The host's own tools. A call to one runs here, not on the turn. */
  hostTools?: AgentHostTool[];
  /** Loaded once per run: the same tools and system prompt for every request keep the prompt cache warm. */
  prepare(): Promise<{ system: string; tools: AgentModelTool[] }>;
  /** Ids the turn changed so far. */
  changed(): string[];
  /** Discard: write back each sub-page document the run saved, unless someone changed it since. */
  restorePages?(): Promise<PageRestore>;
  /** The run restored a version. No undo reaches a restore, so Discard keeps it. */
  restored?(): boolean;
  /** After Discard's undo loop: true when none of the run's steps is left in the editor's undo history. */
  undoneAll(): boolean;
  /** How Discard went, for the prompt bar's message. */
  onDiscarded?(outcome: DiscardOutcome): void;
  /** Discard: join the run's batch steps first, so one redo brings the whole run back. */
  sealSteps?(): void;
  /** Read once per prompt, so a run already answering keeps its level. */
  thinking(): AgentThinkingLevel | undefined;
  /** What the run does now, for the prompt bar's status line. */
  onActivity?(activity: string, input?: unknown): void;
  /** Every model stream event, for the live preview. */
  onStream?(event: AgentModelStreamEvent): void;
  /** After each tool call finishes. */
  onToolDone?(id: string, name: string, result: AgentToolResult): void;
}

const runHostTool = async (tool: AgentHostTool, input: unknown): Promise<AgentToolResult> => {
  try {
    return { content: await tool.run(input), isError: false };
  } catch (thrown) {
    return { content: thrown instanceof Error ? thrown.message : String(thrown), isError: true };
  }
};

const busy = (): Error => new Error('editor.agent: this run is still answering. Await `result` or call stop() first.');

/**
 * One assistant conversation on one agent turn.
 * @param prompt - the first user message, with any editor context already added
 * @param deps - the open turn and the model
 */
export function createAgentRun(prompt: string | Promise<string>, deps: AgentRunDeps): AgentRun {
  const messages: AgentModelMessage[] = [];
  const setup = deps.prepare();
  const state: { controller: AbortController | null; result: Promise<AgentRunResult>; closed: boolean } = {
    controller: null,
    result: Promise.resolve({ status: 'done', reply: '', changed: [] }),
    closed: false,
  };

  const answer = (text: string | Promise<string>): Promise<AgentRunResult> => {
    const controller = new AbortController();
    const thinking = deps.thinking();

    state.controller = controller;

    state.result = (async (): Promise<AgentRunResult> => {
      try {
        messages.push({ role: 'user', content: await text });
        const { system, tools } = await setup;
        const before = deps.changed().join();
        const outcome = await runAssistantLoop({
          model: deps.model,
          system,
          tools,
          messages,
          call: (name, input) => {
            const host = deps.hostTools?.find((tool) => tool.name === name);

            return host === undefined ? deps.turn.call(name, input) : runHostTool(host, input);
          },
          signal: controller.signal,
          maxSteps: deps.maxSteps,
          ...(thinking === undefined ? {} : { thinking }),
          onActivity: deps.onActivity,
          onStream: deps.onStream,
          onToolDone: deps.onToolDone,
        });

        const edited = deps.changed().join() !== before;

        if (outcome.status !== 'done' || !edited || !isLongNote(outcome.reply)) {
          return { ...outcome, changed: deps.changed() };
        }
        deps.onActivity?.('thinking');

        const short = await shortenNote(deps.model, outcome.reply, tools, controller.signal);

        return { ...outcome, reply: short ?? outcome.reply, changed: deps.changed() };
      } catch (thrown) {
        return {
          status: 'failed',
          reply: '',
          error: thrown instanceof Error ? thrown.message : String(thrown),
          changed: deps.changed(),
        };
      } finally {
        if (state.controller === controller) {
          state.controller = null;
        }
      }
    })();

    return state.result;
  };

  const end = (): void => {
    state.closed = true;
    state.controller?.abort();
    deps.turn.end();
  };

  void answer(prompt);

  return {
    get result() {
      return state.result;
    },
    followUp: (text: string) => {
      if (state.closed) {
        throw new Error('editor.agent: this run has ended. Call editor.agent.ask() to start a new one.');
      }
      if (state.controller !== null) {
        throw busy();
      }

      return answer(text);
    },
    stop: () => {
      state.controller?.abort();
    },
    discard: async () => {
      state.controller?.abort();
      await state.result;

      deps.sealSteps?.();
      const undone = { count: 0 };

      // Each successful batch can be its own step when the user acted between them.
      // Undo stops at the first step that is not this turn's (UNDO_NOT_OWN).
      for (;;) {
        const step = await deps.turn.execute({ commands: [{ name: 'history.undo', args: {} }] });

        if (!step.ok) {
          break;
        }
        undone.count += 1;
      }
      const pages = await deps.restorePages?.() ?? { restored: 0, kept: [] };
      const restored = deps.restored?.() === true;
      const all = deps.undoneAll() && pages.kept.length === 0 && !restored;
      const some = undone.count > 0 || pages.restored > 0;
      const kept: DiscardOutcome = some ? 'partial' : 'none';
      const outcome: DiscardOutcome = all ? 'all' : kept;

      deps.onDiscarded?.(restored ? 'restored' : outcome);
      end();

      return all;
    },
    end,
  };
}
