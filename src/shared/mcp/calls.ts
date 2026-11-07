import type { AgentError } from '../../../types/agent';
import { AgentFailure } from '../agent/errors';
import { modelAnswer } from '../agent/model-answer';
import { parseToolCall, toolErrorAnswer, unknownArgument, type AgentToolName, type ToolCall } from '../agent/tool-call';

import { isMcpSurfaceError, NO_DELIVERY, surfaceError } from './errors';
import type { McpExecuteResult, UnavailableCommand } from './session';
import { wellFormed } from './wire-json';

/*
 * The pure half of one MCP tool call: every argument check in the order the Node
 * dispatcher runs it, and the answers it builds. Hosts do the IO between the steps.
 */

export interface ToolOutcome {
  structuredContent: Record<string, unknown>;
  isError: boolean;
}

export interface ListRequest {
  query?: string;
  cursor?: string;
  limit: number;
}

export interface ListResult {
  documents: Array<{ id: string; title: string | null; live: boolean }>;
  nextCursor: string | null;
  supported: boolean;
}

export type OpenMode = 'auto' | 'live' | 'stored';

/** What the host does next, once every check that needs no IO passed. */
export type CallStep =
  | { tool: 'blok_list_documents'; list: ListRequest }
  // documentId: open it. find: list { limit: 25, query? }, then pickDocument.
  | { tool: 'blok_open'; documentId: string; mode: OpenMode; write: boolean; view?: Record<string, unknown> }
  | { tool: 'blok_open'; find: { query?: string }; mode: OpenMode; write: boolean; view?: Record<string, unknown> }
  | { tool: 'blok_close'; handle: string }
  | { tool: AgentToolName; handle: string; write: boolean; call: ToolCall };

export class UnknownToolError extends Error {
  public constructor(name: string) {
    super(`Unknown tool: ${name}`);
    this.name = 'UnknownToolError';
  }
}

export const requireScope = (scopes: readonly string[] | null, scope: 'blok.read' | 'blok.write'): void => {
  if (scopes !== null && !scopes.includes(scope)) {
    throw surfaceError('FORBIDDEN', `This call needs the ${scope} scope.`, { requiredScope: scope });
  }
};

const handleOf = (args: Record<string, unknown>): string => {
  if (typeof args.handle !== 'string' || args.handle === '') {
    throw surfaceError('INVALID_ARGS', 'handle must be the string blok_open returned.');
  }

  return args.handle;
};

const MODES: ReadonlySet<unknown> = new Set(['auto', 'live', 'stored']);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The arguments each lifecycle tool takes: its inputSchema properties (src/shared/mcp/tools.ts). Others are refused.
 * The core tools take `handle` plus what src/shared/agent/tool-call.ts accepts.
 */
export const LIFECYCLE_ARGUMENTS: Readonly<Record<string, readonly string[]>> = {
  blok_list_documents: ['query', 'cursor', 'limit'],
  blok_open: ['documentId', 'query', 'mode', 'write', 'view'],
  blok_close: ['handle'],
};

const refuseUnknownArguments = (name: string, args: Record<string, unknown>): void => {
  const accepted = Object.hasOwn(LIFECYCLE_ARGUMENTS, name) ? LIFECYCLE_ARGUMENTS[name] : undefined;
  const extra = accepted === undefined ? null : unknownArgument(name, args, accepted);

  if (extra !== null) {
    throw new AgentFailure(extra);
  }
};

const CORE_SCOPES: Readonly<Record<AgentToolName, 'blok.read' | 'blok.write'>> = {
  blok_read: 'blok.read',
  blok_describe: 'blok.read',
  blok_execute: 'blok.write',
};

const isCoreTool = (name: string): name is AgentToolName => Object.hasOwn(CORE_SCOPES, name);

const listRequestOf = (args: Record<string, unknown>): ListRequest => {
  if ((args.limit !== undefined && typeof args.limit !== 'number')
    || (args.query !== undefined && typeof args.query !== 'string')
    || (args.cursor !== undefined && typeof args.cursor !== 'string')) {
    throw surfaceError('INVALID_ARGS', 'limit must be a number; query and cursor must be strings.');
  }

  return {
    limit: typeof args.limit === 'number' ? Math.min(Math.max(Math.trunc(args.limit), 1), 100) : 25,
    ...(typeof args.query === 'string' && { query: args.query }),
    ...(typeof args.cursor === 'string' && { cursor: args.cursor }),
  };
};

const openStep = (args: Record<string, unknown>, scopes: readonly string[] | null): CallStep => {
  if (args.write !== undefined && typeof args.write !== 'boolean') {
    throw surfaceError('INVALID_ARGS', 'write must be true or false.');
  }
  const write = args.write === true;

  requireScope(scopes, write ? 'blok.write' : 'blok.read');
  if (args.documentId !== undefined
    && (typeof args.documentId !== 'string' || args.documentId === '' || args.documentId.length > 512)) {
    throw surfaceError('INVALID_ARGS', 'documentId must be a string of 1 to 512 characters.');
  }
  if (args.documentId === undefined && args.query !== undefined && typeof args.query !== 'string') {
    throw surfaceError('INVALID_ARGS', 'query must be a string.');
  }
  if (args.mode !== undefined && !MODES.has(args.mode)) {
    throw surfaceError('INVALID_ARGS', 'mode must be "auto", "live" or "stored".');
  }
  if (args.view !== undefined && !isPlainObject(args.view)) {
    throw surfaceError('INVALID_ARGS', 'view must be an object of blok_read arguments.');
  }
  const mode: OpenMode = args.mode === 'live' || args.mode === 'stored' ? args.mode : 'auto';
  const view = isPlainObject(args.view) ? { view: args.view } : {};

  if (typeof args.documentId === 'string') {
    return { tool: 'blok_open', documentId: args.documentId, mode, write, ...view };
  }
  // Finding by query lists, which is a read.
  requireScope(scopes, 'blok.read');
  const trimmed = typeof args.query === 'string' ? args.query.trim() : '';

  return { tool: 'blok_open', find: trimmed === '' ? {} : { query: trimmed }, mode, write, ...view };
};

// MCP reaches a sub-page with blok_open on its pageId, so `page` is refused here as Ask AI refuses it without sub-pages.
const coreStep = (name: AgentToolName, args: Record<string, unknown>, scopes: readonly string[] | null): CallStep => {
  requireScope(scopes, CORE_SCOPES[name]);
  const handle = handleOf(args);
  const parsed = parseToolCall(name, Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'handle')), { pages: false });

  if (!parsed.ok) {
    throw new AgentFailure(parsed.error);
  }

  return { tool: name, handle, write: name === 'blok_execute', call: parsed.call };
};

/**
 * Every check of one call that needs no IO, in the Node dispatcher's order.
 * Throws an AgentFailure or McpSurfaceError for a model-fixable refusal, UnknownToolError otherwise.
 */
export const checkCall = (name: string, raw: Record<string, unknown>, scopes: readonly string[] | null): CallStep => {
  const args = wellFormed(raw);

  refuseUnknownArguments(name, args);
  if (isCoreTool(name)) {
    return coreStep(name, args, scopes);
  }
  switch (name) {
    case 'blok_list_documents':
      requireScope(scopes, 'blok.read');

      return { tool: name, list: listRequestOf(args) };
    case 'blok_open':
      return openStep(args, scopes);
    case 'blok_close':
      requireScope(scopes, 'blok.read');

      return { tool: name, handle: handleOf(args) };
    default:
      throw new UnknownToolError(name);
  }
};

/** Core throws AgentFailure for model-fixable input (a bad view, an unknown tool). Null: not the model's to fix. */
export const modelFixable = (thrown: unknown): AgentError | null => {
  if (isMcpSurfaceError(thrown)) {
    return thrown.agentError;
  }

  return thrown instanceof AgentFailure ? thrown.error : null;
};

/** The answer for a refused call. */
export const errorOutcome = (name: string, error: AgentError): ToolOutcome => ({
  structuredContent: name === 'blok_execute' ? { ...toolErrorAnswer(name, error), delivery: NO_DELIVERY } : toolErrorAnswer(name, error),
  isError: true,
});

/** The answer for a batch a session ran. Sessions spread delivery last, so it stays last. */
export const executeOutcome = (result: McpExecuteResult): ToolOutcome => ({ structuredContent: modelAnswer(result), isError: !result.ok });

/**
 * A query that matched nothing on the first page lists everything, so the model does not call again without query.
 * `relist` asks the host for that second listing; it is the first listing's request without query and cursor.
 */
export const listFollowUp = (request: ListRequest, listing: ListResult): { relist: ListRequest } | null =>
  request.query !== undefined && request.cursor === undefined && listing.supported && listing.documents.length === 0
    ? { relist: { limit: request.limit } }
    : null;

/** The listing the model sees: the first one, or the relisting marked queryMatched: false. */
export const listingAnswer = (listing: ListResult, relisted?: ListResult): ListResult & { queryMatched?: false } =>
  relisted === undefined ? { ...listing } : { ...relisted, queryMatched: false };

/**
 * Without an id, blok_open opens only a document it cannot get wrong: the one document when no query is
 * given, or the one whose id or title equals the query. A part-match could be the wrong document.
 */
export const pickDocument = (
  find: { query?: string },
  listing: ListResult & { queryMatched?: false },
): { id: string; title: string | null } | { listing: ListResult & { queryMatched?: false } } => {
  const needle = (find.query ?? '').toLowerCase();
  const candidates = needle === ''
    ? listing.documents
    : listing.documents.filter(doc => doc.id.toLowerCase() === needle || doc.title?.trim().toLowerCase() === needle);

  // With more pages, another exact match could be on one of them.
  if (candidates.length !== 1 || listing.nextCursor !== null) {
    return { listing };
  }

  return { id: candidates[0].id, title: candidates[0].title };
};

export interface OpenedSession {
  mode: 'live' | 'stored';
  write: boolean;
  durability: string;
  contractRevision: string;
  exists?: boolean;
  unavailableCommands?: readonly UnavailableCommand[];
}

/** blok_open's answer, keys in the order the model has always seen them. */
export const openAnswer = (input: {
  handle: string;
  session: OpenedSession;
  expiresAfterIdleMs: number;
  /** Set when the document was found by query. */
  found?: { documentId: string; title: string | null };
  view?: unknown;
}): Record<string, unknown> => ({
  handle: input.handle,
  mode: input.session.mode,
  write: input.session.write,
  durability: input.session.durability,
  expiresAfterIdleMs: input.expiresAfterIdleMs,
  contractRevision: input.session.contractRevision,
  ...(input.found !== undefined && { documentId: input.found.documentId, title: input.found.title }),
  ...(input.session.exists !== undefined && { exists: input.session.exists }),
  ...(input.session.unavailableCommands !== undefined && { unavailableCommands: input.session.unavailableCommands }),
  ...(input.view !== undefined && { view: input.view }),
});
