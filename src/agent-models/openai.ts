import type {
  AgentModel, AgentModelContentBlock, AgentModelMessage, AgentModelResponse, AgentThinkingLevel,
} from '../../types/api';

import {
  DEFAULT_MAX_TOKENS, blocksOf, errorOf, isRecord, isText, isToolResult, isToolUse, parseArguments,
  callId, providerBlock, rawTurn, post, stepOf, withLevel, type AdapterOptions, type Body,
} from './shared';

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

const readReply = (reply: unknown, step: number): AgentModelResponse => {
  const error = errorOf(reply, 'OpenAI');

  if (error !== null) {
    throw error;
  }
  if (!isRecord(reply) || !Array.isArray(reply.output)) {
    throw new Error('OpenAI: the reply has no output.');
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

/**
 * The OpenAI Responses API, stateless (`store: false`).
 * @param options - model id, the host's send, and optional level overrides
 */
export function openaiModel(options: AdapterOptions): AgentModel {
  return async (request) => {
    const body = withLevel({
      model: options.model,
      instructions: request.system,
      store: false,
      max_output_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      input: request.messages.flatMap((message) => (message.role === 'user' ? userItems(message) : assistantItems(message))),
      // strict: our blok_execute schema is not closed, and leaving strict out makes OpenAI try strict mode.
      tools: request.tools.map((tool) => ({
        type: 'function', name: tool.name, description: tool.description, parameters: tool.input_schema, strict: false,
      })),
    }, request, LEVELS, options);

    return readReply(await post(body, request, options), stepOf(request));
  };
}
