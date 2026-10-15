import type {
  AgentModel, AgentModelContentBlock, AgentModelMessage, AgentModelResponse, AgentThinkingLevel,
} from '../../types/api';

import {
  DEFAULT_MAX_TOKENS, blocksOf, errorOf, isRecord, isText, isToolResult, isToolUse, parseArguments,
  providerBlock, rawTurn, sendContext, toolNames, withLevel, type AdapterOptions, type Body,
} from './shared';

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

const readReply = (reply: unknown): AgentModelResponse => {
  const error = errorOf(reply, 'OpenAI-compatible');

  if (error !== null) {
    throw error;
  }

  const first: unknown = isRecord(reply) && Array.isArray(reply.choices) ? reply.choices[0] : undefined;

  if (!isRecord(first) || !isRecord(first.message)) {
    throw new Error('OpenAI-compatible: the reply has no choices.');
  }

  const { message } = first;
  const text = textOf(message.content);
  const uses: AgentModelContentBlock[] = (Array.isArray(message.tool_calls) ? message.tool_calls : [])
    .filter(isRecord)
    .map((call) => {
      const fn = isRecord(call.function) ? call.function : {};

      return { type: 'tool_use', id: String(call.id), name: String(fn.name), input: parseArguments(fn.arguments) };
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

/**
 * Chat Completions, the format DeepSeek, Mistral, Groq, Ollama and OpenRouter accept.
 * Never sends tool_choice: Ollama does not support it, and the loop only needs auto.
 * @param options - model id, the host's send, and optional level overrides
 */
export function openaiCompatibleModel(options: AdapterOptions): AgentModel {
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

    return readReply(await options.send(body, sendContext(request, options)));
  };
}
