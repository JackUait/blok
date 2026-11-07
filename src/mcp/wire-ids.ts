import type { JSONRPCMessage } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

import { wellFormed } from '../shared/mcp/wire-json';

const ESCAPED_SURROGATE = /\\u[dD][89a-fA-F][0-9a-fA-F]{2}/;

const wellFormedId = (id: unknown): unknown => typeof id === 'string' ? wellFormed(id) : id;

// The same object back when nothing changes.
const fixMessage = (message: unknown): unknown => {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
    return message;
  }
  const record = message as Record<string, unknown>;
  const id = wellFormedId(record.id);
  const fixed = id === record.id ? record : { ...record, id };
  const params = fixed.params;

  if (fixed.method !== 'notifications/cancelled' || typeof params !== 'object' || params === null || !('requestId' in params)) {
    return fixed;
  }
  const requestId = (params as Record<string, unknown>).requestId;
  const wellFormedRequestId = wellFormedId(requestId);

  return wellFormedRequestId === requestId ? fixed : { ...fixed, params: { ...params, requestId: wellFormedRequestId } };
};

/**
 * A message's id, and a cancel's requestId, with each lone UTF-16 surrogate as U+FFFD, as the ports'
 * JSON readers read them. Only ids: arguments are fixed in checkCall, and the rest of a message may
 * nest too deep to walk.
 */
export const wellFormedIds = (message: unknown): unknown => {
  if (!Array.isArray(message)) {
    return fixMessage(message);
  }
  const fixed = message.map(fixMessage);

  return fixed.every((item, at) => item === message[at]) ? message : fixed;
};

/** An HTTP body with its ids made well-formed; the same bytes when nothing changes or it is not JSON. */
export const wellFormedIdsInBody = (body: Buffer): Buffer => {
  const text = body.toString('utf8');

  if (!ESCAPED_SURROGATE.test(text)) {
    return body;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    const fixed = wellFormedIds(parsed);

    return fixed === parsed ? body : Buffer.from(JSON.stringify(fixed));
  } catch {
    // Not JSON, or too deep to write back: the SDK answers it as before.
    return body;
  }
};

/** The SDK's stdio transport, handing each message on with well-formed ids. */
export const wellFormedIdsStdio = (): StdioServerTransport => {
  const transport = new StdioServerTransport();
  const target: { deliver?: StdioServerTransport['onmessage'] } = {};

  // The SDK reads and sets onmessage as a plain field.
  Object.defineProperty(transport, 'onmessage', {
    configurable: true,
    get: (): StdioServerTransport['onmessage'] => {
      const deliver = target.deliver;

      return deliver === undefined ? undefined : (message: JSONRPCMessage) => deliver(wellFormedIds(message) as JSONRPCMessage);
    },
    set: (handler: StdioServerTransport['onmessage']) => {
      target.deliver = handler;
    },
  });

  return transport;
};
