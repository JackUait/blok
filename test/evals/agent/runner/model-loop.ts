import type Anthropic from '@anthropic-ai/sdk';

export interface MessagesClient {
  create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
}

export interface ToolOutcome {
  content: string;
  isError: boolean;
}

export type Execute = (name: string, input: unknown) => Promise<ToolOutcome>;

export class TokenBudget {
  private used = 0;

  public constructor(private readonly total: number) {}

  public spend(tokens: number): void {
    this.used += tokens;
  }

  public get remaining(): number {
    return this.total - this.used;
  }

  public get spent(): number {
    return this.used;
  }
}

export interface StepUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** One model call and the tool calls it asked for. */
export interface LoopStep extends StepUsage {
  modelMs: number;
  toolMs: number;
  toolCalls: number;
}

export interface LoopResult extends StepUsage {
  stop: 'done' | 'turn-cap' | 'run-token-cap' | 'dispatch-token-cap' | 'refusal' | 'max-tokens';
  answer: string;
  turns: number;
  toolCalls: string[];
  /** The input of each tool call, index-aligned with toolCalls. */
  toolInputs: unknown[];
  /** The inputs of blok_describe calls: which arguments the model had to look up. */
  describeQueries: unknown[];
  steps: LoopStep[];
  detail?: string;
}

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

// Non-streaming keeps requests under SDK timeouts at this size (claude-api skill, max_tokens defaults).
const PER_CALL_MAX_TOKENS = 16_000;

export const runModelLoop = async (o: {
  client: MessagesClient;
  model: string;
  effort: Effort;
  system: string;
  prompt: string;
  tools: Anthropic.Tool[];
  execute: Execute;
  budget: { maxTurns: number; maxOutputTokens: number };
  dispatch: TokenBudget;
  now?: () => number;
}): Promise<LoopResult> => {
  const now = o.now ?? (() => performance.now());
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: o.prompt }];
  const result: LoopResult = {
    stop: 'turn-cap', answer: '', turns: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, toolCalls: [], toolInputs: [], describeQueries: [], steps: [],
  };

  while (result.turns < o.budget.maxTurns) {
    if (o.dispatch.remaining <= 0) {
      return { ...result, stop: 'dispatch-token-cap' };
    }

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: o.model,
      max_tokens: Math.max(1, Math.min(PER_CALL_MAX_TOKENS, o.budget.maxOutputTokens - result.outputTokens)),
      system: o.system,
      tools: o.tools,
      // A copy: the array grows after this call, and a recorded request must not change.
      messages: [...messages],
      output_config: { effort: o.effort },
      // Tools and system stay the same for a whole trial, so each step reads the earlier ones from cache.
      cache_control: { type: 'ephemeral' },
    };
    const started = now();
    const response = await o.client.create(params);
    const step: LoopStep = {
      modelMs: now() - started,
      toolMs: 0,
      toolCalls: 0,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    };

    result.steps.push(step);
    result.turns += 1;
    result.inputTokens += step.inputTokens;
    result.outputTokens += step.outputTokens;
    result.cacheReadTokens += step.cacheReadTokens;
    result.cacheWriteTokens += step.cacheWriteTokens;
    o.dispatch.spend(step.inputTokens + step.outputTokens + step.cacheReadTokens + step.cacheWriteTokens);

    if (response.stop_reason === 'refusal') {
      return { ...result, stop: 'refusal', detail: JSON.stringify(response.stop_details) };
    }

    if (response.stop_reason === 'max_tokens') {
      return { ...result, stop: 'max-tokens' };
    }

    messages.push({ role: 'assistant', content: response.content });

    const uses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');

    if (uses.length === 0) {
      const answer = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n');

      return { ...result, stop: 'done', answer };
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    const toolsStarted = now();

    for (const use of uses) {
      result.toolCalls.push(use.name);
      result.toolInputs.push(use.input);
      result.describeQueries.push(...(use.name === 'blok_describe' ? [use.input] : []));

      const outcome = await o.execute(use.name, use.input);

      toolResults.push({ type: 'tool_result', tool_use_id: use.id, content: outcome.content, is_error: outcome.isError });
    }

    step.toolMs = now() - toolsStarted;
    step.toolCalls = uses.length;
    messages.push({ role: 'user', content: toolResults });

    if (result.outputTokens >= o.budget.maxOutputTokens) {
      return { ...result, stop: 'run-token-cap' };
    }

    if (o.dispatch.remaining <= 0) {
      return { ...result, stop: 'dispatch-token-cap' };
    }
  }

  return result;
};

/** Infra stops and grader bugs are `error` and never count against the pass rate (05 §3.4). */
export const classifyTrial = (loop: LoopResult, verdicts: Array<{ pass: boolean }>, graderThrew: boolean): 'pass' | 'fail' | 'error' => {
  if (graderThrew || loop.stop === 'refusal' || loop.stop === 'dispatch-token-cap') {
    return 'error';
  }

  if (loop.stop !== 'done') {
    return 'fail';
  }

  return verdicts.every((v) => v.pass) ? 'pass' : 'fail';
};
