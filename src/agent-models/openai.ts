import type {
  AgentModel, AgentModelContentBlock, AgentModelMessage, AgentModelRequest, AgentModelResponse, AgentThinkingLevel,
} from '../../types/api';

import {
  DEFAULT_MAX_TOKENS, blocksOf, endOfStream, errorOf, isRecord, isText, isToolResult, isToolUse, parseArguments,
  callId, providerBlock, rawTurn, post, postStream, requireTransport, stepOf, webSearchTool, withLevel, type AdapterOptions, type Body, type Profile,
} from './shared';
import { readJsonEvents } from './sse';

const FORMAT = 'openai-responses';

// Some models reject 'none' (and 'minimal') with a 400, so "off" is the lowest effort every model takes.
const LEVELS: Record<AgentThinkingLevel, Body> = {
  off: { reasoning: { effort: 'low' } },
  low: { reasoning: { effort: 'low' } },
  medium: { reasoning: { effort: 'medium' } },
  high: { reasoning: { effort: 'high' } },
  xhigh: { reasoning: { effort: 'xhigh' } },
  max: { reasoning: { effort: 'max' } },
};

const userItems = (message: AgentModelMessage): unknown[] => (typeof message.content === 'string'
  ? [{ role: 'user', content: message.content }]
  : message.content.flatMap((block): unknown[] => {
    if (isToolResult(block)) {
      return [{ type: 'function_call_output', call_id: block.tool_use_id, output: block.content }];
    }

    return isText(block) ? [{ role: 'user', content: block.text }] : [];
  }));

// Reasoning items, `phase` and calls must go back exactly as received.
const assistantItems = (message: AgentModelMessage): unknown[] => {
  const raw = rawTurn(message.content, FORMAT);

  if (Array.isArray(raw)) {
    return raw;
  }

  return blocksOf(message.content).flatMap((block): unknown[] => {
    if (isText(block)) {
      return [{ type: 'message', role: 'assistant', content: block.text }];
    }

    return isToolUse(block)
      ? [{ type: 'function_call', call_id: block.id, name: block.name, arguments: JSON.stringify(block.input) }]
      : [];
  });
};

const readReply = (reply: unknown, step: number, name: string): AgentModelResponse => {
  const error = errorOf(reply, name);

  if (error !== null) {
    throw error;
  }
  if (!isRecord(reply) || !Array.isArray(reply.output)) {
    throw new Error(`${name}: the reply has no output.`);
  }

  const content: AgentModelContentBlock[] = [];
  const state = { refused: false };
  // A call without a call_id gets one, and the stored output gets it too, so the output item matches.
  const output = reply.output.filter(isRecord).map((item, index) => (item.type === 'function_call'
    ? { ...item, call_id: callId(item.call_id, step, index) }
    : item));

  output.forEach((item) => {
    if (item.type === 'function_call') {
      content.push({ type: 'tool_use', id: String(item.call_id), name: String(item.name), input: parseArguments(item.arguments) });

      return;
    }
    if (item.type !== 'message' || !Array.isArray(item.content)) {
      return;
    }
    item.content.filter(isRecord).forEach((part) => {
      if (part.type === 'output_text' && typeof part.text === 'string') {
        content.push({ type: 'text', text: part.text });
      }
      if (part.type === 'refusal') {
        state.refused = true;
      }
    });
  });
  content.push(providerBlock(FORMAT, output));

  const reason = isRecord(reply.incomplete_details) ? reply.incomplete_details.reason : undefined;

  // max_messages, steered and any newer reason cut the reply short; passing it as done would store a partial turn.
  if (reply.status === 'incomplete' && reason !== 'max_output_tokens' && reason !== 'content_filter') {
    throw new Error(`OpenAI stopped: ${String(reason)}`);
  }
  const stop = ((): string => {
    if (reason === 'max_output_tokens') {
      return 'max_tokens';
    }
    if (state.refused || reason === 'content_filter') {
      return 'refusal';
    }

    return content.some(isToolUse) ? 'tool_use' : 'end_turn';
  })();

  return { content, stop_reason: stop };
};

/** A function call while it streams; `call` is its position among this response's calls. */
interface Streaming {
  call: number;
  json: string;
}

/** Reports tool calls as they stream, then reads the final response through readReply. */
const readStream = async (
  source: Response | ReadableStream<Uint8Array>,
  request: AgentModelRequest,
  step: number,
  name: string
): Promise<AgentModelResponse> => {
  const calls = new Map<number, Streaming>();
  const state: { final: unknown } = { final: undefined };

  const onEvent = (event: Record<string, unknown>): void => {
    // The error event carries its message at the top level, not under `error`.
    if (event.type === 'error') {
      throw new Error(`${name}: ${typeof event.message === 'string' ? event.message : 'the stream failed.'}`);
    }
    if (event.type === 'response.failed') {
      throw errorOf(event.response, name) ?? new Error(`${name}: the response failed.`);
    }
    // A truncated reply ends with response.incomplete; readReply maps it like a sent one.
    if (event.type === 'response.completed' || event.type === 'response.incomplete') {
      state.final = event.response;
    }

    const index = typeof event.output_index === 'number' ? event.output_index : -1;
    const streaming = calls.get(index);

    if (event.type === 'response.output_item.added' && isRecord(event.item) && event.item.type === 'function_call') {
      const call = calls.size;

      calls.set(index, { call, json: '' });
      // Same id as readReply gives the final call, so the loop matches the early call.
      request.onStream?.({ type: 'tool_start', index: call, id: callId(event.item.call_id, step, index), name: typeof event.item.name === 'string' ? event.item.name : '' });
    }
    if (event.type === 'response.function_call_arguments.delta' && streaming !== undefined && typeof event.delta === 'string' && event.delta !== '') {
      const json = streaming.json + event.delta;

      calls.set(index, { ...streaming, json });
      request.onStream?.({ type: 'tool_input', index: streaming.call, json });
    }
    if (event.type === 'response.output_item.done' && streaming !== undefined) {
      const json = isRecord(event.item) ? event.item.arguments : undefined;

      // xAI sends a call whole, with no deltas; the loop runs it at tool_end with the input reported so far.
      if (typeof json === 'string' && json !== streaming.json) {
        request.onStream?.({ type: 'tool_input', index: streaming.call, json });
      }
      request.onStream?.({ type: 'tool_end', index: streaming.call });
    }
  };

  for await (const event of readJsonEvents(source, request.signal, name)) {
    onEvent(event);
  }

  endOfStream(request.signal, state.final !== undefined, name);

  return readReply(state.final, step, name);
};

/**
 * The OpenAI Responses API, stateless (`store: false`).
 * @param options - model id, the host's send or stream, and optional level overrides
 * @param profile - the provider's name for errors and its level defaults
 */
export function openaiModel(options: AdapterOptions, { name, levels }: Profile = { name: 'OpenAI' }): AgentModel {
  requireTransport(options, name);

  const search = webSearchTool(options, { type: 'web_search' });

  return async (request) => {
    const body = withLevel({
      model: options.model,
      instructions: request.system,
      store: false,
      // Azure and xAI drop reasoning across stateless turns without it; OpenAI accepts it.
      include: ['reasoning.encrypted_content'],
      max_output_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      input: request.messages.flatMap((message) => (message.role === 'user' ? userItems(message) : assistantItems(message))),
      // strict: our blok_execute schema is not closed, and leaving strict out makes OpenAI try strict mode.
      tools: [
        ...request.tools.map((tool) => ({
          type: 'function', name: tool.name, description: tool.description, parameters: tool.input_schema, strict: false,
        })),
        ...search,
      ],
    }, request, { ...LEVELS, ...levels }, options);

    const { stream } = options;

    if (stream !== undefined) {
      return readStream(await postStream(stream, { ...body, stream: true }, request, options), request, stepOf(request), name);
    }

    return readReply(await post(body, request, options, name), stepOf(request), name);
  };
}
