// The black-box probes both server package tests run against a started host.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:http';

export function sendRequest(method, url, headers = {}) {
  return new Promise((resolveRequest, reject) => {
    const outgoing = request(url, {
      headers,
      method,
      timeout: 5_000,
    }, (incoming) => {
      const chunks = [];

      incoming.on('data', (chunk) => chunks.push(chunk));
      incoming.once('error', reject);
      incoming.once('end', () => {
        resolveRequest({
          body: Buffer.concat(chunks).toString('utf8'),
          headers: incoming.headers,
          status: incoming.statusCode,
        });
      });
    });

    outgoing.once('timeout', () => {
      outgoing.destroy(new Error(`${method} ${url} timed out`));
    });
    outgoing.once('error', reject);
    outgoing.end();
  });
}

export function assertResponse(actual, expected, label) {
  assert.equal(actual.status, expected.status, `${label} status`);
  assert.equal(actual.body, expected.body, `${label} body`);

  for (const [name, value] of Object.entries(expected.headers)) {
    assert.equal(actual.headers[name], value, `${label} ${name}`);
  }
}

export async function probeEndpoints(
  baseUrl,
  prefix,
  expectedVersion,
  applicationAuthorization = false,
) {
  const endpoint = (path) => new URL(`${prefix}${path}`, baseUrl);

  assertResponse(
    await sendRequest('GET', endpoint('/health')),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: `{"status":"ok","version":"${expectedVersion}"}\n`,
    },
    'GET /health',
  );
  assertResponse(
    await sendRequest('HEAD', endpoint('/health')),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '',
    },
    'HEAD /health',
  );
  assertResponse(
    await sendRequest('POST', endpoint('/health')),
    {
      status: 405,
      headers: {
        allow: 'GET, HEAD',
        'content-type': 'text/plain; charset=utf-8',
      },
      body: 'Method Not Allowed\n',
    },
    'POST /health',
  );
  if (applicationAuthorization) {
    const anonymous = await sendRequest('GET', endpoint('/unfurl'));

    assert.equal(anonymous.status, 401, 'anonymous GET /unfurl status');
    assertResponse(
      await sendRequest('GET', endpoint('/unfurl'), {
        'X-Test-User': 'signed-in',
      }),
      {
        status: 400,
        headers: { 'content-type': 'application/json' },
        body: '{"success":0}\n',
      },
      'authenticated GET /unfurl',
    );
    assertResponse(
      await sendRequest('OPTIONS', endpoint('/unfurl'), {
        'Access-Control-Request-Method': 'GET',
        Origin: 'https://app.example.test',
      }),
      {
        status: 204,
        headers: {
          'access-control-allow-methods': 'GET, OPTIONS',
          'access-control-allow-origin': 'https://app.example.test',
        },
        body: '',
      },
      'anonymous OPTIONS /unfurl',
    );
  } else {
    assertResponse(
      await sendRequest('GET', endpoint('/unfurl')),
      {
        status: 400,
        headers: { 'content-type': 'application/json' },
        body: '{"success":0}\n',
      },
      'GET /unfurl',
    );
  }
  assertResponse(
    await sendRequest(
      'POST',
      endpoint('/upload'),
      applicationAuthorization ? { 'X-Test-User': 'signed-in' } : {},
    ),
    {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: '404 page not found\n',
    },
    'POST /upload',
  );
  assertResponse(
    await sendRequest(
      'GET',
      endpoint('/missing'),
      applicationAuthorization ? { 'X-Test-User': 'signed-in' } : {},
    ),
    {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: '404 page not found\n',
    },
    'GET /missing',
  );
}

export function startProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let error;
  let standardError = '';
  let standardOutput = '';

  child.once('error', (spawnError) => {
    error = spawnError;
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    standardError += chunk;
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    standardOutput += chunk;
  });

  return {
    child,
    error: () => error,
    output: () => `${standardOutput}${standardError}`,
  };
}

export async function waitForServer(running, healthUrl) {
  const deadline = Date.now() + 30_000;
  let lastError;

  while (Date.now() < deadline) {
    if (running.error() !== undefined) {
      throw running.error();
    }

    if (running.child.exitCode !== null || running.child.signalCode !== null) {
      throw new Error(
        `Server exited before becoming healthy: ${running.output()}`,
      );
    }

    try {
      const response = await sendRequest('GET', healthUrl);

      if (response.status === 200) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }

  throw new Error(
    `Server did not become healthy: ${lastError instanceof Error ? lastError.message : lastError ?? ''}\n` +
    running.output(),
  );
}

export async function stopProcess(running) {
  if (running.child.exitCode !== null || running.child.signalCode !== null) {
    return;
  }

  const closed = once(running.child, 'close');
  running.child.kill();

  const activeTimeoutCount = () => process.getActiveResourcesInfo()
    .filter((resource) => resource === 'Timeout')
    .length;
  const timeoutCountBefore = activeTimeoutCount();
  let fallbackTimer;
  const timeout = new Promise((resolveTimeout) => {
    fallbackTimer = setTimeout(resolveTimeout, 5_000);
  });
  let result;

  try {
    result = await Promise.race([closed, timeout]);
  } finally {
    clearTimeout(fallbackTimer);
  }

  if (result !== undefined) {
    assert.equal(
      activeTimeoutCount(),
      timeoutCountBefore,
      'The server shutdown fallback timer must not keep Node alive',
    );
  }

  if (result === undefined &&
      running.child.exitCode === null &&
      running.child.signalCode === null) {
    running.child.kill('SIGKILL');
    await once(running.child, 'close');
  }
}

export async function allocatePort() {
  const { createServer } = await import('node:net');
  const server = createServer();

  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });

  const address = server.address();

  assert.notEqual(address, null, 'Could not allocate a server port');
  assert.equal(typeof address, 'object');

  const port = address.port;

  await new Promise((resolveClose, reject) => {
    server.close((error) => error === undefined ? resolveClose() : reject(error));
  });

  return port;
}

export async function runAndProbe(
  executable,
  args,
  environment,
  prefix,
  expectedVersion,
  applicationAuthorization = false,
) {
  const port = await allocatePort();
  const baseUrl = new URL(`http://127.0.0.1:${port}`);
  const running = startProcess(
    executable,
    args(port),
    { env: { ...process.env, ...environment } },
  );

  try {
    await waitForServer(
      running,
      new URL(`${prefix}/health`, baseUrl),
    );
    await probeEndpoints(
      baseUrl,
      prefix,
      expectedVersion,
      applicationAuthorization,
    );
  } finally {
    await stopProcess(running);
  }
}
