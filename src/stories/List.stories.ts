import type { Meta, StoryObj } from '@storybook/html-vite';
import { userEvent, waitFor, expect } from 'storybook/test';
import type { OutputData, ToolSettings } from '@/types';
import { createEditorContainer, simulateClick, waitForToolbar, triggerSelectAll } from './helpers';
import type { EditorFactoryOptions } from './helpers';
import Blok from '../blok';
import type { ListConfig } from '../tools/list';

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
 * Sample data with all three list types
 */
const allListTypesData: OutputData = {
  time: Date.now(),
  version: '1.0.0',
  blocks: [
    {
      id: 'unordered-list',
      type: 'list',
      data: {
        style: 'unordered',
        items: [
          { content: 'Unordered item one', checked: false },
          { content: 'Unordered item two', checked: false },
          { content: 'Unordered item three', checked: false },
        ],
      },
    },
    {
      id: 'ordered-list',
      type: 'list',
      data: {
        style: 'ordered',
        items: [
          { content: 'Ordered item one', checked: false },
          { content: 'Ordered item two', checked: false },
          { content: 'Ordered item three', checked: false },
        ],
      },
    },
    {
      id: 'checklist',
      type: 'list',
      data: {
        style: 'checklist',
        items: [
          { content: 'Checklist item one', checked: false },
          { content: 'Checklist item two (completed)', checked: true },
          { content: 'Checklist item three', checked: false },
        ],
      },
    },
  ],
};

/**
 * Sample data with all three list types containing nested items
 */
const allListTypesWithNestedData: OutputData = {
  time: Date.now(),
  version: '1.0.0',
  blocks: [
    {
      id: 'nested-unordered-list',
      type: 'list',
      data: {
        style: 'unordered',
        items: [
          {
            content: 'Fruits',
            checked: false,
            items: [
              {
                content: 'Citrus',
                checked: false,
                items: [
                  { content: 'Orange', checked: false },
                  { content: 'Lemon', checked: false },
                  { content: 'Grapefruit', checked: false },
                ],
              },
              {
                content: 'Berries',
                checked: false,
                items: [
                  { content: 'Strawberry', checked: false },
                  { content: 'Blueberry', checked: false },
                ],
              },
            ],
          },
          {
            content: 'Vegetables',
            checked: false,
            items: [
              { content: 'Carrot', checked: false },
              { content: 'Broccoli', checked: false },
            ],
          },
          { content: 'Grains', checked: false },
        ],
      },
    },
    {
      id: 'nested-ordered-list',
      type: 'list',
      data: {
        style: 'ordered',
        items: [
          {
            content: 'Getting Started',
            checked: false,
            items: [
              { content: 'Install dependencies', checked: false },
              { content: 'Configure environment', checked: false },
              {
                content: 'Set up database',
                checked: false,
                items: [
                  { content: 'Create schema', checked: false },
                  { content: 'Run migrations', checked: false },
                  { content: 'Seed initial data', checked: false },
                ],
              },
            ],
          },
          {
            content: 'Development',
            checked: false,
            items: [
              { content: 'Write code', checked: false },
              { content: 'Write tests', checked: false },
            ],
          },
          {
            content: 'Deployment',
            checked: false,
            items: [
              { content: 'Build application', checked: false },
              { content: 'Deploy to server', checked: false },
            ],
          },
        ],
      },
    },
    {
      id: 'nested-checklist',
      type: 'list',
      data: {
        style: 'checklist',
        items: [
          {
            content: 'Project Setup',
            checked: true,
            items: [
              { content: 'Create repository', checked: true },
              { content: 'Initialize project', checked: true },
              {
                content: 'Configure tooling',
                checked: false,
                items: [
                  { content: 'ESLint', checked: true },
                  { content: 'Prettier', checked: true },
                  { content: 'TypeScript', checked: false },
                ],
              },
            ],
          },
          {
            content: 'Feature Development',
            checked: false,
            items: [
              { content: 'Design UI mockups', checked: true },
              { content: 'Implement components', checked: false },
              { content: 'Add unit tests', checked: false },
            ],
          },
          {
            content: 'Release',
            checked: false,
            items: [
              { content: 'Update changelog', checked: false },
              { content: 'Tag version', checked: false },
            ],
          },
        ],
      },
    },
  ],
};

const createEditor = (args: ListCustomStylesArgs): HTMLElement => {
  const hasCustomStyles = args.itemColor || args.itemSize;

  const listTool = hasCustomStyles
    ? ({
        class: Blok.List,
        config: {
          itemColor: args.itemColor,
          itemSize: args.itemSize,
        } as ListConfig,
      } as ToolSettings)
    : Blok.List;

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
        {
          id: 'interactive-checklist',
          type: 'list',
          data: {
            style: 'checklist',
            items: [
              { content: 'Click me to mark as done', checked: false },
              { content: 'Already completed task', checked: true },
              { content: 'Another task to check off', checked: false },
            ],
          },
        },
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
 * Converts a paragraph into a numbered list.
 */
export const ConvertParagraphsToNumberedList: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'para-1',
          type: 'paragraph',
          data: {
            text: 'First paragraph to convert',
          },
        },
        {
          id: 'para-2',
          type: 'paragraph',
          data: {
            text: 'Second paragraph to convert',
          },
        },
        {
          id: 'para-3',
          type: 'paragraph',
          data: {
            text: 'Third paragraph to convert',
          },
        },
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

      // Verify conversion - all paragraphs should now be list items in a single list
      await waitFor(
        () => {
          const list = canvasElement.querySelector('[data-blok-component="list"]');

          expect(list).toBeInTheDocument();

          // Verify no paragraphs remain
          const paragraphs = canvasElement.querySelectorAll('[data-blok-component="paragraph"]');

          expect(paragraphs.length).toBe(0);

          // Verify list has 3 items (one for each converted paragraph)
          const listItems = list?.querySelectorAll('[data-item-path]');

          expect(listItems?.length).toBe(3);
        },
        TIMEOUT_ACTION
      );
    });
  },
};

/**
 * All three list types (unordered, ordered, checklist) with deeply nested items.
 * Demonstrates hierarchical data structures with multiple nesting levels.
 */
export const AllListTypesWithNestedItems: Story = {
  args: {
    data: allListTypesWithNestedData,
    minHeight: 600,
    readOnly: false,
  },
  play: async ({ canvasElement, step }) => {
    await step('Wait for editor to initialize with all three lists', async () => {
      await waitFor(
        () => {
          const lists = canvasElement.querySelectorAll('[data-blok-component="list"]');

          expect(lists.length).toBe(3);
        },
        TIMEOUT_INIT
      );
    });

    await step('Verify unordered list has nested items', async () => {
      const lists = canvasElement.querySelectorAll('[data-blok-component="list"]');
      const unorderedList = lists[0];

      expect(unorderedList).toBeInTheDocument();

      // Check for nested items using data-item-path attribute (path length > 1 means nested)
      const allItems = unorderedList?.querySelectorAll('[data-item-path]');
      const nestedItems = Array.from(allItems ?? []).filter((item) => {
        const path = JSON.parse(item.getAttribute('data-item-path') || '[]');

        return path.length > 1;
      });

      expect(nestedItems?.length).toBeGreaterThan(0);
    });

    await step('Verify ordered list has nested items', async () => {
      const lists = canvasElement.querySelectorAll('[data-blok-component="list"]');
      const orderedList = lists[1];

      expect(orderedList).toBeInTheDocument();

      // Check for nested items using data-item-path attribute (path length > 1 means nested)
      const allItems = orderedList?.querySelectorAll('[data-item-path]');
      const nestedItems = Array.from(allItems ?? []).filter((item) => {
        const path = JSON.parse(item.getAttribute('data-item-path') || '[]');

        return path.length > 1;
      });

      expect(nestedItems?.length).toBeGreaterThan(0);
    });

    await step('Verify checklist has nested items with checkboxes', async () => {
      const lists = canvasElement.querySelectorAll('[data-blok-component="list"]');
      const checklist = lists[2];

      expect(checklist).toBeInTheDocument();

      // Check for checkboxes in nested items
      const checkboxes = checklist?.querySelectorAll('input[type="checkbox"]');

      expect(checkboxes?.length).toBeGreaterThan(3);

      // Verify some checkboxes are checked (based on our test data)
      const checkedBoxes = checklist?.querySelectorAll('input[type="checkbox"]:checked');

      expect(checkedBoxes?.length).toBeGreaterThan(0);
    });

    await step('Toggle a nested checklist item', async () => {
      const lists = canvasElement.querySelectorAll('[data-blok-component="list"]');
      const checklist = lists[2];
      const checkboxes = checklist?.querySelectorAll('input[type="checkbox"]');

      // Find an unchecked checkbox to toggle
      const uncheckedCheckbox = Array.from(checkboxes ?? []).find(
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
