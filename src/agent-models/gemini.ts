import type {
  AgentModel, AgentModelContentBlock, AgentModelMessage, AgentModelRequest, AgentModelResponse, AgentThinkingLevel,
} from '../../types/api';

import {
  DEFAULT_MAX_TOKENS, blocksOf, endOfStream, errorOf, isRecord, isText, isToolResult, isToolUse,
  callId, providerBlock, rawTurn, post, postStream, requireTransport, stepOf, toolNames, webSearchTool, withLevel, type AdapterOptions, type Body, type Profile,
} from './shared';
import { readJsonEvents } from './sse';

const FORMAT = 'gemini';

// Gemini 3+ cannot turn thinking off, and sending thinkingBudget with thinkingLevel is a 400.
// Some models reject MINIMAL, so "off" is LOW, which every text model takes.
const level = (value: string): Body => ({ generationConfig: { thinkingConfig: { thinkingLevel: value } } });
const LEVELS: Record<AgentThinkingLevel, Body> = {
  off: level('LOW'), low: level('LOW'), medium: level('MEDIUM'), high: level('HIGH'), xhigh: level('HIGH'), max: level('HIGH'),
};

const REFUSALS = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII']);
// Any other stop reason (MISSING_THOUGHT_SIGNATURE, TOO_MANY_TOOL_CALLS, ...) fails the run instead of passing as done.
const HANDLED = new Set<unknown>([undefined, 'STOP', 'FINISH_REASON_UNSPECIFIED', 'MAX_TOKENS', 'MALFORMED_FUNCTION_CALL', ...REFUSALS]);

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

/** Tries per step when Gemini writes a malformed call. Nothing ran, so asking again is safe. */
const MALFORMED_TRIES = 3;

class MalformedCall extends Error {}

const readReply = (reply: unknown, step: number, name: string): AgentModelResponse => {
  const error = errorOf(reply, name);

  if (error !== null) {
    throw error;
  }
  if (isRecord(reply) && isRecord(reply.promptFeedback) && reply.promptFeedback.blockReason !== undefined) {
    return { content: [], stop_reason: 'refusal' };
  }

  const first: unknown = isRecord(reply) && Array.isArray(reply.candidates) ? reply.candidates[0] : undefined;

  if (!isRecord(first)) {
    throw new Error(`${name}: the reply has no candidates.`);
  }

  const parts = isRecord(first.content) && Array.isArray(first.content.parts) ? first.content.parts.filter(isRecord) : [];
  // A call without an id gets one, and the stored parts get it too, so the response matches.
  const stored = parts.map((part, index) => (isRecord(part.functionCall)
    ? { ...part, functionCall: { ...part.functionCall, id: callId(part.functionCall.id, step, index) } }
    : part));
  const content: AgentModelContentBlock[] = stored.flatMap((part): AgentModelContentBlock[] => {
    if (isRecord(part.functionCall)) {
      return [{ type: 'tool_use', id: String(part.functionCall.id), name: String(part.functionCall.name), input: part.functionCall.args ?? {} }];
    }

    return part.thought !== true && typeof part.text === 'string' ? [{ type: 'text', text: part.text }] : [];
  });
  const finish = first.finishReason;

  if (!HANDLED.has(finish)) {
    throw new Error(`Gemini stopped: ${String(finish)}`);
  }
  if (finish === 'MALFORMED_FUNCTION_CALL') {
    throw new MalformedCall(typeof first.finishMessage === 'string' ? first.finishMessage : '');
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

type Part = Record<string, unknown>;

/** Text continues the last text part of the same kind, so the parts match the JSON reply. */
const withPart = (parts: Part[], part: Part): Part[] => {
  const last = parts[parts.length - 1];

  if (last !== undefined && typeof last.text === 'string' && typeof part.text === 'string' && last.thought === part.thought) {
    // Spread keeps a thoughtSignature that arrives on a later chunk.
    return [...parts.slice(0, -1), { ...last, ...part, text: last.text + part.text }];
  }

  return [...parts, part];
};

// The loop applies a call at tool_end, so a reply that is retried or fails must emit nothing.
const SAFE = new Set<unknown>(['STOP', 'MAX_TOKENS', 'FINISH_REASON_UNSPECIFIED']);

/** Calls in the order readReply reads them, with the same ids. */
const emitCalls = (request: AgentModelRequest, parts: Part[], step: number): void => {
  const calls = parts.flatMap((part, position) => (isRecord(part.functionCall)
    ? [{ id: callId(part.functionCall.id, step, position), call: part.functionCall }]
    : []));

  calls.forEach(({ id, call }, index) => {
    request.onStream?.({ type: 'tool_start', index, id, name: String(call.name) });
    request.onStream?.({ type: 'tool_input', index, json: JSON.stringify(call.args ?? {}) });
    request.onStream?.({ type: 'tool_end', index });
  });
};

/**
 * Merges the chunks into the JSON reply readReply reads. Gemini sends each functionCall whole,
 * so the calls' events wait for a safe finish without losing anything live.
 */
const readStream = async (
  source: Response | ReadableStream<Uint8Array>,
  request: AgentModelRequest,
  step: number,
  name: string
): Promise<unknown> => {
  const state: { parts: Part[]; candidate: Part; promptFeedback?: Part; finished: boolean } = {
    parts: [], candidate: {}, finished: false,
  };

  for await (const chunk of readJsonEvents(source, request.signal, name)) {
    const error = errorOf(chunk, name);

    if (error !== null) {
      throw error;
    }
    if (isRecord(chunk.promptFeedback)) {
      state.promptFeedback = chunk.promptFeedback;
      state.finished ||= chunk.promptFeedback.blockReason !== undefined;
    }

    const first: unknown = Array.isArray(chunk.candidates) ? chunk.candidates[0] : undefined;

    if (!isRecord(first)) {
      continue;
    }

    const { content, ...rest } = first;
    const parts = isRecord(content) && Array.isArray(content.parts) ? content.parts.filter(isRecord) : [];

    state.candidate = { ...state.candidate, ...rest };
    state.finished ||= first.finishReason !== undefined;
    state.parts = parts.reduce(withPart, state.parts);
  }

  endOfStream(request.signal, state.finished, name);

  if (state.promptFeedback?.blockReason === undefined && SAFE.has(state.candidate.finishReason)) {
    emitCalls(request, state.parts, step);
  }

  return {
    candidates: [{ ...state.candidate, content: { role: 'model', parts: state.parts } }],
    ...(state.promptFeedback === undefined ? {} : { promptFeedback: state.promptFeedback }),
  };
};

/**
 * Gemini generateContent (v1beta). The model id goes in the URL, so `send` and `stream` get it as `context.model`.
 * @param options - model id, the host's send or stream, and optional level overrides
 * @param profile - the provider's name for errors and its level defaults
 */
export function geminiModel(options: AdapterOptions, { name, levels }: Profile = { name: 'Gemini' }): AgentModel {
  requireTransport(options, name);

  const search = webSearchTool(options, { googleSearch: {} });

  return async (request) => {
    const names = toolNames(request.messages);
    const step = stepOf(request);
    const body = withLevel({
      systemInstruction: { parts: [{ text: request.system }] },
      contents: request.messages.map((message) => (message.role === 'user' ? userContent(message, names) : modelContent(message))),
      tools: [
        { functionDeclarations: request.tools.map((tool) => ({
          name: tool.name, description: tool.description, parametersJsonSchema: tool.input_schema,
        })) },
        ...search,
      ],
      // Search alongside function calls needs this flag.
      ...(search.length > 0 ? { toolConfig: { includeServerSideToolInvocations: true } } : {}),
      generationConfig: { maxOutputTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS },
    }, request, { ...LEVELS, ...levels }, options);

    const { stream } = options;

    // The body is the same for both; Gemini picks streaming by URL.
    const ask = async (tries: number): Promise<AgentModelResponse> => {
      const reply = stream === undefined
        ? await post(body, request, options, name)
        : await readStream(await postStream(stream, body, request, options), request, step, name);

      try {
        return readReply(reply, step, name);
      } catch (error) {
        if (!(error instanceof MalformedCall)) {
          throw error;
        }
        if (tries === MALFORMED_TRIES || request.signal.aborted) {
          throw new Error(`${name} wrote a tool call that was not valid, ${tries} times${error.message === '' ? '.' : `: ${error.message}`}`);
        }

        return ask(tries + 1);
      }
    };

    return ask(1);
  };
}
