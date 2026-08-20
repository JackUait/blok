import { createServer } from 'node:http';

export const DEFAULT_HELPER_PORT = 41417;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

/**
 * Local rebuild trigger for the extension popup. The token travels via
 * current.json, which is NOT web-accessible — so arbitrary pages hitting
 * 127.0.0.1 cannot trigger builds even though CORS is wide open.
 */
export function createHelperServer({ token, runBuild, readCurrent }) {
  let inflight = null;

  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS });
    res.end(JSON.stringify(body));
  };

  return createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }
    if (req.headers.authorization !== `Bearer ${token}`) {
      json(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }
    if (req.method === 'GET' && req.url === '/status') {
      json(res, 200, { ok: true, building: inflight !== null, current: readCurrent() });
      return;
    }
    if (req.method === 'POST' && req.url === '/build') {
      inflight ??= Promise.resolve()
        .then(runBuild)
        .finally(() => {
          inflight = null;
        });
      inflight
        .then(() => json(res, 200, { ok: true, current: readCurrent() }))
        .catch((error) => json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) }));
      return;
    }
    json(res, 404, { ok: false, error: 'not found' });
  });
}
