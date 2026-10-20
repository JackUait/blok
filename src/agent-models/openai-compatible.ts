import type {
  AgentModel, AgentModelContentBlock, AgentModelMessage, AgentModelRequest, AgentModelResponse, AgentThinkingLevel,
} from '../../types/api';

import {
  DEFAULT_MAX_TOKENS, blocksOf, endOfStream, errorOf, isRecord, isText, isToolResult, isToolUse, parseArguments,
  callId, providerBlock, rawTurn, post, postStream, requireTransport, stepOf, toolNames, withLevel, type AdapterOptions, type Body,
} from './shared';
import { readJsonEvents } from './sse';

const FORMAT = 'openai-chat';

const LEVELS: Record<AgentThinkingLevel, Body> = {
  off: { reasoning_effort: 'none' },
  low: { reasoning_effort: 'low' },
  medium: { reasoning_effort: 'medium' },
  high: { reasoning_effort: 'high' },
  xhigh: { reasoning_effort: 'xhigh' },
  max: { reasoning_effort: 'max' },
};

const userMessages = (message: AgentModelMessage, names: Map<string, string>): unknown[] => (typeof message.content === 'string'
  ? [{ role: 'user', content: message.content }]
  : message.content.flatMap((block): unknown[] => {
    if (isToolResult(block)) {
      // Mistral and Groq show `name` on tool messages.
      return [{ role: 'tool', tool_call_id: block.tool_use_id, name: names.get(block.tool_use_id) ?? '', content: block.content }];
    }

    return isText(block) ? [{ role: 'user', content: block.text }] : [];
  }));

// DeepSeek returns HTTP 400 when reasoning_content is missing while tools are present.
const assistantMessage = (message: AgentModelMessage): unknown => {
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

const textOf = (content: unknown): string => {
  if (typeof content === 'string') {
    return content;
  }

  return Array.isArray(content)
    ? content.filter(isRecord).flatMap((chunk) => (chunk.type === 'text' && typeof chunk.text === 'string' ? [chunk.text] : [])).join('')
    : '';
};

const readReply = (reply: unknown, step: number): AgentModelResponse => {
  const error = errorOf(reply, 'OpenAI-compatible');

  if (error !== null) {
    throw error;
  }

  const first: unknown = isRecord(reply) && Array.isArray(reply.choices) ? reply.choices[0] : undefined;

  if (!isRecord(first) || !isRecord(first.message)) {
    throw new Error('OpenAI-compatible: the reply has no choices.');
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
}

interface Assembly {
  text?: string;
  reasoning?: string;
  refusal?: string;
  finish?: string;
  /** Keyed by the provider's tool_calls index, in order of first chunk. */
  calls: Map<number, StreamingCall>;
}

const appended = (current: string | undefined, piece: unknown): string | undefined =>
  (typeof piece === 'string' ? `${current ?? ''}${piece}` : current);

// Same shape as a sent reply's message: index is dropped, since the provider block goes back as is.
const messageOf = (state: Assembly): Record<string, unknown> => {
  const calls = [...state.calls.values()].map((call) => ({
    ...(typeof call.id === 'string' ? { id: call.id } : {}), type: 'function', function: { name: call.name, arguments: call.arguments },
  }));

  return {
    role: 'assistant',
    content: state.text ?? null,
    ...(state.reasoning === undefined ? {} : { reasoning_content: state.reasoning }),
    ...(state.refusal === undefined ? {} : { refusal: state.refusal }),
    ...(calls.length === 0 ? {} : { tool_calls: calls }),
  };
};

/** Reports tool calls as they stream, then reads the assembled message through readReply. */
const readStream = async (source: Response | ReadableStream<Uint8Array>, request: AgentModelRequest, step: number): Promise<AgentModelResponse> => {
  const state: Assembly = { calls: new Map() };
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
      state.calls.set(key, { id: entry.id, name: typeof fn.name === 'string' ? fn.name : '', arguments: '', open: true });
      // Same id as readReply gives the final call, so the loop matches the early call.
      request.onStream?.({ type: 'tool_start', index, id: callId(entry.id, step, index), name: typeof fn.name === 'string' ? fn.name : '' });
    }

    const call = state.calls.get(key);

    if (call !== undefined && typeof fn.arguments === 'string' && fn.arguments !== '') {
      call.arguments += fn.arguments;

      // The loop may have run an ended call already; late pieces still reach the reply.
      if (call.open) {
        request.onStream?.({ type: 'tool_input', index, json: call.arguments });
      }
    }
  };

  const onChunk = (chunk: Record<string, unknown>): void => {
    const error = errorOf(chunk, 'OpenAI-compatible');

    if (error !== null) {
      throw error;
    }

    // The usage chunk has no choices.
    const first: unknown = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined;

    if (!isRecord(first)) {
      return;
    }

    const delta = isRecord(first.delta) ? first.delta : {};

    state.text = appended(state.text, delta.content);
    // DeepSeek needs reasoning_content back on the next request.
    state.reasoning = appended(state.reasoning, delta.reasoning_content);
    state.refusal = appended(state.refusal, delta.refusal);

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

  for await (const chunk of readJsonEvents(source, request.signal, 'OpenAI-compatible')) {
    onChunk(chunk);
  }

  endOfStream(request.signal, state.finish !== undefined, 'OpenAI-compatible');

  return readReply({ choices: [{ message: messageOf(state), finish_reason: state.finish }] }, step);
};

/**
 * Chat Completions, the format DeepSeek, Mistral, Groq, Ollama and OpenRouter accept.
 * Never sends tool_choice: Ollama does not support it, and the loop only needs auto.
 * @param options - model id, the host's send or stream, and optional level overrides
 */
export function openaiCompatibleModel(options: AdapterOptions): AgentModel {
  requireTransport(options, 'OpenAI-compatible');

  // Types leave webSearch out here; this catches plain JS callers.
  if (options.webSearch !== undefined && options.webSearch !== false) {
    throw new TypeError('OpenAI-compatible: webSearch is not supported. Add your provider\'s search in send, or give the assistant a search tool.');
  }

  return async (request) => {
    const names = toolNames(request.messages);
    const body = withLevel({
      model: options.model,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: [
        { role: 'system', content: request.system },
        ...request.messages.flatMap((message) => (message.role === 'user' ? userMessages(message, names) : [assistantMessage(message)])),
      ],
      tools: request.tools.map((tool) => ({
        type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
      })),
    }, request, LEVELS, options);

    const { stream } = options;

    if (stream !== undefined) {
      const streaming = { ...body, stream: true };

      return readStream(await postStream(stream, streaming, request, options), request, stepOf(request));
    }

    return readReply(await post(body, request, options, 'OpenAI-compatible'), stepOf(request));
  };
}
