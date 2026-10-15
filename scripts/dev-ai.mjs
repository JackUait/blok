/**
 * Dev AI endpoint for `yarn serve`: the playground's stand-in for the host
 * backend route that calls the LLM for the in-editor assistant.
 * `POST /ai` takes `{ system, messages, tools }` (what `agent.assistant.model`
 * receives) and streams NDJSON: `{ type: 'delta', index, text }` while the model
 * writes, then `{ type: 'message', content, stop_reason, usage }` or
 * `{ type: 'error', error }`. src/playground/ai-model.ts reads it.
 *
 * The key never reaches the page. It comes from the shell, or from
 * ~/.config/blok/ai.env, which lives outside the repo so it cannot be committed.
 * ANTHROPIC_BASE_URL and BLOK_AI_MODEL there point the route at any
 * Anthropic-compatible API (e.g. DeepSeek). Loopback only, and the Host and
 * Origin checks keep other sites and rebound DNS names from spending the key.
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

export const AI_MODEL = 'claude-opus-5-5';

const ENV_FILE = join(homedir(), '.config', 'blok', 'ai.env');

/** Large enough that a long document edit is not cut off; needs streaming. */
const MAX_TOKENS = 64_000;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const NO_KEY_MESSAGE = 'No AI key. Put ANTHROPIC_API_KEY in ~/.config/blok/ai.env (or run `ant auth login`) and restart yarn serve.';

/**
 * The shell wins over the file, so a one-off `BLOK_AI_MODEL=… yarn serve` still works.
 *
 * @param {Record<string, string | undefined>} env
 * @param {string | null} fileText Contents of the private env file, or null when there is none.
 * @returns {{ apiKey: string | undefined, baseURL: string | undefined, model: string }}
 */
export function aiSettings(env, fileText) {
  const merged = { ...(fileText === null ? {} : parseEnv(fileText)), ...env };

  return {
    apiKey: merged.ANTHROPIC_API_KEY,
    baseURL: merged.ANTHROPIC_BASE_URL,
    model: merged.BLOK_AI_MODEL ?? AI_MODEL,
  };
}

/**
 * @param {string} model
 * @param {{ system: string, messages: unknown[], tools: unknown[] }} request
 * @returns {Record<string, unknown>} Beta Messages params.
 */
export function messageParams(model, { system, messages, tools }) {
  return {
    model,
    max_tokens: MAX_TOKENS,
    // Tools render before system, so this mark caches both. They stay the same
    // for a whole run (agent-run.ts), and every step after the first reads them.
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages,
    tools,
    // Moves to the last block on each call, so a step reads the steps before it.
    cache_control: { type: 'ephemeral' },
    output_config: { effort: 'medium' },
    // The notes Opus writes between tool calls arrive as thinking blocks, empty
    // unless display is 'updates'. Keep this the same on every step: changing it
    // drops the cached conversation.
    thinking: { type: 'adaptive', display: 'updates' },
    // fallback: on a refusal the API re-runs the request on a model chosen by refusal category.
    betas: ['server-side-fallback-2026-07-01', 'thinking-display-updates-2026-08-18'],
    fallbacks: 'default',
  };
}

const isModelRequest = (value) => typeof value === 'object' && value !== null
  && typeof value.system === 'string' && Array.isArray(value.messages) && Array.isArray(value.tools);

const json = (status, headers, value) => ({
  status,
  headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  body: JSON.stringify(value),
});

const errorText = (error) => {
  const message = error instanceof Error ? error.message : String(error);

  // The SDK's wording when no key or profile is found.
  return message.startsWith('Could not resolve authentication method') ? NO_KEY_MESSAGE : message;
};

/**
 * @param {object} options
 * @param {string[]} options.origins Pages allowed to call.
 * @param {string[]} options.hosts This server's own `host:port` spellings.
 * @param {string | undefined} options.host
 * @param {string | undefined} options.origin
 * @param {string} options.method
 * @param {string} options.url
 * @param {string} options.body
 * @param {AbortSignal} options.signal Aborted when the page drops the request.
 * @param {CreateMessage} options.createMessage
 * @param {string} [options.model]
 * @returns {Promise<{ status: number, headers: Record<string, string>, body?: string, pipe?: (write: (chunk: string) => void) => Promise<void> }>}
 *   `pipe` is set on the streamed answer. Headers are sent before it runs, so a model error is its last line.
 */
export async function handleAiRequest({ origins, hosts, host, origin, method, url, body, signal, createMessage, model = AI_MODEL }) {
  const allowed = origin !== undefined && origins.includes(origin);
  const headers = allowed ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : { Vary: 'Origin' };

  if (host === undefined || !hosts.includes(host.toLowerCase()) || !allowed) {
    return { status: 403, headers };
  }
  if (new URL(url, 'http://127.0.0.1').pathname !== '/ai') {
    return { status: 404, headers };
  }
  if (method === 'OPTIONS') {
    return {
      status: 204,
      headers: { ...headers, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' },
    };
  }
  if (method !== 'POST') {
    return { status: 405, headers: { ...headers, Allow: 'POST, OPTIONS' } };
  }

  const parsed = (() => {
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  })();

  if (!isModelRequest(parsed)) {
    return json(400, headers, { error: 'Send { system, messages, tools }.' });
  }

  return {
    status: 200,
    headers: { ...headers, 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
    pipe: async (write) => {
      const send = (value) => write(`${JSON.stringify(value)}\n`);

      try {
        const message = await createMessage(messageParams(model, parsed), signal, (index, text) => send({ type: 'delta', index, text }));

        send({ type: 'message', content: message.content, stop_reason: message.stop_reason, ...(message.usage === undefined ? {} : { usage: message.usage }) });
      } catch (error) {
        send({ type: 'error', error: errorText(error) });
      }
    },
  };
}

/**
 * @typedef {(params: Record<string, unknown>, signal: AbortSignal, onDelta: (index: number, text: string) => void)
 *   => Promise<{ content: unknown[], stop_reason: string | null, usage?: unknown }>} CreateMessage
 */

/**
 * The real model call. Imported late, so a checkout without the SDK still serves the playground.
 *
 * @param {{ apiKey: string | undefined, baseURL: string | undefined }} settings
 * @returns {Promise<CreateMessage>}
 */
async function anthropicCreateMessage({ apiKey, baseURL }) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const state = { client: null };

  return async (params, signal, onDelta) => {
    // Built on first use: a missing key then shows in the bar, not at startup.
    // Undefined fields fall back to the SDK's own lookup (env, then `ant auth login`).
    state.client ??= new Anthropic({ apiKey, baseURL });

    const stream = state.client.beta.messages.stream(params, { signal });

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        // A thinking delta is a progress note: reasoning stays empty under display 'updates'.
        const piece = { text_delta: event.delta.text, thinking_delta: event.delta.thinking }[event.delta.type];

        if (typeof piece === 'string' && piece !== '') {
          onDelta(event.index, piece);
        }
      }
    }

    // The message as the API built it: thinking blocks must go back unchanged.
    return stream.finalMessage();
  };
}

const readBody = (request) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;

  request.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      reject(new Error('Request body too large'));
      request.destroy();

      return;
    }
    chunks.push(chunk);
  });
  request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  request.on('error', reject);
});

/**
 * Start the endpoint on `port`, or any free port when that one is taken.
 *
 * @param {object} options
 * @param {number} options.port
 * @param {string[]} options.origins
 * @returns {Promise<{ server: import('node:http').Server, url: string, model: string }>}
 */
export async function startAiEndpoint({ port, origins }) {
  const fileText = (() => {
    try {
      return readFileSync(ENV_FILE, 'utf8');
    } catch {
      return null;
    }
  })();
  const settings = aiSettings(process.env, fileText);
  const createMessage = await anthropicCreateMessage(settings);
  const hosts = [];
  const server = createServer((request, response) => {
    const controller = new AbortController();

    // The page aborted (Stop) or went away: stop paying for the answer.
    response.on('close', () => {
      if (!response.writableFinished) {
        controller.abort();
      }
    });

    readBody(request)
      .then((body) => handleAiRequest({
        origins,
        hosts,
        host: request.headers.host,
        origin: request.headers.origin,
        method: request.method ?? 'GET',
        url: request.url ?? '/',
        body,
        signal: controller.signal,
        createMessage,
        model: settings.model,
      }))
      .then(async ({ status, headers, body, pipe }) => {
        response.writeHead(status, headers);
        if (pipe !== undefined) {
          await pipe((chunk) => response.write(chunk));
        }
        response.end(body);
      })
      .catch(() => {
        response.writeHead(413);
        response.end();
      });
  });

  const listen = (at) => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(at, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  await listen(port).catch(() => listen(0));

  const bound = server.address().port;

  hosts.push(`127.0.0.1:${bound}`, `localhost:${bound}`);

  return { server, url: `http://127.0.0.1:${bound}/ai`, model: settings.model };
}
