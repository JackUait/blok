/**
 * MultiBlockConversion.stories.ts - Stories for multi-block selection and conversion.
 *
 * This file demonstrates selecting multiple blocks and converting them to a different type.
 */
import type { Meta, StoryObj } from '@storybook/html-vite';
import { waitFor, expect } from 'storybook/test';
import type { OutputData } from '@/types';
import {
  createEditorContainer,
  simulateClick,
  waitForToolbar,
  triggerSelectAll,
  TOOLBAR_TESTID,
} from './helpers';
import type { EditorFactoryOptions, EditorContainer } from './helpers';
import Header from '../tools/header';
import List from '../tools/list';

interface MultiBlockConversionArgs extends EditorFactoryOptions {
  minHeight: number;
  data: OutputData | undefined;
}

// Constants
const BLOCK_TESTID = '[data-blok-testid="block-wrapper"]';
const PARAGRAPH_SELECTOR = '[data-blok-testid="block-wrapper"][data-blok-component="paragraph"]';
const SETTINGS_BUTTON_TESTID = '[data-blok-testid="settings-toggler"]';
const POPOVER_CONTAINER_SELECTOR = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';
const CONVERT_TO_OPTION_SELECTOR = '[data-blok-testid="popover-item"][data-blok-item-name="convert-to"]';
const NESTED_POPOVER_SELECTOR = '[data-blok-nested="true"] [data-blok-testid="popover-container"]';

const TIMEOUT_INIT = { timeout: 5000 };
const TIMEOUT_ACTION = { timeout: 5000 };

/**
 * Sample data with different block types for conversion testing
 */
const mixedBlocksData: OutputData = {
  time: Date.now(),
  version: '1.0.0',
  blocks: [
    {
      id: 'convert-header-1',
      type: 'header',
      data: { text: 'This is a Header', level: 2 },
    },
    {
      id: 'convert-list-1',
      type: 'list',
      data: {
        style: 'unordered',
        items: [{ content: 'List item one', checked: false }],
      },
    },
    {
      id: 'convert-header-2',
      type: 'header',
      data: { text: 'Another Header', level: 3 },
    },
  ],
};

const createEditor = (args: MultiBlockConversionArgs): HTMLElement =>
  createEditorContainer({
    ...args,
    tools: {
      header: Header,
      list: List,
    },
  });

const meta: Meta<MultiBlockConversionArgs> = {
  title: 'Editor/MultiBlockConversion',
  tags: ['autodocs'],
  args: {
    minHeight: 300,
    data: mixedBlocksData,
  },
  render: createEditor,
};

export default meta;

type Story = StoryObj<MultiBlockConversionArgs>;

/**
 * Default state with mixed block types (headers and list).
 */
export const Default: Story = {
  args: {
    data: mixedBlocksData,
  },
};

/**
 * Select all blocks using CMD+A (or Ctrl+A) and convert them to paragraphs.
 * This demonstrates multi-block selection and batch conversion.
 */
export const ConvertAllToParagraphs: Story = {
  args: {
    data: mixedBlocksData,
  },
  play: async ({ canvasElement, step }) => {
    const container = canvasElement.querySelector('[data-story-container]') as EditorContainer | null;

    await step('Wait for editor and toolbar to initialize', async () => {
      await waitFor(
        () => {
          const blocks = canvasElement.querySelectorAll(BLOCK_TESTID);

          expect(blocks.length).toBe(3);
          expect(container?.__blokEditor).toBeTruthy();
        },
        TIMEOUT_INIT
      );
      await waitForToolbar(canvasElement);
    });

    await step('Click first block to focus editor', async () => {
      const firstBlock = canvasElement.querySelector(BLOCK_TESTID);

      if (firstBlock) {
        simulateClick(firstBlock);
      }

      await waitFor(
        () => {
          const toolbar = canvasElement.querySelector(TOOLBAR_TESTID);

          expect(toolbar).toHaveAttribute('data-blok-opened', 'true');
        },
        TIMEOUT_ACTION
      );
    });

    await step('Select all blocks with CMD/Ctrl+A twice', async () => {
      const firstBlock = canvasElement.querySelector(BLOCK_TESTID);

      if (firstBlock) {
        // First Ctrl+A selects text in block, second selects all blocks
        triggerSelectAll(firstBlock);
        await new Promise((resolve) => setTimeout(resolve, 100));
        triggerSelectAll(firstBlock);
      }

      await waitFor(
        () => {
          const selectedBlocks = canvasElement.querySelectorAll('[data-blok-selected="true"]');

          expect(selectedBlocks.length).toBe(3);
        },
        TIMEOUT_ACTION
      );
    });

    await step('Open block tunes menu', async () => {
      const settingsButton = canvasElement.querySelector(SETTINGS_BUTTON_TESTID);

      if (settingsButton) {
        simulateClick(settingsButton);
      }

      await waitFor(
        () => {
          const popover = document.querySelector(POPOVER_CONTAINER_SELECTOR);

          expect(popover).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );
    });

    await step('Click Convert to option', async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));

      const convertToOption = document.querySelector(CONVERT_TO_OPTION_SELECTOR);

      if (convertToOption) {
        simulateClick(convertToOption);
      }

      await waitFor(
        () => {
          const nestedPopover = document.querySelector(NESTED_POPOVER_SELECTOR);

          expect(nestedPopover).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );
    });

    await step('Select Paragraph from conversion options', async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));

      const paragraphOption = document.querySelector(
        `${NESTED_POPOVER_SELECTOR} [data-blok-item-name="paragraph"]`
      );

      if (paragraphOption) {
        simulateClick(paragraphOption);
      }

      await waitFor(
        () => {
          const paragraphs = canvasElement.querySelectorAll(PARAGRAPH_SELECTOR);

          expect(paragraphs.length).toBe(3);
        },
        TIMEOUT_ACTION
      );
    });

    await step('Verify all blocks are now paragraphs', async () => {
      const paragraphs = canvasElement.querySelectorAll(PARAGRAPH_SELECTOR);

      expect(paragraphs.length).toBe(3);

      // Verify content is preserved
      const blockTexts = Array.from(paragraphs).map((p) => p.textContent?.trim());

      expect(blockTexts).toContain('This is a Header');
      expect(blockTexts).toContain('List item one');
      expect(blockTexts).toContain('Another Header');
    });
  },
};
