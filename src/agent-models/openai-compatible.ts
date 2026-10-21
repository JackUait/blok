import type {
  AgentModel, AgentModelContentBlock, AgentModelMessage, AgentModelRequest, AgentModelResponse, AgentThinkingLevel,
} from '../../types/api';

import {
  DEFAULT_MAX_TOKENS, blocksOf, endOfStream, errorOf, isRecord, isText, isToolResult, isToolUse, parseArguments,
  callId, merge, providerBlock, rawTurn, post, postStream, requireTransport, stepOf, toolNames, withLevel, type AdapterOptions, type Body, type Profile,
} from './shared';
import { readJsonEvents } from './sse';

const FORMAT = 'openai-chat';

/** How one provider's Chat Completions differs from the common shape. */
export interface ChatProfile extends Profile {
  /** The field that carries the output cap. Defaults to max_tokens; only one is ever sent. */
  tokens?: 'max_tokens' | 'max_completion_tokens';
  /** Sends `name` on tool messages. Mistral shows it; Groq answers 400 and Fireworks' schema rejects it. */
  toolName?: true;
  /** When set, a replayed assistant turn keeps only these keys. Fireworks rejects unknown ones. */
  replayFields?: readonly string[];
  /** Merged into the body only when the request streams. */
  streamBody?: Body;
}

const LEVELS: Record<AgentThinkingLevel, Body> = {
  off: { reasoning_effort: 'none' },
  low: { reasoning_effort: 'low' },
  medium: { reasoning_effort: 'medium' },
  high: { reasoning_effort: 'high' },
  xhigh: { reasoning_effort: 'xhigh' },
  max: { reasoning_effort: 'max' },
};

const userMessages = (message: AgentModelMessage, names: Map<string, string>, toolName: boolean): unknown[] => (typeof message.content === 'string'
  ? [{ role: 'user', content: message.content }]
  : message.content.flatMap((block): unknown[] => {
    if (isToolResult(block)) {
      const name = toolName ? { name: names.get(block.tool_use_id) ?? '' } : {};

      return [{ role: 'tool', tool_call_id: block.tool_use_id, ...name, content: block.content }];
    }

    return isText(block) ? [{ role: 'user', content: block.text }] : [];
  }));

// DeepSeek returns HTTP 400 when reasoning_content is missing while tools are present.
const turnOf = (message: AgentModelMessage): Record<string, unknown> => {
  const raw = rawTurn(message.content, FORMAT);

  if (isRecord(raw)) {
    return raw;
  }

  const blocks = blocksOf(message.content);
  const text = blocks.filter(isText).map((block) => block.text).join('\n');
  const calls = blocks.filter(isToolUse).map((use) => ({
    id: use.id, type: 'function', function: { name: use.name, arguments: JSON.stringify(use.input) },
  }));

  return { role: 'assistant', content: text === '' ? null : text, ...(calls.length === 0 ? {} : { tool_calls: calls }) };
};

const assistantMessage = (message: AgentModelMessage, fields: readonly string[] | undefined): unknown => {
  const turn = turnOf(message);

  return fields === undefined ? turn : Object.fromEntries(Object.entries(turn).filter(([key]) => fields.includes(key)));
};

const textOf = (content: unknown): string => {
  if (typeof content === 'string') {
    return content;
  }

  return Array.isArray(content)
    ? content.filter(isRecord).flatMap((chunk) => (chunk.type === 'text' && typeof chunk.text === 'string' ? [chunk.text] : [])).join('')
    : '';
};

const readReply = (reply: unknown, step: number, name: string): AgentModelResponse => {
  const error = errorOf(reply, name);

  if (error !== null) {
    throw error;
  }

  const first: unknown = isRecord(reply) && Array.isArray(reply.choices) ? reply.choices[0] : undefined;

  if (!isRecord(first) || !isRecord(first.message)) {
    throw new Error(`${name}: the reply has no choices.`);
  }

  const calls = (Array.isArray(first.message.tool_calls) ? first.message.tool_calls : [])
    .map((call, index): unknown => (isRecord(call) ? { ...call, id: callId(call.id, step, index) } : call));
  // The stored turn carries the same ids as the tool messages that answer it.
  const message = calls.length === 0 ? first.message : { ...first.message, tool_calls: calls };
  const text = textOf(message.content);
  // An unnamed call keeps an empty name, so the run reports an unknown tool and the model can retry.
  const uses: AgentModelContentBlock[] = calls.filter(isRecord).map((call) => {
    const fn = isRecord(call.function) ? call.function : {};

    return { type: 'tool_use', id: String(call.id), name: typeof fn.name === 'string' ? fn.name : '', input: parseArguments(fn.arguments) };
  });
  const content: AgentModelContentBlock[] = [
    ...(text === '' ? [] : [{ type: 'text', text }]),
    ...uses,
    providerBlock(FORMAT, message),
  ];
  const finish = first.finish_reason;
  const stop = ((): string => {
    if (finish === 'length') {
      return 'max_tokens';
    }
    if (finish === 'content_filter' || (typeof message.refusal === 'string' && message.refusal !== '')) {
      return 'refusal';
    }

    return uses.length > 0 ? 'tool_use' : 'end_turn';
  })();

  return { content, stop_reason: stop };
};

/** A tool call while it streams. Id and name come from its first chunk only, so its events and the reply agree. */
interface StreamingCall {
  id: unknown;
  name: string;
  arguments: string;
  open: boolean;
  /** Provider keys on the call, such as Vertex's extra_content, which must go back. */
  extra: Record<string, unknown>;
}

interface Assembly {
  text?: string;
  /** Mistral's ThinkChunks, joined into one. */
  think?: { chunk: Record<string, unknown>; text: string };
  /** Each reasoning field under the name it streamed in, since the provider wants that name back. */
  reasoning: Record<string, string>;
  refusal?: string;
  finish?: string;
  /** Keyed by the provider's tool_calls index, in order of first chunk. */
  calls: Map<number, StreamingCall>;
  /** Delta fields this adapter does not know, kept because providers want some back. */
  extra: Record<string, unknown>;
}

const REASONING_FIELDS = ['reasoning_content', 'reasoning'] as const;
const KNOWN_DELTA = new Set(['role', 'content', ...REASONING_FIELDS, 'refusal', 'tool_calls']);
const CALL_FIELDS = new Set(['index', 'id', 'type', 'function']);
// Providers repeat these on every piece of an item, so the first one stands.
const IDENTITY = new Set(['type', 'id', 'format', 'index']);

const without = (record: Record<string, unknown>, keys: Set<string>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(record).filter(([key]) => !keys.has(key)));

/** Strings join, arrays merge by item, objects merge deeply. Nulls carry nothing. */
const mergedRecord = (current: Record<string, unknown>, piece: Record<string, unknown>): Record<string, unknown> =>
  Object.entries(piece).reduce<Record<string, unknown>>((out, [key, value]) => {
    if (value === null || value === undefined) {
      return out;
    }

    const known = out[key];

    if (known !== undefined && IDENTITY.has(key)) {
      return out;
    }

    return { ...out, [key]: mergedValue(known, value) };
  }, { ...current });

/**
 * An item with an index merges into the item with the same index (OpenRouter's reasoning_details).
 * An item without one merges into the last item of its type until a signature closes it: LiteLLM
 * streams each thinking block as unindexed pieces and sends its signature last.
 */
const mergedItems = (current: unknown[], pieces: unknown[]): unknown[] => pieces.reduce<unknown[]>((out, piece) => {
  if (!isRecord(piece)) {
    return [...out, piece];
  }

  const at = typeof piece.index === 'number'
    ? out.findIndex((item) => isRecord(item) && item.index === piece.index)
    : out.length - 1;
  const target = out[at];
  const joins = isRecord(target) && (typeof piece.index === 'number'
    || (target.index === undefined && target.signature === undefined && target.type === piece.type));

  return joins ? out.map((item, position) => (position === at ? mergedRecord(target, piece) : item)) : [...out, piece];
}, [...current]);

const mergedValue = (current: unknown, piece: unknown): unknown => {
  if (typeof piece === 'string') {
    return typeof current === 'string' ? `${current}${piece}` : piece;
  }
  if (Array.isArray(piece)) {
    return mergedItems(Array.isArray(current) ? current : [], piece);
  }

  return isRecord(piece) ? mergedRecord(isRecord(current) ? current : {}, piece) : piece;
};

const appended = (current: string | undefined, piece: unknown): string | undefined =>
  (typeof piece === 'string' ? `${current ?? ''}${piece}` : current);

// Same shape as a sent reply's message: index is dropped, since the provider block goes back as is.
const messageOf = (state: Assembly): Record<string, unknown> => {
  const calls = [...state.calls.values()].map((call) => ({
    ...(typeof call.id === 'string' ? { id: call.id } : {}), type: 'function', function: { name: call.name, arguments: call.arguments },
    ...call.extra,
  }));
  // Mistral wants the ThinkChunk replayed, so its content goes back as chunks.
  const content = state.think === undefined
    ? state.text ?? null
    : [
      { ...state.think.chunk, type: 'thinking', thinking: [{ type: 'text', text: state.think.text }] },
      ...(state.text === undefined ? [] : [{ type: 'text', text: state.text }]),
    ];

  return {
    role: 'assistant',
    content,
    ...state.reasoning,
    ...state.extra,
    ...(state.refusal === undefined ? {} : { refusal: state.refusal }),
    ...(calls.length === 0 ? {} : { tool_calls: calls }),
  };
};

/** Reports tool calls as they stream, then reads the assembled message through readReply. */
const readStream = async (
  source: Response | ReadableStream<Uint8Array>,
  request: AgentModelRequest,
  step: number,
  name: string
): Promise<AgentModelResponse> => {
  const state: Assembly = { reasoning: {}, calls: new Map(), extra: {} };
  const endOpenCalls = (): void => {
    [...state.calls.entries()].forEach(([key, call], index) => {
      if (call.open) {
        state.calls.set(key, { ...call, open: false });
        request.onStream?.({ type: 'tool_end', index });
      }
    });
  };

  const onToolDelta = (entry: Record<string, unknown>, position: number): void => {
    const key = typeof entry.index === 'number' ? entry.index : position;
    const fn = isRecord(entry.function) ? entry.function : {};
    const known = state.calls.get(key);
    const index = known === undefined ? state.calls.size : [...state.calls.keys()].indexOf(key);

    if (known === undefined) {
      // Calls stream one after another, so a new one ends the one before.
      endOpenCalls();
      state.calls.set(key, { id: entry.id, name: typeof fn.name === 'string' ? fn.name : '', arguments: '', open: true, extra: {} });
      // Same id as readReply gives the final call, so the loop matches the early call.
      request.onStream?.({ type: 'tool_start', index, id: callId(entry.id, step, index), name: typeof fn.name === 'string' ? fn.name : '' });
    }

    const call = state.calls.get(key);

    if (call !== undefined) {
      call.extra = mergedRecord(call.extra, without(entry, CALL_FIELDS));
    }
    if (call !== undefined && typeof fn.arguments === 'string' && fn.arguments !== '') {
      call.arguments += fn.arguments;

      // The loop may have run an ended call already; late pieces still reach the reply.
      if (call.open) {
        request.onStream?.({ type: 'tool_input', index, json: call.arguments });
      }
    }
  };

  // Mistral streams reasoning as chunk arrays in content, then the answer as plain strings.
  const onContent = (content: unknown): void => {
    if (!Array.isArray(content)) {
      state.text = appended(state.text, content);

      return;
    }
    content.filter(isRecord).forEach((chunk) => {
      if (chunk.type === 'text') {
        state.text = appended(state.text, chunk.text);
      } else if (chunk.type === 'thinking') {
        state.think = {
          chunk: { ...state.think?.chunk, ...without(chunk, new Set(['thinking'])) },
          text: `${state.think?.text ?? ''}${textOf(chunk.thinking)}`,
        };
      }
    });
  };

  const onChunk = (chunk: Record<string, unknown>): void => {
    const error = errorOf(chunk, name);

    if (error !== null) {
      throw error;
    }

    // The usage chunk has no choices.
    const first: unknown = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined;

    if (!isRecord(first)) {
      return;
    }

    const delta = isRecord(first.delta) ? first.delta : {};

    onContent(delta.content);
    // DeepSeek needs reasoning_content back on the next request. vLLM, Cerebras and SambaNova name it reasoning.
    for (const field of REASONING_FIELDS) {
      const piece = appended(state.reasoning[field], delta[field]);

      if (piece !== undefined) {
        state.reasoning[field] = piece;
      }
    }
    state.refusal = appended(state.refusal, delta.refusal);
    // OpenRouter's reasoning_details and LiteLLM's thinking_blocks must go back with tool results.
    state.extra = mergedRecord(state.extra, without(delta, KNOWN_DELTA));

    if (Array.isArray(delta.tool_calls)) {
      delta.tool_calls.forEach((entry, position) => {
        if (isRecord(entry)) {
          onToolDelta(entry, position);
        }
      });
    }
    if (typeof first.finish_reason === 'string') {
      state.finish = first.finish_reason;
      endOpenCalls();
    }
  };

  for await (const chunk of readJsonEvents(source, request.signal, name)) {
    onChunk(chunk);
  }

  endOfStream(request.signal, state.finish !== undefined, name);

  return readReply({ choices: [{ message: messageOf(state), finish_reason: state.finish }] }, step, name);
};

/**
 * Chat Completions, the format DeepSeek, Mistral, Groq, Ollama and OpenRouter accept.
 * Never sends tool_choice: Ollama does not support it, and the loop only needs auto.
 * @param options - model id, the host's send or stream, and optional level overrides
 * @param profile - the provider's name for errors, its level defaults and its Chat Completions quirks
 */
export function openaiCompatibleModel(options: AdapterOptions, profile: ChatProfile = { name: 'OpenAI-compatible' }): AgentModel {
  const { name, levels, tokens = 'max_tokens', toolName = false, replayFields, streamBody = {} } = profile;

  requireTransport(options, name);

  // Types leave webSearch out here; this catches plain JS callers.
  if (options.webSearch !== undefined && options.webSearch !== false) {
    throw new TypeError(`${name}: webSearch is not supported. Add your provider's search in send, or give the assistant a search tool.`);
  }

  return async (request) => {
    const names = toolNames(request.messages);
    const body = withLevel({
      model: options.model,
      [tokens]: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: [
        { role: 'system', content: request.system },
        ...request.messages.flatMap((message) => (message.role === 'user' ? userMessages(message, names, toolName) : [assistantMessage(message, replayFields)])),
      ],
      tools: request.tools.map((tool) => ({
        type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
      })),
    }, request, { ...LEVELS, ...levels }, options);

    const { stream } = options;

    if (stream !== undefined) {
      const streaming = merge({ ...body, stream: true }, streamBody);

      return readStream(await postStream(stream, streaming, request, options), request, stepOf(request), name);
    }

    return readReply(await post(body, request, options, name), stepOf(request), name);
  };
}
