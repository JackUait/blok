import type { Meta, StoryObj } from '@storybook/html-vite';
import { userEvent, waitFor, expect } from 'storybook/test';
import Blok from '../blok';
import type { OutputData, BlokConfig } from '@/types';
import { simulateClick, waitForIdleCallback, waitForToolbar, TOOLBAR_TESTID } from './helpers';

interface ToolbarArgs {
  minHeight: number;
  data: OutputData | undefined;
}

// Constants to avoid duplicate strings
const BLOCK_TESTID = '[data-blok-testid="block-wrapper"]';
const ACTIONS_TESTID = '[data-blok-testid="toolbar-actions"]';
const PLUS_BUTTON_TESTID = '[data-blok-testid="plus-button"]';
const SETTINGS_BUTTON_TESTID = '[data-blok-testid="settings-toggler"]';

const TIMEOUT_INIT = { timeout: 5000 };
const TIMEOUT_ACTION = { timeout: 5000 };

const sampleData: OutputData = {
  time: Date.now(),
  version: '1.0.0',
  blocks: [
    {
      id: 'toolbar-block-1',
      type: 'paragraph',
      data: { text: 'First paragraph block for toolbar testing.' },
    },
    {
      id: 'toolbar-block-2',
      type: 'paragraph',
      data: { text: 'Second paragraph block.' },
    },
    {
      id: 'toolbar-block-3',
      type: 'paragraph',
      data: { text: 'Third paragraph block.' },
    },
  ],
};

const createEditor = (args: ToolbarArgs): HTMLElement => {
  const container = document.createElement('div');

  container.style.border = '1px solid #e0e0e0';
  container.style.borderRadius = '8px';
  container.style.padding = '16px';
  container.style.minHeight = `${args.minHeight}px`;
  container.style.backgroundColor = '#fff';

  const editorHolder = document.createElement('div');

  editorHolder.id = `blok-editor-${Date.now()}`;
  container.appendChild(editorHolder);

  const config: BlokConfig = {
    holder: editorHolder,
    autofocus: false,
    data: args.data,
  };

  setTimeout(async () => {
    const editor = new Blok(config);

    await editor.isReady;
    await waitForIdleCallback();
  }, 0);

  return container;
};

const meta: Meta<ToolbarArgs> = {
  title: 'Components/Toolbar',
  tags: ['autodocs'],
  args: {
    minHeight: 300,
    data: sampleData,
  },
  render: createEditor,
};

export default meta;

type Story = StoryObj<ToolbarArgs>;

/**
 * Default state: Toolbar is hidden until a block is focused/hovered.
 */
export const Default: Story = {
  args: {
    data: sampleData,
  },
};

/**
 * Toolbar visible with actions zone shown when block is hovered.
 */
export const ToolbarVisible: Story = {
  args: {
    data: sampleData,
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
      // Wait for toolbar to be created (happens in requestIdleCallback)
      await waitForToolbar(canvasElement);
    });

    await step('Click on a block to show toolbar', async () => {
      const block = canvasElement.querySelector(BLOCK_TESTID);

      if (block) {
        simulateClick(block);
      }

      await waitFor(
        () => {
          const toolbar = canvasElement.querySelector(TOOLBAR_TESTID);

          expect(toolbar).toBeInTheDocument();
          expect(toolbar).toHaveAttribute('data-blok-opened', 'true');
        },
        TIMEOUT_ACTION
      );
    });

    await step('Verify actions zone is visible', async () => {
      await waitFor(
        () => {
          const actionsZone = canvasElement.querySelector(ACTIONS_TESTID);

          expect(actionsZone).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );
    });
  },
};

/**
 * Plus button hover state.
 */
export const PlusButtonHover: Story = {
  args: {
    data: sampleData,
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
      // Wait for toolbar to be created (happens in requestIdleCallback)
      await waitForToolbar(canvasElement);
    });

    await step('Click on block to show toolbar', async () => {
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

    await step('Hover plus button', async () => {
      const plusButton = canvasElement.querySelector(PLUS_BUTTON_TESTID);

      if (plusButton) {
        await userEvent.hover(plusButton);
      }
    });
  },
};

/*
 * NOTE: Toolbox opened state lives in EditorModes.stories.ts (ToolboxOpenedMode)
 * Block tunes popover and delete confirmation live in Popover.stories.ts
 * This file focuses on toolbar visibility, button states, and hover interactions.
 */

/**
 * Settings button hover state (grab cursor).
 */
export const SettingsButtonHover: Story = {
  args: {
    data: sampleData,
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
      // Wait for toolbar to be created (happens in requestIdleCallback)
      await waitForToolbar(canvasElement);
    });

    await step('Click on block to show toolbar', async () => {
      const block = canvasElement.querySelector(BLOCK_TESTID);

      if (block) {
        simulateClick(block);
      }

      await waitFor(
        () => {
          const actionsZone = canvasElement.querySelector(ACTIONS_TESTID);

          expect(actionsZone).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );
    });

    await step('Hover settings button', async () => {
      const settingsButton = canvasElement.querySelector(SETTINGS_BUTTON_TESTID);

      if (settingsButton) {
        await userEvent.hover(settingsButton);
      }
    });
  },
};


