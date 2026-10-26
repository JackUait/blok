import {
  HeadlessRoomTerminalError,
  HeadlessRoomTimeoutError,
  openHeadlessRoom,
  type HeadlessRoom,
  type HeadlessRoomEnd
} from '../../components/modules/collaboration/headless-session';
import type { CollabSocketFactory, CollabTicketSource } from '../../components/modules/collaboration/types';
import { createStoreAgentSession } from '../../components/modules/agent/store-session';
import { YBlockSerializer } from '../../components/modules/yjs/serializer';
import type { AgentActor } from '../../../types/agent';
import type { AgentPorts } from '../../shared/agent/types';
import { htmlToSegmentsNode } from '../../view/rich-text-parse5';
import type { McpContracts } from '../contract';
import type { Caller, OpenRequest } from '../dispatcher';
import { isMcpSurfaceError, McpSurfaceError, surfaceError } from '../errors';
import type { HandleSession, UnavailableCommand } from '../session';
import { createLiveSession, terminalToError } from './live-session';
import { nodeSocketFactory } from './node-socket';
import { AgentPresence } from './presence';
import { createHttpVersionHistory } from './version-history';

export interface OpenLiveDeps {
  sync: { url: string; origin?: string };
  contracts: McpContracts;
  /** Mints each handle's ticket. assembleMcp always sets it: config refuses --sync-url without a ticket mode. */
  ticketsFor?: (request: OpenRequest, caller: Caller, actor: AgentActor) => Promise<CollabTicketSource>;
  /** Defaults to `ws` with the configured Origin. */
  socketFactory?: CollabSocketFactory;
  portsFor(caller: Caller, actor: AgentActor, isOpenDocument?: (pageId: string) => Promise<boolean>): AgentPorts;
  /** The name peers see in presence; defaults to actor.name. */
  presenceName?: (caller: Caller, actor: AgentActor) => string;
  pageTitles?: 'off' | 'page-map';
  syncTimeoutMs?: number;
  /** The host's file uploader, for `<tool>.uploadFile`. */
  uploader?: unknown;
}

// encodeURIComponent keeps "." and "..", which the URL parser resolves as path steps to another route.
export const syncUrlFor = (base: string, documentId: string): string => {
  if (documentId === '.' || documentId === '..') {
    throw surfaceError('INVALID_ARGS', `"${documentId}" is not a document id.`);
  }

  return `${base.replace(/\/$/, '')}/${encodeURIComponent(documentId)}`;
};

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

/**
 * The provider retries a failed ticket mint forever, so a host's refusal on
 * reconnect would never reach the agent. One FORBIDDEN from the ticket source
 * ends the room for the session, and later mints are not attempted.
 * @param source - the handle's ticket source
 * @returns the guarded source, plus the end it raises
 */
const revocable = (source: CollabTicketSource): {
  source: CollabTicketSource;
  ended(): HeadlessRoomEnd | null;
  refused(): unknown;
  onEnd(listener: (end: HeadlessRoomEnd) => void): () => void;
} => {
  const state: { refused: unknown; end: HeadlessRoomEnd | null } = { refused: undefined, end: null };
  const listeners = new Set<(end: HeadlessRoomEnd) => void>();

  return {
    source: async (options) => {
      if (state.end !== null) {
        throw state.refused;
      }
      try {
        return await source(options);
      } catch (thrown) {
        if (isMcpSurfaceError(thrown) && thrown.agentError.code === 'FORBIDDEN') {
          const end: HeadlessRoomEnd = { reason: 'terminal', error: 'forbidden' };

          state.refused = thrown;
          state.end = end;
          [...listeners].forEach((listener) => listener(end));
        }
        throw thrown;
      }
    },
    ended: () => state.end,
    refused: () => state.refused,
    onEnd: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
  };
};

const withRevocation = (room: HeadlessRoom, guard: ReturnType<typeof revocable>): HeadlessRoom => ({
  store: room.store,
  outbox: room.outbox,
  get protocol() {
    return room.protocol;
  },
  sendActivity: () => room.sendActivity(),
  flushAppends: () => room.flushAppends(),
  appendFailures: () => room.appendFailures(),
  ended: () => room.ended() ?? guard.ended(),
  onEnd: (listener) => {
    const stops = [room.onEnd(listener), guard.onEnd(listener)];

    return () => stops.forEach((stop) => stop());
  },
  close: () => room.close(),
});

// tools/list renders the stored contract, so a live handle names what it refuses from that list.
const refusedHere = (contracts: McpContracts): UnavailableCommand[] => {
  const live = new Map(contracts.live.commands.map((entry) => [entry.name, entry]));

  return contracts.stored.commands.flatMap((entry) => {
    const here = live.get(entry.name);

    if (!entry.available || here?.available === true) {
      return [];
    }

    return [{ name: entry.name, reason: here?.unavailableReason ?? 'runtime' }];
  });
};

export const createOpenLive = (deps: OpenLiveDeps) => async (request: OpenRequest, caller: Caller, actor: AgentActor): Promise<HandleSession> => {
  const url = syncUrlFor(deps.sync.url, request.documentId);
  const guard = deps.ticketsFor === undefined ? undefined : revocable(await deps.ticketsFor(request, caller, actor));
  const ticketSource = guard?.source;
  // A refused mint ends the wait at once; the provider would retry until the sync timer.
  const refusal = new AbortController();
  const stopWatching = guard?.onEnd(() => refusal.abort());
  const opened = await openHeadlessRoom({
    url,
    docId: request.documentId,
    serializer: new YBlockSerializer({ htmlToSegments: htmlToSegmentsNode, richTextFieldsFor: deps.contracts.richTextFieldsFor }),
    socketFactory: deps.socketFactory ?? nodeSocketFactory(deps.sync.origin ?? null),
    ticketSource,
    writeDenied: !request.write,
    syncTimeoutMs: deps.syncTimeoutMs,
    signal: refusal.signal,
  }).catch((thrown: unknown) => {
    // A refused ticket aborts the wait; name the real, final cause.
    throw guard !== undefined && guard.ended() !== null ? guard.refused() : toSurfaceError(thrown);
  }).finally(() => stopWatching?.());
  const room = guard === undefined ? opened : withRevocation(opened, guard);

  try {
    const agent = createStoreAgentSession({
      store: room.store,
      tools: deps.contracts.runtimes,
      contract: deps.contracts.live,
      actor,
      // A room id has no aliases, so only the same id is the open document.
      ports: deps.portsFor(caller, actor, async (pageId) => pageId === request.documentId),
      richTextFieldsFor: deps.contracts.richTextFieldsFor,
      ...(deps.pageTitles === 'page-map' && { pageTitles: 'page-map' as const }),
      services: {
        versionHistory: createHttpVersionHistory({ roomUrl: url, origin: deps.sync.origin, tickets: ticketSource }),
        ...(deps.uploader !== undefined && { uploader: deps.uploader }),
      },
    });
    const presence = new AgentPresence(
      { setAwarenessField: (field, value) => room.store.setAwarenessField(field, value), sendActivity: () => room.sendActivity() },
      { actor, name: deps.presenceName?.(caller, actor) ?? actor.name }
    );

    const session = createLiveSession({ room, agent, contract: deps.contracts.live, presence, write: request.write });
    const unavailableCommands = refusedHere(deps.contracts);

    // assign, not spread: the session's durability is a getter.
    return unavailableCommands.length === 0 ? session : Object.assign(session, { unavailableCommands });
  } catch (thrown) {
    await room.close().catch(() => undefined);
    throw thrown;
  }
};
