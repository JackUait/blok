import type { AgentError, AgentResult } from '../../types/agent';
import { AgentFailure } from '../shared/agent/errors';

import { surfaceError } from './errors';
import type { BlokMcpOptions, BlokPageCreateRequest } from './options';

type CreatePage = NonNullable<BlokMcpOptions['createPage']>;

// A hung host must not hold blok_execute open forever; the same limit as the authorize webhook.
const WEBHOOK_TIMEOUT_MS = 10_000;
// blok_open's documentId maxLength, which JSON Schema counts in code points.
const MAX_PAGE_ID = 512;
// How much of a refused answer goes to stderr.
const BODY_SHOWN = 500;
// A page id answer is under 3 KiB; anything far past that is not one, and is not read to its end.
const MAX_BODY_BYTES = 64 * 1024;
// A high surrogate with no low one after it, or a low one with no high one before it.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
// Unicode Cc: C0, DEL and C1.
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/u;

/** What the agent sees when the host could not make the first page of a batch. */
export const HOST_PAGE_FAILED = 'The host could not create the page.';
/** The cause of a batch a host failure stopped after it made pages: Blok.Server's wording. */
export const SERVER_STOP: AgentError = { code: 'APPLY_FAILED', message: 'The batch stopped on a server error. Nothing was written.', retryable: true };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * `--create-page <url>`. The wire every port copies:
 *   POST <url>, header `Content-Type: application/json` only, 10 s timeout, redirects not followed.
 *   Body: {"parentDocumentId","principal","actor":{"id","name","onBehalfOf"},"suggestedPageId"},
 *   onBehalfOf null when the actor has none; no other actor fields.
 *   200 {"pageId":"<id>"} → the id (then checked like any hook answer).
 *   200 {"pageId":null} → the host refused (FORBIDDEN).
 *   Any other status (3xx and 201 too), a timeout, a network error, a body that is not a JSON object,
 *   or a pageId that is neither a string nor null → a host error, never a refusal.
 *   The body is parsed as JSON.parse does: a repeated key keeps its last value, so
 *   {"pageId":"a","pageId":null} is a refusal.
 *   A string id must then be 1-512 code points (not bytes, not UTF-16 units), well-formed UTF-16
 *   (a lone surrogate from a \ud800 escape is refused, never turned into U+FFFD), with no Unicode Cc
 *   character (U+0000-U+001F, U+007F-U+009F), and not "." or "..". Anything else is a host error.
 *   A host error is logged to stderr with the status and the first 500 characters of the body.
 *   A body over 64 KiB is a host error too; it is not read past that.
 */
const cappedText = async (url: string, response: Response): Promise<string> => {
  if (response.body === null) {
    return '';
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  const read = { bytes: 0 };

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }
    read.bytes += value.byteLength;
    if (read.bytes > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error(`--create-page ${url} answered more than ${MAX_BODY_BYTES} bytes`);
    }
    chunks.push(value);
  }

  // TextDecoder, as response.text(): it drops a BOM, which Buffer#toString keeps.
  return new TextDecoder().decode(Buffer.concat(chunks));
};

export const createPageWebhook = (url: string, deps: { fetchImpl?: typeof fetch } = {}): CreatePage => {
  const fetchImpl = deps.fetchImpl ?? fetch;

  return async (request) => {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parentDocumentId: request.parentDocumentId,
        principal: request.principal,
        actor: { id: request.actor.id, name: request.actor.name, onBehalfOf: request.actor.onBehalfOf ?? null },
        suggestedPageId: request.suggestedPageId,
      }),
      redirect: 'manual',
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });

    const text = await cappedText(url, response);

    if (response.status !== 200) {
      throw new Error(`--create-page ${url} answered ${response.status}: ${text.slice(0, BODY_SHOWN)}`);
    }
    const body = ((): unknown => {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new Error(`--create-page ${url} answered 200 with a body that is not JSON: ${text.slice(0, BODY_SHOWN)}`);
      }
    })();
    const pageId = isRecord(body) ? body.pageId : undefined;

    if (pageId !== null && typeof pageId !== 'string') {
      throw new Error(`--create-page ${url} answered no "pageId" string or null: ${text.slice(0, BODY_SHOWN)}`);
    }

    return pageId;
  };
};

// "." and ".." name a directory, never a document, in every source.
const isPageId = (value: unknown): value is string =>
  typeof value === 'string' && value !== '' && value !== '.' && value !== '..' && !LONE_SURROGATE.test(value)
  && [...value].length <= MAX_PAGE_ID && !CONTROL.test(value);

const hostFailed = (): AgentFailure => new AgentFailure(surfaceError('SOURCE_UNAVAILABLE', HOST_PAGE_FAILED).agentError);

const askHost = async (createPage: CreatePage, request: BlokPageCreateRequest): Promise<unknown> => {
  try {
    return await createPage(request);
  } catch (thrown) {
    // stdout carries the protocol, so the log goes to stderr.
    console.error('blok-mcp: the host could not create a page', thrown);
    throw hostFailed();
  }
};

/**
 * The host's create, as the executor's page port: null refuses, and every other failure is
 * logged in full while the agent sees only HOST_PAGE_FAILED. Nothing here authorizes, loads or
 * saves the new id: the host owns it.
 */
export const createHostPage = async (createPage: CreatePage, request: BlokPageCreateRequest): Promise<{ pageId: string }> => {
  const answer = await askHost(createPage, request);

  if (answer === null) {
    throw new AgentFailure(surfaceError('FORBIDDEN', 'You may not create a page document here.').agentError);
  }
  if (!isPageId(answer)) {
    console.error('blok-mcp: the host page creator answered no valid page id (1-512 code points, well-formed, no control characters, not "." or "..")', answer);
    throw hostFailed();
  }

  return { pageId: answer };
};

/**
 * The page ids the parent links: `data.pageId` of each `type: "page"` block. Blocks are one flat
 * list (children name their parent), so nested pages are in it too. Text elsewhere never counts.
 */
export const linkedPageIds = (parent: unknown): ReadonlySet<string> => {
  const blocks = isRecord(parent) && Array.isArray(parent.blocks) ? parent.blocks : [];

  return new Set(blocks.flatMap((block: unknown) =>
    isRecord(block) && block.type === 'page' && isRecord(block.data) && typeof block.data.pageId === 'string' ? [block.data.pageId] : []));
};

const pageIdOf = (receipt: unknown): string | undefined => {
  if (!isRecord(receipt) || receipt.type !== 'page' || !isRecord(receipt.prepared)) {
    return undefined;
  }

  return typeof receipt.prepared.pageId === 'string' ? receipt.prepared.pageId : undefined;
};

/**
 * A batch whose parent save broke with a plain error after it made pages. Only pages the parent,
 * as stored after the failure, does not name are listed; null when none is left, so the caller
 * passes the error on.
 */
export const orphanedBySave = (made: readonly string[], parent: unknown, warnings: AgentResult['warnings']): AgentResult | null => {
  const linked = linkedPageIds(parent);
  const orphaned = made
    .filter((pageId) => !linked.has(pageId))
    .map((pageId) => ({ command: 'block.insert', type: 'page', prepared: { pageId } }));

  if (orphaned.length === 0) {
    return null;
  }

  return {
    ok: false,
    error: {
      code: 'ORPHANED_SIDE_EFFECT',
      message: `The batch failed after the host did work for it (${SERVER_STOP.message}). Clean up the listed items.`,
      retryable: false,
      details: { orphaned, cause: SERVER_STOP },
    },
    warnings,
  };
};

/**
 * A stored batch that failed after pages were made. A host failure past the first page is a
 * server stop (SERVER_STOP), as the bundle answers when a port sends that cause. A page the parent
 * names is no orphan: the host must never be told to delete a page the parent uses. With none
 * left, the cause is the answer.
 */
export const reportOrphanedPages = (result: AgentResult, parent: unknown): AgentResult => {
  if (result.ok || result.error.code !== 'ORPHANED_SIDE_EFFECT' || !isRecord(result.error.details)) {
    return result;
  }
  const details = result.error.details;
  const listed: unknown[] = Array.isArray(details.orphaned) ? details.orphaned : [];
  const given = isRecord(details.cause) ? details.cause as unknown as AgentError : undefined;
  const linked = linkedPageIds(parent);
  const hostStopped = given?.code === 'SOURCE_UNAVAILABLE' && given.message === HOST_PAGE_FAILED;
  const orphaned = listed.filter((receipt) => {
    const pageId = pageIdOf(receipt);

    return pageId === undefined || !linked.has(pageId);
  });

  if (given === undefined || (!hostStopped && orphaned.length === listed.length)) {
    return result;
  }
  const cause: AgentError = hostStopped
    ? { ...SERVER_STOP, ...(given.commandIndex !== undefined && { commandIndex: given.commandIndex }) }
    : given;

  if (orphaned.length === 0) {
    return { ...result, error: cause };
  }

  return {
    ...result,
    error: {
      ...result.error,
      message: `The batch failed after the host did work for it (${cause.message}). Clean up the listed items.`,
      details: { ...details, orphaned, cause },
    },
  };
};
