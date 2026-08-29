import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { blokTicket } from './ticket';

/**
 * The same fixture the C# verifier's suites read. One file, two readers: a
 * signer that agrees only with its own tests proves nothing, and byte equality
 * catches a drift in header bytes or payload key order here rather than in
 * production. Copies under any `bin/` directory are build output.
 */
const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../test/unit/server-conformance/fixtures/tickets.json'
);

interface TicketFixtures {
  secret: string;
  compatible: string;
}

const fixtures = JSON.parse(readFileSync(FIXTURES, 'utf-8')) as TicketFixtures;

// The claims baked into the fixture's `compatible` pass.
const EXPIRES_AT_SECONDS = 4102444800;

/**
 * Signs a payload the way the service expects, spelled out rather than reused
 * from `blokTicket`: the fixture carries a `doc` claim the minting API no
 * longer offers, and it is a released wire the verifier must keep accepting.
 * @param payload - the exact payload JSON, key order included
 */
function signLiterally(payload: string): string {
  const b64 = (value: string): string => Buffer.from(value, 'utf-8').toString('base64url');
  const signing = `${b64('{"alg":"HS256","typ":"JWT"}')}.${b64(payload)}`;

  return `${signing}.${createHmac('sha256', fixtures.secret).update(signing).digest('base64url')}`;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('blokTicket conformance', () => {
  // `blokTicket` cannot mint this one any more — `doc` left the minting API
  // because nothing enforces document scoping. The verifier stays tolerant of
  // the claim, so the fixture is pinned by constructing it literally instead;
  // deleting it would drop a case the C# suites still read.
  it('leaves the doc-carrying fixture the verifier still accepts intact', () => {
    expect(signLiterally(`{"user":"u1","doc":"doc-42","write":true,"exp":${EXPIRES_AT_SECONDS}}`))
      .toBe(fixtures.compatible);
  });

  it('reproduces the pass the verifier accepts, byte for byte', () => {
    vi.useFakeTimers().setSystemTime(0);

    const minted = blokTicket(fixtures.secret, {
      user: 'u1',
      write: true,
      ttlSeconds: EXPIRES_AT_SECONDS,
    });

    expect(minted).toBe(signLiterally(`{"user":"u1","write":true,"exp":${EXPIRES_AT_SECONDS}}`));
  });
});
