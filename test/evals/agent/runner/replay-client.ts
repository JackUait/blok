import type Anthropic from '@anthropic-ai/sdk';

import type { EvalTask } from '../types';
import type { MessagesClient } from './model-loop';

type Step = { name: string; input: () => unknown };

const message = (content: Anthropic.ContentBlock[], stop: Anthropic.StopReason): Anthropic.Message => ({
  id: 'replay', type: 'message', role: 'assistant', model: 'replay', container: null, diagnostics: null,
  content, stop_reason: stop, stop_sequence: null, stop_details: null,
  usage: {
    cache_creation: null, cache_creation_input_tokens: null, cache_read_input_tokens: null, inference_geo: null,
    input_tokens: 0, output_tokens: 0, output_tokens_details: null, server_tool_use: null, service_tier: null, speed: null,
  },
});

const handleIn = (text: string): string | undefined => {
  try {
    const value: unknown = JSON.parse(text);

    return value !== null && typeof value === 'object' && 'handle' in value && typeof value.handle === 'string'
      ? value.handle
      : undefined;
  } catch {
    return undefined;
  }
};

/** Plays a task's reference as tool calls: a deterministic, free check of a surface. */
export const replayClient = (task: EvalTask, mode: 'session' | 'mcp'): MessagesClient => {
  const state = { handle: '', at: 0 };
  // blok_open's `write` defaults to false (04); without it every blok_execute answers READ_ONLY.
  const steps: Step[] = mode === 'mcp'
    ? [
      { name: 'blok_list_documents', input: () => ({}) },
      { name: 'blok_open', input: () => ({ documentId: task.docId ?? task.id, write: true }) },
      ...task.reference.map((batch) => ({ name: 'blok_execute', input: () => ({ handle: state.handle, ...batch }) })),
      { name: 'blok_close', input: () => ({ handle: state.handle }) },
    ]
    : task.reference.map((batch) => ({ name: 'blok_execute', input: () => batch }));

  return {
    create: async (params) => {
      const last = params.messages.at(-1);

      for (const block of Array.isArray(last?.content) ? last.content : []) {
        if (block.type === 'tool_result' && typeof block.content === 'string') {
          state.handle = handleIn(block.content) ?? state.handle;
        }
      }

      const step = steps[state.at];

      if (step === undefined) {
        return message([{ type: 'text', text: task.referenceAnswer ?? 'done', citations: null }], 'end_turn');
      }

      state.at += 1;

      return message([{ type: 'tool_use', id: `replay-${state.at}`, name: step.name, input: step.input(), caller: { type: 'direct' } }], 'tool_use');
    },
  };
};
