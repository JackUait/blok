import { errorOf, httpError, isRecord, parseJson } from './shared';

export interface SseEvent {
  event?: string;
  data: string;
}

interface Pending {
  event?: string;
  data: string[];
}

const EMPTY: Pending = { data: [] };

/** Folds one line into the pending event; a blank line completes it. */
const readLine = (line: string, pending: Pending): { pending: Pending; event?: SseEvent } => {
  if (line === '') {
    return pending.data.length === 0
      ? { pending: EMPTY }
      : { pending: EMPTY, event: { ...(pending.event === undefined ? {} : { event: pending.event }), data: pending.data.join('\n') } };
  }

  const colon = line.indexOf(':');
  const field = colon === -1 ? line : line.slice(0, colon);
  const raw = colon === -1 ? '' : line.slice(colon + 1);
  const value = raw.startsWith(' ') ? raw.slice(1) : raw;

  // A line starting with ":" is a comment: its field is '', which matches neither.
  if (field === 'event') {
    return { pending: { ...pending, event: value } };
  }

  return field === 'data' ? { pending: { ...pending, data: [...pending.data, value] } } : { pending };
};

/** The events the lines complete, up to `[DONE]`. */
interface Read {
  events: SseEvent[];
  pending: Pending;
  done: boolean;
}

const eventsOf = (lines: string[], start: Pending): Read => lines.reduce<Read>(
  (out, line) => {
    if (out.done) {
      return out;
    }

    const read = readLine(line, out.pending);

    if (read.event?.data === '[DONE]') {
      return { ...out, pending: read.pending, done: true };
    }

    return { events: read.event === undefined ? out.events : [...out.events, read.event], pending: read.pending, done: false };
  },
  { events: [], pending: start, done: false }
);

function* untilAborted(events: SseEvent[], signal: AbortSignal): Generator<SseEvent> {
  for (const event of events) {
    if (signal.aborted) {
      return;
    }
    yield event;
  }
}

/**
 * Splits complete lines off the buffer. A trailing "\r" is held back, since the next chunk
 * may start with the "\n" of the same CRLF.
 */
const takeLines = (buffer: string, final: boolean): { lines: string[]; rest: string } => {
  const held = !final && buffer.endsWith('\r') ? '\r' : '';
  const lines = buffer.slice(0, buffer.length - held.length).split(/\r\n|\r|\n/);
  const rest = lines.pop() ?? '';

  // At the end, the last line is complete and a missing blank line still ends the event.
  return final ? { lines: [...lines, rest, ''], rest: '' } : { lines, rest: rest + held };
};

/** Text kept from lines that are not SSE fields: a provider's JSON error sent as a bare stream. */
const STRAY_LIMIT = 64_000;

const isStray = (line: string): boolean => line !== '' && !line.startsWith(':') && !/^(data|event|id|retry)(:|$)/.test(line);

const keepStray = (stray: string[] | undefined, lines: string[]): void => {
  if (stray !== undefined && stray.join('\n').length < STRAY_LIMIT) {
    stray.push(...lines.filter(isStray));
  }
};

/**
 * Reads server-sent events from a streaming response. Ends at `data: [DONE]`, at the end of
 * the stream, or when `signal` aborts (the read is cancelled then).
 * @param source - the response, or its body
 * @param signal - the run's signal
 * @param stray - receives lines that are not SSE fields
 */
export async function* readSse(source: Response | ReadableStream<Uint8Array>, signal: AbortSignal, stray?: string[]): AsyncGenerator<SseEvent> {
  // Duck-typed: a stream from another realm (Node fetch under jsdom) fails instanceof.
  const stream = 'getReader' in source ? source : source.body;

  if (stream === null || signal.aborted) {
    return;
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const cancel = (): void => {
    reader.cancel().catch(() => undefined);
  };
  const state: { buffer: string; pending: Pending; done: boolean } = { buffer: '', pending: EMPTY, done: false };

  signal.addEventListener('abort', cancel, { once: true });

  try {
    while (!state.done && !signal.aborted) {
      const chunk = await reader.read();
      const text = state.buffer + (chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true }));
      const { lines, rest } = takeLines(text, chunk.done);
      const read = eventsOf(lines, state.pending);

      keepStray(stray, lines);

      state.buffer = rest;
      state.pending = read.pending;
      state.done = chunk.done || read.done;

      yield* untilAborted(read.events, signal);
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
  }
}

/**
 * The JSON object events of a streaming response, after checking it is not an HTTP error.
 * Data that is not a JSON object is skipped.
 * @param source - the response, or its body
 * @param signal - the run's signal
 * @param provider - names the provider in errors
 */
export async function* readJsonEvents(
  source: Response | ReadableStream<Uint8Array>,
  signal: AbortSignal,
  provider: string
): AsyncGenerator<Record<string, unknown>> {
  const failed = await httpError(source, provider);

  if (failed !== null) {
    throw failed;
  }

  const stray: string[] = [];
  const seen = { events: 0 };

  for await (const { data } of readSse(source, signal, stray)) {
    seen.events += 1;

    const event = parseJson(data);

    if (isRecord(event)) {
      yield event;
    }
  }

  // A bare stream has no HTTP status, so its error body is all there is to report.
  if (seen.events === 0 && stray.length > 0 && !signal.aborted) {
    throw errorOf(parseJson(stray.join('\n')), provider) ?? new Error(`${provider}: the reply was not an event stream.`);
  }
}
