import type { AgentModel, AgentModelContentBlock, AgentModelResponse } from '../../types/api';

type Line =
  | { type: 'delta'; index: number; text: string }
  | { type: 'message'; content: AgentModelContentBlock[]; stop_reason: string | null }
  | { type: 'error'; error: string };

const errorOf = async (response: Response): Promise<string> => {
  const body: unknown = await response.json().catch(() => null);
  const error = typeof body === 'object' && body !== null && 'error' in body ? body.error : undefined;

  return typeof error === 'string' ? error : `The AI endpoint answered ${response.status}.`;
};

/**
 * agent.assistant.model for the playground. Reads the NDJSON that
 * scripts/dev-ai.mjs streams and shows each block's text while it arrives.
 * @param url - the dev endpoint `yarn serve` starts
 */
export const playgroundModel = (url: string): AgentModel => async ({ system, messages, tools, signal, onText }) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system, messages, tools }),
    signal,
  });

  if (!response.ok || response.body === null) {
    throw new Error(await errorOf(response));
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  const texts = new Map<number, string>();
  const state = { buffered: '' };

  const handle = (line: Line): AgentModelResponse | null => {
    if (line.type === 'error') {
      throw new Error(line.error);
    }
    if (line.type === 'message') {
      return { content: line.content, stop_reason: line.stop_reason };
    }

    const text = (texts.get(line.index) ?? '') + line.text;

    texts.set(line.index, text);
    onText?.(text);

    return null;
  };

  for (;;) {
    const { value, done } = await reader.read();

    if (done) {
      throw new Error('The AI endpoint stopped before the answer was complete.');
    }

    const lines = (state.buffered + value).split('\n');

    // The last piece may be half a line; it waits for the next chunk.
    state.buffered = lines.pop() ?? '';

    const answer = lines
      .filter((line) => line !== '')
      .reduce<AgentModelResponse | null>((found, raw) => found ?? handle(JSON.parse(raw) as Line), null);

    if (answer !== null) {
      await reader.cancel();

      return answer;
    }
  }
};
