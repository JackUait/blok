import type { AdapterOptions } from '../../../src/agent-models/shared';
import type { AgentModelRequest, AgentModelStreamEvent } from '../../../types/api';

/** Small chunks, so lines and JSON tokens split across reads. */
export const sseStream = (text: string, size = 7): ReadableStream<Uint8Array> => {
  const bytes = new TextEncoder().encode(text);

  return new ReadableStream({
    start: (controller) => {
      for (let offset = 0; offset < bytes.length; offset += size) {
        controller.enqueue(bytes.slice(offset, offset + size));
      }
      controller.close();
    },
  });
};

/** A host stream that answers each request with the next text, and records the bodies. */
export const fakeStream = (...texts: string[]): { stream: NonNullable<AdapterOptions['stream']>; bodies: Record<string, unknown>[] } => {
  const bodies: Record<string, unknown>[] = [];

  return {
    bodies,
    stream: async (body) => {
      bodies.push(structuredClone(body));

      return sseStream(texts.shift() ?? '');
    },
  };
};

export const request = (onStream?: (event: AgentModelStreamEvent) => void, signal = new AbortController().signal): AgentModelRequest => ({
  system: 'sys', messages: [{ role: 'user', content: 'Go' }], tools: [], signal, ...(onStream === undefined ? {} : { onStream }),
});
