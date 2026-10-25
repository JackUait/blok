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

/**
 * The sync server's version history routes for one room, behind the room's own ticket.
 * Read-only: the restore and delete routes are never called.
 */
export const createHttpVersionHistory = (input: HttpVersionHistoryInput): AgentVersionHistory => {
  const base = `${input.roomUrl.replace(/^ws(s?):/i, 'http$1:')}/history`;

  const get = async (url: string, fresh = false): Promise<Response> => {
    const token = input.tickets === undefined ? undefined : await input.tickets(fresh ? { forceRefresh: true } : undefined);
    const response = await fetch(url, {
      headers: {
        ...(token !== undefined && { Authorization: `Bearer ${token}` }),
        // The HTTP guard checks Origin like the WebSocket upgrade does.
        ...(input.origin !== undefined && { Origin: input.origin }),
      },
    });

    // A ticket can expire between mints.
    return response.status === 401 && !fresh && input.tickets !== undefined ? get(url, true) : response;
  };

  const refused = async (response: Response): Promise<Error> =>
    new Error(`The sync server answered ${response.status}: ${(await response.text()).trim()}`);

  return {
    list: async ({ group }) => {
      const response = await get(group === undefined ? base : `${base}?group=${group}`);

      if (!response.ok) {
        throw await refused(response);
      }

      return versionsOf(await response.json());
    },
    read: async (version) => {
      const colon = version.lastIndexOf(':');
      const sequence = version.slice(colon + 1);

      if (colon <= 0 || !/^\d+$/.test(sequence)) {
        return null;
      }
      const response = await get(`${base}/${encodeURIComponent(version.slice(0, colon))}/${sequence}`);

      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw await refused(response);
      }
      const body: unknown = await response.json();

      return isRecord(body) && Array.isArray(body.blocks) ? body as unknown as OutputData : null;
    },
  };
};
