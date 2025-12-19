/**
 * Placeholder.stories.ts - Stories for placeholder behavior and states.
 *
 * This file is the canonical location for:
 * - CustomPlaceholder: Editor with custom placeholder text
 * - StaticPlaceholder: Default placeholder display
 * - All placeholder visibility and interaction stories
 *
 * Do not duplicate placeholder stories in Editor.stories.ts or other files.
 */
import type { Meta, StoryObj } from '@storybook/html-vite';
import { userEvent, waitFor, expect } from 'storybook/test';
import type { OutputData } from '@/types';
import { createEditorContainer, simulateClick, waitForToolbar, TOOLBAR_TESTID } from './helpers';
import type { EditorFactoryOptions } from './helpers';

interface PlaceholderArgs extends EditorFactoryOptions {
  placeholder: string;
  minHeight: number;
  data: OutputData | undefined;
}

// Constants
const BLOCK_TESTID = '[data-blok-testid="block-wrapper"]';
const PLUS_BUTTON_TESTID = '[data-blok-testid="plus-button"]';
const CONTENTEDITABLE_SELECTOR = '[contenteditable="true"]';
const TOOLBOX_OPENED_SELECTOR = '[data-blok-toolbox-opened="true"]';
const DEFAULT_PLACEHOLDER = 'Start typing here...';

const TIMEOUT_INIT = { timeout: 5000 };
const TIMEOUT_ACTION = { timeout: 5000 };

const createEditor = (args: PlaceholderArgs): HTMLElement => createEditorContainer(args);

const meta: Meta<PlaceholderArgs> = {
  title: 'Components/Placeholder',
  tags: ['autodocs'],
  args: {
    placeholder: DEFAULT_PLACEHOLDER,
    minHeight: 200,
    data: undefined,
  },
  render: createEditor,
};

export default meta;


type Story = StoryObj<PlaceholderArgs>;

/**
 * Empty editor showing static placeholder.
 */
export const StaticPlaceholder: Story = {
  args: {
    placeholder: DEFAULT_PLACEHOLDER,
    data: undefined,
    autofocus: true,
  },
};

/**
 * Empty editor with custom placeholder text.
 */
export const CustomPlaceholder: Story = {
  args: {
    placeholder: 'Write your story...',
    data: undefined,
    autofocus: true,
  },
};

/**
 * Placeholder visible only when block is focused.
 * When the paragraph is blurred, the placeholder is hidden.
 */
export const PlaceholderOnlyOnFocus: Story = {
  args: {
    placeholder: DEFAULT_PLACEHOLDER,
    data: undefined,
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

    await step('Focus empty block to show placeholder', async () => {
      const block = canvasElement.querySelector(BLOCK_TESTID);
      const contentEditable = block?.querySelector(CONTENTEDITABLE_SELECTOR);

      if (contentEditable) {
        await userEvent.click(contentEditable);
      }

      expect(contentEditable).toHaveFocus();
      // Placeholder should be visible when focused
      expect(contentEditable).toHaveAttribute('data-blok-placeholder-active', DEFAULT_PLACEHOLDER);
    });

    await step('Blur block to hide placeholder', async () => {
      const block = canvasElement.querySelector(BLOCK_TESTID);
      const contentEditable = block?.querySelector(CONTENTEDITABLE_SELECTOR) as HTMLElement;

      if (contentEditable) {
        contentEditable.blur();
      }

      await waitFor(
        () => {
          expect(contentEditable).not.toHaveFocus();
        },
        TIMEOUT_ACTION
      );
      // Placeholder is still in the attribute but CSS hides it when not focused
    });
  },
};

/**
 * Placeholder hidden when block has content.
 */
export const PlaceholderHiddenWithContent: Story = {
  args: {
    placeholder: DEFAULT_PLACEHOLDER,
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'content-block-1',
          type: 'paragraph',
          data: { text: 'This block has content, so no placeholder is shown.' },
        },
      ],
    },
  },
};

/**
 * Typing hides placeholder, clearing restores it.
 */
export const TypeAndClearPlaceholder: Story = {
  args: {
    placeholder: DEFAULT_PLACEHOLDER,
    data: undefined,
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

    await step('Focus and type to hide placeholder', async () => {
      const block = canvasElement.querySelector(BLOCK_TESTID);
      const contentEditable = block?.querySelector(CONTENTEDITABLE_SELECTOR);

      if (contentEditable) {
        await userEvent.click(contentEditable);
        await userEvent.type(contentEditable, 'Hello world');
      }

      expect(contentEditable?.textContent).toContain('Hello world');
    });

    await step('Clear content to restore placeholder', async () => {
      const block = canvasElement.querySelector(BLOCK_TESTID);
      const contentEditable = block?.querySelector(CONTENTEDITABLE_SELECTOR);

      if (contentEditable) {
        await userEvent.tripleClick(contentEditable);
        await userEvent.keyboard('{Backspace}');
      }

      await waitFor(
        () => {
          expect(contentEditable?.textContent?.trim()).toBe('');
        },
        TIMEOUT_ACTION
      );
    });
  },
};

/**
 * Multiple blocks - only first empty block shows placeholder.
 */
export const MultipleBlocksPlaceholder: Story = {
  args: {
    placeholder: DEFAULT_PLACEHOLDER,
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'multi-block-1',
          type: 'paragraph',
          data: { text: '' },
        },
        {
          id: 'multi-block-2',
          type: 'paragraph',
          data: { text: 'Second block with content.' },
        },
        {
          id: 'multi-block-3',
          type: 'paragraph',
          data: { text: '' },
        },
      ],
    },
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

    await step('Focus first empty block', async () => {
      const blocks = canvasElement.querySelectorAll(BLOCK_TESTID);
      const firstBlock = blocks[0];
      const contentEditable = firstBlock?.querySelector(CONTENTEDITABLE_SELECTOR);

      if (contentEditable) {
        await userEvent.click(contentEditable);
      }

      expect(contentEditable).toHaveFocus();
    });
  },
};

/**
 * Placeholder with long text (truncation).
 */
export const LongPlaceholder: Story = {
  args: {
    placeholder: 'This is a very long placeholder text that might need to be truncated or wrapped depending on the container width...',
    data: undefined,
    autofocus: true,
  },
};

/**
 * Placeholder opacity transition when toolbox opens.
 */
export const PlaceholderWithToolboxOpen: Story = {
  args: {
    placeholder: DEFAULT_PLACEHOLDER,
    data: undefined,
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

    await step('Open toolbox (placeholder should fade)', async () => {
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
