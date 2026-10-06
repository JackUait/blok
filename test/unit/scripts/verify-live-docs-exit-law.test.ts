// @vitest-environment node
/**
 * The live-docs smoke test must end the process, not merely finish its checks.
 *
 * Node's `fetch` leaves its HTTP keep-alive socket open and undici holds it with
 * a ref'd timer for up to ten minutes, so a script that only awaits its work
 * sits idle until something kills it. Measured 2026-09-16 against the live site:
 * twelve seconds of checks, 604 seconds of wall clock. In CI that is past
 * `timeout-minutes: 10`, so the deploy job was cancelled with every check
 * already printed `ok` and the site already live.
 *
 * verify-live-docs-cli.test.ts drives the script end to end, but it cannot
 * catch this: with local servers the child exits quickly even without the
 * explicit exit (checked by removing it; that suite stayed green), so the hang
 * needs the real host. Hence a source-level pin, for the pass and fail paths.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../../../scripts/verify-live-docs.mjs'), 'utf8');

describe('verify-live-docs', () => {
  it('exits when its checks end, pass or fail, instead of waiting out the socket', () => {
    expect(source).toMatch(/await main\(\);[\s\S]*process\.exit\(failed \? 1 : 0\)/);
  });
});
