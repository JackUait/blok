import type { Meta, StoryObj } from '@storybook/html-vite';
import { waitFor, expect } from 'storybook/test';

import { Bookmark } from '../tools/link/bookmark';

import { createEditorContainer } from './helpers';
import type { EditorFactoryOptions } from './helpers';

import type { OutputData, ToolSettings } from '@/types';

interface BookmarkArgs extends EditorFactoryOptions {
  minHeight: number;
  data: OutputData | undefined;
  readOnly: boolean;
}

// ── Constants ────────────────────────────────────────────────────────

const CARD_SELECTOR = '[data-blok-testid="bookmark-card"]';
const EMPTY_SELECTOR = '[data-blok-testid="bookmark-empty"]';
const TITLE_SELECTOR = '[data-role="bookmark-title"]';

const TIMEOUT_INIT = { timeout: 5000 };

/**
 * Builds an inline SVG data URI with a solid fill so stories never depend
 * on network-loaded images (keeps Chromatic snapshots deterministic).
 *
 * @param width - SVG width in pixels
 * @param height - SVG height in pixels
 * @param fill - Solid fill color
 */
const svgDataUri = (width: number, height: number, fill: string): string =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${fill}"/></svg>`
  )}`;

const CARD_IMAGE = svgDataUri(640, 360, '#4a6cf7');
const CARD_FAVICON = svgDataUri(32, 32, '#f59e0b');

const BOOKMARK_URL = 'https://example.com/article';
const BOOKMARK_TITLE = 'Example Article Title';
const BOOKMARK_DESCRIPTION = 'A short description of the example article shown inside the bookmark card.';

const LONG_TITLE = 'The Comprehensive and Unreasonably Detailed Chronicle of Bookmark Card Title Truncation Behavior in Block-Based Editors, Including Every Edge Case We Could Imagine While Writing This Sentence';
const LONG_DESCRIPTION = 'This description is intentionally verbose so that the bookmark card has to clamp it. It rambles on about OpenGraph metadata, unfurl endpoints, line clamping, ellipses, and the general futility of fitting an entire article summary into two lines of a compact preview card rendered inside a block-based editor.';
const LONG_URL = 'https://example.com/articles/2026/06/an-extremely-long-pathname-created-to-exercise-url-truncation/in-the-bookmark-card-link-row?utm_source=visual-regression&utm_medium=playwright&utm_campaign=bookmark-long-content&utm_term=truncation&utm_content=clamping';

// ── Variant data ─────────────────────────────────────────────────────

const FULL_CARD_DATA = {
  url: BOOKMARK_URL,
  title: BOOKMARK_TITLE,
  description: BOOKMARK_DESCRIPTION,
  favicon: CARD_FAVICON,
  image: CARD_IMAGE,
};

const NO_IMAGE_DATA = {
  url: BOOKMARK_URL,
  title: BOOKMARK_TITLE,
  description: BOOKMARK_DESCRIPTION,
  favicon: CARD_FAVICON,
};

const NO_DESCRIPTION_DATA = {
  url: BOOKMARK_URL,
  title: BOOKMARK_TITLE,
  favicon: CARD_FAVICON,
  image: CARD_IMAGE,
};

const NO_FAVICON_DATA = {
  url: BOOKMARK_URL,
  title: BOOKMARK_TITLE,
  description: BOOKMARK_DESCRIPTION,
  image: CARD_IMAGE,
};

const MINIMAL_DATA = {
  url: BOOKMARK_URL,
};

const LONG_CONTENT_DATA = {
  url: LONG_URL,
  title: LONG_TITLE,
  description: LONG_DESCRIPTION,
  favicon: CARD_FAVICON,
  image: CARD_IMAGE,
};

const EMPTY_DATA = {
  url: '',
};

// ── Editor factory ───────────────────────────────────────────────────

const bookmarkTools = {
  bookmark: {
    class: Bookmark,
    config: { endpoint: '' },
  } as ToolSettings,
};

/**
 * Creates sample data with a single bookmark block.
 *
 * @param id - Block id
 * @param data - Bookmark block data (url + optional meta)
 */
const createBookmarkData = (id: string, data: Record<string, unknown>): OutputData => ({
  time: Date.now(),
  version: '1.0.0',
  blocks: [
    { id, type: 'bookmark', data },
  ],
});

const createEditor = (args: BookmarkArgs): HTMLElement => createEditorContainer({
  ...args,
  tools: bookmarkTools,
});

const meta: Meta<BookmarkArgs> = {
  title: 'Tools/Bookmark',
  tags: ['autodocs'],
  args: {
    minHeight: 300,
    data: createBookmarkData('bookmark-full', FULL_CARD_DATA),
    readOnly: false,
  },
  render: createEditor,
};

export default meta;

type Story = StoryObj<BookmarkArgs>;

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Waits for the bookmark card to render with the expected title text.
 *
 * @param canvasElement - Story canvas root
 * @param title - Expected card title text
 */
const expectCardTitle = async (canvasElement: HTMLElement, title: string): Promise<void> => {
  await waitFor(
    () => {
      const card = canvasElement.querySelector(CARD_SELECTOR);

      expect(card).toBeInTheDocument();
      expect(card?.querySelector(TITLE_SELECTOR)?.textContent).toBe(title);
    },
    TIMEOUT_INIT
  );
};

// ── Stories ──────────────────────────────────────────────────────────

/**
 * Full bookmark card: title, description, favicon, url row and cover image.
 */
export const FullCard: Story = {
  args: {
    data: createBookmarkData('bookmark-full', FULL_CARD_DATA),
  },
  play: async ({ canvasElement }) => {
    await expectCardTitle(canvasElement, BOOKMARK_TITLE);
  },
};

/**
 * Card without a cover image — content column stretches the full width.
 */
export const NoImage: Story = {
  args: {
    data: createBookmarkData('bookmark-no-image', NO_IMAGE_DATA),
  },
  play: async ({ canvasElement }) => {
    await expectCardTitle(canvasElement, BOOKMARK_TITLE);
  },
};

/**
 * Card without a description — title sits directly above the url row.
 */
export const NoDescription: Story = {
  args: {
    data: createBookmarkData('bookmark-no-description', NO_DESCRIPTION_DATA),
  },
  play: async ({ canvasElement }) => {
    await expectCardTitle(canvasElement, BOOKMARK_TITLE);
  },
};

/**
 * Card without a favicon — the url row shows plain text only.
 */
export const NoFavicon: Story = {
  args: {
    data: createBookmarkData('bookmark-no-favicon', NO_FAVICON_DATA),
  },
  play: async ({ canvasElement }) => {
    await expectCardTitle(canvasElement, BOOKMARK_TITLE);
  },
};

/**
 * Minimal card with only a url — the title falls back to the hostname.
 */
export const Minimal: Story = {
  args: {
    data: createBookmarkData('bookmark-minimal', MINIMAL_DATA),
  },
  play: async ({ canvasElement }) => {
    await expectCardTitle(canvasElement, 'example.com');
  },
};

/**
 * Very long title, description and url — exercises truncation/clamping.
 */
export const LongContent: Story = {
  args: {
    data: createBookmarkData('bookmark-long-content', LONG_CONTENT_DATA),
  },
  play: async ({ canvasElement }) => {
    await expectCardTitle(canvasElement, LONG_TITLE);
  },
};

/**
 * Empty state: a bookmark block without a url shows the empty placeholder.
 */
export const EmptyState: Story = {
  args: {
    data: createBookmarkData('bookmark-empty', EMPTY_DATA),
  },
  play: async ({ canvasElement }) => {
    await waitFor(
      () => {
        expect(canvasElement.querySelector(EMPTY_SELECTOR)).toBeInTheDocument();
      },
      TIMEOUT_INIT
    );
  },
};

/**
 * Full bookmark card rendered in read-only mode.
 */
export const ReadOnlyFullCard: Story = {
  args: {
    data: createBookmarkData('bookmark-readonly', FULL_CARD_DATA),
    readOnly: true,
  },
  play: async ({ canvasElement }) => {
    await expectCardTitle(canvasElement, BOOKMARK_TITLE);
  },
};
