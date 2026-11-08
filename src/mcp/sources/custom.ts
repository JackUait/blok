import type { AgentErrorCode } from '../../../types/agent';
import { MAX_JSON_DEPTH, nestsDeeperThan, wellFormed } from '../../shared/mcp/wire-json';
import { McpConfigError } from '../config';
import { surfaceError } from '../errors';
import type { BlokDocumentCaller, BlokMcpDocumentSource } from '../options';

import type { DocumentSource, LoadedDocument, SourceListing } from './types';
import { assertDocumentShape, isRecord } from './types';

export type BlokMcpSourceErrorKind = 'changed' | 'unavailable' | 'forbidden' | 'invalidId';

/** Thrown by a host's document source to refuse with a code. The agent sees `agentMessage`. */
export class BlokMcpSourceError extends Error {
  public readonly kind: BlokMcpSourceErrorKind;
  /** Shown to the agent: no paths, hosts or secrets. Empty: Blok's own words. */
  public readonly agentMessage: string;

  constructor(kind: BlokMcpSourceErrorKind, agentMessage: string, options?: { cause?: unknown }) {
    super(agentMessage === '' ? kind : agentMessage, options);
    this.name = 'BlokMcpSourceError';
    this.kind = kind;
    this.agentMessage = agentMessage;
  }
}

type Op = 'load' | 'save' | 'list';

// Every port answers with these exact words (shared conformance: embed.json).
const FAILED: Record<Op, string> = {
  load: 'The host could not load this document. Try again.',
  save: 'The host could not save this document, so nothing was saved. Try again.',
  list: 'The host could not list documents. Try again.',
};

const CODES: Record<BlokMcpSourceErrorKind, AgentErrorCode> = {
  changed: 'DOCUMENT_CHANGED',
  unavailable: 'SOURCE_UNAVAILABLE',
  forbidden: 'FORBIDDEN',
  invalidId: 'INVALID_ARGS',
};

const fallbackMessage = (kind: BlokMcpSourceErrorKind, op: Op): string => ({
  changed: 'Someone saved this document since you opened it. Read it again, then retry.',
  unavailable: FAILED[op],
  forbidden: 'The host does not allow this.',
  invalidId: 'The host does not accept this document id.',
})[kind];

// Duck-typed as well: a host may load its own copy of this package, where instanceof fails.
const sourceErrorOf = (thrown: unknown): { kind: BlokMcpSourceErrorKind; agentMessage: string } | null => {
  if (!isRecord(thrown) && !(thrown instanceof Error)) {
    return null;
  }
  const kind: unknown = Reflect.get(thrown, 'kind');
  const agentMessage: unknown = Reflect.get(thrown, 'agentMessage');
  const named = thrown instanceof BlokMcpSourceError || Reflect.get(thrown, 'name') === 'BlokMcpSourceError';

  return named && typeof kind === 'string' && kind in CODES
    ? { kind: kind as BlokMcpSourceErrorKind, agentMessage: typeof agentMessage === 'string' ? agentMessage : '' }
    : null;
};

/** A host bug or a plain throw: the full error goes to stderr, the agent gets generic words. */
const hostFailed = (op: Op, documentId: string | null, what: unknown): Error => {
  console.error(`blok-mcp: the host document source failed to ${op}${documentId === null ? '' : ` "${documentId}"`}`, what);

  return surfaceError('SOURCE_UNAVAILABLE', FAILED[op]);
};

const guarded = async <T>(op: Op, documentId: string | null, call: () => Promise<T>): Promise<T> => {
  try {
    return await call();
  } catch (thrown) {
    const refused = sourceErrorOf(thrown);

    if (refused === null) {
      throw hostFailed(op, documentId, thrown);
    }
    const message = refused.agentMessage.trim() === '' ? fallbackMessage(refused.kind, op) : refused.agentMessage;

    throw surfaceError(CODES[refused.kind], message);
  }
};

const isVersion = (value: unknown): value is string => typeof value === 'string' && value !== '';

/** The same checks a file or an endpoint answer gets: depth, JSON values only, lone surrogates, shape. */
const checkedDocument = (documentId: string, document: unknown): unknown => {
  const where = `The host's document "${documentId}"`;

  // Bounded walk first: it also stops a cyclic object before JSON.stringify sees it.
  if (nestsDeeperThan(document, MAX_JSON_DEPTH)) {
    throw surfaceError('SOURCE_UNAVAILABLE', `${where} nests deeper than ${MAX_JSON_DEPTH} levels of objects and arrays.`);
  }
  const parsed: unknown = (() => {
    try {
      // undefined (no document at all) stringifies to undefined; the shape check refuses it.
      const text: string | undefined = JSON.stringify(document);
      const value: unknown = text === undefined ? undefined : JSON.parse(text);

      return value;
    } catch {
      throw surfaceError('SOURCE_UNAVAILABLE', `${where} is not JSON.`);
    }
  })();
  const normalised = wellFormed(parsed);

  assertDocumentShape(normalised, where);

  return normalised;
};

const checkedListing = (answer: unknown): SourceListing => {
  if (!isRecord(answer) || !Array.isArray(answer.documents)) {
    throw hostFailed('list', null, new Error('list answered without a "documents" array'));
  }

  return {
    documents: answer.documents
      .filter((doc): doc is { id: string; title?: unknown } => isRecord(doc) && typeof doc.id === 'string')
      .map(doc => ({ id: doc.id, title: typeof doc.title === 'string' ? doc.title : null })),
    nextCursor: typeof answer.nextCursor === 'string' ? answer.nextCursor : null,
  };
};

const forOne = (host: BlokMcpDocumentSource, caller: BlokDocumentCaller): DocumentSource => {
  const bound: DocumentSource = {
    kind: 'custom',
    load: async (documentId): Promise<LoadedDocument> => {
      const answer = await guarded('load', documentId, () => host.load(caller, documentId));

      if (answer === null) {
        return { raw: { blocks: [] }, version: null, missing: true };
      }
      if (!isRecord(answer) || !isVersion(answer.version)) {
        throw hostFailed('load', documentId, new Error('load answered an existing document without a non-empty version'));
      }

      return { raw: checkedDocument(documentId, answer.document), version: answer.version };
    },
    save: async (documentId, document, { ifVersion }) => {
      const answer: unknown = await guarded('save', documentId, () => host.save(caller, documentId, JSON.stringify(document), ifVersion));

      if (!isRecord(answer) || !isVersion(answer.version)) {
        throw hostFailed('save', documentId, new Error('save answered without a non-empty version'));
      }

      return { version: answer.version };
    },
  };
  const list = host.list;

  if (typeof list === 'function') {
    bound.list = async (request) => checkedListing(await guarded('list', null, () => list.call(host, caller, request)));
  }

  return bound;
};

const UNBOUND = 'blok-mcp: a host document source is used only through forCaller';

/** The host's source behind Blok's checks and error words. Each handle binds its opener's caller. */
export const createCustomSource = (host: BlokMcpDocumentSource): DocumentSource => {
  if (!isRecord(host) || typeof host.load !== 'function' || typeof host.save !== 'function') {
    throw new McpConfigError('source.source needs load and save functions');
  }
  if (host.list !== undefined && typeof host.list !== 'function') {
    throw new McpConfigError('source.source.list must be a function');
  }

  return {
    kind: 'custom',
    load: () => Promise.reject(new Error(UNBOUND)),
    save: () => Promise.reject(new Error(UNBOUND)),
    ...(host.list !== undefined && { list: () => Promise.reject(new Error(UNBOUND)) }),
    forCaller: caller => forOne(host, caller),
  };
};
