/**
 * EditorModes.stories.ts - Stories for different editor operational modes.
 *
 * This file is the canonical location for:
 * - ReadOnlyMode: Editor in read-only state
 * - EmptyEditor: Editor with no initial content
 * - ToolboxOpenedMode: Editor with toolbox popover open
 * - NarrowMode: Editor in constrained width container
 *
 * Do not duplicate these stories in other files.
 */
import type { Meta, StoryObj } from '@storybook/html-vite';
import { waitFor, expect } from 'storybook/test';
import Blok from '../blok';
import type { OutputData, BlokConfig } from '@/types';
import { simulateClick, waitForIdleCallback, waitForToolbar, TOOLBAR_TESTID } from './helpers';

interface EditorModesArgs {
  minHeight: number;
  width: number;
  data: OutputData | undefined;
  readOnly: boolean;
}

// Constants
const BLOCK_TESTID = '[data-blok-testid="block-wrapper"]';
const ACTIONS_TESTID = '[data-blok-testid="toolbar-actions"]';
const PLUS_BUTTON_TESTID = '[data-blok-testid="plus-button"]';
const TOOLBOX_OPENED_SELECTOR = '[data-blok-toolbox-opened="true"]';

const TIMEOUT_INIT = { timeout: 5000 };
const TIMEOUT_ACTION = { timeout: 5000 };

const sampleData: OutputData = {
  time: Date.now(),
  version: '1.0.0',
  blocks: [
    {
      id: 'mode-block-1',
      type: 'paragraph',
      data: { text: 'First paragraph for testing editor modes.' },
    },
    {
      id: 'mode-block-2',
      type: 'paragraph',
      data: { text: 'Second paragraph with more content.' },
    },
    {
      id: 'mode-block-3',
      type: 'paragraph',
      data: { text: 'Third paragraph block.' },
    },
  ],
};

const createEditor = (args: EditorModesArgs): HTMLElement => {
  const container = document.createElement('div');

  container.style.border = '1px solid #e0e0e0';
  container.style.borderRadius = '8px';
  container.style.padding = '16px';
  container.style.minHeight = `${args.minHeight}px`;
  container.style.backgroundColor = '#fff';

  if (args.width) {
    container.style.width = `${args.width}px`;
  }

  const editorHolder = document.createElement('div');

  editorHolder.id = `blok-editor-${Date.now()}`;
  container.appendChild(editorHolder);

  const config: BlokConfig = {
    holder: editorHolder,
    autofocus: false,
    readOnly: args.readOnly,
    data: args.data,
  };

  setTimeout(async () => {
    const editor = new Blok(config);

    await editor.isReady;
    await waitForIdleCallback();
  }, 0);

  return container;
};

const meta: Meta<EditorModesArgs> = {
  title: 'Editor/Modes',
  tags: ['autodocs'],
  args: {
    minHeight: 300,
    width: 0,
    data: sampleData,
    readOnly: false,
  },
  render: createEditor,
};

export default meta;

type Story = StoryObj<EditorModesArgs>;

/**
 * Normal editing mode (default).
 */
export const NormalMode: Story = {
  args: {
    data: sampleData,
    readOnly: false,
  },
};

/**
 * Read-only mode - content cannot be edited.
 */
export const ReadOnlyMode: Story = {
  args: {
    data: sampleData,
    readOnly: true,
  },
};

/**
 * Narrow mode - editor in a constrained width container.
 * Toolbar actions move inside the content area.
 */
export const NarrowMode: Story = {
  args: {
    data: sampleData,
    readOnly: false,
    width: 400,
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

    await step('Click block to show toolbar in narrow mode', async () => {
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
  },
};

/**
 * Empty editor state - no blocks.
 */
export const EmptyEditor: Story = {
  args: {
    data: undefined,
    readOnly: false,
  },
};

/**
 * Single block editor.
 */
export const SingleBlock: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'single-block-1',
          type: 'paragraph',
          data: { text: 'This is the only block in the editor.' },
        },
      ],
    },
    readOnly: false,
  },
};

/**
 * Editor with many blocks (scrolling behavior).
 */
export const ManyBlocks: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: Array.from({ length: 15 }, (_, i) => ({
        id: `many-block-${i + 1}`,
        type: 'paragraph',
        data: { text: `Paragraph block number ${i + 1}. Lorem ipsum dolor sit amet, consectetur adipiscing elit.` },
      })),
    },
    readOnly: false,
    minHeight: 400,
  },
};

/**
 * Editor focused state with toolbar visible.
 */
export const FocusedWithToolbar: Story = {
  args: {
    data: sampleData,
    readOnly: false,
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

    await step('Focus block to show toolbar', async () => {
      const block = canvasElement.querySelector(BLOCK_TESTID);

      if (block) {
        simulateClick(block);
      }

      await waitFor(
        () => {
          const toolbar = canvasElement.querySelector(TOOLBAR_TESTID);

          expect(toolbar).toHaveAttribute('data-blok-opened', 'true');

          const actionsZone = canvasElement.querySelector(ACTIONS_TESTID);

          expect(actionsZone).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );
    });
  },
};

/**
 * Toolbox opened state (special editor class).
 */
export const ToolboxOpenedMode: Story = {
  args: {
    data: sampleData,
    readOnly: false,
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

    await step('Focus block', async () => {
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
          const editor = canvasElement.querySelector(TOOLBOX_OPENED_SELECTOR);

          expect(editor).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );
    });
  },
};

/**
 * Compact narrow editor (mobile-like).
 */
export const CompactNarrow: Story = {
  args: {
    data: sampleData,
    readOnly: false,
    width: 320,
    minHeight: 200,
  },
};
