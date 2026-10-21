import type {
  AgentModelContentBlock,
  AgentModelMessage,
  AgentModelRequest,
  AgentThinkingLevel,
} from '../../types/api';

export type Body = Record<string, unknown>;

export interface SendContext {
  signal: AbortSignal;
  model: string;
  thinking?: AgentThinkingLevel;
}

export interface AdapterOptions {
  model: string;
  send?(body: Body, context: SendContext): Promise<unknown>;
  /** When set, every request streams. */
  stream?(body: Body, context: SendContext): Promise<Response | ReadableStream<Uint8Array>>;
  maxTokens?: number;
  levels?: Partial<Record<AgentThinkingLevel, Body>>;
  /** The provider's own web search. An object is merged into its tool entry. */
  webSearch?: boolean | Body;
}

/** What agentModel knows about a provider beyond the API it speaks. */
export interface Profile {
  /** Names the provider in errors. */
  name: string;
  /** Level fragments that replace the API's defaults for this provider. The host's `levels` still win. */
  levels?: Partial<Record<AgentThinkingLevel, Body>>;
}

/** The provider's search tool entry, or none when the host did not ask for it. */
export const webSearchTool = (options: AdapterOptions, entry: Body): Body[] => {
  if (options.webSearch === undefined || options.webSearch === false) {
    return [];
  }

  return [options.webSearch === true ? entry : { ...entry, ...options.webSearch }];
};

export const DEFAULT_MAX_TOKENS = 16_000;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isText = (block: AgentModelContentBlock): block is { type: 'text'; text: string } =>
  block.type === 'text' && typeof block.text === 'string';

export const isToolUse = (block: AgentModelContentBlock): block is { type: 'tool_use'; id: string; name: string; input: unknown } =>
  block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string';

export const isToolResult = (
  block: AgentModelContentBlock
): block is { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean } =>
  block.type === 'tool_result' && typeof block.tool_use_id === 'string' && typeof block.content === 'string';

export const blocksOf = (content: AgentModelMessage['content']): AgentModelContentBlock[] =>
  typeof content === 'string' ? [{ type: 'text', text: content }] : content;

/** Native assistant turn, kept so reasoning data goes back to the provider unchanged. */
export const providerBlock = (format: string, raw: unknown): AgentModelContentBlock => ({ type: 'provider', format, raw });

export const rawTurn = (content: AgentModelMessage['content'], format: string): unknown => {
  if (typeof content === 'string') {
    return undefined;
  }

  // Widened to unknown so isRecord can narrow it; the union has no 'raw' key.
  const block: unknown = content.find((entry) => entry.type === 'provider' && entry.format === format);

  return isRecord(block) ? block.raw : undefined;
};

export const merge = (base: Body, extra: Body): Body => Object.entries(extra).reduce<Body>((out, [key, value]) => {
  const current = out[key];

  return { ...out, [key]: isRecord(value) ? merge(isRecord(current) ? current : {}, value) : value };
}, { ...base });

export const withLevel = (
  body: Body,
  request: AgentModelRequest,
  defaults: Record<AgentThinkingLevel, Body>,
  options: AdapterOptions
): Body => (request.thinking === undefined
  ? body
  : merge(body, options.levels?.[request.thinking] ?? defaults[request.thinking]));

/** Chat Completions and Responses send arguments as a string that may not be valid JSON. */
export const parseArguments = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value ?? {};
  }
  if (value.trim() === '') {
    return {};
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    // editor.agent's turn answers this with a retryable INVALID_ARGS.
    return { invalidJson: value };
  }
};

export const toolNames = (messages: AgentModelMessage[]): Map<string, string> => new Map(
  messages.flatMap((message) => blocksOf(message.content).filter(isToolUse).map((use): [string, string] => [use.id, use.name]))
);

export const sendContext = (request: AgentModelRequest, options: AdapterOptions): SendContext => ({
  signal: request.signal,
  model: options.model,
  ...(request.thinking === undefined ? {} : { thinking: request.thinking }),
});

/** A call without a usable id gets one, unique within the run. */
export const callId = (id: unknown, step: number, index: number): string =>
  (typeof id === 'string' && id !== '' ? id : `call-${step}-${index}`);

/** Steps so far plus this one; part of a synthesized call id. */
export const stepOf = (request: AgentModelRequest): number =>
  request.messages.filter((message) => message.role === 'assistant').length + 1;

/**
 * Hands send its own copy of the body: the body shares objects with the run's history,
 * tools and the level tables, and the docs invite hosts to edit it.
 */
export const post = (body: Body, request: AgentModelRequest, options: AdapterOptions, provider: string): Promise<unknown> => {
  if (options.send === undefined) {
    return Promise.reject(new TypeError(`${provider}: pass send or stream.`));
  }

  return options.send(structuredClone(body), sendContext(request, options));
};

/** As post, for the host's stream. */
export const postStream = (
  stream: NonNullable<AdapterOptions['stream']>,
  body: Body,
  request: AgentModelRequest,
  options: AdapterOptions
): Promise<Response | ReadableStream<Uint8Array>> => stream(structuredClone(body), sendContext(request, options));

/** Thrown when the adapter is made, so a missing transport shows at setup, not at the first prompt. */
export const requireTransport = (options: AdapterOptions, provider: string): void => {
  if (options.send === undefined && options.stream === undefined) {
    throw new TypeError(`${provider}: pass send or stream.`);
  }
};

const errorMessage = (error: unknown): string => {
  if (isRecord(error) && typeof error.message === 'string') {
    return error.message;
  }

  return typeof error === 'string' ? error : JSON.stringify(error);
};

/** undefined when the text is not JSON. */
export const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

export const errorOf = (reply: unknown, provider: string): Error | null => {
  if (!isRecord(reply) || reply.error === undefined || reply.error === null) {
    return null;
  }

  return new Error(`${provider}: ${errorMessage(reply.error)}`);
};

/** A failed streaming request answers with the provider's JSON error, not SSE, so readSse would find no events. */
export const httpError = async (source: Response | ReadableStream<Uint8Array>, provider: string): Promise<Error | null> => {
  if ('getReader' in source || source.ok) {
    return null;
  }

  const text = await source.text().catch(() => '');

  return errorOf(parseJson(text), provider) ?? new Error(`${provider}: HTTP ${source.status}.`);
};

/**
 * Throws unless the stream reached its terminal event. A dropped connection ends the
 * stream too, and its half reply must not pass as one.
 */
export const endOfStream = (signal: AbortSignal, finished: boolean, provider: string): void => {
  if (signal.aborted) {
    throw new Error(`${provider}: the run stopped mid-stream.`);
  }
  if (!finished) {
    throw new Error(`${provider}: the stream ended early.`);
  }
};
