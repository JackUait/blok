import type { Meta, StoryObj } from '@storybook/html-vite';

import { Embed, type EmbedData } from '../tools/link/embed';
import { EMBED_SERVICES, matchEmbedService } from '../tools/link/registry';

import { createEditorContainer } from './helpers';
import type { EditorFactoryOptions } from './helpers';

import type { OutputData } from '@/types';

interface EmbedAudioArgs extends EditorFactoryOptions {
  minHeight: number;
  data: OutputData | undefined;
}

const DEFAULT_WIDTH = 580;
const DEFAULT_HEIGHT = 320;

/**
 * One canonical share URL per audio/music service, mirroring the positive
 * samples proven by test/unit/tools/link/registry.test.ts.
 */
const AUDIO_SOURCES: Record<string, string> = {
  spotify: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
  yandexmusic: 'https://music.yandex.ru/album/11904129/track/70471675',
  deezer: 'https://www.deezer.com/track/3135556',
  soundcloud: 'https://soundcloud.com/forss/flickermood',
  mixcloud: 'https://www.mixcloud.com/spartacus/party-time/',
  applemusic: 'https://music.apple.com/us/album/1989-taylors-version/1708308989',
  applepodcasts: 'https://podcasts.apple.com/us/podcast/the-daily/id1200361736',
  audiomack: 'https://audiomack.com/innercatmusic/song/allegro-in-b-flat-k-3',
  anghami: 'https://play.anghami.com/song/45385197',
};

/**
 * Resolves a service's sample URL through the live registry and builds the
 * exact block data Embed.onPaste would produce for that paste.
 */
const buildEmbedData = (service: string): EmbedData => {
  const source = AUDIO_SOURCES[service];
  const match = matchEmbedService(source);

  if (match === null) {
    throw new Error(`Sample URL for "${service}" did not match any embed service: ${source}`);
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
const createEmbedData = (service: string): OutputData => ({
  time: Date.now(),
  version: '1.0.0',
  blocks: [
    {
      id: `embed-${service}`,
      type: 'embed',
      data: buildEmbedData(service),
    },
  ],
});

/**
 * Creates an editor container with the Embed tool registered.
 */
const createEditor = (args: EmbedAudioArgs): HTMLElement => createEditorContainer({
  ...args,
  tools: {
    embed: { class: Embed },
  },
});

const meta: Meta<EmbedAudioArgs> = {
  title: 'Tools/Embed/Audio',
  tags: ['autodocs'],
  args: {
    minHeight: 300,
    data: createEmbedData('spotify'),
  },
  render: createEditor,
};

export default meta;

type Story = StoryObj<EmbedAudioArgs>;

/**
 * Builds a story rendering one live embed block for the given service.
 * Stories load real provider iframes — intended for manual browsing.
 */
const createServiceStory = (service: string): Story => ({
  args: {
    minHeight: (EMBED_SERVICES[service].height ?? DEFAULT_HEIGHT) + 160,
    data: createEmbedData(service),
  },
});

/**
 * Spotify track player (compact 152px-tall widget).
 */
export const Spotify: Story = createServiceStory('spotify');

/**
 * Yandex Music track player — the iframe widget reverses the share-URL
 * album/track slot order.
 */
export const YandexMusic: Story = createServiceStory('yandexmusic');

/**
 * Deezer track via the auto widget.
 */
export const Deezer: Story = createServiceStory('deezer');

/**
 * SoundCloud track via the w.soundcloud.com player (permalink in ?url=).
 */
export const SoundCloud: Story = createServiceStory('soundcloud');

/**
 * Mixcloud show via the widget iframe feed (shortest player at 120px).
 */
export const Mixcloud: Story = createServiceStory('mixcloud');

/**
 * Apple Music album embedded via the embed.music.apple.com host swap.
 */
export const AppleMusic: Story = createServiceStory('applemusic');

/**
 * Apple Podcasts show embedded via the embed.podcasts.apple.com host swap.
 */
export const ApplePodcasts: Story = createServiceStory('applepodcasts');

/**
 * Audiomack song — share path rearranged to /embed/<type>/<artist>/<slug>.
 */
export const Audiomack: Story = createServiceStory('audiomack');

/**
 * Anghami song via the widget.anghami.com host (play.anghami.com denies framing).
 */
export const Anghami: Story = createServiceStory('anghami');
