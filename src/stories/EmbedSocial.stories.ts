import type { Meta, StoryObj } from '@storybook/html-vite';

import { Embed, type EmbedData } from '../tools/link/embed';
import { EMBED_SERVICES, matchEmbedService } from '../tools/link/registry';

import { createEditorContainer } from './helpers';
import type { EditorFactoryOptions } from './helpers';

import type { OutputData } from '@/types';

interface EmbedSocialArgs extends EditorFactoryOptions {
  minHeight: number;
  data: OutputData | undefined;
}

const DEFAULT_WIDTH = 580;
const DEFAULT_HEIGHT = 320;

/**
 * One canonical share URL per social service, mirroring the positive
 * samples proven by test/unit/tools/link/registry.test.ts.
 */
const SOCIAL_SOURCES: Record<string, string> = {
  reddit: 'https://www.reddit.com/r/IAmA/comments/z1c9z/i_am_barack_obama_president_of_the_united_states/',
  instagram: 'https://www.instagram.com/p/BsOGulcndj-/',
  facebookvideo: 'https://www.facebook.com/facebook/videos/10153231379946729/',
  facebookpost: 'https://www.facebook.com/zuck/posts/10113961365418581',
  linkedin: 'https://www.linkedin.com/posts/williamhgates_the-last-chapter-of-my-career-activity-7326660324483289089-2c0f?utm_source=share',
  mastodon: 'https://mastodon.social/@Gargron/100254678717223630',
  pinterest: 'https://www.pinterest.com/pin/99360735500167749/',
  snapchat: 'https://www.snapchat.com/spotlight/W7_EDlXWTBiXAEEniNoMPwAAYYmplb211YmdvAZ01kChEAZ01kCgkAAAAAQ',
  substack: 'https://astralcodexten.substack.com/p/still-alive',
  threads: 'https://www.threads.com/@zuck/post/C2QBoRaRmR1',
};

/**
 * Resolves a service's sample URL through the live registry and builds the
 * exact block data Embed.onPaste would produce for that paste.
 */
const buildEmbedData = (service: string): EmbedData => {
  const source = SOCIAL_SOURCES[service];
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
const createEditor = (args: EmbedSocialArgs): HTMLElement => createEditorContainer({
  ...args,
  tools: {
    embed: { class: Embed },
  },
});

const meta: Meta<EmbedSocialArgs> = {
  title: 'Tools/Embed/Social',
  tags: ['autodocs'],
  args: {
    minHeight: 300,
    data: createEmbedData('reddit'),
  },
  render: createEditor,
};

export default meta;

type Story = StoryObj<EmbedSocialArgs>;

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
 * Reddit post via embed.reddit.com (mobile /s/ share tokens and redd.it
 * short links are opaque redirects, excluded).
 */
export const Reddit: Story = createServiceStory('reddit');

/**
 * Instagram post via /embed/captioned/ — X-Frame-Options: DENY is gated on
 * Sec-Fetch-Dest, so browsers frame fine while naive curl checks false-negative.
 */
export const Instagram: Story = createServiceStory('instagram');

/**
 * Facebook video via plugins/video.php with the canonical watch URL
 * percent-encoded into ?href=.
 */
export const FacebookVideo: Story = createServiceStory('facebookvideo');

/**
 * Facebook post via plugins/post.php with the permalink percent-encoded
 * into ?href=.
 */
export const FacebookPost: Story = createServiceStory('facebookpost');

/**
 * LinkedIn post — the numeric activity id from the share slug becomes an
 * urn:li:activity embed path.
 */
export const LinkedIn: Story = createServiceStory('linkedin');

/**
 * Mastodon status — curated instance allowlist; remote_id carries host+path
 * because each instance serves its own /embed endpoint.
 */
export const Mastodon: Story = createServiceStory('mastodon');

/**
 * Pinterest pin via the assets.pinterest.com embed card (fixed 345px width).
 */
export const Pinterest: Story = createServiceStory('pinterest');

/**
 * Snapchat spotlight — CSP frame-ancestors * overrides the bogus
 * X-Frame-Options header, so framing works.
 */
export const Snapchat: Story = createServiceStory('snapchat');

/**
 * Substack post via the /embed/p/ preview card (full post pages lock
 * frame-ancestors to substack).
 */
export const Substack: Story = createServiceStory('substack');

/**
 * Threads post — script kind: a text-post-media blockquote upgraded by
 * www.threads.com/embed.js (registry carries kind: 'script').
 */
export const Threads: Story = createServiceStory('threads');
