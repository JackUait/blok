import type {
  AgentAnthropicTool,
  AgentModel,
  AgentModelContentBlock,
  AgentModelMessage,
  AgentModelResponse,
  AgentThinkingLevel,
  AgentToolResult,
} from '../../types/api';

export type AssistantLoopStatus = 'done' | 'stopped' | 'refused' | 'truncated' | 'step-limit' | 'failed';

export interface AssistantLoopResult {
  status: AssistantLoopStatus;
  /** The model's last text. */
  reply: string;
  error?: string;
}

export interface AssistantLoopOptions {
  model: AgentModel;
  system: string;
  tools: AgentAnthropicTool[];
  /** The conversation. The loop appends to it, so a follow-up continues it. */
  messages: AgentModelMessage[];
  call(name: string, input: unknown): Promise<AgentToolResult>;
  signal: AbortSignal;
  /** Model calls allowed in this run. */
  maxSteps: number;
  /** Sent on every model request of this run. */
  thinking?: AgentThinkingLevel;
  /** 'thinking' before each model request, then the name of each tool called. Silent after the run stops. */
  onActivity?(activity: string): void;
}

type ToolUse = { type: 'tool_use'; id: string; name: string; input: unknown };

const isToolUse = (block: AgentModelContentBlock): block is ToolUse =>
  block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string';

const textOf = (content: AgentModelContentBlock[]): string => content
  .flatMap((block) => (block.type === 'text' && typeof block.text === 'string' ? [block.text] : []))
  .join('\n')
  .trim();

const isResponse = (value: unknown): value is AgentModelResponse =>
  typeof value === 'object' && value !== null && Array.isArray((value as { content?: unknown }).content);

const unanswered = (use: ToolUse, why: string): AgentModelContentBlock => ({
  type: 'tool_result',
  tool_use_id: use.id,
  content: JSON.stringify({ ok: false, error: { code: 'CANCELLED', message: why, retryable: false } }),
  is_error: true,
});

const messageOf = (thrown: unknown): string => (thrown instanceof Error ? thrown.message : String(thrown));

const answerAll = async (uses: ToolUse[], options: AssistantLoopOptions): Promise<AgentModelContentBlock[]> => {
  const results: AgentModelContentBlock[] = [];

  for (const use of uses) {
    if (!options.signal.aborted) {
      options.onActivity?.(use.name);
    }

    const outcome = options.signal.aborted ? null : await options.call(use.name, use.input);

    results.push(outcome === null
      ? unanswered(use, 'The user stopped the run.')
      : { type: 'tool_result', tool_use_id: use.id, content: outcome.content, is_error: outcome.isError });
  }

  return results;
};

type Step = { next: 'continue'; reply: string } | { next: 'return'; result: AssistantLoopResult };

const ask = (options: AssistantLoopOptions): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> => {
  return options.model({
    system: options.system,
    messages: options.messages,
    tools: options.tools,
    signal: options.signal,
    ...(options.thinking === undefined ? {} : { thinking: options.thinking }),
  }).then(
    (value) => ({ ok: true as const, value }),
    (thrown: unknown) => ({ ok: false as const, error: messageOf(thrown) })
  );
};

const runStep = async (options: AssistantLoopOptions, previousReply: string): Promise<Step> => {
  const { messages, signal } = options;
  const reply = { text: previousReply };
  const finish = (status: AssistantLoopStatus, error?: string): Step => ({
    next: 'return',
    result: { status, reply: reply.text, ...(error === undefined ? {} : { error }) },
  });

  if (signal.aborted) {
    return finish('stopped');
  }

  options.onActivity?.('thinking');

  const response = await ask(options);

  if (signal.aborted) {
    return finish('stopped');
  }
  if (!response.ok) {
    return finish('failed', response.error);
  }
  if (!isResponse(response.value)) {
    return finish('failed', 'The model returned no message content.');
  }

  const { content, stop_reason: stop } = response.value;
  const text = textOf(content);

  reply.text = text === '' ? reply.text : text;

  if (stop === 'refusal') {
    // A refused turn is not added: its partial content would poison a follow-up.
    return finish('refused');
  }

  messages.push({ role: 'assistant', content });

  const uses = content.filter(isToolUse);

  if (stop === 'max_tokens') {
    if (uses.length > 0) {
      messages.push({ role: 'user', content: uses.map((use) => unanswered(use, 'The output was cut off. This call was not run.')) });
    }

    return finish('truncated');
  }
  if (stop === 'pause_turn') {
    return { next: 'continue', reply: reply.text };
  }
  if (uses.length === 0) {
    return finish('done');
  }

  messages.push({ role: 'user', content: await answerAll(uses, options) });

  return signal.aborted ? finish('stopped') : { next: 'continue', reply: reply.text };
};

/**
 * Runs model calls and tool calls until the model answers without a tool call.
 *
 * Every tool_use the history holds gets a tool_result, even when the run stops
 * early. A follow-up request with an unanswered tool_use is rejected by the API.
 * @param options - model, tools and the conversation to continue
 * @param reply - the model's last text so far
 * @param stepsLeft - model calls still allowed
 */
export const runAssistantLoop = async (
  options: AssistantLoopOptions,
  reply = '',
  stepsLeft = options.maxSteps
): Promise<AssistantLoopResult> => {
  if (stepsLeft <= 0) {
    return { status: 'step-limit', reply };
  }

  const step = await runStep(options, reply);

  return step.next === 'return' ? step.result : runAssistantLoop(options, step.reply, stepsLeft - 1);
};
