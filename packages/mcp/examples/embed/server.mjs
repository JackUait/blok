#!/usr/bin/env node
/**
 * Blok's MCP tools on your own MCP server.
 *
 * This host has its own serverInfo ("host-example"), its own instructions, one tool
 * (host_echo) and one prompt (host_hello). It adds Blok's blok_* tools and prompts with
 * createBlok, configured by the same flags and env as `blok-mcp` (parseBlokMcpArgs).
 *
 *   node scripts/build-mcp.mjs
 *   node packages/mcp/examples/embed/server.mjs --source files:./docs --authorize <url> [--http 127.0.0.1:0]
 *
 * Signing in is the host's job; this example fakes it:
 *   HTTP   `X-Example-User: <name>` signs the caller in as <name>. `X-Example-Signed-In: true`
 *          without X-Example-User signs them in without a name. Neither header: anonymous.
 *   stdio  the one local user, "local".
 * Blok refuses anonymous and unnamed callers unless --example-allow-anonymous is given.
 *
 * Example flags (every other flag goes to Blok):
 *   --example-host-tool <name>             the host tool's name (default host_echo)
 *   --example-host-prompt <name>           the host prompt's name (default host_hello)
 *   --example-allow-anonymous <principal>  serve anonymous callers as this principal
 *   --example-source endpoint:<url>        a host document source (not available yet)
 *
 * The HTTP side keeps only what an example needs: no Origin/Host checks and no body cap
 * of its own. Those, like OAuth, belong to your server.
 */
import { createServer } from 'node:http';

// stdout carries the protocol over stdio, so nothing may log there.
const toStderr = (...args) => console.error(...args);

Object.assign(console, { log: toStderr, info: toStderr, debug: toStderr });

const { createMcpHandler, Server } = await import('@modelcontextprotocol/server');
const { serveStdio } = await import('@modelcontextprotocol/server/stdio');
const { createBlok, parseBlokMcpArgs } = await import('@bloklabs/mcp');

const NAME = 'host-example';
const EXAMPLE_FLAGS = new Set(['--example-host-tool', '--example-host-prompt', '--example-allow-anonymous', '--example-source']);

class StartError extends Error {}

/** Splits this example's own flags from the blok-mcp ones. Each example flag takes a value. */
const splitArgs = (argv) => {
  const example = {};
  const blok = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!EXAMPLE_FLAGS.has(arg)) {
      blok.push(arg);
      continue;
    }
    const value = argv[index + 1];

    if (value === undefined || value.startsWith('--')) {
      throw new StartError(`${arg} needs a value`);
    }
    example[arg.slice('--example-'.length)] = value;
    index += 1;
  }

  return { example, blok };
};

const hostSurface = (example) => {
  const toolName = example['host-tool'] ?? 'host_echo';
  const promptName = example['host-prompt'] ?? 'host_hello';

  return {
    tools: [{
      name: toolName,
      description: 'Echoes the text back.',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    }],
    callTool: async (request) => {
      if (request.params.name !== toolName) {
        throw Object.assign(new Error(`Tool ${request.params.name} not found`), { code: -32602 });
      }

      return { content: [{ type: 'text', text: String(request.params.arguments?.text ?? '') }] };
    },
    prompts: [{ name: promptName, description: 'Says hello.' }],
    getPrompt: async (request) => {
      if (request.params.name !== promptName) {
        throw Object.assign(new Error(`Prompt ${request.params.name} not found`), { code: -32602 });
      }

      return { messages: [{ role: 'user', content: { type: 'text', text: 'Hello from the host.' } }] };
    },
  };
};

/** The signed-in user from the fake headers, as the SDK's AuthInfo. */
const authInfoOf = (headers) => {
  const user = headers['x-example-user'];

  if (typeof user === 'string' && user !== '') {
    return { token: 'example', clientId: NAME, scopes: [], extra: { sub: user } };
  }
  if (headers['x-example-signed-in'] === 'true') {
    return { token: 'example', clientId: NAME, scopes: [], extra: {} };
  }

  return undefined;
};

const toRequest = async (req, url) => {
  const headers = new Headers();

  for (const [name, value] of Object.entries(req.headers)) {
    headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';

  return new Request(url, { method: req.method, headers, ...(hasBody && { body: Buffer.concat(chunks) }) });
};

const send = async (res, response) => {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body === null) {
    res.end();

    return;
  }
  for await (const chunk of response.body) {
    res.write(chunk);
  }
  res.end();
};

const serveHttp = async (listen, buildServer) => {
  const at = listen.lastIndexOf(':');
  const handler = createMcpHandler(() => buildServer());
  const http = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (url.pathname !== '/mcp') {
      res.writeHead(404).end();

      return;
    }
    toRequest(req, url)
      .then(request => handler.fetch(request, { authInfo: authInfoOf(req.headers) }))
      .then(response => send(res, response))
      .catch((error) => {
        console.error(`${NAME}: request failed`, error);
        if (!res.headersSent) {
          res.writeHead(500);
        }
        res.end();
      });
  });

  await new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(Number(listen.slice(at + 1)), listen.slice(0, at).replace(/^\[|\]$/g, ''), resolve);
  });
  const address = http.address();

  console.error(`${NAME}: listening on http://${address.family === 'IPv6' ? `[${address.address}]` : address.address}:${address.port}/mcp`);

  return async () => {
    await handler.close();
    http.closeAllConnections();
    await new Promise(resolve => http.close(resolve));
  };
};

const main = async () => {
  const { example, blok: blokArgs } = splitArgs(process.argv.slice(2));
  const options = await parseBlokMcpArgs(blokArgs, process.env);
  const stdio = options.transport.kind === 'stdio';

  // Item 2 hooks in here: --example-source endpoint:<url> becomes a host document source
  // passed to createBlok as options.source.
  if (example.source !== undefined) {
    throw new StartError('--example-source is not available yet');
  }
  const blok = createBlok(options, {
    // stdio has one local user; over HTTP the default reads the AuthInfo the host passed to the SDK.
    ...(stdio && { caller: () => ({ principal: 'local' }) }),
    ...(example['allow-anonymous'] !== undefined && { anonymousPrincipal: example['allow-anonymous'] }),
  });
  const host = hostSurface(example);
  const buildServer = () => {
    const server = new Server({ name: NAME, version: '1.0.0' }, { instructions: `Host instructions.\n\n${blok.instructions}` });

    blok.attach(server, host);

    return server;
  };

  try {
    // Over HTTP a server is built per request, so check the names once before serving.
    buildServer();
  } catch (error) {
    await blok.close();
    throw new StartError(error.message);
  }
  const closeTransport = stdio
    ? (() => {
      const serving = serveStdio(buildServer);

      return () => serving.close();
    })()
    : await serveHttp(options.transport.listen, buildServer);
  const shutdown = () => {
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
    process.stdin.off('end', shutdown);
    // Blok first: it waits for calls in flight, whose answers still need the transport.
    void blok.close()
      .then(closeTransport)
      .then(() => process.exit(0), () => process.exit(1));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  if (stdio) {
    process.stdin.on('end', shutdown);
  }
};

main().catch((error) => {
  console.error(`${NAME}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(error instanceof StartError || error?.name === 'McpConfigError' ? 2 : 1);
});
