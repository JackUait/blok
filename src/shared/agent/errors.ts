import type { AgentError, AgentErrorCode, AgentProblem, AgentWarning, AgentWarningCode } from '../../../types/agent';

export const RETRYABLE_CODES: ReadonlySet<AgentErrorCode> = new Set<AgentErrorCode>(['STALE', 'CONFLICT', 'CANCELLED']);

export class AgentFailure extends Error {
  public readonly error: AgentError;

  constructor(error: AgentError) {
    super(error.message);
    this.name = 'AgentFailure';
    this.error = error;
  }
}

export const failure = (
  code: AgentErrorCode,
  message: string,
  extra: { commandIndex?: number; path?: string; details?: Record<string, unknown> } = {}
): AgentFailure => new AgentFailure({
  code,
  message,
  ...(extra.commandIndex !== undefined && { commandIndex: extra.commandIndex }),
  ...(extra.path !== undefined && { path: extra.path }),
  retryable: RETRYABLE_CODES.has(code),
  ...(extra.details !== undefined && { details: extra.details }),
});

export const warning = (
  code: AgentWarningCode,
  message: string,
  extra: Omit<AgentWarning, 'code' | 'message'> = {}
): AgentWarning => ({
  code,
  message,
  ...(extra.commandIndex !== undefined && { commandIndex: extra.commandIndex }),
  ...(extra.blockId !== undefined && { blockId: extra.blockId }),
  ...(extra.field !== undefined && { field: extra.field }),
});

// Each extra problem costs the model tokens on every retry.
const MAX_OTHERS = 8;

export const problemOf = (error: AgentError | AgentProblem): AgentProblem => ({
  code: error.code,
  message: error.message,
  ...(error.commandIndex !== undefined && { commandIndex: error.commandIndex }),
  ...(error.path !== undefined && { path: error.path }),
});

// Data rejections share one path per command, so their message tells them apart.
const keyOf = (problem: AgentProblem): string => JSON.stringify([
  problem.code, problem.commandIndex, problem.path, problem.code === 'DATA_REJECTED' ? problem.message : '',
]);

/** Adds the other problems of a failed batch to its first error, once each, capped. */
export const withOthers = (primary: AgentError, others: readonly AgentProblem[]): AgentError => {
  const error: AgentError = { ...primary };

  Reflect.deleteProperty(error, 'others');
  const seen = new Set([keyOf(error)]);
  const unique = others.map(problemOf).filter(problem => {
    const key = keyOf(problem);

    return seen.has(key) ? false : (seen.add(key), true);
  });

  if (unique.length === 0) {
    return error;
  }
  const listed = unique.slice(0, MAX_OTHERS);
  const count = `${unique.length} more problem${unique.length === 1 ? '' : 's'}`;
  const where = listed.length < unique.length ? `; the first ${listed.length} are in error.others` : ' in error.others';

  return { ...error, message: `${error.message} ${count}${where}. Fix them all, then retry.`, others: listed };
};

/** A page waits only on its host creating the document; another prepared tool needs the editor itself. */
export const insertUnavailableReason = (requires: readonly string[]): 'runtime' | 'host' =>
  requires.includes('pageBackend') ? 'host' : 'runtime';

/** Why block.insert of a type with a prepareInsert hook fails where nothing prepares it. */
export const notPreparedHere = (type: string, requires: readonly string[]): string => insertUnavailableReason(requires) === 'host'
  ? `This host cannot insert "${type}": a new page needs its own document, and this host creates none. `
    + 'The editor\'s page tool creates one, so does blok-mcp with --page-titles page-map, '
    + 'and so does a C# host whose page target implements IBlokPageCreator.'
  : `This runtime cannot insert "${type}": its tool prepares the block first (prepareInsert), and only the editor runs that.`;
