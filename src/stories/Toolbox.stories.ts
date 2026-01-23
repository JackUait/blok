/**
 * Toolbox.stories.ts - Stories demonstrating toolbox customization.
 *
 * This file demonstrates how to set custom icons for all available tools
 * in the toolbox using the tool settings configuration.
 */
import type { Meta, StoryObj } from '@storybook/html-vite';
import { waitFor, expect } from 'storybook/test';

import { Header } from '../tools/header';
import { Paragraph } from '../tools/paragraph';

import { createEditorContainer, simulateClick, waitForToolbar, TOOLBAR_TESTID } from './helpers';
import type { EditorFactoryOptions } from './helpers';

import type { OutputData, ToolSettings, BlockToolConstructable } from '@/types';

interface ToolboxArgs extends EditorFactoryOptions {
  minHeight: number;
  data: OutputData | undefined;
}

// Constants
const BLOCK_TESTID = '[data-blok-testid="block-wrapper"]';
const PLUS_BUTTON_TESTID = '[data-blok-testid="plus-button"]';
const TOOLBOX_OPENED_SELECTOR = '[data-blok-toolbox-opened="true"]';
const POPOVER_ITEM_TESTID = '[data-blok-testid="popover-item"]';

const TIMEOUT_INIT = { timeout: 5000 };
const TIMEOUT_ACTION = { timeout: 5000 };

// Custom SVG icons for demonstration
const CustomIcons = {
  // Star icon for Paragraph
  star: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <path d="M10 2L12.09 7.26L18 7.97L13.82 11.64L15.18 17.5L10 14.27L4.82 17.5L6.18 11.64L2 7.97L7.91 7.26L10 2Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,

  // Crown icon for Heading
  crown: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <path d="M3 15L4 7L7 10L10 5L13 10L16 7L17 15H3Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M3 15H17V17H3V15Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
};

const sampleData: OutputData = {
  time: Date.now(),
  version: '1.0.0',
  blocks: [
    {
      id: 'toolbox-block-1',
      type: 'paragraph',
      data: { text: 'Click the plus button to see the toolbox with custom icons.' },
    },
  ],
};

const createEditor = (args: ToolboxArgs): HTMLElement => createEditorContainer(args);

const meta: Meta<ToolboxArgs> = {
  title: 'Components/Toolbox',
  tags: ['autodocs'],
  args: {
    minHeight: 300,
    data: sampleData,
  },
  render: createEditor,
};

export default meta;


type Story = StoryObj<ToolboxArgs>;

/**
 * Toolbox with custom icons for all tools.
 *
 * This story demonstrates how to override the default toolbox icons
 * for both Paragraph and Header tools using the `toolbox` configuration
 * in tool settings.
 *
 * To customize icons, use the `toolbox` property in tool settings:
 * ```typescript
 * tools: {
 *   paragraph: {
 *     class: Paragraph,
 *     toolbox: {
 *       icon: '<svg>...</svg>',
 *       title: 'Custom Title'
 *     }
 *   }
 * }
 * ```
 */
export const CustomIconsForAllTools: Story = {
  args: {
    data: sampleData,
    tools: {
      paragraph: {
        class: Paragraph as unknown as BlockToolConstructable,
        toolbox: {
          icon: CustomIcons.star,
          title: 'Paragraph',
        },
      } as ToolSettings,
      header: {
        class: Header as unknown as BlockToolConstructable,
        toolbox: {
          icon: CustomIcons.crown,
          title: 'Header',
        },
      } as ToolSettings,
    },
  },
  play: async ({ canvasElement, step }) => {
    await step('Wait for editor and toolbar to initialize', async () => {
      await waitFor(
        () => {
          const block = canvasElement.querySelector(BLOCK_TESTID);

          expect(block).toBeInTheDocument();
        },
        TIMEOUT_INIT
      );
      await waitForToolbar(canvasElement);
    });

    await step('Click block to show toolbar', async () => {
      const block = canvasElement.querySelector(BLOCK_TESTID);

      if (block) {
        simulateClick(block);
      }

      await waitFor(
        () => {
          const toolbar = canvasElement.querySelector(TOOLBAR_TESTID);

          expect(toolbar).toHaveAttribute('data-blok-opened', 'true');
        },
        TIMEOUT_ACTION
      );
    });

    await step('Open toolbox to see custom icons', async () => {
      const plusButton = canvasElement.querySelector(PLUS_BUTTON_TESTID);

      if (plusButton) {
        simulateClick(plusButton);
      }

      await waitFor(
        () => {
          const editor = canvasElement.querySelector(TOOLBOX_OPENED_SELECTOR);

          expect(editor).toBeInTheDocument();

          // Verify popover items are rendered
          const items = document.querySelectorAll(POPOVER_ITEM_TESTID);

          expect(items.length).toBeGreaterThan(0);
        },
        TIMEOUT_ACTION
      );
    });
  },
};


