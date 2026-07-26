import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_URL } from './route-metadata';

const DOCS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROBOTS = fs.readFileSync(path.join(DOCS_ROOT, 'public/robots.txt'), 'utf8');

/**
 * The file states the property's policy in prose ("open to every crawler,
 * including AI training and AI-answer crawlers"). `Content-Signal` is the
 * machine-readable form of that same sentence, so the two must agree.
 *
 * Cloudflare's directive (CC0) carries three orthogonal signals: `search`
 * (search results), `ai-input` (live AI answer context) and `ai-train` (model
 * training). Strict robots.txt validators warn about the unknown directive;
 * that is expected and harmless — RFC 9309 requires parsers to ignore lines
 * they do not recognise.
 */
describe('robots.txt Content-Signal', () => {
  it('grants all three signals under the catch-all group', () => {
    const catchAll = ROBOTS.split(/^User-agent:/m)
      .map((group) => group.trim())
      .find((group) => group.startsWith('*'));

    expect(catchAll).toMatch(/^Content-Signal: search=yes, ai-input=yes, ai-train=yes$/m);
  });

  it('names the sitemap at the production origin', () => {
    expect(ROBOTS).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
  });
});
