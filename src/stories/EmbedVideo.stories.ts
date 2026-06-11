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
  vimeo: 'https://vimeo.com/123456789',
  vimeoshowcase: 'https://vimeo.com/showcase/7008490',
  vimeoevent: 'https://vimeo.com/event/5285353',
  rutube: 'https://rutube.ru/video/abcdef0123456789abcdef0123456789/',
  vkvideo: 'https://vk.com/video-12345_67890',
  loom: 'https://www.loom.com/share/e5b8c04bca094dd8a5507925ab887002',
  streamable: 'https://streamable.com/moo',
  tiktok: 'https://www.tiktok.com/@javiercazarez/video/7469789434322455863',
  wistia: 'https://support.wistia.com/medias/h1z3uqsjal',
  vidyard: 'https://share.vidyard.com/watch/h2NqLfsfpLszhtLg1mXnAZ',
  giphy: 'https://giphy.com/gifs/lustig-witzig-funny-reaction-cJhDKXoHvzahcGPgiK',
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
