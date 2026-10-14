import type { AgentActor } from '../../types/agent';
import type { OutputData } from '../../types/data-formats/output-data';
import { createDocumentAgentSession } from '../shared/agent/document-session';
import type { AgentPorts } from '../shared/agent/types';
import { loadStoredDocument } from '../view/agent-runtime';

import { defaultAgentActor } from './actor';
import type { McpContracts } from './contract';
import type { Caller, DispatcherDeps, ListResult, OpenRequest } from './dispatcher';
import { surfaceError } from './errors';
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
  portsFor(caller: Caller, actor: AgentActor, documentId?: string): AgentPorts;
}

export const createOpener = (
  deps: OpenerDeps,
): { open: DispatcherDeps['open']; list: DispatcherDeps['list']; actorFor(caller: Caller): AgentActor } => {
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
        ports: deps.portsFor(caller, actor, request.documentId),
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

  return { open, list, actorFor };
};
