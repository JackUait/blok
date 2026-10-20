import type {
  AgentModel, AgentModelContentBlock, AgentModelMessage, AgentModelRequest, AgentModelResponse, AgentThinkingLevel,
} from '../../types/api';

import {
  DEFAULT_MAX_TOKENS, callId, endOfStream, errorOf, isRecord, parseArguments, post, postStream, requireTransport, stepOf, withLevel,
  type AdapterOptions, type Body,
} from './shared';
import { readJsonEvents } from './sse';

// Claude Opus 5.5 rejects disabled thinking, so "off" is the lowest effort.
const LEVELS: Record<AgentThinkingLevel, Body> = {
  off: { output_config: { effort: 'low' } },
  low: { output_config: { effort: 'low' } },
  medium: { output_config: { effort: 'medium' } },
  high: { output_config: { effort: 'high' } },
  xhigh: { output_config: { effort: 'xhigh' } },
  max: { output_config: { effort: 'max' } },
};

const withoutProviderBlocks = (message: AgentModelMessage): AgentModelMessage => (typeof message.content === 'string'
  ? message
  : { ...message, content: message.content.filter((block) => block.type !== 'provider') });

const isBlock = (entry: unknown): entry is AgentModelContentBlock => isRecord(entry) && typeof entry.type === 'string';

// A call with no id or name would be dropped by the loop and left unanswered; this way it runs or gets "unknown tool".
const withCallIds = (blocks: AgentModelContentBlock[], step: number): AgentModelContentBlock[] => blocks.map((block, index) => (block.type === 'tool_use'
  ? { ...block, id: callId(block.id, step, index), name: typeof block.name === 'string' ? block.name : '' }
  : block));

const readReply = (reply: unknown, step: number): AgentModelResponse => {
  const error = errorOf(reply, 'Anthropic');

  if (error !== null) {
    throw error;
  }
  const content: unknown = isRecord(reply) ? reply.content : undefined;

  if (!isRecord(reply) || !Array.isArray(content)) {
    throw new Error('Anthropic: the reply has no content.');
  }

  return { content: withCallIds(content.filter(isBlock), step), stop_reason: typeof reply.stop_reason === 'string' ? reply.stop_reason : null };
};

/** A content block while it streams; `json` collects its input_json_delta chunks. */
interface Building {
  block: Record<string, unknown>;
  json: string;
  /** Position among this response's tool calls, for stream events. */
  call?: number;
}

// The next request is a 400 if a thinking block lost its signature.
const DELTA_FIELDS: Record<string, string> = { text_delta: 'text', thinking_delta: 'thinking', signature_delta: 'signature' };

const withDelta = (building: Building, delta: Record<string, unknown>): Building => {
  if (delta.type === 'input_json_delta') {
    return typeof delta.partial_json === 'string' ? { ...building, json: building.json + delta.partial_json } : building;
  }

  const key = typeof delta.type === 'string' ? DELTA_FIELDS[delta.type] : undefined;
  const value = key === undefined ? undefined : delta[key];

  if (key === undefined || typeof value !== 'string') {
    return building;
  }

  const current = building.block[key];

  return { ...building, block: { ...building.block, [key]: `${typeof current === 'string' ? current : ''}${value}` } };
};

const finished = ({ block, json }: Building): AgentModelContentBlock => ('input' in block || json !== ''
  ? { ...block, type: String(block.type), input: parseArguments(json === '' ? block.input : json) }
  : { ...block, type: String(block.type) });

/** Builds the same response readReply gives for the JSON reply, and reports tool calls as they stream. */
const readStream = async (source: Response | ReadableStream<Uint8Array>, request: AgentModelRequest, step: number): Promise<AgentModelResponse> => {
  const blocks = new Map<number, Building>();
  const state: { stopped: boolean; stop: string | null; calls: number } = { stopped: false, stop: null, calls: 0 };

  const onEvent = (event: Record<string, unknown>): void => {
    const error = errorOf(event, 'Anthropic');

    if (error !== null) {
      throw error;
    }

    const index = typeof event.index === 'number' ? event.index : -1;
    const building = blocks.get(index);

    if (event.type === 'message_stop') {
      state.stopped = true;
    }
    if (event.type === 'message_delta' && isRecord(event.delta) && typeof event.delta.stop_reason === 'string') {
      state.stop = event.delta.stop_reason;
    }
    if (event.type === 'content_block_start' && isRecord(event.content_block)) {
      const block = { ...event.content_block };
      const call = block.type === 'tool_use' ? state.calls++ : undefined;

      blocks.set(index, { block, json: '', ...(call === undefined ? {} : { call }) });

      if (call !== undefined) {
        // Same id and name as withCallIds gives the final block, so the loop matches the early call.
        request.onStream?.({ type: 'tool_start', index: call, id: callId(block.id, step, index), name: typeof block.name === 'string' ? block.name : '' });
      }
    }
    if (event.type === 'content_block_delta' && building !== undefined && isRecord(event.delta)) {
      const next = withDelta(building, event.delta);

      blocks.set(index, next);

      if (next.call !== undefined && next.json !== building.json) {
        request.onStream?.({ type: 'tool_input', index: next.call, json: next.json });
      }
    }
    if (event.type === 'content_block_stop' && building?.call !== undefined) {
      request.onStream?.({ type: 'tool_end', index: building.call });
    }
  };

  for await (const event of readJsonEvents(source, request.signal, 'Anthropic')) {
    onEvent(event);
  }

  endOfStream(request.signal, state.stopped, 'Anthropic');

  const content = [...blocks.entries()].sort(([a], [b]) => a - b).map(([, entry]) => finished(entry));

  return { content: withCallIds(content, step), stop_reason: state.stop };
};

/**
 * The Messages API. The request is already in its shape, so this mostly adds model, effort and cache marks.
 * @param options - model id, the host's send or stream, and optional level overrides
 */
export function anthropicModel(options: AdapterOptions): AgentModel {
  requireTransport(options, 'Anthropic');

  return async (request) => {
    const body = withLevel({
      model: options.model,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      // Tools render before system, so this mark caches both for every prompt. An empty text block is a 400.
      system: request.system === '' ? '' : [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
      messages: request.messages.map(withoutProviderBlocks),
      tools: request.tools,
      // Moves to the last block on each call, so a step reads the steps before it.
      cache_control: { type: 'ephemeral' },
    }, request, LEVELS, options);

    const { stream } = options;

    if (stream !== undefined) {
      return readStream(await postStream(stream, { ...body, stream: true }, request, options), request, stepOf(request));
    }

    return readReply(await post(body, request, options, 'Anthropic'), stepOf(request));
  };
}
