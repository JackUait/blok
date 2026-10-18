import type Anthropic from '@anthropic-ai/sdk';

import type { OutputData } from '../../../../types';
import type { EvalTask, ExecuteResult, Grader, GraderInput, LogEntry, Observed, Surface, Verdict } from '../types';
import type { Execute, LoopStep, MessagesClient, TokenBudget } from './model-loop';
import { classifyTrial, runModelLoop } from './model-loop';

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

// Names no tool: a real MCP client's prompt does not choose the call path for the model.
export const SYSTEM_PROMPT = 'You edit a Blok document through the provided tools. When you are done, reply with a short summary.';

export interface SurfaceRun {
  tools: Anthropic.Tool[];
  /** The system prompt the surface ships with; without one the trial sends SYSTEM_PROMPT. */
  system?: string;
  execute: Execute;
  finish(): Promise<{ final: OutputData; log: LogEntry[]; results: ExecuteResult[]; observed?: Observed; actorId?: string }>;
  close(): Promise<void>;
}

/** 'shipped' is what each surface ships with: mixed in the editor (agent.ts ask), the server default for MCP. */
export type EvalSchema = 'envelope' | 'full' | 'shipped';

export type OpenSurface = (task: EvalTask, schema: EvalSchema) => Promise<SurfaceRun>;

export interface TrialRecord {
  taskId: string;
  surface: Surface;
  trial: number;
  outcome: 'pass' | 'fail' | 'error';
  graders: Record<string, Verdict>;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  toolCalls: string[];
  describeQueries: unknown[];
  /** The error of each failed blok_execute: why the model had to try again. */
  executeErrors: Array<NonNullable<ExecuteResult['error']>>;
  /** The commands the model ran, with their arguments. */
  log: LogEntry[];
  steps: LoopStep[];
  wallMs: number;
  errorDetail?: string;
}

const errorRecord = (o: { task: EvalTask; surface: Surface; trial: number }, error: unknown): TrialRecord => ({
  taskId: o.task.id, surface: o.surface, trial: o.trial, outcome: 'error', graders: {}, turns: 0, inputTokens: 0, outputTokens: 0,
  cacheReadTokens: 0, cacheWriteTokens: 0, toolCalls: [], describeQueries: [], executeErrors: [], log: [], steps: [], wallMs: 0,
  errorDetail: error instanceof Error ? (error.stack ?? error.message) : String(error),
});

/** Runs every grader; one that throws is remembered, never counted as a verdict. */
const grade = (list: Grader[], input: GraderInput): { graders: Record<string, Verdict>; threw: unknown } => {
  const graders: Record<string, Verdict> = {};
  let threw: unknown = null;

  for (const grader of list) {
    try {
      graders[grader.name] = grader.check(input);
    } catch (error) {
      threw = error;
    }
  }

  return { graders, threw };
};

export const runTrial = async (o: {
  task: EvalTask; surface: Surface; open: OpenSurface; trial: number; client: MessagesClient;
  model: string; effort: Effort; schema: EvalSchema; dispatch: TokenBudget;
}): Promise<TrialRecord> => {
  let surface: SurfaceRun;

  try {
    surface = await o.open(o.task, o.schema);
  } catch (error) {
    return errorRecord(o, error);
  }

  try {
    const prompt = o.task.docId === undefined ? o.task.prompt : `The document id is "${o.task.docId}". ${o.task.prompt}`;
    const started = performance.now();
    const loop = await runModelLoop({
      client: o.client, model: o.model, effort: o.effort, system: surface.system ?? SYSTEM_PROMPT, prompt,
      tools: surface.tools, execute: surface.execute, budget: o.task.budget, dispatch: o.dispatch,
    });
    const wallMs = performance.now() - started;
    const end = await surface.finish();
    const { graders, threw } = grade(o.task.graders, {
      seed: o.task.seed, final: end.final, actorId: end.actorId ?? 'agent-eval', log: end.log, results: end.results,
      toolCalls: loop.toolCalls, answer: loop.answer, observed: end.observed,
    });

    return {
      taskId: o.task.id, surface: o.surface, trial: o.trial,
      outcome: classifyTrial(loop, Object.values(graders), threw !== null),
      graders, turns: loop.turns, inputTokens: loop.inputTokens, outputTokens: loop.outputTokens,
      cacheReadTokens: loop.cacheReadTokens, cacheWriteTokens: loop.cacheWriteTokens, toolCalls: loop.toolCalls, describeQueries: loop.describeQueries, steps: loop.steps, wallMs,
      log: end.log,
      executeErrors: end.results.flatMap((r) => (r.ok || r.error === undefined ? [] : [r.error])),
      errorDetail: threw instanceof Error ? (threw.stack ?? threw.message) : (loop.detail ?? (loop.stop === 'done' ? undefined : loop.stop)),
    };
  } catch (error) {
    return errorRecord(o, error);
  } finally {
    await surface.close();
  }
};

export const logFromExecuteCalls = (
  calls: Array<{ input: { commands?: Array<{ name: string; args: unknown }> }; result: ExecuteResult & { error?: { code: string; commandIndex?: number } } }>,
  actorId: string
): LogEntry[] =>
  calls.flatMap((call, batch) => (call.input.commands ?? []).map((command, index) => ({
    batch, index, name: command.name, args: command.args, actorId,
    ...(!call.result.ok && call.result.error !== undefined && (call.result.error.commandIndex ?? 0) === index ? { error: { code: call.result.error.code } } : {}),
  })));

/** A tool as the Messages API takes it; its input schema must be an object schema. */
export const asAnthropicTool = (tool: { name: string; description?: string; schema: Record<string, unknown> }): Anthropic.Tool => {
  if (tool.schema.type !== 'object') {
    throw new TypeError(`${tool.name}: input schema is not an object schema`);
  }

  return {
    name: tool.name,
    ...(tool.description !== undefined && { description: tool.description }),
    input_schema: { ...tool.schema, type: 'object' },
  };
};

/**
 * An `error` trial is infrastructure, not a measurement. It must fail the run
 * that produced it; pass and fail trials are judged later by the report.
 */
export const assertMeasured = (record: TrialRecord): void => {
  if (record.outcome === 'error') {
    throw new Error(`${record.taskId} on ${record.surface} #${record.trial} did not run: ${record.errorDetail ?? 'no detail'}`);
  }
};
