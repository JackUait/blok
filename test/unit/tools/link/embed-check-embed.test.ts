import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Embed, type EmbedData } from '../../../../src/tools/link/embed';
import { CHECK_EMBED_TIMEOUT_MS } from '../../../../src/tools/link/check-embed';
import type { API, BlockToolConstructorOptions } from '../../../../types';
import type { BlokConfig } from '../../../../types/configs/blok-config';

type LinkPaste = NonNullable<BlokConfig['linkPaste']>;

const insertMock = vi.fn();
const notifyMock = vi.fn();
const roots: HTMLElement[] = [];

const mount = (linkPaste: LinkPaste, blockTools: string[] = ['embed', 'bookmark']): { tool: Embed; root: HTMLElement } => {
  const options = {
    api: {
      i18n: { t: (key: string) => key, has: () => false, getLocale: () => 'en' },
      blocks: { delete: (): void => undefined, insert: insertMock, getBlockIndex: () => 4 },
      notifier: { show: notifyMock },
      tools: { getBlockTools: () => blockTools.map((name) => ({ name })) },
      config: { linkPaste },
    } as unknown as API,
    block: { id: 'embed-block', dispatchChange: (): void => undefined } as never,
    config: {},
    readOnly: false,
    data: {} as EmbedData,
  } as BlockToolConstructorOptions<EmbedData>;
  const tool = new Embed(options);
  const root = tool.render();

  document.body.appendChild(root);
  roots.push(root);

  return { tool, root };
};

const submit = async (root: HTMLElement, url: string): Promise<void> => {
  const input = root.querySelector<HTMLInputElement>('[data-role="embed-url-input"]');
  const form = root.querySelector<HTMLFormElement>('[data-role="embed-url-form"]');

  if (input === null || form === null) {
    throw new Error('no URL form');
  }

  input.value = url;
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await vi.advanceTimersByTimeAsync(CHECK_EMBED_TIMEOUT_MS + 10);
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  roots.splice(0).forEach((root) => root.remove());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Embed URL input — the host frame check', () => {
  it.each(['blocked', 'insecure'] as const)('swaps the block for a bookmark with a notice on %s', async (verdict) => {
    const checkEmbed = vi.fn(async () => ({ verdict }));
    const { tool, root } = mount({ allowGenericEmbed: true, checkEmbed });

    await submit(root, 'https://dash.example.org/q3');

    expect(checkEmbed).toHaveBeenCalledWith('https://dash.example.org/q3');
    expect(insertMock).toHaveBeenCalledWith('bookmark', { url: 'https://dash.example.org/q3' }, undefined, 4, true, true);
    expect(notifyMock).toHaveBeenCalledWith({ message: 'tools.embed.checkBlocked' });
    expect(tool.save().source).toBe('');
  });

  it.each(['allowed', 'unknown'] as const)('embeds as usual on %s, and saves no verdict', async (verdict) => {
    const { tool, root } = mount({ allowGenericEmbed: true, checkEmbed: async () => ({ verdict }) });

    await submit(root, 'https://dash.example.org/q3');

    expect(insertMock).not.toHaveBeenCalled();
    expect(tool.save()).toEqual({
      service: '',
      source: 'https://dash.example.org/q3',
      embed: 'https://dash.example.org/q3',
      kind: 'iframe',
      width: 580,
      height: 320,
    });
  });

  it('embeds as usual when the check never answers', async () => {
    const { tool, root } = mount({ allowGenericEmbed: true, checkEmbed: () => new Promise(() => undefined) });

    await submit(root, 'https://dash.example.org/q3');

    expect(tool.save().source).toBe('https://dash.example.org/q3');
  });

  it('does not ask about a registry provider', async () => {
    const checkEmbed = vi.fn(async () => ({ verdict: 'blocked' as const }));
    const { tool, root } = mount({ checkEmbed });

    await submit(root, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    expect(checkEmbed).not.toHaveBeenCalled();
    expect(tool.save().service).toBe('youtube');
  });

  it('never lets "allowed" embed a host the rules refuse', async () => {
    const checkEmbed = vi.fn(async () => ({ verdict: 'allowed' as const }));
    const { tool, root } = mount({ allowGenericEmbed: true, blockedEmbedOrigins: ['dash.example.org'], checkEmbed });

    await submit(root, 'https://dash.example.org/q3');

    expect(checkEmbed).not.toHaveBeenCalled();
    expect(tool.save().source).toBe('');
    expect(root.querySelector('[data-role="embed-url-error"]')).not.toBeNull();
  });

  it('drops a late answer once the user has typed another URL', async () => {
    const { tool, root } = mount({
      allowGenericEmbed: true,
      checkEmbed: async () => {
        const input = root.querySelector<HTMLInputElement>('[data-role="embed-url-input"]');

        if (input !== null) {
          input.value = 'https://other.example.org/';
        }

        return { verdict: 'blocked' };
      },
    });

    await submit(root, 'https://dash.example.org/q3');

    expect(insertMock).not.toHaveBeenCalled();
    expect(tool.save().source).toBe('');
  });

  it('keeps the form and says the link cannot be embedded when there is no bookmark tool', async () => {
    const { tool, root } = mount({ allowGenericEmbed: true, checkEmbed: async () => ({ verdict: 'blocked' }) }, ['embed']);

    await submit(root, 'https://dash.example.org/q3');

    expect(insertMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
    expect(tool.save().source).toBe('');
    expect(root.querySelector('[data-role="embed-url-error"]')).not.toBeNull();
  });
});
