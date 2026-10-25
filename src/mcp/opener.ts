import type { AgentActor } from '../../types/agent';
import type { OutputData } from '../../types/data-formats/output-data';
import { createDocumentAgentSession } from '../shared/agent/document-session';
import { AgentFailure } from '../shared/agent/errors';
import type { AgentPorts } from '../shared/agent/types';
import { mintId } from '../shared/mint-id';
import { loadStoredDocument } from '../view/agent-runtime';

import { defaultAgentActor } from './actor';
import type { McpContracts } from './contract';
import type { Caller, DispatcherDeps, ListResult, OpenRequest } from './dispatcher';
import { isMcpSurfaceError, surfaceError } from './errors';
import { resolveMode } from './mode';
import type { BlokMcpOptions } from './options';
import type { HandleSession } from './session';
import { createEndpointSource } from './sources/endpoint';
import { createFilesSource } from './sources/files';
import type { DocumentSource } from './sources/types';
import { openStoredSession } from './stored-session';

export const createSource = (source: BlokMcpOptions['source']): DocumentSource | null => {
  if (source === undefined) {
    return null;
  }

  return source.kind === 'files' ? createFilesSource(source.dir) : createEndpointSource(source);
};

export interface OpenerDeps {
  options: BlokMcpOptions;
  contracts: McpContracts;
  source: DocumentSource | null;
  openLive?: (request: OpenRequest, caller: Caller, actor: AgentActor) => Promise<HandleSession>;
  portsFor(caller: Caller, actor: AgentActor, isOpenDocument?: (pageId: string) => Promise<boolean>): AgentPorts;
}

export const createOpener = (
  deps: OpenerDeps,
): {
  open: DispatcherDeps['open'];
  list: DispatcherDeps['list'];
  actorFor(caller: Caller): AgentActor;
  createPage(caller: Caller): Promise<{ pageId: string }>;
} => {
  const syncConfigured = deps.options.sync !== undefined;
  const actorFor = (caller: Caller): AgentActor =>
    (deps.options.agentActor ?? defaultAgentActor)(caller.principal, caller.clientName);

  const authorize = deps.options.authorize;

  const open: DispatcherDeps['open'] = async (request, caller) => {
    if (authorize !== undefined && !(await authorize(caller.principal, request.documentId, request.write))) {
      throw surfaceError('FORBIDDEN', 'You may not open this document with this access.');
    }
    const mode = resolveMode(request.mode, syncConfigured);
    const actor = actorFor(caller);

    if (mode === 'live') {
      if (deps.openLive === undefined) {
        throw surfaceError('INVALID_ARGS', 'Live mode needs blok-mcp to run with --sync-url.');
      }

      return deps.openLive(request, caller, actor);
    }
    const source = deps.source;

    if (source === null) {
      throw surfaceError('SOURCE_UNAVAILABLE', 'No document source is configured. Start blok-mcp with --source.');
    }

    return openStoredSession({
      documentId: request.documentId,
      write: request.write,
      source,
      contract: deps.contracts.stored,
      // Every source runs assertDocumentShape before returning raw, so `blocks` is an array here.
      loadDocument: (raw) => loadStoredDocument(raw as OutputData, deps.contracts.richTextFieldsFor),
      createAgentSession: (document) => createDocumentAgentSession({
        document,
        tools: deps.contracts.runtimes,
        contract: deps.contracts.stored,
        actor,
        ports: deps.portsFor(caller, actor, async (pageId) =>
          pageId === request.documentId || (await source.sameDocument?.(pageId, request.documentId) ?? false)),
        // 01 builds the Node pageBackend only with this flag and the openPageDocument port (Task 26).
        ...(deps.options.pageTitles === 'page-map' && { pageTitles: 'page-map' as const }),
      }),
    });
  };

  const list: DispatcherDeps['list'] = async (request, caller): Promise<ListResult> => {
    if (deps.source?.list === undefined) {
      return { documents: [], nextCursor: null, supported: false };
    }
    const listing = await deps.source.list(request);
    // A listed id is a read; without a hook (stdio) every document is visible.
    const readable = authorize === undefined
      ? listing.documents
      : (await Promise.all(listing.documents.map(async (doc) =>
        (await authorize(caller.principal, doc.id, false)) ? [doc] : []))).flat();

    return {
      documents: readable.map((doc) => ({ ...doc, live: syncConfigured })),
      nextCursor: listing.nextCursor,
      supported: true,
    };
  };

  /**
   * A new page's document under a fresh id, authorized like a write open. Stored mode saves an empty
   * document. Live mode joins the new room once: the sync service seeds it before the join syncs, and
   * the host's first PUT of it comes later, on an edit or a reopen.
   */
  const createPage = async (caller: Caller): Promise<{ pageId: string }> => {
    const source = deps.source;
    const pageId = mintId();

    try {
      if (authorize !== undefined && !(await authorize(caller.principal, pageId, true))) {
        throw surfaceError('FORBIDDEN', 'You may not create a page document here.');
      }
      if (syncConfigured) {
        await createLivePage(pageId, caller);

        return { pageId };
      }
      if (source === null) {
        throw surfaceError('SOURCE_UNAVAILABLE', 'No document source is configured, so no page document can be created.');
      }
      const loaded = await source.load(pageId);

      // The endpoint source saves without a version check, so this is its only guard against an overwrite.
      if (loaded.missing !== true) {
        throw surfaceError('SOURCE_UNAVAILABLE', 'The new page id is taken. Try again.');
      }
      await source.save(pageId, { blocks: [] }, { ifVersion: loaded.version });
    } catch (thrown) {
      // The executor keeps only an AgentFailure's code.
      throw isMcpSurfaceError(thrown) ? new AgentFailure({ ...thrown.agentError, details: { ...thrown.agentError.details, pageId } }) : thrown;
    }

    return { pageId };
  };

  // The join runs the ticket mint and the service's own authorization, and loads the room.
  const createLivePage = async (pageId: string, caller: Caller): Promise<void> => {
    if (deps.openLive === undefined) {
      throw surfaceError('INVALID_ARGS', 'Live mode needs blok-mcp to run with --sync-url.');
    }
    const session = await deps.openLive({ documentId: pageId, mode: 'live', write: true }, caller, actorFor(caller));

    try {
      const view = await session.read({});

      if (view.blocks.length > 0 || view.page?.title !== undefined || view.page?.icon !== undefined) {
        throw surfaceError('SOURCE_UNAVAILABLE', 'The new page id is taken. Try again.');
      }
    } finally {
      // Awaited: this runs inside blok_execute, so nothing else waits for the socket to close.
      await session.close('closed').catch((error: unknown) => console.error('blok-mcp: closing a new page room failed', error));
    }
  };

  return { open, list, actorFor, createPage };
};
