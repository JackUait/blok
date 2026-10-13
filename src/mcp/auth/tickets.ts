import { blokTicket } from '../../../packages/server/src/ticket';
import type { CollabTicketSource } from '../../components/modules/collaboration/types';
import { readTicketClaims } from '../../components/utils/access-pass';
import { surfaceError } from '../errors';
import type { BlokMcpOptions } from '../options';

export interface TicketRequest { documentId: string; write: boolean; principal: string; clientName: string; actorId: string }

// A collaboration pass is checked at the handshake only; 1800 s is the ceiling ticket.ts recommends.
const TTL_SECONDS = 1800;
const REFRESH_MARGIN_MS = 30_000;
// blok_open waits on this request; a hung host must not hold the call open forever.
const TICKET_FETCH_TIMEOUT_MS = 10_000;

const ticketField = (text: string): unknown => {
  try {
    const body: unknown = JSON.parse(text);

    return typeof body === 'object' && body !== null && 'ticket' in body ? body.ticket : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Mints the first ticket eagerly, so a refusal surfaces at blok_open.
 * Only the MCP server's own host token is sent, never the caller's OAuth token.
 */
export const createTicketProvider = (
  config: NonNullable<BlokMcpOptions['tickets']>,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
) => async (request: TicketRequest): Promise<CollabTicketSource> => {
  if (config.kind === 'secret') {
    const mint: CollabTicketSource = async () =>
      blokTicket(config.secret, { user: request.actorId, doc: request.documentId, write: request.write, ttlSeconds: TTL_SECONDS });

    await mint();

    return mint;
  }

  const fetchTicket = async (): Promise<{ ticket: string; expiresAtMs: number }> => {
    const response = await fetchImpl(config.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.hostToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doc: request.documentId,
        write: request.write,
        principal: request.principal,
        clientName: request.clientName,
        actorId: request.actorId,
      }),
      signal: AbortSignal.timeout(TICKET_FETCH_TIMEOUT_MS),
    }).catch(() => {
      throw surfaceError('SOURCE_UNAVAILABLE', 'The ticket endpoint could not be reached.');
    });

    // 401 refuses our host token, not the agent: retryable, so a token rotation never ends live handles.
    if (response.status === 401) {
      throw surfaceError('SOURCE_UNAVAILABLE', 'The ticket endpoint refused the host token.');
    }
    if (response.status === 403) {
      throw surfaceError('FORBIDDEN', 'The host did not grant this document to this agent.');
    }
    if (!response.ok) {
      throw surfaceError('SOURCE_UNAVAILABLE', `The ticket endpoint answered ${response.status}.`);
    }
    const text = await response.text().catch(() => {
      throw surfaceError('SOURCE_UNAVAILABLE', 'The ticket endpoint could not be reached.');
    });
    const ticket = ticketField(text);

    if (typeof ticket !== 'string') {
      throw surfaceError('SOURCE_UNAVAILABLE', 'The ticket endpoint answered without a "ticket" field.');
    }
    const claims = readTicketClaims(ticket);

    // The journal and frame 107 name the ticket's user; it must be the agent, never the human (06 C3).
    // The signature is not checked here; the room checks it.
    if (claims?.user !== request.actorId || claims.doc !== request.documentId) {
      throw surfaceError('FORBIDDEN', 'The host minted a ticket for another user or document. Its "user" must equal actorId.');
    }
    // The handle already refuses writes; a write ticket for a read-only open is still more than was asked.
    if (claims.write === true && !request.write) {
      throw surfaceError('FORBIDDEN', 'The host minted a write ticket for a read-only open.');
    }

    return { ticket, expiresAtMs: typeof claims.exp === 'number' ? claims.exp * 1000 : now() };
  };

  const state = { cached: await fetchTicket() };

  return async (options) => {
    if (options?.forceRefresh === true || state.cached.expiresAtMs - now() < REFRESH_MARGIN_MS) {
      state.cached = await fetchTicket();
    }

    return state.cached.ticket;
  };
};
