import type { Meta, StoryObj } from '@storybook/html-vite';
import { userEvent, waitFor, expect } from 'storybook/test';
import type { OutputData } from '@/types';
import { createEditorContainer, simulateClick, waitForToolbar, selectTextInBlock, waitForPointerEvents } from './helpers';
import type { EditorFactoryOptions } from './helpers';
import Header from '../tools/header';

interface InlineToolbarArgs extends EditorFactoryOptions {
  minHeight: number;
  data: OutputData | undefined;
}

// Constants
const BLOCK_TESTID = '[data-blok-testid="block-wrapper"]';
const INLINE_TOOLBAR_TESTID = '[data-blok-testid="inline-toolbar"]';
const INLINE_TOOL_INPUT_TESTID = '[data-blok-testid="inline-tool-input"]';
const CONTENTEDITABLE_SELECTOR = '[contenteditable="true"]';
const LINK_TOOL_SELECTOR = '[data-blok-item-name="link"]';
const CONVERT_TO_SELECTOR = '[data-blok-item-name="convert-to"]';
const POPOVER_OPENED_SELECTOR = '[data-blok-popover-opened="true"]';
const NESTED_POPOVER_SELECTOR = '[data-blok-nested="true"]';

const TIMEOUT_INIT = { timeout: 5000 };
const TIMEOUT_ACTION = { timeout: 5000 };

const sampleData: OutputData = {
  time: Date.now(),
  version: '1.0.0',
  blocks: [
    {
      id: 'inline-block-1',
      type: 'paragraph',
      data: { text: 'Select this text to see the inline toolbar appear with formatting options.' },
    },
    {
      id: 'inline-block-2',
      type: 'paragraph',
      data: { text: 'This paragraph has <strong>bold text</strong> and <em>italic text</em> already applied.' },
    },
    {
      id: 'inline-block-3',
      type: 'paragraph',
      data: { text: 'This paragraph contains a <a href="https://example.com">link to example</a> website.' },
    },
  ],
};

const createEditor = (args: InlineToolbarArgs): HTMLElement => createEditorContainer(args);

/**
 * Helper to select text within an element
 */
const selectText = (element: Element, start: number, end: number): void => {
  const range = document.createRange();
  const textNode = element.firstChild;

  if (textNode && textNode.nodeType === Node.TEXT_NODE) {
    range.setStart(textNode, start);
    range.setEnd(textNode, end);

    const selection = window.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);
  }
};

const meta: Meta<InlineToolbarArgs> = {
  title: 'Components/Inline Toolbar',
  tags: ['autodocs'],
  args: {
    minHeight: 300,
    data: sampleData,
    tools: {
      header: Header,
    },
  },
  render: createEditor,
};

export default meta;

type Story = StoryObj<InlineToolbarArgs>;

/**
 * Default state: Inline toolbar is hidden until text is selected.
 */
export const Default: Story = {
  args: {
    data: sampleData,
  },
};

/**
 * Inline toolbar visible after selecting text.
 */
export const WithTextSelection: Story = {
  args: {
    data: sampleData,
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

    await step('Select text to show inline toolbar', async () => {
      const block = canvasElement.querySelector(BLOCK_TESTID);
      const contentEditable = block?.querySelector(CONTENTEDITABLE_SELECTOR);

      if (contentEditable) {
        simulateClick(contentEditable);
        selectText(contentEditable, 0, 11);
        document.dispatchEvent(new Event('selectionchange'));
      }

      await waitFor(
        () => {
          const inlineToolbar = document.querySelector(INLINE_TOOLBAR_TESTID);

          expect(inlineToolbar).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );
    });
  },
};

/**
 * Bold tool active state when selected text is bold.
 */
export const BoldActive: Story = {
  args: {
    data: sampleData,
  },
  play: async ({ canvasElement, step }) => {
    await step('Wait for editor to initialize', async () => {
      await waitFor(
        () => {
          const blocks = canvasElement.querySelectorAll(BLOCK_TESTID);

          expect(blocks.length).toBeGreaterThan(1);
        },
        TIMEOUT_INIT
      );
    });

    await step('Select bold text to show active state', async () => {
      const blocks = canvasElement.querySelectorAll(BLOCK_TESTID);
      const secondBlock = blocks[1];

      // Use 'strong' selector - browsers normalize <b> to <strong>
      if (secondBlock) {
        selectTextInBlock(secondBlock, 'strong');
      }

      await waitFor(
        () => {
          const inlineToolbar = document.querySelector(INLINE_TOOLBAR_TESTID);

          expect(inlineToolbar).toBeInTheDocument();

          // Verify bold tool shows active state
          const boldTool = document.querySelector('[data-blok-item-name="bold"]');

          expect(boldTool).toHaveAttribute('data-blok-popover-item-active', 'true');
        },
        TIMEOUT_ACTION
      );
    });
  },
};

/**
 * Italic tool active state when selected text is italic.
 */
export const ItalicActive: Story = {
  args: {
    data: sampleData,
  },
  play: async ({ canvasElement, step }) => {
    await step('Wait for editor to initialize', async () => {
      await waitFor(
        () => {
          const blocks = canvasElement.querySelectorAll(BLOCK_TESTID);

          expect(blocks.length).toBeGreaterThan(1);
        },
        TIMEOUT_INIT
      );
    });

    await step('Select italic text to show active state', async () => {
      const blocks = canvasElement.querySelectorAll(BLOCK_TESTID);
      const secondBlock = blocks[1];

      // Use 'em' selector - browsers normalize <i> to <em>
      if (secondBlock) {
        selectTextInBlock(secondBlock, 'em');
      }

      await waitFor(
        () => {
          const inlineToolbar = document.querySelector(INLINE_TOOLBAR_TESTID);

          expect(inlineToolbar).toBeInTheDocument();

          // Verify italic tool shows active state
          const italicTool = document.querySelector('[data-blok-item-name="italic"]');

          expect(italicTool).toHaveAttribute('data-blok-popover-item-active', 'true');
        },
        TIMEOUT_ACTION
      );
    });
  },
};

/**
 * Link tool active state when cursor is in a link.
 */
export const LinkActive: Story = {
  args: {
    data: sampleData,
  },
  play: async ({ canvasElement, step }) => {
    await step('Wait for editor to initialize', async () => {
      await waitFor(
        () => {
          const blocks = canvasElement.querySelectorAll(BLOCK_TESTID);

          expect(blocks.length).toBeGreaterThan(2);
        },
        TIMEOUT_INIT
      );
    });

    await step('Select link text to show active/unlink state', async () => {
      const blocks = canvasElement.querySelectorAll(BLOCK_TESTID);
      const thirdBlock = blocks[2];

      if (thirdBlock) {
        selectTextInBlock(thirdBlock, 'a');
      }

      await waitFor(
        () => {
          const inlineToolbar = document.querySelector(INLINE_TOOLBAR_TESTID);

          expect(inlineToolbar).toBeInTheDocument();

          // Verify link tool shows active state
          const linkTool = document.querySelector(LINK_TOOL_SELECTOR);

          expect(linkTool).toHaveAttribute('data-blok-popover-item-active', 'true');
        },
        TIMEOUT_ACTION
      );
    });
  },
};

/**
 * Link input field shown when clicking the link tool.
 */
export const LinkInputShown: Story = {
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

    await step('Select text to show inline toolbar', async () => {
      const block = canvasElement.querySelector(BLOCK_TESTID);
      const contentEditable = block?.querySelector(CONTENTEDITABLE_SELECTOR);

      if (contentEditable) {
        // Focus the element first
        simulateClick(contentEditable);

        // Create a proper selection using the same pattern as other working tests
        const range = document.createRange();
        const textNode = contentEditable.firstChild;

        if (textNode && textNode.nodeType === Node.TEXT_NODE) {
          // Select "Select this" (11 characters)
          range.setStart(textNode, 0);
          range.setEnd(textNode, 11);
        } else {
          // Fallback: select all content
          range.selectNodeContents(contentEditable);
        }

        const selection = window.getSelection();

        selection?.removeAllRanges();
        selection?.addRange(range);

        // Focus the element to ensure selection is active
        (contentEditable as HTMLElement).focus();

        // Dispatch selectionchange event
        document.dispatchEvent(new Event('selectionchange'));
      }

      // Wait for the debounced selection handler (180ms) plus popover creation
      await new Promise((resolve) => setTimeout(resolve, 300));

      await waitFor(
        () => {
          const inlineToolbar = document.querySelector(INLINE_TOOLBAR_TESTID);

          expect(inlineToolbar).toBeInTheDocument();

          // Also verify the popover is populated
          const popoverContainer = inlineToolbar?.querySelector('[data-blok-testid="popover-container"]');

          expect(popoverContainer).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );
    });

    await step('Click link tool to show input', async () => {
      // The link tool should now be available
      const linkTool = document.querySelector(LINK_TOOL_SELECTOR);

      expect(linkTool).toBeInTheDocument();

      if (linkTool) {
        // Click the link tool
        (linkTool as HTMLElement).click();
      }

      // Wait for nested popover to appear
      await waitFor(
        () => {
          // The input is inside a nested popover
          const linkInput = document.querySelector(INLINE_TOOL_INPUT_TESTID);

          expect(linkInput).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );
    });
  },
};

/**
 * Convert-to dropdown opened in inline toolbar.
 */
export const ConvertToDropdownOpen: Story = {
  args: {
    data: sampleData,
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

    await step('Select text to show inline toolbar', async () => {
      const block = canvasElement.querySelector(BLOCK_TESTID);
      const contentEditable = block?.querySelector(CONTENTEDITABLE_SELECTOR);

      if (contentEditable) {
        simulateClick(contentEditable);
        selectText(contentEditable, 0, 11);
        document.dispatchEvent(new Event('selectionchange'));
      }

      await waitFor(
        () => {
          const inlineToolbar = document.querySelector(INLINE_TOOLBAR_TESTID);

          expect(inlineToolbar).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );
    });

    await step('Click convert-to button to open nested popover', async () => {
      // Wait for the convert-to button to appear (it's rendered async after inline toolbar opens)
      await waitFor(
        () => {
          const convertToButton = document.querySelector(CONVERT_TO_SELECTOR);

          expect(convertToButton).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );

      const convertToButton = document.querySelector(CONVERT_TO_SELECTOR);

      if (convertToButton) {
        // Use simulateClick helper which dispatches mousedown, mouseup, and click events
        // This is needed for proper popover event handling
        simulateClick(convertToButton);
      }

      // Wait a bit for the popover animation
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

/**
 * Inline toolbar tool hover state.
 * Note: Adds --force-hover class to bypass @media (hover: hover) in headless browsers.
 */
export const ToolHoverState: Story = {
  args: {
    data: sampleData,
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

    await step('Select text to show inline toolbar', async () => {
      const block = canvasElement.querySelector(BLOCK_TESTID);
      const contentEditable = block?.querySelector(CONTENTEDITABLE_SELECTOR);

      if (contentEditable) {
        simulateClick(contentEditable);
        selectText(contentEditable, 0, 11);
        document.dispatchEvent(new Event('selectionchange'));
      }

      await waitFor(
        () => {
          const inlineToolbar = document.querySelector(INLINE_TOOLBAR_TESTID);

          expect(inlineToolbar).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );
    });

    await step('Hover over bold tool', async () => {
      // Wait for popover to open AND for pointer-events to be enabled
      await waitForPointerEvents(`${INLINE_TOOLBAR_TESTID} [data-blok-testid="popover-container"]`);

      // Small delay for CSS animation to complete
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Find the bold tool specifically by its data attribute
      const boldTool = document.querySelector('[data-blok-item-name="bold"]');

      if (boldTool) {
        // Add force-hover state to show hover styles in headless browsers
        boldTool.setAttribute('data-blok-force-hover', 'true');
        await userEvent.hover(boldTool);
      }
    });
  },
};
