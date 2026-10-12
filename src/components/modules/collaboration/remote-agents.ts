import { capPresenceName, isPresenceColor } from './presence';

export interface RemoteAgent {
  via: string;
  onBehalfOf: string;
  onBehalfOfName: string | null;
}

export interface RemoteAgentCursor {
  actorId: string;
  name: string;
  color: string | null;
  blockId: string;
  field: string | null;
  start: number | null;
  end: number | null;
}

/** Ids are hashed and compared, and a peer can publish megabytes. */
export const MAX_AGENT_ID_LENGTH = 256;

const isId = (value: unknown): value is string =>
  typeof value === 'string' && value !== '' && value.length <= MAX_AGENT_ID_LENGTH;

const isOffset = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A peer's `agent` awareness field, or null. Anything malformed drops the
 * whole field, so the peer is drawn as a person.
 * @param value - untrusted
 */
export function readAgentField(value: unknown): RemoteAgent | null {
  if (!isRecord(value) || !isId(value.via) || !isId(value.onBehalfOf)) {
    return null;
  }

  if (value.onBehalfOfName !== undefined && typeof value.onBehalfOfName !== 'string') {
    return null;
  }

  const name = capPresenceName(value.onBehalfOfName);

  return { via: value.via, onBehalfOf: value.onBehalfOf, onBehalfOfName: name === '' ? null : name };
}

/**
 * A peer's `agentCursor` awareness field, or null. A bad actorId, name or
 * blockId drops it. A bad field or offset keeps the block at block level.
 * @param value - untrusted
 */
export function readAgentCursor(value: unknown): RemoteAgentCursor | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = capPresenceName(value.name);

  if (!isId(value.actorId) || name === '' || !isId(value.blockId)) {
    return null;
  }

  const base = {
    actorId: value.actorId,
    name,
    color: isPresenceColor(value.color) ? value.color : null,
    blockId: value.blockId,
  };
  const broken = (value.field !== undefined && typeof value.field !== 'string')
    || (value.start !== undefined && !isOffset(value.start))
    || (value.end !== undefined && !isOffset(value.end));

  if (broken) {
    return { ...base, field: null, start: null, end: null };
  }

  return {
    ...base,
    field: typeof value.field === 'string' ? value.field : null,
    start: isOffset(value.start) ? value.start : null,
    end: isOffset(value.end) ? value.end : null,
  };
}
