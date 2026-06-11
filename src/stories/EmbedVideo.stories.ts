import type { Meta, StoryObj } from '@storybook/html-vite';

import { Embed, type EmbedData } from '../tools/link/embed';
import { EMBED_SERVICES, matchEmbedService } from '../tools/link/registry';

import { createEditorContainer } from './helpers';
import type { EditorFactoryOptions } from './helpers';

import type { OutputData } from '@/types';

interface EmbedVideoArgs extends EditorFactoryOptions {
  minHeight: number;
  data: OutputData | undefined;
}

const DEFAULT_WIDTH = 580;
const DEFAULT_HEIGHT = 320;

/**
 * One canonical sample URL per video embed service. Each URL mirrors a
 * positive sample proven to match in test/unit/tools/link/registry.test.ts.
 */
const VIDEO_SAMPLES = {
  youtube: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  youtubeplaylist: 'https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf',
  vimeo: 'https://vimeo.com/76979871',
  vimeoshowcase: 'https://vimeo.com/showcase/7008490',
  vimeoevent: 'https://vimeo.com/event/1082764',
  rutube: 'https://rutube.ru/video/2d6e5b618ad70e0995f52f5e1276a07d/',
  vkvideo: 'https://vk.com/video_ext.php?oid=-22822305&id=456243154&hash=a53d5925ac2b0d7584',
  loom: 'https://www.loom.com/share/e5b8c04bca094dd8a5507925ab887002',
  streamable: 'https://streamable.com/moo',
  tiktok: 'https://www.tiktok.com/@javiercazarez/video/7469789434322455863',
  wistia: 'https://support.wistia.com/medias/h1z3uqsjal',
  vidyard: 'https://share.vidyard.com/watch/h2NqLfsfpLszhtLg1mXnAZ',
  giphy: 'https://giphy.com/gifs/lustig-witzig-funny-reaction-cJhDKXoHvzahcGPgiK',
  ted: 'https://www.ted.com/talks/amy_cuddy_your_body_language_may_shape_who_you_are',
  internetarchive: 'https://archive.org/details/BigBuckBunny_124',
  kick: 'https://kick.com/xqc',
  peertube: 'https://framatube.org/w/kkGMgK9ZtnKfYAgnEtQxbv',
  odysee: 'https://odysee.com/@veritasium:f/how-electricity-actually-works:b',
  soop: 'https://vod.sooplive.co.kr/player/189220507',
  coub: 'https://coub.com/view/17txps',
  bitchute: 'https://www.bitchute.com/video/VAD9enZVfmf5/',
} as const;

type VideoService = keyof typeof VIDEO_SAMPLES;

/**
 * Builds the embed block data for a service exactly as Embed.onPaste would
 * after the sample URL is pasted. Throws at module init if the sample URL
 * stopped matching its registry entry.
 */
const buildEmbedBlockData = (service: VideoService): EmbedData => {
  const source = VIDEO_SAMPLES[service];
  const match = matchEmbedService(source);

  if (match === null) {
    throw new Error(`Sample URL for "${service}" no longer matches the embed registry: ${source}`);
  }

  if (match.service !== service) {
    throw new Error(`Sample URL for "${service}" matched "${match.service}" instead: ${source}`);
  }

  const config = EMBED_SERVICES[match.service];

  return {
    service: match.service,
    source,
    embed: match.embedUrl,
    kind: match.kind,
    width: config.width ?? DEFAULT_WIDTH,
    height: config.height ?? DEFAULT_HEIGHT,
  };
};

/**
 * Wraps a single embed block for a service into editor OutputData.
 */
const createEmbedData = (service: VideoService): OutputData => ({
  time: Date.now(),
  version: '1.0.0',
  blocks: [
    {
      id: `embed-${service}`,
      type: 'embed',
      data: buildEmbedBlockData(service),
    },
  ],
});

/**
 * Creates an editor container with the Embed tool registered.
 */
const createEditor = (args: EmbedVideoArgs): HTMLElement => createEditorContainer({
  ...args,
  tools: {
    embed: { class: Embed },
  },
});

const meta: Meta<EmbedVideoArgs> = {
  title: 'Tools/Embed/Video',
  tags: ['autodocs'],
  args: {
    minHeight: 450,
    data: createEmbedData('youtube'),
  },
  render: createEditor,
};

export default meta;

type Story = StoryObj<EmbedVideoArgs>;

/**
 * Builds a story rendering one live embed block for the given service.
 */
const createServiceStory = (service: VideoService): Story => ({
  args: {
    data: createEmbedData(service),
  },
});

export const Youtube: Story = createServiceStory('youtube');

export const YoutubePlaylist: Story = createServiceStory('youtubeplaylist');

export const Vimeo: Story = createServiceStory('vimeo');

export const VimeoShowcase: Story = createServiceStory('vimeoshowcase');

export const VimeoEvent: Story = createServiceStory('vimeoevent');

export const Rutube: Story = createServiceStory('rutube');

export const VkVideo: Story = createServiceStory('vkvideo');

export const Loom: Story = createServiceStory('loom');

export const Streamable: Story = createServiceStory('streamable');

export const TikTok: Story = createServiceStory('tiktok');

export const Wistia: Story = createServiceStory('wistia');

export const Vidyard: Story = createServiceStory('vidyard');

export const Giphy: Story = createServiceStory('giphy');

/** Talk URLs are rewritten onto the dedicated embed.ted.com host. */
export const Ted: Story = createServiceStory('ted');

/** /details/<item> pages are rewritten to the /embed/<item> player on the same host. */
export const InternetArchive: Story = createServiceStory('internetarchive');

/** Channel URLs embed via the separate player.kick.com host with autoplay disabled. */
export const Kick: Story = createServiceStory('kick');

/** Federated: only a curated host allowlist matches, and the instance host is part of the remote id. */
export const PeerTube: Story = createServiceStory('peertube');

/** Claim paths (with :claim-id suffixes) are embedded via the $/embed app route. */
export const Odysee: Story = createServiceStory('odysee');

/** Regional sooplive.co.kr and legacy afreecatv.com VOD hosts normalize onto vod.sooplive.com. */
export const Soop: Story = createServiceStory('soop');

/** /view/<id> permalinks are rewritten to the /embed/<id> player path. */
export const Coub: Story = createServiceStory('coub');

/** /video/<id> pages are rewritten to /embed/<id>/ on the canonical www host. */
export const BitChute: Story = createServiceStory('bitchute');
