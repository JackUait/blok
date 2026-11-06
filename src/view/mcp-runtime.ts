import type { AgentError, AgentResult } from '../../types/agent';
import type { BlokCustomToolsFile, ManifestOverrides } from '../../types/tool-manifest';
import { failure } from '../shared/agent/errors';
import { defaultAgentActor, safeClientName } from '../shared/mcp/actor';
import {
  checkCall, errorOutcome, executeOutcome, listFollowUp, listingAnswer, modelFixable, openAnswer, pickDocument, UnknownToolError,
  type ListRequest, type ListResult, type OpenedSession,
} from '../shared/mcp/calls';
import { checkOptionSafety, McpConfigError, parseMcpArgs } from '../shared/mcp/config';
import { parseCustomToolsFile, parseOverridesFile } from '../shared/mcp/custom-tools-file';
import { assertSafeId, listedIds, listPage, parseDocumentText, savedFileText, titleOfText } from '../shared/mcp/files';
import type { BlokMcpOptions } from '../shared/mcp/options';
import { failedResult, NO_DELIVERY, surfaceError, terminalToError } from '../shared/mcp/errors';
import type { Delivery } from '../shared/mcp/session';
import { resolveMode } from '../shared/mcp/mode';
import { mcpPromptResult } from '../shared/mcp/prompts';
import { mcpSurface } from '../shared/mcp/surface';

import { mcpContractsFor, type McpContracts } from './mcp-contracts';

/*
 * The MCP operations of the server runtime. Each one is the Node MCP's own code over JSON,
 * so a C#, Go or Rust host that does only the IO answers what blok-mcp answers.
 * docs/plans/2026-11-06-csharp-mcp-research/08-bundle-contract.md lists them.
 */

type Input = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringArrayRecord = (value: unknown): value is Record<string, string[]> =>
  isRecord(value) && Object.values(value).every(list => Array.isArray(list) && list.every(item => typeof item === 'string'));

const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined =>
  allowed.find(item => item === value);

/** The start options that shape the contracts, as blok-mcp's own options read them. */
export const contractsOf = (input: Input): McpContracts => {
  const manifest: BlokCustomToolsFile | undefined = input.manifest === undefined ? undefined : parseCustomToolsFile(input.manifest);
  const overrides: ManifestOverrides | undefined = input.overrides === undefined ? undefined : parseOverridesFile(input.overrides);

  return mcpContractsFor({
    manifest,
    overrides,
    pageTitles: oneOf(input.pageTitles, ['off', 'page-map'] as const),
    ...(isStringArrayRecord(input.richTextFields) && { richTextFields: input.richTextFields }),
    sync: input.sync === true,
    source: input.source === true,
    uploads: input.uploads === true,
    ...(input.comments === false && { comments: false }),
  });
};

const surface = (input: Input): string => JSON.stringify(mcpSurface(contractsOf(input), {
  schema: oneOf(input.schema, ['envelope', 'full', 'mixed'] as const),
  ...(typeof input.handleIdleMs === 'number' && { handleIdleMs: input.handleIdleMs }),
}));

const stringRecord = (value: unknown): Record<string, string> => (isRecord(value)
  ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  : {});

// JSON-RPC InvalidParams: the transport raises it, as the SDK does for Node.
const INVALID_PARAMS = -32602;

const prompt = (input: Input): string => {
  const outcome = mcpPromptResult(String(input.name), stringRecord(input.arguments));

  return JSON.stringify(outcome.ok ? { result: outcome.result } : { error: { code: INVALID_PARAMS, message: outcome.message } });
};

const scopesOf = (value: unknown): readonly string[] | null =>
  Array.isArray(value) ? value.filter((scope): scope is string => typeof scope === 'string') : null;

const checkCallResult = (input: Input): string => {
  const name = String(input.name);

  try {
    return JSON.stringify({ step: checkCall(name, isRecord(input.arguments) ? input.arguments : {}, scopesOf(input.scopes)) });
  } catch (thrown) {
    if (thrown instanceof UnknownToolError) {
      return JSON.stringify({ unknownTool: thrown.message });
    }
    const error = modelFixable(thrown);

    if (error === null) {
      throw thrown;
    }

    return JSON.stringify({ answer: errorOutcome(name, error) });
  }
};

const isListResult = (value: unknown): value is ListResult =>
  isRecord(value) && Array.isArray(value.documents) && (value.nextCursor === null || typeof value.nextCursor === 'string')
  && typeof value.supported === 'boolean';

const listResultOf = (value: unknown, name: string): ListResult => {
  if (!isListResult(value)) {
    throw new TypeError(`${name} must be { documents, nextCursor, supported }.`);
  }

  return value;
};

const listRequestOf = (value: unknown): ListRequest => {
  const request = isRecord(value) ? value : {};

  return {
    limit: typeof request.limit === 'number' ? request.limit : 25,
    ...(typeof request.query === 'string' && { query: request.query }),
    ...(typeof request.cursor === 'string' && { cursor: request.cursor }),
  };
};

const listAnswer = (input: Input): string => {
  const first = listResultOf(input.listing, 'listing');

  if (input.relisted !== undefined) {
    return JSON.stringify({ listing: listingAnswer(first, listResultOf(input.relisted, 'relisted')) });
  }
  const followUp = listFollowUp(listRequestOf(input.request), first);

  return JSON.stringify(followUp === null ? { listing: listingAnswer(first) } : followUp);
};

const pick = (input: Input): string => {
  const find = isRecord(input.find) && typeof input.find.query === 'string' ? { query: input.find.query } : {};
  const picked = pickDocument(find, listResultOf(input.listing, 'listing'));

  return JSON.stringify('listing' in picked
    ? { answer: { structuredContent: { ...picked.listing }, isError: false } }
    : { open: { documentId: picked.id, title: picked.title } });
};

const openAnswerResult = (input: Input): string => {
  if (typeof input.handle !== 'string' || !isRecord(input.session) || typeof input.expiresAfterIdleMs !== 'number') {
    throw new TypeError('mcpOpenAnswer input requires `handle`, `session` and `expiresAfterIdleMs`.');
  }
  const found = isRecord(input.found) && typeof input.found.documentId === 'string'
    ? { documentId: input.found.documentId, title: typeof input.found.title === 'string' ? input.found.title : null }
    : undefined;

  return JSON.stringify({
    answer: {
      structuredContent: openAnswer({
        handle: input.handle,
        session: input.session as unknown as OpenedSession,
        expiresAfterIdleMs: input.expiresAfterIdleMs,
        ...(found !== undefined && { found }),
        ...(input.view !== undefined && { view: input.view }),
      }),
      isError: false,
    },
  });
};

const isAgentError = (value: unknown): value is AgentError =>
  isRecord(value) && typeof value.code === 'string' && typeof value.message === 'string';

/**
 * The error a host raised, built by the helper Node uses at that site: `retryable` depends on it,
 * not only on the code. `as-is` keeps an error that already went through one (a re-wrap).
 */
export const hostError = (input: Input): AgentError => {
  const error = input.error;

  if (!isAgentError(error)) {
    throw new TypeError('MCP error input requires an `error` with string `code` and `message`.');
  }
  const details = isRecord(error.details) ? error.details : undefined;

  switch (input.helper) {
    case 'surface':
      return surfaceError(error.code, error.message, details).agentError;
    case 'failure':
      return failure(error.code, error.message, {
        ...(typeof error.commandIndex === 'number' && { commandIndex: error.commandIndex }),
        ...(typeof error.path === 'string' && { path: error.path }),
        ...(details !== undefined && { details }),
      }).error;
    case 'as-is':
      if (typeof error.retryable !== 'boolean') {
        throw new TypeError('An `as-is` error needs a boolean `retryable`.');
      }

      return error;
    default:
      throw new TypeError('MCP error input requires `helper`: "surface", "failure" or "as-is".');
  }
};

/**
 * blok_execute's answer for a batch result. `delivery` is what the save or the room gave; absent, nothing
 * was saved. `failed`: the save was refused (an error input as mcpErrorAnswer takes), so the batch fails
 * with that error and keeps its warnings.
 */
const executeAnswer = (input: Input): string => {
  const result = input.result;

  if (!isRecord(result) || typeof result.ok !== 'boolean' || !Array.isArray(result.warnings)) {
    throw new TypeError('mcpExecuteAnswer input requires a batch `result`.');
  }
  const ran = result as unknown as AgentResult;
  const delivery = isRecord(input.delivery) ? input.delivery as unknown as Delivery : NO_DELIVERY;

  return JSON.stringify({
    answer: executeOutcome(isRecord(input.failed) ? failedResult(hostError(input.failed), ran.warnings) : { ...ran, delivery }),
  });
};

const errorAnswer = (input: Input): string => JSON.stringify({ answer: errorOutcome(String(input.tool), hostError(input)) });

const modeResult = (input: Input): string => {
  const requested = oneOf(input.requested, ['auto', 'live', 'stored'] as const) ?? 'auto';

  try {
    return JSON.stringify({ mode: resolveMode(requested, input.sync === true) });
  } catch (thrown) {
    const error = modelFixable(thrown);

    if (error === null) {
      throw thrown;
    }

    return JSON.stringify({ error });
  }
};

// The default actor; a host with its own agentActor names it itself and publishes actor.name.
const actorResult = (input: Input): string => {
  const clientName = safeClientName(typeof input.clientName === 'string' ? input.clientName : undefined);

  return JSON.stringify({ clientName, actor: defaultAgentActor(String(input.principal), clientName), presenceName: clientName });
};

/** A config refusal is data; blok-mcp prints `blok-mcp: <error>` and exits with code 2. */
const configResult = (run: () => unknown): string => {
  try {
    const value = run();

    return JSON.stringify(value === undefined ? {} : value);
  } catch (thrown) {
    if (thrown instanceof McpConfigError) {
      return JSON.stringify({ error: thrown.message });
    }
    throw thrown;
  }
};

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const parseArgs = (input: Input): string => {
  const env = isRecord(input.env)
    ? Object.fromEntries(Object.entries(input.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    : {};

  return configResult(() => ({ ok: parseMcpArgs(stringArray(input.argv), env) }));
};

const unused = (): Promise<never> => Promise.reject(new Error('Only checked, never called.'));

/**
 * Options as data: the functions blok-mcp checks only for presence are flags here.
 * `authorize: true` stands for a hook; `uploads.uploadByFile: true` for the uploader's function.
 */
const checkOptions = (input: Input): string => configResult(() => {
  const options = isRecord(input.options) ? input.options : {};
  const { authorize, uploads, ...rest } = options;
  const upload = isRecord(uploads) ? uploads : undefined;
  const { uploadByFile, ...limits } = upload ?? {};

  checkOptionSafety({
    ...rest,
    ...(authorize === true && { authorize: unused }),
    ...(upload !== undefined && { uploads: { ...limits, uploader: uploadByFile === true ? { uploadByFile: unused } : {} } }),
  } as unknown as BlokMcpOptions);
});

const configFile = (input: Input): string => configResult(() => ({
  value: input.kind === 'manifest' ? parseCustomToolsFile(input.value) : parseOverridesFile(input.value),
}));

/** A refusal the files source raises as an MCP error; `{}` when there is none. */
const surfaceRefusal = (run: () => unknown): string => {
  try {
    return JSON.stringify(run() ?? {});
  } catch (thrown) {
    const error = modelFixable(thrown);

    if (error === null) {
      throw thrown;
    }

    return JSON.stringify({ error });
  }
};

const filesList = (input: Input): string => {
  const entries = Array.isArray(input.entries) ? input.entries.filter(isRecord) : [];
  const titled = entries.map(entry => ({
    id: String(entry.id),
    // A file the host could not read lists without a title.
    title: typeof entry.text === 'string' ? titleOfText(entry.text) : null,
  }));

  return JSON.stringify(listPage(titled, listRequestOf(input)));
};

const documentText = (input: Input): string =>
  JSON.stringify({ text: input.form === 'compact' ? JSON.stringify(input.document) : savedFileText(input.document) });

export const MCP_OPERATIONS: Readonly<Record<string, (input: Input) => string | Promise<string>>> = {
  mcpSurface: surface,
  mcpPrompt: prompt,
  mcpCheckCall: checkCallResult,
  mcpListAnswer: listAnswer,
  mcpPickDocument: pick,
  mcpOpenAnswer: openAnswerResult,
  mcpErrorAnswer: errorAnswer,
  mcpExecuteAnswer: executeAnswer,
  mcpResolveMode: modeResult,
  mcpActor: actorResult,
  mcpParseArgs: parseArgs,
  mcpCheckOptions: checkOptions,
  mcpConfigFile: configFile,
  mcpFileId: input => surfaceRefusal(() => assertSafeId(String(input.id))),
  mcpFileIds: input => JSON.stringify({ ids: listedIds(stringArray(input.names)) }),
  mcpFilesList: filesList,
  mcpParseDocument: input => surfaceRefusal(() => ({ document: parseDocumentText(String(input.id), String(input.text)) })),
  mcpDocumentText: documentText,
  mcpRoomError: input => JSON.stringify({ error: terminalToError(typeof input.terminal === 'string' ? input.terminal : undefined) }),
};
