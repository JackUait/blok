import type { AgentModel, AgentModelContentBlock, AgentModelMessage, AgentModelResponse, AgentThinkingLevel } from '../../types/api';

import {
  DEFAULT_MAX_TOKENS, errorOf, isRecord, sendContext, withLevel, type AdapterOptions, type Body,
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

const readReply = (reply: unknown): AgentModelResponse => {
  const error = errorOf(reply, 'Anthropic');

  if (error !== null) {
    throw error;
  }
  const content: unknown = isRecord(reply) ? reply.content : undefined;

  if (!isRecord(reply) || !Array.isArray(content)) {
    throw new Error('Anthropic: the reply has no content.');
  }

  return { content: content.filter(isBlock), stop_reason: typeof reply.stop_reason === 'string' ? reply.stop_reason : null };
};

/**
 * The Messages API. The request is already in its shape, so this mostly adds model and effort.
 * @param options - model id, the host's send, and optional level overrides
 */
export function anthropicModel(options: AdapterOptions): AgentModel {
  return async (request) => {
    const body = withLevel({
      model: options.model,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: request.system,
      messages: request.messages.map(withoutProviderBlocks),
      tools: request.tools,
    }, request, LEVELS, options);

    return readReply(await options.send(body, sendContext(request, options)));
  };
}
