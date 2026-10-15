import type {
  AgentModel, AgentModelContentBlock, AgentModelMessage, AgentModelResponse, AgentThinkingLevel,
} from '../../types/api';

import {
  DEFAULT_MAX_TOKENS, blocksOf, errorOf, isRecord, isText, isToolResult, isToolUse,
  providerBlock, rawTurn, sendContext, toolNames, withLevel, type AdapterOptions, type Body,
} from './shared';

const FORMAT = 'gemini';

// Gemini 3+ cannot turn thinking off, and sending thinkingBudget with thinkingLevel is a 400.
const level = (value: string): Body => ({ generationConfig: { thinkingConfig: { thinkingLevel: value } } });
const LEVELS: Record<AgentThinkingLevel, Body> = {
  off: level('MINIMAL'), low: level('LOW'), medium: level('MEDIUM'), high: level('HIGH'), xhigh: level('HIGH'), max: level('HIGH'),
};

const REFUSALS = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII']);

const userContent = (message: AgentModelMessage, names: Map<string, string>): unknown => ({
  role: 'user',
  parts: blocksOf(message.content).flatMap((block): unknown[] => {
    if (isToolResult(block)) {
      const name = names.get(block.tool_use_id) ?? '';

      return [{ functionResponse: {
        id: block.tool_use_id, name, response: block.is_error === true ? { error: block.content } : { result: block.content },
      } }];
    }

    return isText(block) ? [{ text: block.text }] : [];
  }),
});

// Parts carry thoughtSignature, which Gemini 3 needs back unchanged.
const modelContent = (message: AgentModelMessage): unknown => {
  const raw = rawTurn(message.content, FORMAT);

  if (Array.isArray(raw)) {
    return { role: 'model', parts: raw };
  }

  return {
    role: 'model',
    parts: blocksOf(message.content).flatMap((block): unknown[] => {
      if (isText(block)) {
        return [{ text: block.text }];
      }

      return isToolUse(block) ? [{ functionCall: { id: block.id, name: block.name, args: block.input } }] : [];
    }),
  };
};

const readReply = (reply: unknown, step: number): AgentModelResponse => {
  const error = errorOf(reply, 'Gemini');

  if (error !== null) {
    throw error;
  }
  if (isRecord(reply) && isRecord(reply.promptFeedback) && reply.promptFeedback.blockReason !== undefined) {
    return { content: [], stop_reason: 'refusal' };
  }

  const first: unknown = isRecord(reply) && Array.isArray(reply.candidates) ? reply.candidates[0] : undefined;

  if (!isRecord(first)) {
    throw new Error('Gemini: the reply has no candidates.');
  }

  const parts = isRecord(first.content) && Array.isArray(first.content.parts) ? first.content.parts.filter(isRecord) : [];
  // A call without an id gets one, and the stored parts get it too, so the response matches.
  const stored = parts.map((part, index) => (isRecord(part.functionCall) && typeof part.functionCall.id !== 'string'
    ? { ...part, functionCall: { ...part.functionCall, id: `call-${step}-${index}` } }
    : part));
  const content: AgentModelContentBlock[] = stored.flatMap((part): AgentModelContentBlock[] => {
    if (isRecord(part.functionCall)) {
      return [{ type: 'tool_use', id: String(part.functionCall.id), name: String(part.functionCall.name), input: part.functionCall.args ?? {} }];
    }

    return part.thought !== true && typeof part.text === 'string' ? [{ type: 'text', text: part.text }] : [];
  });
  const finish = first.finishReason;

  if (finish === 'MALFORMED_FUNCTION_CALL') {
    content.push({ type: 'text', text: 'The model wrote a tool call that was not valid.' });
  }
  content.push(providerBlock(FORMAT, stored));

  const stop = ((): string => {
    if (finish === 'MAX_TOKENS') {
      return 'max_tokens';
    }
    if (typeof finish === 'string' && REFUSALS.has(finish)) {
      return 'refusal';
    }

    return content.some(isToolUse) ? 'tool_use' : 'end_turn';
  })();

  return { content, stop_reason: stop };
};

/**
 * Gemini generateContent (v1beta). The model id goes in the URL, so `send` gets it as `context.model`.
 * @param options - model id, the host's send, and optional level overrides
 */
export function geminiModel(options: AdapterOptions): AgentModel {
  return async (request) => {
    const names = toolNames(request.messages);
    const step = request.messages.filter((message) => message.role === 'assistant').length + 1;
    const body = withLevel({
      systemInstruction: { parts: [{ text: request.system }] },
      contents: request.messages.map((message) => (message.role === 'user' ? userContent(message, names) : modelContent(message))),
      tools: [{ functionDeclarations: request.tools.map((tool) => ({
        name: tool.name, description: tool.description, parametersJsonSchema: tool.input_schema,
      })) }],
      generationConfig: { maxOutputTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS },
    }, request, LEVELS, options);

    return readReply(await options.send(body, sendContext(request, options)), step);
  };
}
