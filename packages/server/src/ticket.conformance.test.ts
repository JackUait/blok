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
  docMismatch: string;
  readOnly: string;
}

const fixtures = JSON.parse(readFileSync(FIXTURES, 'utf-8')) as TicketFixtures;

// The claims baked into the fixture passes.
const EXPIRES_AT_SECONDS = 4102444800;

afterEach(() => {
  vi.useRealTimers();
});

describe('blokTicket conformance', () => {
  it('reproduces the pass the verifier accepts, byte for byte', () => {
    vi.useFakeTimers().setSystemTime(0);

    const minted = blokTicket(fixtures.secret, {
      user: 'u1',
      doc: 'doc-42',
      write: true,
      ttlSeconds: EXPIRES_AT_SECONDS,
    });

    expect(minted).toBe(fixtures.compatible);
  });

  it('reproduces the pass naming a different document, byte for byte', () => {
    vi.useFakeTimers().setSystemTime(0);

    const minted = blokTicket(fixtures.secret, {
      user: 'u1',
      doc: 'other-doc',
      write: true,
      ttlSeconds: EXPIRES_AT_SECONDS,
    });

    expect(minted).toBe(fixtures.docMismatch);
  });

  it('reproduces the read-only pass, byte for byte', () => {
    vi.useFakeTimers().setSystemTime(0);

    const minted = blokTicket(fixtures.secret, {
      user: 'u1',
      doc: 'doc-42',
      write: false,
      ttlSeconds: EXPIRES_AT_SECONDS,
    });

    expect(minted).toBe(fixtures.readOnly);
  });
});
