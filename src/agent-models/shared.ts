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
  send(body: Body, context: SendContext): Promise<unknown>;
  maxTokens?: number;
  levels?: Partial<Record<AgentThinkingLevel, Body>>;
}

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

  return { ...out, [key]: isRecord(current) && isRecord(value) ? merge(current, value) : value };
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

  try {
    return JSON.parse(value) as unknown;
  } catch {
    // The tool rejects this with a schema error, so the model can retry.
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

const errorMessage = (error: unknown): string => {
  if (isRecord(error) && typeof error.message === 'string') {
    return error.message;
  }

  return typeof error === 'string' ? error : JSON.stringify(error);
};

export const errorOf = (reply: unknown, provider: string): Error | null => {
  if (!isRecord(reply) || reply.error === undefined || reply.error === null) {
    return null;
  }

  return new Error(`${provider}: ${errorMessage(reply.error)}`);
};
