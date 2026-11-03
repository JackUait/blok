import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Embed, type EmbedData } from '../../../../src/tools/link/embed';
import type { API, BlockToolConstructorOptions } from '../../../../types';
import type { BlokConfig } from '../../../../types/configs/blok-config';

type LinkPaste = NonNullable<BlokConfig['linkPaste']>;

const mount = (
  data: Partial<EmbedData>,
  linkPaste: LinkPaste = { allowGenericEmbed: true, genericEmbedClickToLoad: false },
  readOnly = true
): { tool: Embed; root: HTMLElement } => {
  const options = {
    api: {
      i18n: { t: (key: string) => key, has: () => false, getLocale: () => 'en' },
      blocks: { delete: (): void => undefined },
      config: { linkPaste },
      events: { on: (): void => undefined, off: (): void => undefined },
    } as unknown as API,
    block: { id: 'embed-block', dispatchChange: (): void => undefined } as never,
    config: {},
    readOnly,
    data,
  } as BlockToolConstructorOptions<EmbedData>;
  const tool = new Embed(options);

  return { tool, root: tool.render() };
};

const generic = (source: string): Partial<EmbedData> => ({ service: '', source, embed: source, kind: 'iframe' });

const hostLabel = (root: HTMLElement): HTMLElement | null =>
  root.querySelector<HTMLElement>('[data-role="embed-host"]');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Embed — a loaded generic frame names its real host outside the frame', () => {
  it('shows the framed host in punycode with its port, as Blok chrome beside the frame', () => {
    const { root } = mount(generic('https://пример.рф:8443/page'));
    const label = hostLabel(root);
    const figure = root.querySelector('[data-role="embed-figure"]');

    expect(label?.textContent?.trim()).toBe('xn--e1afmkfd.xn--p1ai:8443');
    expect(label?.parentElement).toBe(figure);
    expect(label?.contains(root.querySelector('iframe'))).toBe(false);
  });

  it('appears once the reader loads a click-to-load embed', () => {
    const { root } = mount(generic('https://third.party.test/page'), { allowGenericEmbed: true });

    expect(hostLabel(root)).toBeNull();

    root.querySelector<HTMLButtonElement>('button[data-role="embed-load"]')?.click();

    expect(hostLabel(root)?.textContent?.trim()).toBe('third.party.test');
  });

  it('stays when read-only flips or the caption toggles', () => {
    const { tool, root } = mount(generic('https://third.party.test/page'), undefined, false);

    tool.setReadOnly(true);
    tool.setReadOnly(false);
    root.querySelector<HTMLButtonElement>('[data-action="caption-toggle"]')?.click();

    expect(root.querySelectorAll('[data-role="embed-host"]')).toHaveLength(1);
  });

  it('is not shown for a registry embed', () => {
    const { root } = mount({
      service: 'youtube',
      source: 'https://youtu.be/dQw4w9WgXcQ',
      embed: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
    });

    expect(root.querySelector('iframe')).not.toBeNull();
    expect(hostLabel(root)).toBeNull();
  });
});
