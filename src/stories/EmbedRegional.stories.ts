import type { Meta, StoryObj } from '@storybook/html-vite';

import { Embed, type EmbedData } from '../tools/link/embed';
import { EMBED_SERVICES, matchEmbedService } from '../tools/link/registry';

import { createEditorContainer } from './helpers';
import type { EditorFactoryOptions } from './helpers';

import type { OutputData } from '@/types';

interface EmbedRegionalArgs extends EditorFactoryOptions {
  minHeight: number;
  data: OutputData | undefined;
}

const DEFAULT_WIDTH = 580;
const DEFAULT_HEIGHT = 320;

/**
 * One canonical sample URL per regional video & TV embed service. Each URL
 * mirrors a positive sample proven to match in test/unit/tools/link/registry.test.ts.
 */
const REGIONAL_SAMPLES = {
  bilibili: 'https://www.bilibili.com/video/BV1GJ411x7h7/?spm_id_from=333.337',
  niconico: 'https://www.nicovideo.jp/watch/sm9',
  youku: 'https://v.youku.com/v_show/id_XODU1NzgzMTg0.html',
  navertv: 'https://tv.naver.com/v/8565915',
  kakaotv: 'https://tv.kakao.com/v/451075687',
  dailymotion: 'https://www.dailymotion.com/video/xaehrai',
  okru: 'https://ok.ru/video/7692086741685',
  arte: 'https://www.arte.tv/en/videos/110989-000-A/steven-spielberg/',
} as const;

type RegionalService = keyof typeof REGIONAL_SAMPLES;

/**
 * Builds the embed block data for a service exactly as Embed.onPaste would
 * after the sample URL is pasted. Throws at module init if the sample URL
 * stopped matching its registry entry.
 */
const buildEmbedBlockData = (service: RegionalService): EmbedData => {
  const source = REGIONAL_SAMPLES[service];
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
const createEmbedData = (service: RegionalService): OutputData => ({
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
const createEditor = (args: EmbedRegionalArgs): HTMLElement => createEditorContainer({
  ...args,
  tools: {
    embed: { class: Embed },
  },
});

const meta: Meta<EmbedRegionalArgs> = {
  title: 'Tools/Embed/Regional',
  tags: ['autodocs'],
  args: {
    minHeight: 450,
    data: createEmbedData('bilibili'),
  },
  render: createEditor,
};

export default meta;

type Story = StoryObj<EmbedRegionalArgs>;

/**
 * Builds a story rendering one live embed block for the given service.
 */
const createServiceStory = (service: RegionalService): Story => ({
  args: {
    data: createEmbedData(service),
  },
});

export const Bilibili: Story = createServiceStory('bilibili');

export const Niconico: Story = createServiceStory('niconico');

export const Youku: Story = createServiceStory('youku');

export const NaverTv: Story = createServiceStory('navertv');

export const KakaoTv: Story = createServiceStory('kakaotv');

export const Dailymotion: Story = createServiceStory('dailymotion');

export const OkRu: Story = createServiceStory('okru');

export const Arte: Story = createServiceStory('arte');
