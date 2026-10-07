// @vitest-environment node
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { handleTicketRequest, ticketClaimsFor } from '../../../scripts/dev-ticket.mjs';

const SECRET = 'dev-secret-dev-secret-dev-secret-0123';
const ORIGINS = ['http://localhost:3303', 'http://127.0.0.1:3303'];

const decode = (ticket: string): Record<string, unknown> => {
  const [header, payload, signature] = ticket.split('.');
  const expected = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url');

  expect(signature).toBe(expected);

  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
};

const request = (url: string, origin: string | undefined = ORIGINS[0], method = 'GET'): ReturnType<typeof handleTicketRequest> =>
  handleTicketRequest({ secret: SECRET, origins: ORIGINS, origin, method, url });

describe('ticketClaimsFor', () => {
  // Must match userConfig() in index.html, or history names the wrong person.
  it('builds the user id the way the playground does', () => {
    expect(ticketClaimsFor(new URLSearchParams('name=%20Anna%20'))).toEqual({ user: 'playground-anna', write: true });
  });

  it('falls back to the anonymous playground user', () => {
    expect(ticketClaimsFor(new URLSearchParams(''))).toEqual({ user: 'playground-user', write: true });
    expect(ticketClaimsFor(new URLSearchParams('name=%20%20'))).toEqual({ user: 'playground-user', write: true });
  });

  it('scopes the pass to a document when one is asked for', () => {
    expect(ticketClaimsFor(new URLSearchParams('name=Ben&doc=playground--page--p1'))).toEqual({
      user: 'playground-ben',
      write: true,
      doc: 'playground--page--p1',
    });
  });
});

describe('handleTicketRequest', () => {
  it('mints a signed write pass for the named user and document', () => {
    const response = request('/ticket?name=Anna&doc=playground');

    expect(response.status).toBe(200);

    const claims = decode((JSON.parse(response.body ?? '') as { ticket: string }).ticket);

    expect(claims).toMatchObject({ user: 'playground-anna', write: true, doc: 'playground' });
    expect(typeof claims.exp).toBe('number');
  });

  // Uploads and link previews share one pass with no document in it.
  it('mints a pass with no doc claim when no document is asked for', () => {
    const claims = decode((JSON.parse(request('/ticket?name=Anna').body ?? '') as { ticket: string }).ticket);

    expect(claims).not.toHaveProperty('doc');
  });

  it('lets a playground origin read the answer', () => {
    const response = request('/ticket', 'http://127.0.0.1:3303');

    expect(response.headers['Access-Control-Allow-Origin']).toBe('http://127.0.0.1:3303');
    expect(response.headers.Vary).toBe('Origin');
  });

  it('gives no CORS grant to another origin', () => {
    expect(request('/ticket', 'https://evil.example').headers).not.toHaveProperty('Access-Control-Allow-Origin');
  });

  it('answers 404 for any other path and 405 for other methods', () => {
    expect(request('/other').status).toBe(404);
    expect(request('/ticket', ORIGINS[0], 'POST').status).toBe(405);
  });
});
