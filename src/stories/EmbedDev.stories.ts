import type { Meta, StoryObj } from '@storybook/html-vite';

import { Embed, type EmbedData } from '../tools/link/embed';
import { EMBED_SERVICES, matchEmbedService } from '../tools/link/registry';

import { createEditorContainer } from './helpers';
import type { EditorFactoryOptions } from './helpers';

import type { OutputData } from '@/types';

interface EmbedDevArgs extends EditorFactoryOptions {
  minHeight: number;
  data: OutputData | undefined;
}

const DEFAULT_WIDTH = 580;
const DEFAULT_HEIGHT = 320;

/**
 * Canonical sample source URL per service, mined from the registry unit tests
 * (test/unit/tools/link/registry.test.ts) — real-shaped URLs proven to match.
 */
const SAMPLE_SOURCES: Record<string, string> = {
  codepen: 'https://codepen.io/team/codepen/pen/EVdVpQ',
  codesandbox: 'https://codesandbox.io/s/vanilla',
  stackblitz: 'https://stackblitz.com/edit/react-ts',
  typeform: 'https://form.typeform.com/to/LQcTJr',
  airtable: 'https://airtable.com/shr5EBHUmHzStubDx',
  miro: 'https://miro.com/app/board/uXjVOUbVyFY=/',
  desmos: 'https://www.desmos.com/calculator/qy6jc8mfi9',
  observable: 'https://observablehq.com/@mbostock/embedded-notebook',
  jsfiddle: 'https://jsfiddle.net/josewirewax/2rqnsdd6/',
};

/**
 * Builds the embed block data for a service exactly as Embed.onPaste would:
 * the source URL is resolved through the registry and combined with the
 * registry entry's default dimensions.
 *
 * Throws at module init when the sample URL no longer matches its service —
 * a registry regression must break the stories loudly, not render a stub.
 */
const buildEmbedData = (service: string): EmbedData => {
  const source = SAMPLE_SOURCES[service];
  const match = matchEmbedService(source);

  if (match === null || match.service !== service) {
    throw new Error(
      `Sample URL for "${service}" resolved to "${match === null ? 'null' : match.service}": ${source}`
    );
  }

  return {
    service: match.service,
    source,
    embed: match.embedUrl,
    kind: match.kind,
    width: EMBED_SERVICES[match.service].width ?? DEFAULT_WIDTH,
    height: EMBED_SERVICES[match.service].height ?? DEFAULT_HEIGHT,
  };
};

/**
 * Wraps a single service's embed block into editor OutputData.
 */
const createEmbedBlockData = (service: string): OutputData => ({
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
const createEditor = (args: EmbedDevArgs): HTMLElement => createEditorContainer({
  ...args,
  tools: {
    embed: { class: Embed },
  },
});

const meta: Meta<EmbedDevArgs> = {
  title: 'Tools/Embed/Dev',
  tags: ['autodocs'],
  args: {
    minHeight: 600,
    data: createEmbedBlockData('codepen'),
  },
  render: createEditor,
};

export default meta;

type Story = StoryObj<EmbedDevArgs>;

/**
 * Creates a story rendering one live embed block for the given service.
 * Stories load LIVE provider iframes — intended for manual browsing.
 */
const createServiceStory = (service: string): Story => ({
  args: {
    data: createEmbedBlockData(service),
  },
});

/**
 * CodePen pen embed (result tab).
 */
export const CodePen: Story = createServiceStory('codepen');

/**
 * CodeSandbox sandbox embed.
 */
export const CodeSandbox: Story = createServiceStory('codesandbox');

/**
 * StackBlitz project embed (embed=1).
 */
export const StackBlitz: Story = createServiceStory('stackblitz');

/**
 * Typeform form embed (frameable form page, original subdomain kept).
 */
export const Typeform: Story = createServiceStory('typeform');

/**
 * Airtable shared view embed (shr... share link).
 */
export const Airtable: Story = createServiceStory('airtable');

/**
 * Miro board live-embed.
 */
export const Miro: Story = createServiceStory('miro');

/**
 * Desmos graphing calculator embed (?embed chrome-less mode).
 */
export const Desmos: Story = createServiceStory('desmos');

/**
 * Observable notebook embed (frame-ancestors-permissive /embed/ route).
 */
export const Observable: Story = createServiceStory('observable');

/**
 * JSFiddle fiddle embed (/embedded/ suffix).
 */
export const JsFiddle: Story = createServiceStory('jsfiddle');
