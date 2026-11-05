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

describe('Embed — a loaded generic frame has no host line above it', () => {
  it('shows only the frame', () => {
    const { root } = mount(generic('https://third.party.test/page'));

    expect(hostLabel(root)).toBeNull();
    expect(root.querySelector('iframe')).not.toBeNull();
  });

  it('adds no host line once the reader loads a click-to-load embed', () => {
    const { root } = mount(generic('https://third.party.test/page'), { allowGenericEmbed: true });

    root.querySelector<HTMLButtonElement>('button[data-role="embed-load"]')?.click();

    expect(root.querySelector('iframe')).not.toBeNull();
    expect(hostLabel(root)).toBeNull();
  });
});
