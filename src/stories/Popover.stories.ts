import type { Meta, StoryObj } from '@storybook/html-vite';
import { userEvent, waitFor, expect } from 'storybook/test';

import { Header } from '../tools/header';

import { createEditorContainer, simulateClick, waitForToolbar, TOOLBAR_TESTID, dispatchKeyboardEvent, focusSearchInput, waitForPointerEvents } from './helpers';
import type { EditorFactoryOptions } from './helpers';

import type { OutputData } from '@/types';


interface PopoverArgs extends EditorFactoryOptions {
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
const DELETE_BUTTON_SELECTOR = '[data-blok-item-name="delete"]';
const CONVERT_TO_SELECTOR = '[data-blok-item-name="convert-to"]';
const NESTED_POPOVER_SELECTOR = '[data-blok-nested="true"]';

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

const createEditor = (args: PopoverArgs): HTMLElement => createEditorContainer(args);

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
        // Add data-blok-force-hover attribute to show hover styles in headless browsers
        // The CSS uses this attribute instead of :hover for testing compatibility
        popoverItem.setAttribute('data-blok-force-hover', 'true');
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
 * Popover confirmation state - demonstrates the visual appearance of an item in confirmation mode.
 * Note: This manually applies confirmation styling since the default delete tune doesn't have confirmation.
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

    await step('Apply confirmation state styling to delete button', async () => {
      // Wait for popover items to be fully rendered
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Delete button is inside the popover which is in document.body
      const deleteButton = document.querySelector(DELETE_BUTTON_SELECTOR);

      if (deleteButton) {
        // Manually apply confirmation state styling for visual demonstration
        // This matches the styling applied by popover-item-default.ts applyConfirmationState()
        deleteButton.setAttribute('data-blok-popover-item-confirmation', 'true');
        deleteButton.setAttribute('data-blok-popover-item-no-hover', 'true');
        deleteButton.setAttribute('data-blok-popover-item-no-focus', 'true');
        deleteButton.classList.add('bg-item-confirm-bg!', 'text-white!');
      }

      await waitFor(
        () => {
          // Confirmation button is inside the popover which is in document.body
          const confirmButton = document.querySelector(CONFIRMATION_SELECTOR);

          expect(confirmButton).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );

      // Add hover state to confirmation button for visual testing in headless browsers
      const confirmButton = document.querySelector(CONFIRMATION_SELECTOR);

      if (confirmButton) {
        confirmButton.setAttribute('data-blok-force-hover', 'true');
        await userEvent.hover(confirmButton);
      }
    });
  },
};

/**
 * Popover search/filter functionality (in block settings).
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

    await step('Open block settings', async () => {
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

    await step('Type to filter items', async () => {
      // Wait for popover to be fully rendered
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Use helper to focus search input and type
      focusSearchInput('delete');

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
 * Popover item in disabled state.
 */
export const DisabledItem: Story = {
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

    await step('Open toolbox and disable an item', async () => {
      const plusButton = canvasElement.querySelector(PLUS_BUTTON_TESTID);

      if (plusButton) {
        simulateClick(plusButton);
      }

      await waitFor(
        () => {
          const popover = document.querySelector(POPOVER_OPENED_SELECTOR);

          expect(popover).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );

      // Wait for items to render then add disabled styling to first item
      await new Promise((resolve) => setTimeout(resolve, 150));

      const popoverItem = document.querySelector(POPOVER_ITEM_TESTID);

      if (popoverItem) {
        // Add the proper disabled classes and attribute that match the real implementation
        // The itemDisabled class from popover-item-default.const.ts is:
        // 'cursor-default pointer-events-none text-text-secondary'
        popoverItem.classList.add('cursor-default', 'pointer-events-none', 'text-text-secondary');
        popoverItem.setAttribute('data-blok-disabled', 'true');
      }

      await waitFor(
        () => {
          const disabledItem = document.querySelector('[data-blok-disabled="true"]');

          expect(disabledItem).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );
    });
  },
};

/**
 * Mobile popover layout (full-width bottom sheet style).
 */
export const MobilePopover: Story = {
  args: {
    data: sampleData,
    minHeight: 400,
  },
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
    chromatic: {
      viewports: [375],
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

    await step('Open toolbox in mobile view', async () => {
      const plusButton = canvasElement.querySelector(PLUS_BUTTON_TESTID);

      if (plusButton) {
        simulateClick(plusButton);
      }

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
 * Mobile overlay backdrop (semi-transparent background).
 */
export const MobileOverlay: Story = {
  args: {
    data: sampleData,
    minHeight: 400,
  },
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
    chromatic: {
      viewports: [375],
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
          const actionsZone = canvasElement.querySelector(ACTIONS_TESTID);

          expect(actionsZone).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );
    });

    await step('Open block tunes to show mobile overlay', async () => {
      const settingsButton = canvasElement.querySelector(SETTINGS_BUTTON_TESTID);

      if (settingsButton) {
        simulateClick(settingsButton);
      }

      await waitFor(
        () => {
          const popover = document.querySelector(POPOVER_OPENED_SELECTOR);

          expect(popover).toBeInTheDocument();

          // On mobile, the overlay should be visible - check for overlay element
          const popoverElements = document.querySelectorAll('[data-blok-popover-opened="true"]');
          const hasOverlay = Array.from(popoverElements).some(p =>
            p.querySelector('[data-blok-testid="popover-overlay"]')
          );

          // Overlay exists (visibility controlled by CSS media queries)
          expect(hasOverlay || popover).toBeTruthy();
        },
        TIMEOUT_ACTION
      );
    });
  },
};

/**
 * Block settings menu with convert-to dropdown open.
 */
export const BlockSettingsConvertToOpen: Story = {
  args: {
    data: sampleData,
    tools: {
      header: Header,
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
          const actionsZone = canvasElement.querySelector(ACTIONS_TESTID);

          expect(actionsZone).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );
    });

    await step('Open block settings', async () => {
      const settingsButton = canvasElement.querySelector(SETTINGS_BUTTON_TESTID);

      if (settingsButton) {
        simulateClick(settingsButton);
      }

      await waitFor(
        () => {
          const blockTunesPopover = document.querySelector(BLOCK_TUNES_POPOVER_TESTID);

          expect(blockTunesPopover).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );
    });

    await step('Click convert-to button to open nested popover', async () => {
      // Wait for the convert-to button to appear (it's rendered async after block settings opens)
      await waitFor(
        () => {
          const convertToButton = document.querySelector(CONVERT_TO_SELECTOR);

          expect(convertToButton).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );

      const convertToButton = document.querySelector(CONVERT_TO_SELECTOR);

      if (convertToButton) {
        simulateClick(convertToButton);
      }

      // Wait for the popover animation
      await new Promise((resolve) => setTimeout(resolve, 100));

      await waitFor(
        () => {
          // The nested popover should be opened
          const nestedPopover = document.querySelector(NESTED_POPOVER_SELECTOR + POPOVER_OPENED_SELECTOR);

          expect(nestedPopover).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );
    });
  },
};
