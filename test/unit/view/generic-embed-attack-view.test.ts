// @vitest-environment node
/**
 * Hostile saved embed data through the headless renderers (blocksToHtml, which
 * the React view, the Go/C#/Rust server runtime and blocksToViewNodes all use,
 * and blocksToMarkdown).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { blocksToHtml, blocksToMarkdown, blocksToViewNodes } from '../../../src/view';
import type { OutputData } from '../../../types';

const EVIL = 'https://evil.attacker.test/phish';
const YT_WATCH = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

const doc = (data: Record<string, unknown>): OutputData => ({ blocks: [{ id: 'e', type: 'embed', data }] });

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('generic and spoofed embeds', () => {
  it('a generic embed (service "") is a link, never an iframe', () => {
    const html = blocksToHtml(doc({ service: '', source: EVIL, embed: EVIL, kind: 'iframe' }));

    expect(html).not.toContain('<iframe');
    expect(html).toContain(`href="${EVIL}"`);
  });

  it('youtube service with attacker source renders nothing', () => {
    const html = blocksToHtml(doc({ service: 'youtube', source: EVIL, embed: EVIL }));

    expect(html).not.toContain('evil.attacker.test');
    expect(html).not.toContain('<iframe');
  });

  it('youtube service with a real source ignores the stored embed field', () => {
    const html = blocksToHtml(doc({ service: 'youtube', source: YT_WATCH, embed: EVIL }));

    expect(html).toContain('src="https://www.youtube');
    expect(html).not.toContain('evil.attacker.test');
  });

  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])('service %s is a link, not a frame', (service) => {
    const html = blocksToHtml(doc({ service, source: EVIL, embed: EVIL }));

    expect(html).not.toContain('<iframe');
  });

  it.each([123, { a: 1 }, [EVIL], null, true])('non-string source %j does not throw', (source) => {
    expect(() => blocksToHtml(doc({ service: '', source, embed: EVIL }))).not.toThrow();
    expect(() => blocksToHtml(doc({ service: 'youtube', source, embed: EVIL }))).not.toThrow();
    expect(() => blocksToMarkdown(doc({ service: '', source, embed: EVIL }))).not.toThrow();
  });

  it('caption and service with HTML are escaped', () => {
    const payload = '<img src=x onerror=alert(1)><iframe src="https://evil.attacker.test"></iframe>';
    const html = blocksToHtml(doc({ service: payload, source: EVIL, caption: payload }))
      + blocksToHtml(doc({ service: 'youtube', source: YT_WATCH, caption: payload }));

    expect(html).not.toContain('<img');
    expect(html.match(/<iframe/g)?.length ?? 0).toBe(1);
  });

  it('view nodes keep the sandbox on registry frames', () => {
    const nodes = JSON.stringify(blocksToViewNodes(doc({ service: 'youtube', source: YT_WATCH })));

    expect(nodes).toContain('"sandbox"');
  });
});

describe('hostile transformUrl', () => {
  it('a transformUrl result with a non-https scheme drops the frame', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'http://evil.attacker.test/', 'https:/evil', '//evil.attacker.test/x', ' https://evil.attacker.test']) {
      const html = blocksToHtml(doc({ service: 'youtube', source: YT_WATCH }), { transformUrl: () => bad });

      expect(html).not.toContain('<iframe src=');
    }
  });

  it('a transformUrl result with quotes cannot break out of the attribute', () => {
    const html = blocksToHtml(doc({ service: 'youtube', source: YT_WATCH }), {
      transformUrl: () => 'https://x.test/" onload="alert(1)',
    });

    expect(html).not.toContain('" onload="');
  });

});

describe('generic embeds export as links', () => {
  it('generic embed → link, caption HTML escaped, no raw iframe', () => {
    const md = blocksToMarkdown(doc({ service: '', source: EVIL, caption: '<iframe src="https://evil.attacker.test"></iframe>' }));

    expect(md).not.toMatch(/<iframe/i);
    expect(md).toContain(EVIL);
  });

  it('javascript: source does not become a markdown link', () => {
    const md = blocksToMarkdown(doc({ service: '', source: 'javascript:alert(1)' }));

    expect(md).not.toContain('](javascript:');
  });
});
