import { describe, it, expect, vi } from 'vitest';
import { buildPasteMenuItems, type PasteMenuI18n } from '../../../../src/tools/link/paste-menu/items';
import type { PasteMenuOption } from '../../../../src/tools/link/paste-menu/options';
import type { PopoverItemParams } from '../../../../types/utils/popover/popover-item';

const identityI18n: PasteMenuI18n = { t: (key: string): string => key };

/**
 * Narrows a popover item to a default-base item exposing the fields we assert on.
 * Items built here are always default items with an onActivate handler.
 */
const asDefaultItem = (
  item: PopoverItemParams
): { name?: string; title?: string; secondaryLabel?: string; icon?: string; closeOnActivate?: boolean; onActivate?: (a: unknown, b?: unknown) => void } =>
  item as { name?: string; title?: string; secondaryLabel?: string; icon?: string; closeOnActivate?: boolean; onActivate?: (a: unknown, b?: unknown) => void };

describe('buildPasteMenuItems', () => {
  it('builds one item per option, preserving order', () => {
    const options: PasteMenuOption[] = [
      { type: 'embed' },
      { type: 'bookmark' },
      { type: 'mention' },
      { type: 'plain' },
    ];

    const names = buildPasteMenuItems(options, identityI18n, vi.fn()).map(
      (item) => asDefaultItem(item).name
    );

    expect(names).toEqual([
      'paste-menu-embed',
      'paste-menu-bookmark',
      'paste-menu-mention',
      'paste-menu-plain',
    ]);
  });

  it('sets the title to the i18n label key for each type', () => {
    const options: PasteMenuOption[] = [
      { type: 'plain' },
      { type: 'bookmark' },
      { type: 'embed' },
      { type: 'mention' },
    ];

    const titles = buildPasteMenuItems(options, identityI18n, vi.fn()).map(
      (item) => asDefaultItem(item).title
    );

    expect(titles).toEqual([
      'tools.linkPaste.plain',
      'tools.linkPaste.bookmark',
      'tools.linkPaste.embed',
      'tools.linkPaste.mention',
    ]);
  });

  it('gives the bookmark option a distinct icon from the plain link option', () => {
    const options: PasteMenuOption[] = [{ type: 'plain' }, { type: 'bookmark' }];

    const [plain, bookmark] = buildPasteMenuItems(options, identityI18n, vi.fn()).map(
      (item) => asDefaultItem(item).icon
    );

    expect(plain).not.toBe(bookmark);
  });

  it('sets name, closeOnActivate and a non-empty icon for each item', () => {
    const options: PasteMenuOption[] = [
      { type: 'embed' },
      { type: 'bookmark' },
      { type: 'mention' },
      { type: 'plain' },
    ];

    const items = buildPasteMenuItems(options, identityI18n, vi.fn());

    items.forEach((rawItem, index) => {
      const item = asDefaultItem(rawItem);

      expect(item.name).toBe(`paste-menu-${options[index].type}`);
      expect(item.closeOnActivate).toBe(true);
      expect(typeof item.icon).toBe('string');
      expect(item.icon).not.toBe('');
    });
  });

  it('calls onSelect with the item action type on activation', () => {
    const onSelect = vi.fn();
    const options: PasteMenuOption[] = [
      { type: 'bookmark' },
      { type: 'embed' },
    ];

    const items = buildPasteMenuItems(options, identityI18n, onSelect);

    asDefaultItem(items[0]).onActivate?.({});
    expect(onSelect).toHaveBeenCalledWith('bookmark');

    asDefaultItem(items[1]).onActivate?.({});
    expect(onSelect).toHaveBeenCalledWith('embed');

    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  describe('embed item presentation for a recognized provider url', () => {
    const youtubeUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

    /** Resolves the per-type embed templates the way a real locale would. */
    const templateI18n: PasteMenuI18n = {
      t: (key: string): string => {
        const templates: Record<string, string> = {
          'tools.linkPaste.embedVideo': 'Embed a video from {provider}',
          'tools.linkPaste.embedAudio': 'Embed audio from {provider}',
          'tools.linkPaste.embedImage': 'Embed an image from {provider}',
          'tools.linkPaste.embedSocial': 'Embed a post from {provider}',
          'tools.linkPaste.embedDocument': 'Embed a document from {provider}',
          'tools.linkPaste.embedTable': 'Embed a table from {provider}',
          'tools.linkPaste.embedForm': 'Embed a form from {provider}',
          'tools.linkPaste.embedCode': 'Embed code from {provider}',
          'tools.linkPaste.embedDesign': 'Embed a design from {provider}',
          'tools.linkPaste.embedChart': 'Embed a chart from {provider}',
          'tools.linkPaste.embedMap': 'Embed a map from {provider}',
          'tools.linkPaste.embedCalendar': 'Embed a calendar from {provider}',
        };

        return templates[key] ?? key;
      },
    };

    it('titles the embed item with the localized type template naming the provider', () => {
      const items = buildPasteMenuItems([{ type: 'embed' }], templateI18n, vi.fn(), youtubeUrl);
      const embed = asDefaultItem(items[0]);

      expect(embed.title).toBe('Embed a video from YouTube');
      expect(embed.secondaryLabel).toBeUndefined();
    });

    it('picks the template matching the link type', () => {
      const [audio] = buildPasteMenuItems(
        [{ type: 'embed' }],
        templateI18n,
        vi.fn(),
        'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC'
      );

      expect(asDefaultItem(audio).title).toBe('Embed audio from Spotify');
    });

    it.each([
      [
        'https://vk.com/video-1_2',
        'Embed a video from VK Video',
      ],
      [
        'https://docs.google.com/forms/d/e/form-id/viewform',
        'Embed a form from Google Forms',
      ],
      [
        'https://storymaps.arcgis.com/stories/0123456789abcdef0123456789abcdef',
        'Embed a map from ArcGIS StoryMaps',
      ],
      [
        'https://www.openstreetmap.org/#map=12/51.505/-0.09',
        'Embed a map from OpenStreetMap',
      ],
      [
        'https://v.qq.com/x/page/a1b2c3.html',
        'Embed a video from Tencent Video',
      ],
      [
        'https://podcasts.apple.com/us/podcast/the-daily/id1200361736',
        'Embed audio from Apple Podcasts',
      ],
      [
        'https://giphy.com/gifs/lustig-witzig-funny-reaction-cJhDKXoHvzahcGPgiK',
        'Embed an image from GIPHY',
      ],
      [
        'https://www.reddit.com/r/programming/comments/1abc2de/some_title_slug/',
        'Embed a post from Reddit',
      ],
      [
        'https://docs.google.com/document/d/1A2b3C4d5E6f7G8h9I0jKLMNOPqrstuv/edit',
        'Embed a document from Google Docs',
      ],
      [
        'https://airtable.com/shr5EBHUmHzStubDx',
        'Embed a table from Airtable',
      ],
      [
        'https://codepen.io/team/pen/AbCdEf',
        'Embed code from CodePen',
      ],
      [
        'https://www.figma.com/design/KEY123/My-File',
        'Embed a design from Figma',
      ],
      [
        'https://www.desmos.com/calculator/qy6jc8mfi9',
        'Embed a chart from Desmos',
      ],
      [
        'https://calendly.com/acme-team',
        'Embed a calendar from Calendly',
      ],
    ])('keeps the %s provider title grammatical', (url, expected) => {
      const [item] = buildPasteMenuItems(
        [{ type: 'embed' }],
        templateI18n,
        vi.fn(),
        url
      );

      expect(asDefaultItem(item).title).toBe(expected);
    });

    it('uses a link-type icon distinct from the generic embed globe', () => {
      const [withUrl] = buildPasteMenuItems([{ type: 'embed' }], identityI18n, vi.fn(), youtubeUrl);
      const [generic] = buildPasteMenuItems([{ type: 'embed' }], identityI18n, vi.fn());

      expect(asDefaultItem(withUrl).icon).not.toBe(asDefaultItem(generic).icon);
      expect(asDefaultItem(withUrl).icon).toContain('<svg');
    });

    it('gives different link types different icons', () => {
      const [video] = buildPasteMenuItems([{ type: 'embed' }], identityI18n, vi.fn(), youtubeUrl);
      const [audio] = buildPasteMenuItems(
        [{ type: 'embed' }],
        identityI18n,
        vi.fn(),
        'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC'
      );

      expect(asDefaultItem(video).icon).not.toBe(asDefaultItem(audio).icon);
    });

    it('leaves bookmark and plain items unchanged by the url', () => {
      const withUrl = buildPasteMenuItems(
        [{ type: 'bookmark' }, { type: 'plain' }],
        identityI18n,
        vi.fn(),
        youtubeUrl
      );
      const generic = buildPasteMenuItems([{ type: 'bookmark' }, { type: 'plain' }], identityI18n, vi.fn());

      withUrl.forEach((item, index) => {
        expect(asDefaultItem(item).title).toBe(asDefaultItem(generic[index]).title);
        expect(asDefaultItem(item).icon).toBe(asDefaultItem(generic[index]).icon);
        expect(asDefaultItem(item).secondaryLabel).toBeUndefined();
      });
    });

    it('falls back to the generic embed presentation for an unrecognized url', () => {
      const [item] = buildPasteMenuItems(
        [{ type: 'embed' }],
        identityI18n,
        vi.fn(),
        'https://example.com/article'
      );
      const [generic] = buildPasteMenuItems([{ type: 'embed' }], identityI18n, vi.fn());

      expect(asDefaultItem(item).title).toBe(asDefaultItem(generic).title);
      expect(asDefaultItem(item).icon).toBe(asDefaultItem(generic).icon);
    });
  });
});
