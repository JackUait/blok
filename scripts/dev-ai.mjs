/**
 * Dev AI endpoint for `yarn serve`: the playground's stand-in for the host
 * backend route that calls the LLM for the in-editor assistant.
 * `POST /ai` takes `{ system, messages, tools }` (what `agent.assistant.model`
 * receives) and answers with the model's message.
 *
 * The key never reaches the page: the Anthropic SDK reads ANTHROPIC_API_KEY (or
 * an `ant auth login` profile) here. Loopback only, and the Host and Origin
 * checks keep other sites and rebound DNS names from spending it.
 */
import { createServer } from 'node:http';

export const AI_MODEL = process.env.BLOK_AI_MODEL ?? 'claude-opus-5-5';

/** Large enough that a long document edit is not cut off; needs streaming. */
const MAX_TOKENS = 64_000;
const MAX_BODY_BYTES = 8 * 1024 * 1024;

/**
 * @param {{ system: string, messages: unknown[], tools: unknown[] }} request
 * @returns {Record<string, unknown>} Beta Messages params.
 */
export function messageParams({ system, messages, tools }) {
  return {
    model: AI_MODEL,
    max_tokens: MAX_TOKENS,
    system,
    messages,
    tools,
    output_config: { effort: 'medium' },
    // On a refusal the API re-runs the request on a model chosen by refusal category.
    betas: ['server-side-fallback-2026-07-01'],
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
 * @param {(params: Record<string, unknown>, signal: AbortSignal) => Promise<{ content: unknown[], stop_reason: string | null }>} options.createMessage
 * @returns {Promise<{ status: number, headers: Record<string, string>, body?: string }>}
 */
export async function handleAiRequest({ origins, hosts, host, origin, method, url, body, signal, createMessage }) {
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

  try {
    const message = await createMessage(messageParams(parsed), signal);

    return json(200, headers, { content: message.content, stop_reason: message.stop_reason });
  } catch (error) {
    return json(502, headers, { error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * The real model call. Imported late, so a checkout without the SDK still serves the playground.
 *
 * @returns {Promise<(params: Record<string, unknown>, signal: AbortSignal) => Promise<{ content: unknown[], stop_reason: string | null }>>}
 */
async function anthropicCreateMessage() {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const state = { client: null };

  return async (params, signal) => {
    // Built on first use: a missing key then shows in the bar, not at startup.
    state.client ??= new Anthropic();

    // Streaming: a 64k max_tokens request would time out as one HTTP call.
    return state.client.beta.messages.stream(params, { signal }).finalMessage();
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
 * @returns {Promise<{ server: import('node:http').Server, url: string }>}
 */
export async function startAiEndpoint({ port, origins }) {
  const createMessage = await anthropicCreateMessage();
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
      }))
      .then(({ status, headers, body }) => {
        response.writeHead(status, headers);
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

  return { server, url: `http://127.0.0.1:${bound}/ai` };
}
