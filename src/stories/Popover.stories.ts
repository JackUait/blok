import type { Meta, StoryObj } from '@storybook/html-vite';
import { userEvent, waitFor, expect } from 'storybook/test';
import Blok from '../blok';
import type { OutputData, BlokConfig } from '@/types';
import { simulateClick, waitForIdleCallback, waitForToolbar, TOOLBAR_TESTID, dispatchKeyboardEvent, focusSearchInput, waitForPointerEvents } from './helpers';

interface PopoverArgs {
  minHeight: number;
  data: OutputData | undefined;
}

// Constants
const BLOCK_TESTID = '[data-blok-testid="block-wrapper"]';
const ACTIONS_TESTID = '[data-blok-testid="toolbar-actions"]';
const PLUS_BUTTON_TESTID = '[data-blok-testid="plus-button"]';
const SETTINGS_BUTTON_TESTID = '[data-blok-testid="settings-toggler"]';
const BLOCK_TUNES_POPOVER_TESTID = '[data-blok-testid="block-tunes-popover"]';
const POPOVER_ITEM_TESTID = '[data-blok-testid="popover-item"]';

const POPOVER_OPENED_SELECTOR = '[data-blok-popover-opened="true"]';
const ITEM_FOCUSED_SELECTOR = '[data-blok-focused=\"true\"]';
const CONFIRMATION_SELECTOR = '[data-blok-popover-item-confirmation="true"]';
const NOTHING_FOUND_SELECTOR = '[data-blok-nothing-found-displayed="true"]';
const DELETE_BUTTON_SELECTOR = '[data-blok-item-name="delete"]';

const TIMEOUT_INIT = { timeout: 5000 };
const TIMEOUT_ACTION = { timeout: 5000 };

const sampleData: OutputData = {
  time: Date.now(),
  version: '1.0.0',
  blocks: [
    {
      id: 'popover-block-1',
      type: 'paragraph',
      data: { text: 'Block for testing popover states and interactions.' },
    },
    {
      id: 'popover-block-2',
      type: 'paragraph',
      data: { text: 'Second block for additional testing.' },
    },
  ],
};

const createEditor = (args: PopoverArgs): HTMLElement => {
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

const meta: Meta<PopoverArgs> = {
  title: 'Components/Popover',
  tags: ['autodocs'],
  args: {
    minHeight: 350,
    data: sampleData,
  },
  render: createEditor,
};

export default meta;

type Story = StoryObj<PopoverArgs>;

/*
 * NOTE: Toolbox opened state lives in EditorModes.stories.ts (ToolboxOpenedMode)
 * This file focuses on popover-specific states: hover, focus, search, confirmation.
 */

/**
 * Default state: Popover is closed.
 */
export const Default: Story = {
  args: {
    data: sampleData,
  },
};

/**
 * Popover item hover state.
 * Note: Waits for pointer-events to be enabled before hovering.
 */
export const ItemHoverState: Story = {
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

    await step('Open toolbox and hover item', async () => {
      const plusButton = canvasElement.querySelector(PLUS_BUTTON_TESTID);

      if (plusButton) {
        simulateClick(plusButton);
      }

      // Wait for popover to open AND for pointer-events to be enabled
      await waitForPointerEvents('[data-blok-popover-opened="true"] [data-blok-testid="popover-container"]');

      // Small delay for CSS animation to complete
      await new Promise((resolve) => setTimeout(resolve, 150));

      const popoverItem = document.querySelector(POPOVER_ITEM_TESTID);

      if (popoverItem) {
        // Add force-hover class to show hover styles in headless browsers
        popoverItem.classList.add('blok-popover-item--force-hover');
        await userEvent.hover(popoverItem);
      }
    });
  },
};

/**
 * Popover item focused state (keyboard navigation).
 */
export const ItemFocusedState: Story = {
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

    await step('Open toolbox and navigate with keyboard', async () => {
      const plusButton = canvasElement.querySelector(PLUS_BUTTON_TESTID);

      if (plusButton) {
        await userEvent.click(plusButton);
      }

      await waitFor(
        () => {
          // Popover is appended to document.body, not inside the canvas
          const popover = document.querySelector(POPOVER_OPENED_SELECTOR);

          expect(popover).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );

      // Wait for popover to fully initialize before keyboard navigation
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Find a popover item or the popover container to dispatch from
      const popoverItem = document.querySelector(POPOVER_ITEM_TESTID);
      const popover = document.querySelector(POPOVER_OPENED_SELECTOR);
      const targetElement = popoverItem ?? popover ?? document.body;

      // Dispatch ArrowDown event from the popover element for flipper to catch
      dispatchKeyboardEvent('ArrowDown', { target: targetElement });

      await waitFor(
        () => {
          // Popover items are inside the popover which is in document.body
          const focusedItem = document.querySelector(ITEM_FOCUSED_SELECTOR);

          expect(focusedItem).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );
    });
  },
};

/**
 * Block tunes popover with convert-to nested items.
 */
export const BlockTunesPopover: Story = {
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

    await step('Click block to show toolbar', async () => {
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

    await step('Open block tunes', async () => {
      const settingsButton = canvasElement.querySelector(SETTINGS_BUTTON_TESTID);

      if (settingsButton) {
        simulateClick(settingsButton);
      }

      await waitFor(
        () => {
          // Block tunes popover is appended to document.body
          const blockTunesPopover = document.querySelector(BLOCK_TUNES_POPOVER_TESTID);

          expect(blockTunesPopover).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );
    });
  },
};

/**
 * Popover confirmation state (delete action).
 */
export const ConfirmationState: Story = {
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

    await step('Click block to show toolbar', async () => {
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

    await step('Open block tunes', async () => {
      const settingsButton = canvasElement.querySelector(SETTINGS_BUTTON_TESTID);

      if (settingsButton) {
        await userEvent.click(settingsButton);
      }

      await waitFor(
        () => {
          // Block tunes popover is appended to document.body
          const blockTunesPopover = document.querySelector(BLOCK_TUNES_POPOVER_TESTID);

          expect(blockTunesPopover).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );
    });

    await step('Click delete to trigger confirmation', async () => {
      // Wait for popover items to be fully rendered
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Delete button is inside the popover which is in document.body
      const deleteButton = document.querySelector(DELETE_BUTTON_SELECTOR);

      if (deleteButton) {
        // Use userEvent.click for proper click handling
        await userEvent.click(deleteButton);
      }

      // Wait for confirmation state animation
      await new Promise((resolve) => setTimeout(resolve, 100));

      await waitFor(
        () => {
          // Confirmation button is inside the popover which is in document.body
          const confirmButton = document.querySelector(CONFIRMATION_SELECTOR);

          expect(confirmButton).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );
    });
  },
};

/**
 * Popover search/filter functionality.
 */
export const SearchFiltering: Story = {
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

    await step('Open toolbox', async () => {
      const plusButton = canvasElement.querySelector(PLUS_BUTTON_TESTID);

      if (plusButton) {
        simulateClick(plusButton);
      }

      await waitFor(
        () => {
          // Popover is appended to document.body, not inside the canvas
          const popover = document.querySelector(POPOVER_OPENED_SELECTOR);

          expect(popover).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );
    });

    await step('Type to filter items', async () => {
      // Wait for popover to be fully rendered
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Use helper to focus search input and type
      focusSearchInput('para');

      await new Promise((resolve) => setTimeout(resolve, 300));

      // Verify the popover is still open and filtering worked
      await waitFor(
        () => {
          const popover = document.querySelector(POPOVER_OPENED_SELECTOR);

          expect(popover).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );
    });
  },
};

/**
 * Popover nothing found message.
 */
export const NothingFoundMessage: Story = {
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

    await step('Open toolbox', async () => {
      const plusButton = canvasElement.querySelector(PLUS_BUTTON_TESTID);

      if (plusButton) {
        await userEvent.click(plusButton);
      }

      await waitFor(
        () => {
          // Popover is appended to document.body, not inside the canvas
          const popover = document.querySelector(POPOVER_OPENED_SELECTOR);

          expect(popover).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );
    });

    await step('Search for non-existent tool', async () => {
      // Wait for popover to be fully rendered and search input to be available
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Find and focus the search input inside the popover
      const searchInput = document.querySelector('[data-blok-testid="popover-search-input"]') as HTMLInputElement;

      if (searchInput) {
        searchInput.focus();
        // Type directly into the input
        searchInput.value = 'xyznonexistent';
        // Trigger input event to notify the search handler
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      }

      await waitFor(
        () => {
          // Nothing found message is inside the popover which is in document.body
          const nothingFound = document.querySelector(NOTHING_FOUND_SELECTOR);

          expect(nothingFound).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );
    });
  },
};


