import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Embed, type EmbedData } from '../../../../src/tools/link/embed';
import { GENERIC_IFRAME_SANDBOX } from '../../../../src/shared/embed-frame';
import type { API, BlockToolConstructorOptions } from '../../../../types';
import type { BlokConfig } from '../../../../types/configs/blok-config';

type LinkPaste = NonNullable<BlokConfig['linkPaste']>;

const t = (key: string, params?: Record<string, string | number>): string =>
  params === undefined ? key : `${key} ${JSON.stringify(params)}`;

const mount = (
  data: Partial<EmbedData>,
  linkPaste: LinkPaste = { allowGenericEmbed: true },
  readOnly = true
): { tool: Embed; root: HTMLElement } => {
  const options = {
    api: {
      i18n: { t, has: () => false, getLocale: () => 'en' },
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

const loadButton = (root: HTMLElement): HTMLButtonElement | null =>
  root.querySelector<HTMLButtonElement>('button[data-role="embed-load"]');

/** Every attribute value in the block, to prove no URL of the framed site is in the DOM yet. */
const attributeValues = (root: HTMLElement): string[] =>
  Array.from(root.querySelectorAll('*')).flatMap((el) => Array.from(el.attributes).map((attr) => attr.value));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Embed — generic embeds wait for a click before loading', () => {
  it('creates no frame and no request to the site until the reader clicks', () => {
    const { root } = mount(generic('https://third.party.test/page'));

    expect(root.querySelector('iframe')).toBeNull();
    expect(attributeValues(root).some((value) => value.includes('third.party.test'))).toBe(false);
    expect(loadButton(root)?.textContent).toBe('tools.embed.loadFrom {"host":"third.party.test"}');
  });

  it('names the real host in punycode, with its port', () => {
    const { root } = mount(generic('https://пример.рф:8443/x'));
    const host = 'xn--e1afmkfd.xn--p1ai:8443';

    expect(root.querySelector('[data-role="embed-load-host"]')?.textContent).toBe(host);
    expect(loadButton(root)?.textContent).toBe(`tools.embed.loadFrom {"host":"${host}"}`);
  });

  it('loads the strict generic frame on click, in read-only mode too', () => {
    const { root } = mount(generic('https://third.party.test/page'));

    loadButton(root)?.click();

    const frame = root.querySelector('iframe');

    expect(frame?.getAttribute('src')).toBe('https://third.party.test/page');
    expect(frame?.getAttribute('sandbox')).toBe(GENERIC_IFRAME_SANDBOX);
    expect(loadButton(root)).toBeNull();
  });

  it('keeps the frame loaded when the caption is toggled or read-only flips', () => {
    const { tool, root } = mount(generic('https://third.party.test/page'), { allowGenericEmbed: true }, false);

    loadButton(root)?.click();
    tool.setReadOnly(true);
    tool.setReadOnly(false);

    expect(root.querySelector('iframe')).not.toBeNull();
    expect(loadButton(root)).toBeNull();
  });

  it('never saves the click', () => {
    const { tool, root } = mount(generic('https://third.party.test/page'));
    const before = tool.save();

    loadButton(root)?.click();

    expect(tool.save()).toEqual(before);
  });

  it('frames at once when the host sets genericEmbedClickToLoad: false', () => {
    const { root } = mount(generic('https://third.party.test/page'), {
      allowGenericEmbed: true,
      genericEmbedClickToLoad: false,
    });

    expect(root.querySelector('iframe')?.getAttribute('src')).toBe('https://third.party.test/page');
    expect(loadButton(root)).toBeNull();
  });

  it('leaves registry embeds alone', () => {
    const { root } = mount({
      service: 'youtube',
      source: 'https://youtu.be/dQw4w9WgXcQ',
      embed: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
    });

    expect(root.querySelector('iframe')).not.toBeNull();
    expect(loadButton(root)).toBeNull();
  });
});
