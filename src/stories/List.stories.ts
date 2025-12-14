import type { Meta, StoryObj } from '@storybook/html-vite';
import { userEvent, waitFor, expect } from 'storybook/test';
import type { OutputData, ToolSettings } from '@/types';
import { createEditorContainer, simulateClick, waitForToolbar, triggerSelectAll } from './helpers';
import type { EditorFactoryOptions } from './helpers';
import Blok from '../blok';
import type { ListConfig } from '../../types/tools/list';

// Constants
const TIMEOUT_INIT = { timeout: 5000 };
const TIMEOUT_ACTION = { timeout: 5000 };

interface ListCustomStylesArgs extends EditorFactoryOptions {
  minHeight: number;
  data: OutputData | undefined;
  readOnly: boolean;
  itemColor: string;
  itemSize: string;
}

/**
 * Sample data with all three list types (ListItem model - each item is a separate block)
 */
const allListTypesData: OutputData = {
  time: Date.now(),
  version: '1.0.0',
  blocks: [
    // Unordered list items
    { id: 'unordered-1', type: 'list', data: { text: 'Unordered item one', style: 'unordered' } },
    { id: 'unordered-2', type: 'list', data: { text: 'Unordered item two', style: 'unordered' } },
    { id: 'unordered-3', type: 'list', data: { text: 'Unordered item three', style: 'unordered' } },
    // Ordered list items
    { id: 'ordered-1', type: 'list', data: { text: 'Ordered item one', style: 'ordered' } },
    { id: 'ordered-2', type: 'list', data: { text: 'Ordered item two', style: 'ordered' } },
    { id: 'ordered-3', type: 'list', data: { text: 'Ordered item three', style: 'ordered' } },
    // Checklist items
    { id: 'checklist-1', type: 'list', data: { text: 'Checklist item one', style: 'checklist', checked: false } },
    { id: 'checklist-2', type: 'list', data: { text: 'Checklist item two (completed)', style: 'checklist', checked: true } },
    { id: 'checklist-3', type: 'list', data: { text: 'Checklist item three', style: 'checklist', checked: false } },
  ],
};

/**
 * Sample data with nested list items (using depth property)
 */
const allListTypesWithNestedData: OutputData = {
  time: Date.now(),
  version: '1.0.0',
  blocks: [
    // Unordered nested list
    { id: 'u-1', type: 'list', data: { text: 'Fruits', style: 'unordered', depth: 0 } },
    { id: 'u-2', type: 'list', data: { text: 'Citrus', style: 'unordered', depth: 1 } },
    { id: 'u-3', type: 'list', data: { text: 'Orange', style: 'unordered', depth: 2 } },
    { id: 'u-4', type: 'list', data: { text: 'Lemon', style: 'unordered', depth: 2 } },
    { id: 'u-5', type: 'list', data: { text: 'Berries', style: 'unordered', depth: 1 } },
    { id: 'u-6', type: 'list', data: { text: 'Strawberry', style: 'unordered', depth: 2 } },
    { id: 'u-7', type: 'list', data: { text: 'Blueberry', style: 'unordered', depth: 2 } },
    { id: 'u-8', type: 'list', data: { text: 'Vegetables', style: 'unordered', depth: 0 } },
    { id: 'u-9', type: 'list', data: { text: 'Carrot', style: 'unordered', depth: 1 } },
    // Ordered nested list
    { id: 'o-1', type: 'list', data: { text: 'Getting Started', style: 'ordered', depth: 0 } },
    { id: 'o-2', type: 'list', data: { text: 'Install dependencies', style: 'ordered', depth: 1 } },
    { id: 'o-3', type: 'list', data: { text: 'Configure environment', style: 'ordered', depth: 1 } },
    { id: 'o-4', type: 'list', data: { text: 'Set up database', style: 'ordered', depth: 1 } },
    { id: 'o-5', type: 'list', data: { text: 'Create schema', style: 'ordered', depth: 2 } },
    { id: 'o-6', type: 'list', data: { text: 'Run migrations', style: 'ordered', depth: 2 } },
    { id: 'o-7', type: 'list', data: { text: 'Development', style: 'ordered', depth: 0 } },
    { id: 'o-8', type: 'list', data: { text: 'Write code', style: 'ordered', depth: 1 } },
    { id: 'o-9', type: 'list', data: { text: 'Write tests', style: 'ordered', depth: 1 } },
    // Checklist nested list
    { id: 'c-1', type: 'list', data: { text: 'Project Setup', style: 'checklist', checked: true, depth: 0 } },
    { id: 'c-2', type: 'list', data: { text: 'Create repository', style: 'checklist', checked: true, depth: 1 } },
    { id: 'c-3', type: 'list', data: { text: 'Initialize project', style: 'checklist', checked: true, depth: 1 } },
    { id: 'c-4', type: 'list', data: { text: 'Configure tooling', style: 'checklist', checked: false, depth: 1 } },
    { id: 'c-5', type: 'list', data: { text: 'ESLint', style: 'checklist', checked: true, depth: 2 } },
    { id: 'c-6', type: 'list', data: { text: 'Prettier', style: 'checklist', checked: true, depth: 2 } },
    { id: 'c-7', type: 'list', data: { text: 'TypeScript', style: 'checklist', checked: false, depth: 2 } },
    { id: 'c-8', type: 'list', data: { text: 'Feature Development', style: 'checklist', checked: false, depth: 0 } },
    { id: 'c-9', type: 'list', data: { text: 'Design UI mockups', style: 'checklist', checked: true, depth: 1 } },
    { id: 'c-10', type: 'list', data: { text: 'Implement components', style: 'checklist', checked: false, depth: 1 } },
  ],
};

const createEditor = (args: ListCustomStylesArgs): HTMLElement => {
  const hasCustomStyles = args.itemColor || args.itemSize;

  const listTool = hasCustomStyles
    ? ({
        class: Blok.List,
        inlineToolbar: true,
        config: {
          itemColor: args.itemColor,
          itemSize: args.itemSize,
        } as ListConfig,
      } as ToolSettings)
    : ({
        class: Blok.List,
        inlineToolbar: true,
      } as ToolSettings);

  return createEditorContainer({
    ...args,
    tools: {
      paragraph: Blok.Paragraph,
      list: listTool,
    },
  });
};

const meta: Meta<ListCustomStylesArgs> = {
  title: 'Tools/List',
  tags: ['autodocs'],
  args: {
    minHeight: 400,
    data: allListTypesData,
    readOnly: false,
    itemColor: '',
    itemSize: '',
  },
  argTypes: {
    itemColor: {
      control: 'color',
      description: 'Custom color for list items (any valid CSS color)',
    },
    itemSize: {
      control: 'text',
      description: 'Custom font size for list items (any valid CSS font-size)',
    },
  },
  render: createEditor,
};

export default meta;

type Story = StoryObj<ListCustomStylesArgs>;

/**
 * Large red list items.
 */
export const LargeRedItems: Story = {
  args: {
    data: allListTypesData,
    itemColor: '#dc2626',
    itemSize: '24px',
  },
};

/**
 * Interactive checklist - click checkboxes to toggle completion state.
 */
export const InteractiveChecklist: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        { id: 'ic-1', type: 'list', data: { text: 'Click me to mark as done', style: 'checklist', checked: false } },
        { id: 'ic-2', type: 'list', data: { text: 'Already completed task', style: 'checklist', checked: true } },
        { id: 'ic-3', type: 'list', data: { text: 'Another task to check off', style: 'checklist', checked: false } },
      ],
    },
    readOnly: false,
  },
  play: async ({ canvasElement, step }) => {
    await step('Wait for editor to initialize', async () => {
      await waitFor(
        () => {
          const checkbox = canvasElement.querySelector('input[type="checkbox"]');

          expect(checkbox).toBeInTheDocument();
        },
        TIMEOUT_INIT
      );
    });

    await step('Toggle first checkbox', async () => {
      const checkboxes = canvasElement.querySelectorAll('input[type="checkbox"]');
      const firstCheckbox = checkboxes[0] as HTMLInputElement;

      if (firstCheckbox) {
        await userEvent.click(firstCheckbox);
      }

      await waitFor(
        () => {
          expect(firstCheckbox.checked).toBe(true);
        },
        TIMEOUT_ACTION
      );
    });
  },
};

/**
 * Read-only mode - lists are displayed but not editable.
 */
export const ReadOnlyLists: Story = {
  args: {
    data: allListTypesData,
    readOnly: true,
  },
};

/**
 * Converts paragraphs into list items.
 */
export const ConvertParagraphsToNumberedList: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        { id: 'para-1', type: 'paragraph', data: { text: 'First paragraph to convert' } },
        { id: 'para-2', type: 'paragraph', data: { text: 'Second paragraph to convert' } },
        { id: 'para-3', type: 'paragraph', data: { text: 'Third paragraph to convert' } },
      ],
    },
    readOnly: false,
  },
  play: async ({ canvasElement, step }) => {
    await step('Wait for editor to initialize', async () => {
      await waitFor(
        () => {
          const paragraphs = canvasElement.querySelectorAll('[data-blok-component="paragraph"]');

          expect(paragraphs.length).toBe(3);
        },
        TIMEOUT_INIT
      );
      // Wait for toolbar to be created
      await waitForToolbar(canvasElement);
    });

    await step('Select all paragraphs', async () => {
      const firstParagraph = canvasElement.querySelector('[data-blok-component="paragraph"] [contenteditable="true"]');

      if (firstParagraph) {
        simulateClick(firstParagraph);

        // Wait for focus to be applied
        await new Promise((resolve) => setTimeout(resolve, 200));

        // First select-all selects text within the block
        triggerSelectAll(firstParagraph);
        // Short delay to let the first selection happen
        await new Promise((resolve) => setTimeout(resolve, 100));
        // Second select-all selects all blocks (cross-block selection)
        triggerSelectAll(firstParagraph);
      }

      // Verify all blocks are selected
      await waitFor(
        () => {
          const selectedBlocks = canvasElement.querySelectorAll('[data-blok-selected="true"]');

          expect(selectedBlocks.length).toBe(3);
        },
        TIMEOUT_ACTION
      );
    });

    await step('Convert to numbered list', async () => {
      // Open block tunes menu via settings toggler
      const settingsToggler = canvasElement.querySelector('[data-blok-testid="settings-toggler"]');

      expect(settingsToggler).toBeInTheDocument();

      if (!settingsToggler) {
        return;
      }

      simulateClick(settingsToggler);

      // Wait for block tunes popover to appear
      await waitFor(
        () => {
          const popover = document.querySelector('[data-blok-testid="block-tunes-popover"]');

          expect(popover).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );

      // Click on "Convert to" option
      const convertToOption = document.querySelector('[data-blok-testid="popover-item"][data-blok-item-name="convert-to"]');

      expect(convertToOption).toBeInTheDocument();

      if (!convertToOption) {
        return;
      }

      simulateClick(convertToOption);

      // Wait for nested popover with conversion options
      await waitFor(
        () => {
          const nestedPopover = document.querySelector('[data-blok-nested="true"][data-blok-popover-opened="true"]');

          expect(nestedPopover).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );

      // Click on numbered list option to convert
      const listOption = document.querySelector('[data-blok-nested="true"] [data-blok-item-name="numbered-list"]');

      expect(listOption).toBeInTheDocument();

      if (listOption) {
        simulateClick(listOption);
      }

      // Verify conversion - each paragraph becomes a separate list block
      await waitFor(
        () => {
          const listBlocks = canvasElement.querySelectorAll('[data-blok-component="list"]');

          expect(listBlocks.length).toBe(3);

          // Verify no paragraphs remain
          const paragraphs = canvasElement.querySelectorAll('[data-blok-component="paragraph"]');

          expect(paragraphs.length).toBe(0);
        },
        TIMEOUT_ACTION
      );
    });
  },
};

/**
 * All three list types (unordered, ordered, checklist) with nested items using depth.
 * Demonstrates hierarchical data structures with multiple nesting levels.
 */
export const AllListTypesWithNestedItems: Story = {
  args: {
    data: allListTypesWithNestedData,
    minHeight: 600,
    readOnly: false,
  },
  play: async ({ canvasElement, step }) => {
    await step('Wait for editor to initialize with list blocks', async () => {
      await waitFor(
        () => {
          const listBlocks = canvasElement.querySelectorAll('[data-blok-component="list"]');

          expect(listBlocks.length).toBeGreaterThan(0);
        },
        TIMEOUT_INIT
      );
    });

    await step('Verify checklist items have checkboxes', async () => {
      // Check for checkboxes in checklist items
      const checkboxes = canvasElement.querySelectorAll('input[type="checkbox"]');

      expect(checkboxes.length).toBeGreaterThan(0);

      // Verify some checkboxes are checked (based on our test data)
      const checkedBoxes = canvasElement.querySelectorAll('input[type="checkbox"]:checked');

      expect(checkedBoxes.length).toBeGreaterThan(0);
    });

    await step('Toggle a checklist item', async () => {
      const checkboxes = canvasElement.querySelectorAll('input[type="checkbox"]');

      // Find an unchecked checkbox to toggle
      const uncheckedCheckbox = Array.from(checkboxes).find(
        (cb) => !(cb as HTMLInputElement).checked
      ) as HTMLInputElement | undefined;

      if (uncheckedCheckbox) {
        await userEvent.click(uncheckedCheckbox);

        await waitFor(
          () => {
            expect(uncheckedCheckbox.checked).toBe(true);
          },
          TIMEOUT_ACTION
        );
      }
    });
  },
};