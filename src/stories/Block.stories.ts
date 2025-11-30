import type { Meta, StoryObj } from '@storybook/html-vite';
import { userEvent, waitFor, expect } from 'storybook/test';
import type { OutputData } from '@/types';
import { createEditorContainer, simulateClick, waitForToolbar, TOOLBAR_TESTID, triggerSelectAll } from './helpers';
import type { EditorFactoryOptions } from './helpers';

interface BlockArgs extends EditorFactoryOptions {
  minHeight: number;
  data: OutputData | undefined;
  readOnly: boolean;
}

// Constants
const BLOCK_TESTID = '[data-blok-testid="block-wrapper"]';
const CONTENTEDITABLE_SELECTOR = '[contenteditable="true"]';
const BLOCK_SELECTED_SELECTOR = '[data-blok-selected="true"]';

const TIMEOUT_INIT = { timeout: 5000 };
const TIMEOUT_ACTION = { timeout: 5000 };

const sampleData: OutputData = {
  time: Date.now(),
  version: '1.0.0',
  blocks: [
    {
      id: 'block-state-1',
      type: 'paragraph',
      data: { text: 'First block for testing block states.' },
    },
    {
      id: 'block-state-2',
      type: 'paragraph',
      data: { text: 'Second block with different content.' },
    },
    {
      id: 'block-state-3',
      type: 'paragraph',
      data: { text: 'Third block for multi-select testing.' },
    },
  ],
};

const createEditor = (args: BlockArgs): HTMLElement => createEditorContainer(args);

const meta: Meta<BlockArgs> = {
  title: 'Components/Block',
  tags: ['autodocs'],
  args: {
    minHeight: 300,
    data: sampleData,
    readOnly: false,
  },
  render: createEditor,
};

export default meta;

type Story = StoryObj<BlockArgs>;

/**
 * Default state: Blocks displayed without selection.
 */
export const Default: Story = {
  args: {
    data: sampleData,
    readOnly: false,
  },
};

/**
 * Block focused state with cursor inside.
 */
export const Focused: Story = {
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

    await step('Click block to focus', async () => {
      const block = canvasElement.querySelector(BLOCK_TESTID);
      const contentEditable = block?.querySelector(CONTENTEDITABLE_SELECTOR);

      if (contentEditable) {
        simulateClick(contentEditable);
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
 * Block selected state (cross-block selection visual).
 */
export const SelectedByShortcut: Story = {
  args: {
    data: sampleData,
    readOnly: false,
  },
  play: async ({ canvasElement, step }) => {
    await step('Wait for editor and toolbar to initialize', async () => {
      await waitFor(
        () => {
          const blocks = canvasElement.querySelectorAll(BLOCK_TESTID);

          expect(blocks.length).toBeGreaterThan(0);
        },
        TIMEOUT_INIT
      );
      // Wait for toolbar to be created (happens in requestIdleCallback)
      await waitForToolbar(canvasElement);
    });

    await step('Click block to focus', async () => {
      const block = canvasElement.querySelector(BLOCK_TESTID);
      const contentEditable = block?.querySelector(CONTENTEDITABLE_SELECTOR);

      if (contentEditable) {
        simulateClick(contentEditable);
        // Wait a bit for focus to be established
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    });

    await step('Select all blocks with keyboard shortcut', async () => {
      const block = canvasElement.querySelector(BLOCK_TESTID);
      const contentEditable = block?.querySelector(CONTENTEDITABLE_SELECTOR);

      if (contentEditable) {
        // First select-all selects text within the block
        triggerSelectAll(contentEditable);
        // Short delay to let the first selection happen
        await new Promise((resolve) => setTimeout(resolve, 100));
        // Second select-all selects all blocks (cross-block selection)
        triggerSelectAll(contentEditable);
      }

      await waitFor(
        () => {
          const selectedBlocks = canvasElement.querySelectorAll(BLOCK_SELECTED_SELECTOR);

          expect(selectedBlocks.length).toBeGreaterThan(0);
        },
        TIMEOUT_ACTION
      );
    });
  },
};

/**
 * Multiple blocks selected.
 */
export const MultipleSelected: Story = {
  args: {
    data: sampleData,
    readOnly: false,
  },
  play: async ({ canvasElement, step }) => {
    await step('Wait for editor and toolbar to initialize', async () => {
      await waitFor(
        () => {
          const blocks = canvasElement.querySelectorAll(BLOCK_TESTID);

          expect(blocks.length).toBeGreaterThan(2);
        },
        TIMEOUT_INIT
      );
      // Wait for toolbar to be created (happens in requestIdleCallback)
      await waitForToolbar(canvasElement);
    });

    await step('Focus first block', async () => {
      const firstBlock = canvasElement.querySelector(BLOCK_TESTID);
      const contentEditable = firstBlock?.querySelector(CONTENTEDITABLE_SELECTOR);

      if (contentEditable) {
        simulateClick(contentEditable);
        // Wait a bit for focus to be established
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    });

    await step('Select all to trigger multi-block selection', async () => {
      const firstBlock = canvasElement.querySelector(BLOCK_TESTID);
      const contentEditable = firstBlock?.querySelector(CONTENTEDITABLE_SELECTOR);

      if (contentEditable) {
        // First select-all selects text within the block
        triggerSelectAll(contentEditable);
        // Short delay to let the first selection happen
        await new Promise((resolve) => setTimeout(resolve, 100));
        // Second select-all selects all blocks (cross-block selection)
        triggerSelectAll(contentEditable);
      }

      await waitFor(
        () => {
          const selectedBlocks = canvasElement.querySelectorAll(BLOCK_SELECTED_SELECTOR);

          expect(selectedBlocks.length).toBeGreaterThanOrEqual(3);
        },
        TIMEOUT_ACTION
      );
    });
  },
};

/**
 * Block with selection highlight (text selection within block).
 */
export const WithTextSelection: Story = {
  args: {
    data: sampleData,
    readOnly: false,
  },
  play: async ({ canvasElement, step }) => {
    await step('Wait for editor to initialize', async () => {
      await waitFor(
        () => {
          const block = canvasElement.querySelector(BLOCK_TESTID);

          expect(block).toBeInTheDocument();
        },
        TIMEOUT_INIT
      );
    });

    await step('Select text within block', async () => {
      const block = canvasElement.querySelector(BLOCK_TESTID);
      const contentEditable = block?.querySelector(CONTENTEDITABLE_SELECTOR);

      if (contentEditable) {
        await userEvent.click(contentEditable);
        await userEvent.tripleClick(contentEditable);
      }

      const selection = window.getSelection();

      expect(selection?.toString().length).toBeGreaterThan(0);
    });
  },
};

/**
 * Block in read-only mode.
 */
export const ReadOnly: Story = {
  args: {
    data: sampleData,
    readOnly: true,
  },
};

/**
 * Block link hover state.
 */
export const LinkInBlock: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'link-block-1',
          type: 'paragraph',
          data: { text: 'This block contains a <a href="https://example.com">clickable link</a> to test hover states.' },
        },
      ],
    },
    readOnly: false,
  },
  play: async ({ canvasElement, step }) => {
    await step('Wait for editor to initialize', async () => {
      await waitFor(
        () => {
          const link = canvasElement.querySelector('a');

          expect(link).toBeInTheDocument();
        },
        TIMEOUT_INIT
      );
    });

    await step('Hover over link', async () => {
      const link = canvasElement.querySelector('a');

      if (link) {
        await userEvent.hover(link);
      }
    });
  },
};

/**
 * Block with bold and italic text.
 */
export const WithFormattedText: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'formatted-block-1',
          type: 'paragraph',
          data: { text: 'This text has <b>bold</b>, <i>italic</i>, and <b><i>bold italic</i></b> formatting.' },
        },
      ],
    },
    readOnly: false,
  },
};

/**
 * Block fade-in animation on creation.
 */
export const NewBlockAnimation: Story = {
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

    await step('Focus last block and press Enter to create new block', async () => {
      const blocks = canvasElement.querySelectorAll(BLOCK_TESTID);
      const initialBlockCount = blocks.length;
      const lastBlock = blocks[blocks.length - 1];
      const contentEditable = lastBlock?.querySelector(CONTENTEDITABLE_SELECTOR);

      if (contentEditable) {
        simulateClick(contentEditable);
        // Wait a bit for focus to be established
        await new Promise((resolve) => setTimeout(resolve, 100));

        const selection = window.getSelection();
        const range = document.createRange();

        range.selectNodeContents(contentEditable);
        range.collapse(false);
        selection?.removeAllRanges();
        selection?.addRange(range);

        await userEvent.keyboard('{Enter}');
      }

      await waitFor(
        () => {
          const newBlocks = canvasElement.querySelectorAll(BLOCK_TESTID);

          expect(newBlocks.length).toBeGreaterThan(initialBlockCount);
        },
        TIMEOUT_ACTION
      );
    });
  },
};

/**
 * Stretched block - full-width block layout.
 * This state is shown when a block is configured to stretch to full width.
 */
export const StretchedBlock: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'normal-block-1',
          type: 'paragraph',
          data: { text: 'This is a normal width paragraph block.' },
        },
        {
          id: 'stretched-block-1',
          type: 'paragraph',
          data: { text: 'This block has the stretched class applied to demonstrate full-width layout.' },
        },
        {
          id: 'normal-block-2',
          type: 'paragraph',
          data: { text: 'Another normal width paragraph for comparison.' },
        },
      ],
    },
    readOnly: false,
  },
  play: async ({ canvasElement, step }) => {
    await step('Wait for editor to initialize', async () => {
      await waitFor(
        () => {
          const blocks = canvasElement.querySelectorAll(BLOCK_TESTID);

          expect(blocks.length).toBe(3);
        },
        TIMEOUT_INIT
      );
    });

    await step('Apply stretched state to middle block', async () => {
      const blocks = canvasElement.querySelectorAll(BLOCK_TESTID);
      const middleBlock = blocks[1];

      if (middleBlock) {
        middleBlock.setAttribute('data-blok-stretched', 'true');
      }

      await waitFor(
        () => {
          const stretchedBlock = canvasElement.querySelector('[data-blok-stretched="true"]');

          expect(stretchedBlock).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );
    });
  },
};
