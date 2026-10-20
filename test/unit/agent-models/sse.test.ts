import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readJsonEvents, readSse } from '../../../src/agent-models/sse';

const streamOf = (...chunks: string[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start: (controller) => {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
};

const collect = async (source: Response | ReadableStream<Uint8Array>, signal = new AbortController().signal): Promise<Array<{ event?: string; data: string }>> => {
  const events: Array<{ event?: string; data: string }> = [];

  for await (const event of readSse(source, signal)) {
    events.push(event);
  }

  return events;
};

describe('readSse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses events split across chunks', async () => {
    const events = await collect(streamOf(
      'event: ping\r',
      '\ndata: {"a":',
      '1}\r\n\r',
      '\n: a comment\n',
      'data: café\n\n'
    ));

    expect(events).toEqual([{ event: 'ping', data: '{"a":1}' }, { data: 'café' }]);
  });

  it('keeps a multi-byte character split across chunks', async () => {
    const bytes = new TextEncoder().encode('data: é\n\n');
    const split = bytes.indexOf(0xc3) + 1;
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.enqueue(bytes.slice(0, split));
        controller.enqueue(bytes.slice(split));
        controller.close();
      },
    });

    expect(await collect(stream)).toEqual([{ data: 'é' }]);
  });

  it('joins multi-line data', async () => {
    expect(await collect(streamOf('data: one\ndata:two\n\n'))).toEqual([{ data: 'one\ntwo' }]);
  });

  it('reads a Response body and a last event without a trailing blank line', async () => {
    expect(await collect(new Response('event: a\ndata: 1'))).toEqual([{ event: 'a', data: '1' }]);
  });

  it('stops at [DONE]', async () => {
    expect(await collect(streamOf('data: 1\n\ndata: [DONE]\n\ndata: 2\n\n'))).toEqual([{ data: '1' }]);
  });

  it('stops reading when the signal aborts', async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    // Never closes on its own, so only the abort can end the read.
    const stream = new ReadableStream<Uint8Array>({
      start: (source) => source.enqueue(new TextEncoder().encode('data: 1\n\n')),
      cancel,
    });
    const events: Array<{ event?: string; data: string }> = [];

    for await (const event of readSse(stream, controller.signal)) {
      events.push(event);
      controller.abort();
    }

    expect(events).toEqual([{ data: '1' }]);
    expect(cancel).toHaveBeenCalled();
  });

  it('reads nothing when the signal is already aborted', async () => {
    const controller = new AbortController();

    controller.abort();

    expect(await collect(streamOf('data: 1\n\n'), controller.signal)).toEqual([]);
  });
});

describe('readJsonEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const collectJson = async (source: Response | ReadableStream<Uint8Array>, signal = new AbortController().signal): Promise<unknown[]> => {
    const events: unknown[] = [];

    for await (const event of readJsonEvents(source, signal, 'P')) {
      events.push(event);
    }

    return events;
  };

  it('yields each JSON object event and skips data that is not a JSON object', async () => {
    expect(await collectJson(streamOf('data: {"a":1}\n\n', 'data: not json\n\n', 'data: [1]\n\n', 'data: 3\n\n', 'data: {"b":', '2}\n\n')))
      .toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('throws the provider\'s message for an HTTP error response, and its status when the body is not JSON', async () => {
    await expect(collectJson(new Response('{"error":{"message":"Bad key"}}', { status: 401 }))).rejects.toThrow('P: Bad key');
    await expect(collectJson(new Response('<html>', { status: 502 }))).rejects.toThrow('P: HTTP 502.');
  });

  it('reads an ok Response body', async () => {
    expect(await collectJson(new Response('data: {"a":1}\n\n'))).toEqual([{ a: 1 }]);
  });

  it('yields nothing when the signal is already aborted', async () => {
    const controller = new AbortController();

    controller.abort();

    expect(await collectJson(streamOf('data: {"a":1}\n\n'), controller.signal)).toEqual([]);
  });
});
