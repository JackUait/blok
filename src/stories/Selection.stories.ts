import type { Meta, StoryObj } from '@storybook/html-vite';
import { waitFor, expect } from 'storybook/test';
import type { OutputData } from '@/types';
import { createEditorContainer, simulateClick, waitForToolbar } from './helpers';
import type { EditorFactoryOptions } from './helpers';

interface SelectionArgs extends EditorFactoryOptions {
  minHeight: number;
  data: OutputData | undefined;
}

// Constants
const BLOCK_TESTID = '[data-blok-testid="block-wrapper"]';
const INLINE_TOOLBAR_TESTID = '[data-blok-testid="inline-toolbar"]';
const INLINE_TOOL_INPUT_TESTID = '[data-blok-testid="inline-tool-input"]';
const CONTENTEDITABLE_SELECTOR = '[contenteditable="true"]';
const LINK_TOOL_SELECTOR = '[data-blok-item-name="link"]';

const TIMEOUT_INIT = { timeout: 5000 };
const TIMEOUT_ACTION = { timeout: 5000 };

const multiLineData: OutputData = {
  time: Date.now(),
  version: '1.0.0',
  blocks: [
    {
      id: 'multi-line-block',
      type: 'paragraph',
      data: {
        text: 'This is the first line of text that spans multiple words. Here is the second sentence with more content. And finally a third sentence to make it longer.',
      },
    },
  ],
};

const multiBlockData: OutputData = {
  time: Date.now(),
  version: '1.0.0',
  blocks: [
    {
      id: 'block-1',
      type: 'paragraph',
      data: { text: 'First paragraph with some text to select from here.' },
    },
    {
      id: 'block-2',
      type: 'paragraph',
      data: { text: 'Second paragraph continues the selection across blocks.' },
    },
    {
      id: 'block-3',
      type: 'paragraph',
      data: { text: 'Third paragraph ends the cross-block selection here.' },
    },
  ],
};

const createEditor = (args: SelectionArgs): HTMLElement => createEditorContainer(args);

const meta: Meta<SelectionArgs> = {
  title: 'Components/Selection',
  tags: ['autodocs'],
  args: {
    minHeight: 300,
    data: multiLineData,
  },
  render: createEditor,
};

export default meta;

type Story = StoryObj<SelectionArgs>;

/**
 * Selects text across multiple words/strings and opens the link input.
 * This demonstrates the fake background selection behavior when focus moves to the link input.
 */
export const MultiStringSelectionWithLinkInput: Story = {
  args: {
    data: multiLineData,
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

    await step('Select text spanning multiple words', async () => {
      const block = canvasElement.querySelector(BLOCK_TESTID);
      const contentEditable = block?.querySelector(CONTENTEDITABLE_SELECTOR);

      if (contentEditable) {
        simulateClick(contentEditable);

        const range = document.createRange();
        const textNode = contentEditable.firstChild;

        if (textNode && textNode.nodeType === Node.TEXT_NODE) {
          // Select "first line of text that spans multiple words" (characters 12-54)
          range.setStart(textNode, 12);
          range.setEnd(textNode, 54);
        } else {
          range.selectNodeContents(contentEditable);
        }

        const selection = window.getSelection();

        selection?.removeAllRanges();
        selection?.addRange(range);

        (contentEditable as HTMLElement).focus();
        document.dispatchEvent(new Event('selectionchange'));
      }

      // Wait for debounced selection handler
      await new Promise((resolve) => setTimeout(resolve, 300));

      await waitFor(
        () => {
          const inlineToolbar = document.querySelector(INLINE_TOOLBAR_TESTID);

          expect(inlineToolbar).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );
    });

    await step('Click link tool to open input', async () => {
      const linkTool = document.querySelector(LINK_TOOL_SELECTOR);

      expect(linkTool).toBeInTheDocument();

      if (linkTool) {
        (linkTool as HTMLElement).click();
      }

      await waitFor(
        () => {
          const linkInput = document.querySelector(INLINE_TOOL_INPUT_TESTID);

          expect(linkInput).toBeInTheDocument();

          // Verify fake background is applied to maintain visual selection
          const fakeBackground = document.querySelector('[data-blok-fake-background="true"]');

          expect(fakeBackground).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );
    });
  },
};

/**
 * Selects text across multiple blocks/paragraphs and opens the link input.
 * This demonstrates cross-block selection with fake background when focus moves to the link input.
 */
export const CrossBlockSelectionWithLinkInput: Story = {
  args: {
    data: multiBlockData,
  },
  play: async ({ canvasElement, step }) => {
    await step('Wait for editor and toolbar to initialize', async () => {
      await waitFor(
        () => {
          const blocks = canvasElement.querySelectorAll(BLOCK_TESTID);

          expect(blocks.length).toBeGreaterThanOrEqual(3);
        },
        TIMEOUT_INIT
      );
      await waitForToolbar(canvasElement);
    });

    await step('Select text across multiple blocks', async () => {
      const blocks = canvasElement.querySelectorAll(BLOCK_TESTID);
      const firstBlock = blocks[0];
      const lastBlock = blocks[2];

      const firstContentEditable = firstBlock?.querySelector(CONTENTEDITABLE_SELECTOR);
      const lastContentEditable = lastBlock?.querySelector(CONTENTEDITABLE_SELECTOR);

      if (firstContentEditable && lastContentEditable) {
        simulateClick(firstContentEditable);

        const range = document.createRange();
        const firstTextNode = firstContentEditable.firstChild;
        const lastTextNode = lastContentEditable.firstChild;

        if (firstTextNode && lastTextNode) {
          // Select from "some text" in first block to "cross-block" in third block
          range.setStart(firstTextNode, 22);
          range.setEnd(lastTextNode, 35);
        }

        const selection = window.getSelection();

        selection?.removeAllRanges();
        selection?.addRange(range);

        (firstContentEditable as HTMLElement).focus();
        document.dispatchEvent(new Event('selectionchange'));
      }

      // Wait for debounced selection handler
      await new Promise((resolve) => setTimeout(resolve, 300));

      await waitFor(
        () => {
          const inlineToolbar = document.querySelector(INLINE_TOOLBAR_TESTID);

          expect(inlineToolbar).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );
    });

    await step('Click link tool to open input', async () => {
      const linkTool = document.querySelector(LINK_TOOL_SELECTOR);

      expect(linkTool).toBeInTheDocument();

      if (linkTool) {
        (linkTool as HTMLElement).click();
      }

      await waitFor(
        () => {
          const linkInput = document.querySelector(INLINE_TOOL_INPUT_TESTID);

          expect(linkInput).toBeInTheDocument();

          // Verify fake background is applied to maintain visual selection across blocks
          const fakeBackgrounds = document.querySelectorAll('[data-blok-fake-background="true"]');

          expect(fakeBackgrounds.length).toBeGreaterThan(0);
        },
        TIMEOUT_ACTION
      );
    });
  },
};
