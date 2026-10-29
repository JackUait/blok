import { randomUUID } from 'node:crypto';

import type { AgentVersion, AgentVersionHistory } from '../../../types/agent';
import type { OutputData } from '../../../types/data-formats/output-data';
import type { CollabTicketSource } from '../../components/modules/collaboration/types';

export interface HttpVersionHistoryInput {
  /** The room's WebSocket URL, e.g. wss://host/sync/doc-1. */
  roomUrl: string;
  origin?: string;
  tickets?: CollabTicketSource;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const timeOf = (value: unknown): number | null => typeof value === 'number' ? value : null;

/** The server's GET /sync/{doc}/history answer, as AgentVersions newest first. */
const versionsOf = (body: unknown): AgentVersion[] => {
  if (!isRecord(body) || !Array.isArray(body.versions)) {
    throw new Error('The sync server sent a version list it could not read.');
  }
  const lineages = Array.isArray(body.lineages) ? body.lineages.filter(isRecord) : [];
  const current = new Set(lineages.filter(lineage => lineage.current === true).map(lineage => lineage.lineage));

  return body.versions.filter(isRecord).map((entry): AgentVersion => ({
    version: `${String(entry.lineage)}:${String(entry.sequence)}`,
    savedAt: timeOf(entry.savedAt),
    startedAt: timeOf(entry.startedAt),
    actors: Array.isArray(entry.actors) ? entry.actors.filter((actor): actor is string => typeof actor === 'string') : [],
    ...(!current.has(entry.lineage) && { beforeReset: true }),
  }));
};

/** "lineage:sequence" as its route path, or null when it is not one. */
const pointPath = (version: string): string | null => {
  const colon = version.lastIndexOf(':');
  const lineage = version.slice(0, colon);
  const sequence = version.slice(colon + 1);

  // encodeURIComponent keeps "." and "..", which the URL parser resolves as path steps out of /history.
  if (colon <= 0 || lineage === '.' || lineage === '..' || !/^\d+$/.test(sequence)) {
    return null;
  }

  return `${encodeURIComponent(lineage)}/${sequence}`;
};

/**
 * The sync server's version history routes for one room, behind the room's own ticket.
 * Restore posts what the history drawer posts. The delete route is never called.
 */
export const createHttpVersionHistory = (input: HttpVersionHistoryInput): AgentVersionHistory => {
  const base = `${input.roomUrl.replace(/^ws(s?):/i, 'http$1:')}/history`;

  const send = async (url: string, init: { method?: string; headers?: Record<string, string> } = {}, fresh = false): Promise<Response> => {
    const token = input.tickets === undefined ? undefined : await input.tickets(fresh ? { forceRefresh: true } : undefined);
    const response = await fetch(url, {
      ...(init.method !== undefined && { method: init.method }),
      headers: {
        ...init.headers,
        ...(token !== undefined && { Authorization: `Bearer ${token}` }),
        // The HTTP guard checks Origin like the WebSocket upgrade does.
        ...(input.origin !== undefined && { Origin: input.origin }),
      },
    }).catch((error: unknown) => {
      // No answer at all: the network may come back.
      throw Object.assign(new Error(`The sync server could not be reached: ${error instanceof Error ? error.message : String(error)}`), { retryable: true });
    });

    // A ticket can expire between mints. The retry keeps init, so a restore keeps its idempotency key.
    return response.status === 401 && !fresh && input.tickets !== undefined ? send(url, init, true) : response;
  };
  const get = (url: string): Promise<Response> => send(url);

  // The status tells the agent whether a retry can help.
  const refused = async (response: Response): Promise<Error> => Object.assign(
    new Error(`The sync server answered ${response.status}: ${(await response.text()).trim()}`),
    { status: response.status }
  );

  return {
    list: async ({ group }) => {
      const response = await get(group === undefined ? base : `${base}?group=${group}`);

      if (!response.ok) {
        throw await refused(response);
      }

      return versionsOf(await response.json());
    },
    read: async (version) => {
      const path = pointPath(version);

      if (path === null) {
        return null;
      }
      const response = await get(`${base}/${path}`);

      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw await refused(response);
      }
      const body: unknown = await response.json();

      return isRecord(body) && Array.isArray(body.blocks) ? body as unknown as OutputData : null;
    },
    restore: async (version, options) => {
      const path = pointPath(version);

      if (path === null) {
        return false;
      }
      const expect = options?.expectRevision;

      // A tag the server cannot read would restore unpinned, so it never leaves here.
      if (expect !== undefined && pointPath(expect) === null) {
        return 'stale';
      }
      // One key per restore: a retried request that already landed is answered, never applied twice.
      const response = await send(`${base}/${path}/restore`, {
        method: 'POST',
        headers: { 'Blok-Idempotency-Key': randomUUID(), ...(expect !== undefined && { 'If-Match': `"${expect}"` }) },
      });

      if (response.status === 404) {
        return false;
      }
      // The room moved past the version the agent checked; nothing was written.
      if (response.status === 412) {
        return 'stale';
      }
      if (!response.ok) {
        throw await refused(response);
      }

      return true;
    },
  };
};
