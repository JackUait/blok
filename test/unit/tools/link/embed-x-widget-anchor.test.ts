import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Embed, type EmbedData } from '../../../../src/tools/link/embed';
import type { API, BlockToolConstructorOptions } from '../../../../types';
import type { MenuConfigItem } from '../../../../types/tools/menu-config';

const mount = (source: string, readOnly = true): { tool: Embed; root: HTMLElement } => {
  const options = {
    api: {
      i18n: { t: (key: string) => key, has: () => false, getLocale: () => 'en' },
      blocks: { delete: (): void => undefined },
      config: {},
    } as unknown as API,
    block: { id: 'embed-block', dispatchChange: (): void => undefined } as never,
    config: {},
    readOnly,
    data: { service: 'twitter', source, embed: 'https://twitter.com/i/status/20', kind: 'script' },
  } as BlockToolConstructorOptions<EmbedData>;
  const tool = new Embed(options);

  return { tool, root: tool.render() };
};

const widgetScript = (root: HTMLElement): Element | null =>
  root.querySelector('script[src*="platform.twitter.com"]');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Embed — the X widget loads only for an https X source', () => {
  it.each([
    ['a source with no scheme', 'x.com/jack/status/20'],
    ['an http source', 'http://twitter.com/jack/status/20'],
  ])('shows a link card for %s, not widgets.js', (_name, source) => {
    const { root } = mount(source);

    expect(widgetScript(root)).toBeNull();
    expect(root.querySelector('blockquote')).toBeNull();
    expect(root.querySelector('[data-role="embed-link-card-anchor"]')?.getAttribute('href'))
      .toBe('https://twitter.com/i/status/20');
  });

  it('opens the https post, not a path on the editor, from "Open original"', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { tool } = mount('x.com/jack/status/20', false);
    const items = tool.renderSettings() as MenuConfigItem[];
    const openOriginal = items.find((item) => 'name' in item && item.name === 'embed-open-original');

    expect(openOriginal).toBeDefined();
    (openOriginal as { onActivate: () => void }).onActivate();

    expect(open).toHaveBeenCalledWith('https://twitter.com/i/status/20', '_blank', 'noopener,noreferrer');
  });

  it('still loads the widget for an https X source', () => {
    const { root } = mount('https://x.com/jack/status/20');

    expect(widgetScript(root)).not.toBeNull();
    expect(root.querySelector('blockquote.twitter-tweet a')?.getAttribute('href')).toBe('https://x.com/jack/status/20');
  });
});
