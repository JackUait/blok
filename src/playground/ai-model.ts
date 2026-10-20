import type { AgentHostTool, AgentModel, AgentModelContentBlock, AgentModelResponse, AgentModelStreamEvent } from '../../types/api';

type Line =
  | { type: 'delta'; index: number; text: string }
  | { type: 'message'; content: AgentModelContentBlock[]; stop_reason: string | null }
  | { type: 'error'; error: string }
  | AgentModelStreamEvent;

const errorOf = async (response: Response): Promise<string> => {
  const body: unknown = await response.json().catch(() => null);
  const error = typeof body === 'object' && body !== null && 'error' in body ? body.error : undefined;

  return typeof error === 'string' ? error : `The AI endpoint answered ${response.status}.`;
};

/**
 * agent.assistant.model for the playground. Reads the NDJSON that
 * scripts/dev-ai.mjs streams and returns its final message.
 * @param url - the dev endpoint `yarn serve` starts
 */
export const playgroundModel = (url: string): AgentModel => async ({ system, messages, tools, signal, onStream }) => {
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
  const state = { buffered: '' };

  const handle = (line: Line): AgentModelResponse | null => {
    if (line.type === 'error') {
      throw new Error(line.error);
    }
    if (line.type === 'tool_start' || line.type === 'tool_input' || line.type === 'tool_end') {
      onStream?.(line);
    }
    // Deltas are skipped: the bar shows a status line, not the text in flight.
    return line.type === 'message' ? { content: line.content, stop_reason: line.stop_reason } : null;
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

const WEB_TOOLS: Array<Omit<AgentHostTool, 'run'>> = [
  {
    name: 'web_search',
    description: 'Search Wikipedia. Returns article titles, links and snippets. Use web_fetch on a link to read the article.',
    input_schema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        lang: { type: 'string', description: 'Wikipedia language code, e.g. "en" or "ru". Default "en".' },
      },
    },
  },
  {
    name: 'image_search',
    description: 'Search Wikimedia Commons for real photos and pictures. Returns direct image URLs that load, with author and license. Use these URLs for image blocks; never make one up.',
    input_schema: { type: 'object', required: ['query'], properties: { query: { type: 'string', description: 'Best in English.' } } },
  },
  {
    name: 'web_fetch',
    description: 'Fetch a public http(s) URL. Returns a page as plain text, or says whether an image or file loads.',
    input_schema: { type: 'object', required: ['url'], properties: { url: { type: 'string' } } },
  },
];

/**
 * agent.assistant.tools for the playground: keyless web tools that
 * scripts/dev-web.mjs runs behind the dev route's `/web`.
 * @param url - the dev endpoint `yarn serve` starts
 */
export const playgroundWebTools = (url: string): AgentHostTool[] => WEB_TOOLS.map((tool) => ({
  ...tool,
  run: async (input) => {
    const response = await fetch(new URL('/web', url).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: tool.name, input }),
    });
    const body: unknown = await response.json().catch(() => null);
    const field = (key: string): unknown => (typeof body === 'object' && body !== null && key in body ? (body as Record<string, unknown>)[key] : undefined);
    const text = field('text');

    if (response.ok && typeof text === 'string') {
      return text;
    }

    const error = field('error');

    throw new Error(typeof error === 'string' ? error : `The web endpoint answered ${response.status}.`);
  },
}));
