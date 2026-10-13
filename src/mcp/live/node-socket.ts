import WebSocket from 'ws';
import type { CollabSocketFactory, WebSocketLike } from '../../components/modules/collaboration/types';

/**
 * `ws`, not Node's global WebSocket: `ws` takes an origin option on every
 * supported Node, so the package keeps core's >=20.19.0 engine floor.
 * Ticket mode needs Origin on every client.
 * @param origin - the Origin header to send, or null to send none
 * @returns a socket factory for the collaboration provider
 */
export const nodeSocketFactory = (origin: string | null): CollabSocketFactory => (url, protocols) => {
  const socket = new WebSocket(url, protocols, origin === null ? {} : { origin });

  // The provider nulls onerror, then closes a CONNECTING socket; ws then emits
  // 'error', and an emitter with no listener throws and kills the process.
  socket.on('error', () => undefined);

  return socket satisfies WebSocketLike;
};
