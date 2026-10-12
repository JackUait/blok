import {
  HeadlessRoomTerminalError,
  HeadlessRoomTimeoutError,
  openHeadlessRoom
} from '../../components/modules/collaboration/headless-session';
import type { CollabSocketFactory, CollabTicketSource } from '../../components/modules/collaboration/types';
import { createStoreAgentSession } from '../../components/modules/agent/store-session';
import { YBlockSerializer } from '../../components/modules/yjs/serializer';
import type { AgentActor } from '../../../types/agent';
import type { AgentPorts } from '../../shared/agent/types';
import { htmlToSegmentsNode } from '../../view/rich-text-parse5';
import type { McpContracts } from '../contract';
import type { Caller, OpenRequest } from '../dispatcher';
import { McpSurfaceError, surfaceError } from '../errors';
import type { HandleSession } from '../session';
import { createLiveSession, terminalToError } from './live-session';
import { nodeSocketFactory } from './node-socket';
import { AgentPresence } from './presence';

export interface OpenLiveDeps {
  sync: { url: string; origin?: string };
  contracts: McpContracts;
  /** Mints each handle's ticket. assembleMcp always sets it: config refuses --sync-url without a ticket mode. */
  ticketsFor?: (request: OpenRequest, caller: Caller, actor: AgentActor) => Promise<CollabTicketSource>;
  /** Defaults to `ws` with the configured Origin. */
  socketFactory?: CollabSocketFactory;
  portsFor(caller: Caller, actor: AgentActor): AgentPorts;
  /** The name peers see in presence; defaults to actor.name. */
  presenceName?: (caller: Caller, actor: AgentActor) => string;
  pageTitles?: 'off' | 'page-map';
  syncTimeoutMs?: number;
}

export const syncUrlFor = (base: string, documentId: string): string => `${base.replace(/\/$/, '')}/${encodeURIComponent(documentId)}`;

const toSurfaceError = (thrown: unknown): unknown => {
  if (thrown instanceof HeadlessRoomTimeoutError) {
    return surfaceError('ROOM_SYNC_TIMEOUT', 'The room did not finish loading in time. Try again.');
  }
  if (thrown instanceof HeadlessRoomTerminalError) {
    const error = terminalToError(thrown.error);

    return new McpSurfaceError(error.code, error.message, error.details);
  }

  return thrown;
};

export const createOpenLive = (deps: OpenLiveDeps) => async (request: OpenRequest, caller: Caller, actor: AgentActor): Promise<HandleSession> => {
  const ticketSource = deps.ticketsFor === undefined ? undefined : await deps.ticketsFor(request, caller, actor);
  const room = await openHeadlessRoom({
    url: syncUrlFor(deps.sync.url, request.documentId),
    docId: request.documentId,
    serializer: new YBlockSerializer({ htmlToSegments: htmlToSegmentsNode, richTextFieldsFor: deps.contracts.richTextFieldsFor }),
    socketFactory: deps.socketFactory ?? nodeSocketFactory(deps.sync.origin ?? null),
    ticketSource,
    writeDenied: !request.write,
    syncTimeoutMs: deps.syncTimeoutMs,
  }).catch((thrown: unknown) => {
    throw toSurfaceError(thrown);
  });

  const agent = createStoreAgentSession({
    store: room.store,
    tools: deps.contracts.runtimes,
    contract: deps.contracts.live,
    actor,
    ports: deps.portsFor(caller, actor),
    richTextFieldsFor: deps.contracts.richTextFieldsFor,
    ...(deps.pageTitles === 'page-map' && { pageTitles: 'page-map' as const }),
  });
  const presence = new AgentPresence(
    { setAwarenessField: (field, value) => room.store.setAwarenessField(field, value), sendActivity: () => room.sendActivity() },
    { actor, name: deps.presenceName?.(caller, actor) ?? actor.name }
  );

  return createLiveSession({ room, agent, contract: deps.contracts.live, presence, write: request.write });
};
