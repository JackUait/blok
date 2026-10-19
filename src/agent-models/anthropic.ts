import type { AgentModel, AgentModelContentBlock, AgentModelMessage, AgentModelResponse, AgentThinkingLevel } from '../../types/api';

import {
  DEFAULT_MAX_TOKENS, callId, errorOf, isRecord, post, stepOf, withLevel, type AdapterOptions, type Body,
} from './shared';

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

/**
 * The Messages API. The request is already in its shape, so this mostly adds model, effort and cache marks.
 * @param options - model id, the host's send, and optional level overrides
 */
export function anthropicModel(options: AdapterOptions): AgentModel {
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

    return readReply(await post(body, request, options), stepOf(request));
  };
}
