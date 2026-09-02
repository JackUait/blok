import { afterEach, describe, expect, it, vi } from 'vitest';
import { blokTicket } from './ticket';

const SECRET = 's3cret-value-at-least-32-chars-long!';

interface TicketPayload {
  user: string;
  doc?: string;
  write: boolean;
  exp: number;
}

/**
 * @param segment - the base64url payload segment of a minted pass
 */
const decodePayload = (segment: string): TicketPayload =>
  JSON.parse(Buffer.from(segment, 'base64url').toString()) as TicketPayload;

afterEach(() => {
  vi.useRealTimers();
});

describe('blokTicket', () => {
  it('produces three base64url segments', () => {
    const parts = blokTicket(SECRET, { user: 'u1' }).split('.');

    expect(parts).toHaveLength(3);
    for (const part of parts) {
      expect(part).not.toMatch(/[+/=]/);
    }
  });

  it('declares HS256, which is the only algorithm the service accepts', () => {
    const [header] = blokTicket(SECRET, { user: 'u1' }).split('.');

    expect(JSON.parse(Buffer.from(header, 'base64url').toString()) as unknown)
      .toEqual({ alg: 'HS256', typ: 'JWT' });
  });

  it('carries the claims and a default five-minute expiry', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const [, payload] = blokTicket(SECRET, { user: 'u1', doc: 'doc-42', write: true }).split('.');
    const claims = decodePayload(payload);

    expect(claims).toMatchObject({ user: 'u1', doc: 'doc-42', write: true });
    expect(claims.exp).toBe(Math.floor(Date.parse('2026-01-01T00:00:00Z') / 1000) + 300);
  });

  it('honours an explicit ttl', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const [, payload] = blokTicket(SECRET, { user: 'u1', ttlSeconds: 60 }).split('.');

    expect(decodePayload(payload).exp)
      .toBe(Math.floor(Date.parse('2026-01-01T00:00:00Z') / 1000) + 60);
  });

  it('refuses a secret shorter than the service will accept', () => {
    expect(() => blokTicket('short', { user: 'u1' })).toThrow(/32/);
  });

  it('produces a different signature for a different secret', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const a = blokTicket(SECRET, { user: 'u1' });
    const b = blokTicket('another-secret-that-is-long-enough!!', { user: 'u1' });

    expect(a.split('.')[2]).not.toBe(b.split('.')[2]);
  });

  // The verifier compares the ENCODED header segment against a hard-coded
  // constant, ordinally. Reordering these keys or adding a space is rejected.
  it('emits the exact header segment the verifier compares against', () => {
    expect(blokTicket(SECRET, { user: 'u1' }).split('.')[0])
      .toBe('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
  });

  it('omits doc when no document was named, rather than sending an empty one', () => {
    const [, payload] = blokTicket(SECRET, { user: 'u1' }).split('.');

    expect(decodePayload(payload)).not.toHaveProperty('doc');
  });
});
