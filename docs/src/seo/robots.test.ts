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

  // RFC 9309 §2.2.2: a crawler obeys the most specific group matching its token
  // and ignores every other group. Consecutive `User-agent` lines share one rule
  // block, so a Content-Signal under `*` alone reaches none of the named agents
  // it was written for — it is read by exactly the crawlers it does not address.
  it('repeats the signal in every group, since a named crawler reads only its own', () => {
    const silent: string[] = [];
    let agents: string[] = [];
    let rules: string[] = [];

    const flush = () => {
      if (agents.length === 0) return;
      const signalled = rules.some(
        (rule) => rule === 'Content-Signal: search=yes, ai-input=yes, ai-train=yes',
      );
      if (!signalled) silent.push(...agents);
      agents = [];
      rules = [];
    };

    for (const raw of ROBOTS.split('\n')) {
      const line = raw.trim();
      if (line === '' || line.startsWith('#')) continue;
      if (line.startsWith('User-agent:')) {
        // A rule already seen means the previous group ended here.
        if (rules.length > 0) flush();
        agents.push(line.slice('User-agent:'.length).trim());
        continue;
      }
      if (line.startsWith('Sitemap:')) continue;
      rules.push(line);
    }
    flush();

    expect(
      silent,
      'these user agents match a group with no Content-Signal, so they never see one',
    ).toEqual([]);
  });

  it('names the sitemap at the production origin', () => {
    expect(ROBOTS).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
  });
});
