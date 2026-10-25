import type { AgentError, AgentResult } from '../../../types/agent';

import { failure } from './errors';
import { modelAnswer } from './model-answer';

/*
 * One reading of a blok_read / blok_describe / blok_execute call, for every surface that carries one
 * (Ask AI's agent turn, the MCP dispatcher). A surface only serializes what this returns, so the
 * answers a model sees cannot drift apart. test/unit/architecture/agent-wire-parity-law.test.ts pins it.
 */

export type AgentToolName = 'blok_read' | 'blok_describe' | 'blok_execute';

/**
 * The arguments each tool accepts besides `page`, as src/agent/render-tools.ts declares them.
 * blok_read is left out: core's doc.read schema checks its arguments.
 */
export const TOOL_ARGUMENTS: Readonly<Record<'blok_describe' | 'blok_execute', readonly string[]>> = {
  blok_describe: ['tool', 'command'],
  blok_execute: ['commands', 'expectRevision'],
};

export type ToolCall =
  | { name: 'blok_read'; view: Record<string, unknown>; page?: string }
  | { name: 'blok_describe'; query: { tool?: string; command?: string } }
  // Core's checkEnvelope validates the batch, malformed entries included.
  | { name: 'blok_execute'; batch: Record<string, unknown>; page?: string };

export type ParsedToolCall = { ok: true; call: ToolCall } | { ok: false; error: AgentError };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const refused = (code: AgentError['code'], message: string, path?: string): ParsedToolCall => ({
  ok: false,
  error: failure(code, message, path === undefined ? {} : { path }).error,
});

/** INVALID_ARGS for the first argument outside `accepted`, or null. */
export const unknownArgument = (tool: string, args: Record<string, unknown>, accepted: readonly string[]): AgentError | null => {
  const extra = Object.keys(args).find(key => !accepted.includes(key));

  return extra === undefined
    ? null
    : failure('INVALID_ARGS', `${tool}: unknown field "${extra}"; accepted fields: ${accepted.join(', ') || 'none'}`, { path: `/${extra}` }).error;
};

const inputObject = (input: unknown): { args: Record<string, unknown> } | { error: AgentError } => {
  const state: { raw: unknown } = { raw: input ?? {} };

  // Agent-model adapters can hand over the raw argument string.
  if (typeof input === 'string') {
    try {
      state.raw = input.trim() === '' ? {} : JSON.parse(input);
    } catch {
      return { error: failure('INVALID_ARGS', 'The tool input is not valid JSON. Send a JSON object.').error };
    }
  }
  if (!isRecord(state.raw)) {
    return { error: failure('INVALID_ARGS', 'The tool input must be a JSON object.').error };
  }
  // parseArguments (src/agent-models/shared.ts) and the dev AI route send this for arguments that did not parse.
  if (Object.hasOwn(state.raw, 'invalidJson')) {
    return { error: failure('INVALID_ARGS', 'The tool input is not valid JSON, so nothing ran. Send the call again as a JSON object.').error };
  }

  return { args: state.raw };
};

const describeCall = (args: Record<string, unknown>): ParsedToolCall => {
  const extra = unknownArgument('blok_describe', args, TOOL_ARGUMENTS.blok_describe);
  const { tool, command } = args;

  if (extra !== null) {
    return { ok: false, error: extra };
  }
  if (tool !== undefined && typeof tool !== 'string') {
    return refused('INVALID_ARGS', '`tool` must be a string.', '/tool');
  }
  if (command !== undefined && typeof command !== 'string') {
    return refused('INVALID_ARGS', '`command` must be a string.', '/command');
  }

  return {
    ok: true,
    call: { name: 'blok_describe', query: { ...(tool === undefined ? {} : { tool }), ...(command === undefined ? {} : { command }) } },
  };
};

/**
 * Reads one tool call. `pages`: the surface can open the sub-page a `page` argument names.
 * Without it `page` is refused, never ignored: ignoring it would run the call on the wrong page.
 */
export const parseToolCall = (name: AgentToolName, input: unknown, options: { pages: boolean }): ParsedToolCall => {
  const parsed = inputObject(input);

  if ('error' in parsed) {
    return { ok: false, error: parsed.error };
  }
  const { args } = parsed;
  if (name === 'blok_describe') {
    return describeCall(args);
  }
  const { page, ...rest } = args;

  if (page !== undefined && (typeof page !== 'string' || page === '')) {
    return refused('INVALID_ARGS', '`page` must be the id of a page block.', '/page');
  }
  if (page !== undefined && !options.pages) {
    return refused(
      'COMMAND_UNAVAILABLE',
      'This surface cannot open sub-page documents, so `page` is not accepted. Omit it. Where blok_open exists, open the page block\'s pageId with it instead.',
      '/page',
    );
  }
  const pageField = page === undefined ? {} : { page };

  if (name === 'blok_read') {
    return { ok: true, call: { name, view: rest, ...pageField } };
  }
  const accepted = options.pages ? [...TOOL_ARGUMENTS.blok_execute, 'page'] : TOOL_ARGUMENTS.blok_execute;
  const extra = unknownArgument(name, rest, accepted);

  return extra === null ? { ok: true, call: { name, batch: rest, ...pageField } } : { ok: false, error: extra };
};

/** A batch refused before it ran. */
export const refusedBatch = (error: AgentError): Extract<AgentResult, { ok: false }> => ({ ok: false, error, warnings: [] });

/**
 * The answer a model sees for a failed call: a batch's failure for blok_execute,
 * `{ error }` for every other tool (src/agent/result-schemas.ts `orError`).
 */
export const toolErrorAnswer = (name: string, error: AgentError): Record<string, unknown> =>
  name === 'blok_execute' ? modelAnswer(refusedBatch(error)) : { error };
