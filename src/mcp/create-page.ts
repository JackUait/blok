import type { AgentError, AgentResult } from '../../types/agent';
import { AgentFailure } from '../shared/agent/errors';

import { surfaceError } from './errors';
import type { BlokMcpOptions, BlokPageCreateRequest } from './options';

type CreatePage = NonNullable<BlokMcpOptions['createPage']>;

// A hung host must not hold blok_execute open forever; the same limit as the authorize webhook.
const WEBHOOK_TIMEOUT_MS = 10_000;
// blok_open's documentId maxLength, which JSON Schema counts in code points.
const MAX_PAGE_ID = 512;
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
 *   Any other status (3xx too), a timeout, a network error, a body that is not a JSON object,
 *   or a pageId that is neither a string nor null → a host error, never a refusal.
 */
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

    if (response.status !== 200) {
      throw new Error(`--create-page ${url} answered ${response.status}`);
    }
    const body: unknown = JSON.parse(await response.text());
    const pageId = isRecord(body) ? body.pageId : undefined;

    if (pageId !== null && typeof pageId !== 'string') {
      throw new Error(`--create-page ${url} answered no "pageId" string or null`);
    }

    return pageId;
  };
};

const isPageId = (value: unknown): value is string =>
  typeof value === 'string' && value !== '' && [...value].length <= MAX_PAGE_ID && !CONTROL.test(value);

/**
 * The host's create, as the executor's page port: null refuses, and every other failure is
 * logged in full while the agent sees only HOST_PAGE_FAILED. Nothing here authorizes, loads or
 * saves the new id: the host owns it.
 */
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
    console.error('blok-mcp: the host page creator answered no valid page id (1-512 characters, no control characters)', answer);
    throw hostFailed();
  }

  return { pageId: answer };
};

const pageIdOf = (receipt: unknown): string | undefined => {
  if (!isRecord(receipt) || receipt.type !== 'page' || !isRecord(receipt.prepared)) {
    return undefined;
  }

  return typeof receipt.prepared.pageId === 'string' ? receipt.prepared.pageId : undefined;
};

/**
 * A stored batch that failed after pages were made. A host failure past the first page is a
 * server stop (SERVER_STOP), as the bundle answers when a port sends that cause. A page the parent
 * names is no orphan: the host must never be told to delete a page the parent uses. With none
 * left, the cause is the answer.
 */
export const reportOrphanedPages = (result: AgentResult, parentText: string): AgentResult => {
  if (result.ok || result.error.code !== 'ORPHANED_SIDE_EFFECT' || !isRecord(result.error.details)) {
    return result;
  }
  const details = result.error.details;
  const listed: unknown[] = Array.isArray(details.orphaned) ? details.orphaned : [];
  const given = isRecord(details.cause) ? details.cause as unknown as AgentError : undefined;
  const hostStopped = given?.code === 'SOURCE_UNAVAILABLE' && given.message === HOST_PAGE_FAILED;
  const orphaned = listed.filter((receipt) => {
    const pageId = pageIdOf(receipt);

    return pageId === undefined || !parentText.includes(JSON.stringify(pageId));
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
