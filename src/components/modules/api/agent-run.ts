import type {
  AgentAnthropicTool,
  AgentModel,
  AgentModelMessage,
  AgentRun,
  AgentRunResult,
  AgentThinkingLevel,
  AgentTurn,
} from '../../../../types/api';
import { runAssistantLoop } from '../../../agent/assistant-loop';

export interface AgentRunDeps {
  turn: AgentTurn;
  model: AgentModel;
  maxSteps: number;
  /** Loaded once per run: the same tools and system prompt for every request keep the prompt cache warm. */
  prepare(): Promise<{ system: string; tools: AgentAnthropicTool[] }>;
  /** Ids the turn changed so far. */
  changed(): string[];
  /** Read once per prompt, so a run already answering keeps its level. */
  thinking(): AgentThinkingLevel | undefined;
  /** Text the model is streaming, for the prompt bar. */
  onText?(text: string): void;
}

const busy = (): Error => new Error('editor.agent: this run is still answering. Await `result` or call stop() first.');

/**
 * One assistant conversation on one agent turn.
 * @param prompt - the first user message, with any editor context already added
 * @param deps - the open turn and the model
 */
export function createAgentRun(prompt: string, deps: AgentRunDeps): AgentRun {
  const messages: AgentModelMessage[] = [];
  const setup = deps.prepare();
  const state: { controller: AbortController | null; result: Promise<AgentRunResult>; closed: boolean } = {
    controller: null,
    result: Promise.resolve({ status: 'done', reply: '', changed: [] }),
    closed: false,
  };

  const answer = (text: string): Promise<AgentRunResult> => {
    const controller = new AbortController();
    const thinking = deps.thinking();

    state.controller = controller;
    messages.push({ role: 'user', content: text });

    state.result = (async (): Promise<AgentRunResult> => {
      try {
        const { system, tools } = await setup;
        const outcome = await runAssistantLoop({
          model: deps.model,
          system,
          tools,
          messages,
          call: (name, input) => deps.turn.call(name, input),
          signal: controller.signal,
          maxSteps: deps.maxSteps,
          ...(thinking === undefined ? {} : { thinking }),
          onText: deps.onText,
        });

        return { ...outcome, changed: deps.changed() };
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
      end();

      return undone.count > 0;
    },
    end,
  };
}
