// @vitest-environment node
/**
 * An embed exported as a link must not wear a name its URL does not back.
 * The stored `service` is free text in saved JSON, so it is the link text
 * only when the source really matches that registry service. Anything else
 * shows the source URL: `{ service: 'accounts.google.com', source: <phishing
 * page> }` must not read as a Google link.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { blocksToHtml, blocksToMarkdown } from '../../../src/view';
import type { OutputData } from '../../../types';

const PHISH = 'https://evil.example.test/phish';
const TWEET = 'https://twitter.com/jack/status/20';

const doc = (data: Record<string, unknown>): OutputData => ({ blocks: [{ id: 'e', type: 'embed', data }] });

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('embed link text in exports', () => {
  it('HTML: an unknown service on another site shows the source URL', () => {
    const html = blocksToHtml(doc({ service: 'accounts.google.com', source: PHISH }));

    expect(html).toBe(`<a href="${PHISH}">${PHISH}</a>`);
  });

  it('Markdown: an unknown service on another site shows the source URL', () => {
    const md = blocksToMarkdown(doc({ service: 'accounts.google.com', source: PHISH }));

    expect(md).toBe(`[${PHISH}](${PHISH})`);
  });

  it('Markdown: a registry service whose source does not match shows the source URL', () => {
    const md = blocksToMarkdown(doc({ service: 'youtube', source: PHISH }));

    expect(md).toBe(`[${PHISH}](${PHISH})`);
  });

  it('HTML: a script widget whose source matches keeps its service name', () => {
    const html = blocksToHtml(doc({ service: 'twitter', source: TWEET }));

    expect(html).toBe(`<a href="${TWEET}">twitter</a>`);
  });

  it('Markdown: a registry block whose source matches keeps its service name', () => {
    const md = blocksToMarkdown(doc({ service: 'youtube', source: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }));

    expect(md).toBe('[youtube](https://www.youtube.com/watch?v=dQw4w9WgXcQ)');
  });

  it('Markdown: a caption is still the link text', () => {
    const md = blocksToMarkdown(doc({ service: 'accounts.google.com', source: PHISH, caption: 'My talk' }));

    expect(md).toBe(`[My talk](${PHISH})`);
  });
});
