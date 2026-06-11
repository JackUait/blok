import type { Meta, StoryObj } from '@storybook/html-vite';

import { Embed, type EmbedData } from '../tools/link/embed';
import { EMBED_SERVICES, matchEmbedService } from '../tools/link/registry';

import { createEditorContainer } from './helpers';
import type { EditorFactoryOptions } from './helpers';

import type { OutputData } from '@/types';

interface EmbedProductivityArgs extends EditorFactoryOptions {
  minHeight: number;
  data: OutputData | undefined;
}

const DEFAULT_WIDTH = 580;
const DEFAULT_HEIGHT = 320;

/**
 * One canonical share URL per productivity service, mirroring the positive
 * samples proven by test/unit/tools/link/registry.test.ts.
 */
const PRODUCTIVITY_SOURCES: Record<string, string> = {
  calendly: 'https://calendly.com/acme-team',
  tally: 'https://tally.so/r/wMNDgn',
  jotform: 'https://form.jotform.com/241234567890123',
  whimsical: 'https://whimsical.com/my-roadmap-Q3xL9mTzKvB2aWcRpD8uHn',
  excalidraw: 'https://excalidraw.com/#json=AbC123dEf456GhI789jK,XyZ987wVu654TsR321qP',
  tldraw: 'https://www.tldraw.com/r/AbCdEf123456',
  mentimeter: 'https://www.mentimeter.com/app/presentation/alxyz1u2abcdefg',
  behance: 'https://www.behance.net/gallery/123456789/Brand-Identity',
  chromatic: 'https://5ccbc373887ca40020446347-abcdef.chromatic.com/?path=/story/button--primary',
  plunker: 'https://plnkr.co/edit/abc123XYZ',
};

/**
 * Resolves a service's sample URL through the live registry and builds the
 * exact block data Embed.onPaste would produce for that paste.
 */
const buildEmbedData = (service: string): EmbedData => {
  const source = PRODUCTIVITY_SOURCES[service];
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
const createEditor = (args: EmbedProductivityArgs): HTMLElement => createEditorContainer({
  ...args,
  tools: {
    embed: { class: Embed },
  },
});

const meta: Meta<EmbedProductivityArgs> = {
  title: 'Tools/Embed/Productivity',
  tags: ['autodocs'],
  args: {
    minHeight: 300,
    data: createEmbedData('calendly'),
  },
  render: createEditor,
};

export default meta;

type Story = StoryObj<EmbedProductivityArgs>;

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
 * Calendly scheduling page framed as-is with the embed_domain/embed_type
 * inline-widget params appended.
 */
export const Calendly: Story = createServiceStory('calendly');

/**
 * Tally form — the /r/ share link is rewritten onto the /embed/ endpoint.
 */
export const Tally: Story = createServiceStory('tally');

/**
 * JotForm form — numeric ids only; regional hosts normalize onto form.jotform.com.
 */
export const JotForm: Story = createServiceStory('jotform');

/**
 * Whimsical board — the trailing 16+ char base62 token of the slug feeds /embed/.
 */
export const Whimsical: Story = createServiceStory('whimsical');

/**
 * Excalidraw E2E-encrypted #json= scene — the <docId>,<key> pair is a
 * two-capture join passed through verbatim (the key never reaches the server).
 */
export const Excalidraw: Story = createServiceStory('excalidraw');

/**
 * tldraw room link — the kind segment (r/ro/v/p) is kept because each share
 * kind renders through a different route.
 */
export const Tldraw: Story = createServiceStory('tldraw');

/**
 * Mentimeter presentation via the appended /embed viewer (plays the whole deck).
 */
export const Mentimeter: Story = createServiceStory('mentimeter');

/**
 * Behance project — the numeric gallery id feeds the /embed/project endpoint.
 */
export const Behance: Story = createServiceStory('behance');

/**
 * Chromatic story permalink rebuilt onto
 * <host>.chromatic.com/iframe.html?id=<story>&viewMode=story|docs.
 */
export const Chromatic: Story = createServiceStory('chromatic');

/**
 * Plunker editor link mapped onto embed.plnkr.co with ?show=preview.
 */
export const Plunker: Story = createServiceStory('plunker');
