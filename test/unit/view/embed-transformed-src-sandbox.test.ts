// @vitest-environment node
/**
 * A registry player frame gets a looser sandbox (`allow-same-origin`, popups
 * that escape) because the registry knows its origin. A `transformUrl` that
 * moves the frame to another origin, say a proxy on the host's own site,
 * must not keep it: `allow-scripts allow-same-origin` on the page's own
 * origin lifts the sandbox.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { blocksToHtml, blocksToViewNodes } from '../../../src/view';
import { GENERIC_IFRAME_SANDBOX, PLAYER_IFRAME_SANDBOX } from '../../../src/shared/embed-frame';
import type { OutputData } from '../../../types';

const YT_WATCH = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const youtube: OutputData = { blocks: [{ id: 'e', type: 'embed', data: { service: 'youtube', source: YT_WATCH } }] };

const sandboxOf = (html: string): string | undefined => /sandbox="([^"]*)"/.exec(html)?.[1];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('embed frame sandbox after transformUrl', () => {
  it.each([
    ['a proxy on another host', (url: string) => `https://proxy.host.test/?u=${encodeURIComponent(url)}`],
    ['a lookalike host', () => 'https://www.youtube.com.evil.test/embed/x'],
    ['userinfo before another host', () => 'https://www.youtube.com@evil.test/embed/x'],
    ['another port', () => 'https://www.youtube.com:8443/embed/x'],
  ])('%s gets the generic sandbox', (_label, transformUrl) => {
    const html = blocksToHtml(youtube, { transformUrl });

    expect(sandboxOf(html)).toBe(GENERIC_IFRAME_SANDBOX);
    expect(html).toContain('<iframe src="https://');
  });

  it('a rewrite that keeps the provider origin keeps the player sandbox', () => {
    const html = blocksToHtml(youtube, { transformUrl: (url) => `${url}&rel=0` });

    expect(sandboxOf(html)).toBe(PLAYER_IFRAME_SANDBOX);
  });

  it('no transformUrl keeps the player sandbox', () => {
    expect(sandboxOf(blocksToHtml(youtube))).toBe(PLAYER_IFRAME_SANDBOX);
  });

  it('view nodes get the generic sandbox for a proxy too', () => {
    const nodes = JSON.stringify(blocksToViewNodes(youtube, { transformUrl: () => 'https://proxy.host.test/x' }));

    expect(nodes).toContain(GENERIC_IFRAME_SANDBOX);
    expect(nodes).not.toContain('allow-same-origin');
  });
});
