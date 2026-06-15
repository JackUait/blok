import type { Meta, StoryObj } from '@storybook/html-vite';
import { waitFor, expect } from 'storybook/test';

import { File as FileBlock } from '../tools/index';

import { createEditorContainer } from './helpers';
import type { EditorFactoryOptions } from './helpers';

import type { OutputData, ToolSettings } from '@/types';

interface FileArgs extends EditorFactoryOptions {
  minHeight: number;
  data: OutputData | undefined;
  readOnly: boolean;
}

// ── Constants ────────────────────────────────────────────────────────

const CARD_SELECTOR = '[data-role="file-card"]';
const EMPTY_SELECTOR = '.blok-media-empty';

const TIMEOUT_INIT = { timeout: 5000 };

const FILE_URL = 'https://cdn.example.com/report.pdf';
const FILE_NAME = 'report.pdf';
const FILE_SIZE = 2400000;

// ── Variant data ─────────────────────────────────────────────────────

const FILLED_DATA = {
  url: FILE_URL,
  fileName: FILE_NAME,
  size: FILE_SIZE,
};

const WITH_CAPTION_DATA = {
  url: FILE_URL,
  fileName: FILE_NAME,
  size: FILE_SIZE,
  caption: 'Q2 financials',
};

const EMPTY_DATA = {
  url: '',
};

// ── Editor factory ───────────────────────────────────────────────────

const fileTools = {
  file: {
    class: FileBlock,
  } as ToolSettings,
};

/**
 * Creates sample data with a single file block.
 *
 * @param id - Block id
 * @param data - File block data
 */
const createFileData = (id: string, data: Record<string, unknown>): OutputData => ({
  time: Date.now(),
  version: '1.0.0',
  blocks: [
    { id, type: 'file', data },
  ],
});

const createEditor = (args: FileArgs): HTMLElement => createEditorContainer({
  ...args,
  tools: fileTools,
});

const meta: Meta<FileArgs> = {
  title: 'Tools/File',
  tags: ['autodocs'],
  args: {
    minHeight: 300,
    data: createFileData('file-filled', FILLED_DATA),
    readOnly: false,
  },
  render: createEditor,
};

export default meta;

type Story = StoryObj<FileArgs>;

// ── Stories ──────────────────────────────────────────────────────────

/**
 * Empty state: a file block without a url shows the upload/link placeholder.
 */
export const Empty: Story = {
  args: {
    data: createFileData('file-empty', EMPTY_DATA),
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
 * Filled file card with url, file name and size.
 */
export const Filled: Story = {
  args: {
    data: createFileData('file-filled', FILLED_DATA),
  },
  play: async ({ canvasElement }) => {
    await waitFor(
      () => {
        expect(canvasElement.querySelector(CARD_SELECTOR)).toBeInTheDocument();
      },
      TIMEOUT_INIT
    );
  },
};

/**
 * File card with an optional caption below.
 */
export const WithCaption: Story = {
  args: {
    data: createFileData('file-with-caption', WITH_CAPTION_DATA),
  },
  play: async ({ canvasElement }) => {
    await waitFor(
      () => {
        expect(canvasElement.querySelector(CARD_SELECTOR)).toBeInTheDocument();
      },
      TIMEOUT_INIT
    );
  },
};

/**
 * Filled file card rendered in read-only mode.
 */
export const ReadOnly: Story = {
  args: {
    data: createFileData('file-readonly', FILLED_DATA),
    readOnly: true,
  },
  play: async ({ canvasElement }) => {
    await waitFor(
      () => {
        expect(canvasElement.querySelector(CARD_SELECTOR)).toBeInTheDocument();
      },
      TIMEOUT_INIT
    );
  },
};
