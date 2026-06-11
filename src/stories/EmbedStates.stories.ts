import type { Meta, StoryObj } from '@storybook/html-vite';
import { waitFor, expect } from 'storybook/test';

import { Embed, type EmbedData } from '../tools/link/embed';

import { createEditorContainer } from './helpers';
import type { EditorFactoryOptions } from './helpers';

import type { OutputData } from '@/types';

interface EmbedStatesArgs extends EditorFactoryOptions {
  minHeight: number;
  data: OutputData | undefined;
}

const YOUTUBE_SOURCE = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const YOUTUBE_EMBED = 'https://www.youtube.com/embed/dQw4w9WgXcQ';

const FIGURE_SELECTOR = '[data-role="embed-figure"]';
const FRAME_SELECTOR = '[data-blok-testid="embed-frame"]';
const CAPTION_SELECTOR = '[data-role="embed-caption"]';
const EMPTY_SELECTOR = '[data-blok-testid="embed-empty"]';
const SCRIPT_SELECTOR = '[data-blok-testid="embed-script"]';

const WAIT_OPTIONS = { timeout: 5000 };

/**
 * Builds the canonical YouTube iframe embed data, exactly as the tool would
 * produce after a paste, with optional state overrides.
 */
const youtubeData = (overrides: Partial<EmbedData> = {}): EmbedData => ({
  service: 'youtube',
  source: YOUTUBE_SOURCE,
  embed: YOUTUBE_EMBED,
  width: 580,
  height: 320,
  ...overrides,
});

/**
 * Wraps a single embed block's data into editor OutputData.
 */
const createEmbedData = (id: string, data: Partial<EmbedData>): OutputData => ({
  time: Date.now(),
  version: '1.0.0',
  blocks: [
    {
      id,
      type: 'embed',
      data,
    },
  ],
});

/**
 * Creates an editor container with the Embed tool registered.
 */
const createEditor = (args: EmbedStatesArgs): HTMLElement => createEditorContainer({
  ...args,
  tools: {
    embed: { class: Embed },
  },
});

const meta: Meta<EmbedStatesArgs> = {
  title: 'Tools/Embed/States',
  tags: ['autodocs'],
  args: {
    minHeight: 450,
    data: createEmbedData('embed-default', youtubeData()),
  },
  render: createEditor,
};

export default meta;

type Story = StoryObj<EmbedStatesArgs>;

/**
 * Default embed state: full-width centered YouTube iframe.
 */
export const Default: Story = {
  args: {
    data: createEmbedData('embed-default', youtubeData()),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const iframe = canvasElement.querySelector(FRAME_SELECTOR);

      expect(iframe).not.toBeNull();
      expect(iframe?.getAttribute('src')).toBe(YOUTUBE_EMBED);
      expect(canvasElement.querySelector(FIGURE_SELECTOR)).not.toBeNull();
    }, WAIT_OPTIONS);
  },
};

/**
 * Embed resized to 50% of the content column, centered (default alignment).
 */
export const HalfWidth: Story = {
  args: {
    data: createEmbedData('embed-half-width', youtubeData({ widthPercent: 50 })),
  },
};

/**
 * Embed resized to 50% and aligned to the left edge of the content column.
 */
export const AlignLeft: Story = {
  args: {
    data: createEmbedData('embed-align-left', youtubeData({ widthPercent: 50, alignment: 'left' })),
  },
};

/**
 * Embed resized to 50% and aligned to the right edge of the content column.
 */
export const AlignRight: Story = {
  args: {
    data: createEmbedData('embed-align-right', youtubeData({ widthPercent: 50, alignment: 'right' })),
  },
};

/**
 * Embed with a visible caption containing text.
 */
export const WithCaption: Story = {
  args: {
    data: createEmbedData('embed-caption', youtubeData({
      captionVisible: true,
      caption: 'A fixed deterministic caption',
    })),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const caption = canvasElement.querySelector(CAPTION_SELECTOR);

      expect(caption).not.toBeNull();
      expect(caption?.textContent).toBe('A fixed deterministic caption');
    }, WAIT_OPTIONS);
  },
};

/**
 * Embed with the caption toggled visible but empty — shows the placeholder.
 */
export const EmptyCaption: Story = {
  args: {
    data: createEmbedData('embed-caption-empty', youtubeData({
      captionVisible: true,
      caption: '',
    })),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const caption = canvasElement.querySelector(CAPTION_SELECTOR);

      expect(caption).not.toBeNull();
      expect(caption?.textContent).toBe('');
      expect(caption?.getAttribute('data-placeholder')).not.toBeNull();
    }, WAIT_OPTIONS);
  },
};

/**
 * Embed in a read-only editor: no resize handles, no hover overlay.
 */
export const ReadOnly: Story = {
  args: {
    readOnly: true,
    data: createEmbedData('embed-readonly', youtubeData()),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(canvasElement.querySelector(FIGURE_SELECTOR)).not.toBeNull();
      expect(canvasElement.querySelector('[data-role="resize-handle"]')).toBeNull();
    }, WAIT_OPTIONS);
  },
};

/**
 * Embed block with no data: renders the empty placeholder.
 */
export const EmptyState: Story = {
  args: {
    data: createEmbedData('embed-empty', {}),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(canvasElement.querySelector(EMPTY_SELECTOR)).not.toBeNull();
    }, WAIT_OPTIONS);
  },
};

/**
 * Script-kind embed for Twitter / X: a blockquote upgraded by widgets.js.
 * Data matches exactly what the tool produces after pasting a status URL.
 */
export const TwitterScript: Story = {
  args: {
    data: createEmbedData('embed-twitter', {
      service: 'twitter',
      source: 'https://twitter.com/jack/status/20',
      embed: 'https://twitter.com/i/status/20',
      kind: 'script',
      width: 550,
      height: 0,
    }),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(canvasElement.querySelector(SCRIPT_SELECTOR)).not.toBeNull();
    }, WAIT_OPTIONS);
  },
};

/**
 * Script-kind embed for Telegram: a post widget rendered by telegram-widget.js.
 * Data matches exactly what the tool produces after pasting a t.me post URL.
 */
export const TelegramScript: Story = {
  args: {
    data: createEmbedData('embed-telegram', {
      service: 'telegram',
      source: 'https://t.me/durov/123',
      embed: 'https://t.me/durov/123',
      kind: 'script',
      width: 580,
      height: 0,
    }),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(canvasElement.querySelector(SCRIPT_SELECTOR)).not.toBeNull();
    }, WAIT_OPTIONS);
  },
};
