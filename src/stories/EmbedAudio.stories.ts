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
  tidal: 'https://tidal.com/browse/track/19850234',
  spotifypodcasters: 'https://creators.spotify.com/pod/show/ourpodcastshow/episodes/S3E7-Twilight-Zone-Night-of-the-Meek-and-The-Guardians-of-the-Galaxy-Holiday-Special-e1t30j1',
  pocketcasts: 'https://pca.st/k2rof194',
  iheart: 'https://www.iheart.com/podcast/105-stuff-you-should-know-26940277/',
  acast: 'https://shows.acast.com/dansnowshistoryhit/episodes/mary-beard-on-ruling-the-roman-empire',
  podbean: 'https://www.podbean.com/ew/pb-x5n4w-18ae7e7',
  spreaker: 'https://www.spreaker.com/episode/the-best-episode-ever--58444864',
  buzzsprout: 'https://www.buzzsprout.com/231452/episodes/19296533-is-it-time-for-you-to-start-another-podcast',
  castbox: 'https://castbox.fm/episode/1368-Edward-Snowden-id1608-id196880677',
  transistor: 'https://share.transistor.fm/s/df7a2086',
  audioboom: 'https://audioboom.com/posts/8730423-our-great-episode',
  tunein: 'https://tunein.com/radio/Jazz24-s34682/',
  beatport: 'https://www.beatport.com/track/strobe/1696999',
  netease: 'https://music.163.com/song?id=347230',
  suno: 'https://suno.com/song/b27c29f6-8ab4-47eb-81fd-efb85c848ada',
  hearthis: 'https://hearthis.at/drmotte/dr-motte-mixmission-sunshine-live-2024/',
  boomplay: 'https://www.boomplay.com/songs/129188941?srModel=COPYLINK',
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

/**
 * Tidal track via the embed.tidal.com host — the type segment is pluralized
 * (track → tracks).
 */
export const Tidal: Story = createServiceStory('tidal');

/**
 * Spotify for Creators episode — /embed is inserted before /episodes; legacy
 * podcasters.spotify.com and anchor.fm hosts normalize to creators.spotify.com.
 */
export const SpotifyPodcasters: Story = createServiceStory('spotifypodcasters');

/**
 * Pocket Casts share code rewritten onto the /embed/ path.
 */
export const PocketCasts: Story = createServiceStory('pocketcasts');

/**
 * iHeart podcast page — the same page is frameable once ?embed=true is appended.
 */
export const IHeart: Story = createServiceStory('iheart');

/**
 * Acast episode via the embed.acast.com host — the /episodes/ path segment is
 * dropped in the embed URL.
 */
export const Acast: Story = createServiceStory('acast');

/**
 * Podbean /ew/ share link — the pb-id moves into the player-v2 ?i= query.
 */
export const Podbean: Story = createServiceStory('podbean');

/**
 * Spreaker episode — the trailing numeric id is extracted into the
 * widget.spreaker.com player query.
 */
export const Spreaker: Story = createServiceStory('spreaker');

/**
 * Buzzsprout episode — same URL with the small-player query
 * (client_source=small_player&iframe=true) appended.
 */
export const Buzzsprout: Story = createServiceStory('buzzsprout');

/**
 * Castbox episode — the trailing -idN-idN pair is extracted into the
 * /app/castbox/player path.
 */
export const Castbox: Story = createServiceStory('castbox');

/**
 * Transistor share page rewritten from /s/ to the /e/ player (the /s/ share
 * page sends X-Frame-Options and refuses to frame).
 */
export const Transistor: Story = createServiceStory('transistor');

/**
 * Audioboom post via the embeds.audioboom.com subdomain (/embed/v4 player).
 */
export const Audioboom: Story = createServiceStory('audioboom');

/**
 * TuneIn station — the s-id is extracted into the /embed/player/ path
 * (podcast p-ids have no embed and are rejected).
 */
export const TuneIn: Story = createServiceStory('tunein');

/**
 * Beatport track via the embed.beatport.com query player (?id=&type=track).
 */
export const Beatport: Story = createServiceStory('beatport');

/**
 * NetEase Cloud Music song via the outchain player query (handles the SPA
 * /#/song hash form too).
 */
export const NetEase: Story = createServiceStory('netease');

/**
 * Suno AI song — the UUID is rewritten onto the /embed/ path.
 */
export const Suno: Story = createServiceStory('suno');

/**
 * hearthis.at track — /embed/ is appended to the artist/track path.
 */
export const HearThis: Story = createServiceStory('hearthis');

/**
 * Boomplay song via the /embed/<id>/MUSIC player path.
 */
export const Boomplay: Story = createServiceStory('boomplay');
