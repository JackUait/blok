import type {
  AgentModel,
  AgentModelContentBlock,
  AgentModelMessage,
  AgentModelResponse,
  AgentModelStreamEvent,
  AgentModelTool,
  AgentThinkingLevel,
  AgentToolResult,
} from '../../types/api';
import { toolErrorAnswer } from '../shared/agent/tool-call';

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
  tools: AgentModelTool[];
  /** The conversation. The loop appends to it, so a follow-up continues it. */
  messages: AgentModelMessage[];
  call(name: string, input: unknown): Promise<AgentToolResult>;
  signal: AbortSignal;
  /** Model calls allowed in this run. */
  maxSteps: number;
  /** Sent on every model request of this run. */
  thinking?: AgentThinkingLevel;
  /** 'thinking' before each model request, then each tool called with its input. Silent after the run stops. */
  onActivity?(activity: string, input?: unknown): void;
  /** Every stream event of the model, after the loop has handled it. */
  onStream?(event: AgentModelStreamEvent): void;
  /** After each tool call finishes, whether it ran early from the stream or not. */
  onToolDone?(id: string, name: string, result: AgentToolResult): void;
}

type ToolUse = { type: 'tool_use'; id: string; name: string; input: unknown };

const isToolUse = (block: AgentModelContentBlock): block is ToolUse =>
  block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string';

const isCited = (block: AgentModelContentBlock | undefined): boolean =>
  block !== undefined && 'citations' in block && Array.isArray(block.citations);

// Anthropic web search splits one sentence into adjacent text blocks around each cited block.
const textOf = (content: AgentModelContentBlock[]): string => content
  .reduce((text, block, index) => {
    if (block.type !== 'text' || typeof block.text !== 'string') {
      return text;
    }

    const previous = content[index - 1];
    const sameSentence = previous?.type === 'text' && (isCited(previous) || isCited(block));

    return text === '' || sameSentence ? text + block.text : `${text}\n${block.text}`;
  }, '')
  .trim();

const isResponse = (value: unknown): value is AgentModelResponse =>
  typeof value === 'object' && value !== null && Array.isArray((value as { content?: unknown }).content);

const unanswered = (use: ToolUse, why: string): AgentModelContentBlock => ({
  type: 'tool_result',
  tool_use_id: use.id,
  content: JSON.stringify(toolErrorAnswer(use.name, { code: 'CANCELLED', message: why, retryable: false })),
  is_error: true,
});

const messageOf = (thrown: unknown): string => (thrown instanceof Error ? thrown.message : String(thrown));

const report = (options: AssistantLoopOptions, activity: string, input?: unknown): void => {
  try {
    options.onActivity?.(activity, input);
  } catch {
    // A status line must not stop an edit.
  }
};

type Started = Promise<AgentToolResult | null>;

/** Calls started from the stream. Null when the user stopped the run before its turn came. */
type Early = {
  byId: Map<string, Started>;
  /** Stream index → call, for a final reply that renames the ids. */
  byIndex: Map<number, { id: string; name: string; run: Started }>;
};

/**
 * The early call behind the `position`-th tool_use of the final reply.
 * Falls back to the stream index + name when the ids differ, so a call never runs twice.
 */
const earlyOf = (early: Early, uses: ToolUse[], position: number): Started | undefined => {
  const use = uses[position];
  const byId = early.byId.get(use.id);

  if (byId !== undefined) {
    return byId;
  }

  const byIndex = early.byIndex.get(position);

  if (byIndex === undefined || byIndex.name !== use.name || uses.some((other) => other.id === byIndex.id)) {
    return undefined;
  }

  return byIndex.run;
};

const runCall = async (options: AssistantLoopOptions, id: string, name: string, input: unknown): Promise<AgentToolResult> => {
  const result = await options.call(name, input);

  try {
    options.onToolDone?.(id, name, result);
  } catch {
    // A listener must not stop an edit.
  }

  return result;
};

const parse = (json: string): { ok: true; value: unknown } | { ok: false } => {
  try {
    return { ok: true, value: JSON.parse(json) as unknown };
  } catch {
    return { ok: false };
  }
};

/**
 * Starts each streamed call at its tool_end, chained in stream order.
 * A call that throws rejects the calls queued after it, as answerAll does.
 */
const streamStep = (options: AssistantLoopOptions): { early: Early; handle(event: AgentModelStreamEvent): void; close(): void } => {
  const open = new Map<number, { id: string; name: string; json: string }>();
  const early: Early = { byId: new Map(), byIndex: new Map() };
  const state: { chain: Promise<unknown>; ordered: boolean; closed: boolean } = { chain: Promise.resolve(), ordered: true, closed: false };

  const end = (index: number): void => {
    const entry = open.get(index);

    open.delete(index);

    if (entry === undefined) {
      return;
    }

    // An arg-less call streams no input at all.
    const input = parse(entry.json === '' ? '{}' : entry.json);

    if (!input.ok) {
      // Later calls wait for the final response too, so calls keep stream order.
      state.ordered = false;

      return;
    }
    if (!state.ordered || options.signal.aborted || early.byId.has(entry.id)) {
      return;
    }

    report(options, entry.name, input.value);

    const run = state.chain.then(() => (options.signal.aborted ? null : runCall(options, entry.id, entry.name, input.value)));

    // Read later by answerAll; this only keeps an early throw from being reported as unhandled.
    run.catch(() => undefined);
    state.chain = run;
    early.byId.set(entry.id, run);
    early.byIndex.set(index, { id: entry.id, name: entry.name, run });
  };

  const own = (event: AgentModelStreamEvent): void => {
    if (event.type === 'tool_start') {
      open.set(event.index, { id: event.id, name: event.name, json: '' });
    }

    const entry = open.get(event.index);

    if (event.type === 'tool_input' && entry !== undefined) {
      entry.json = event.json;
    }
    if (event.type === 'tool_end') {
      end(event.index);
    }
  };

  return {
    early,
    handle: (event) => {
      // A late event must not start a call answerAll already ran.
      if (state.closed) {
        return;
      }

      try {
        own(event);
        options.onStream?.(event);
      } catch {
        // A stream listener must not stop an edit.
      }
    },
    close: () => {
      state.closed = true;
    },
  };
};

/** A call that started early keeps its real result, even after a stop. */
const outcomeOf = (uses: ToolUse[], position: number, options: AssistantLoopOptions, early: Early): Promise<AgentToolResult | null> => {
  const use = uses[position];
  const started = earlyOf(early, uses, position);

  if (started !== undefined) {
    return started;
  }
  if (options.signal.aborted) {
    return Promise.resolve(null);
  }

  report(options, use.name, use.input);

  return runCall(options, use.id, use.name, use.input);
};

/** A call that throws answers itself and the calls after it, then ends the run. */
const answerAll = async (uses: ToolUse[], options: AssistantLoopOptions, early: Early): Promise<{ results: AgentModelContentBlock[]; error?: string }> => {
  const results: AgentModelContentBlock[] = [];

  for (const [index, use] of uses.entries()) {
    try {
      const outcome = await outcomeOf(uses, index, options, early);

      results.push(outcome === null
        ? unanswered(use, 'The user stopped the run.')
        : { type: 'tool_result', tool_use_id: use.id, content: outcome.content, is_error: outcome.isError });
    } catch (thrown) {
      const error = messageOf(thrown);

      results.push(...uses.slice(index).map((skipped) => unanswered(skipped, `The run failed: ${error}`)));

      return { results, error };
    }
  }

  return { results };
};

type Step = { next: 'continue'; reply: string } | { next: 'return'; result: AssistantLoopResult };

/** On max_tokens, a call that already ran early is answered with its real result. */
const cutOff = async (uses: ToolUse[], position: number, early: Early): Promise<AgentModelContentBlock> => {
  const use = uses[position];
  const started = earlyOf(early, uses, position);

  try {
    const outcome = started === undefined ? null : await started;

    return outcome === null
      ? unanswered(use, 'The output was cut off. This call was not run.')
      : { type: 'tool_result', tool_use_id: use.id, content: outcome.content, is_error: outcome.isError };
  } catch (thrown) {
    return unanswered(use, `The run failed: ${messageOf(thrown)}`);
  }
};

const ask = (
  options: AssistantLoopOptions,
  onStream: (event: AgentModelStreamEvent) => void
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> => {
  return options.model({
    system: options.system,
    messages: options.messages,
    tools: options.tools,
    signal: options.signal,
    onStream,
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

  report(options, 'thinking');

  const stream = streamStep(options);
  const response = await ask(options, stream.handle);

  stream.close();
  // The run may return below; no early edit may still be applying then.
  await Promise.allSettled(stream.early.byId.values());

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
      messages.push({ role: 'user', content: await Promise.all(uses.map((_use, position) => cutOff(uses, position, stream.early))) });
    }

    return finish('truncated');
  }
  if (stop === 'pause_turn' && uses.length === 0) {
    return { next: 'continue', reply: reply.text };
  }
  if (uses.length === 0) {
    return finish('done');
  }

  const answered = await answerAll(uses, options, stream.early);

  messages.push({ role: 'user', content: answered.results });

  if (answered.error !== undefined) {
    return finish('failed', answered.error);
  }

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
