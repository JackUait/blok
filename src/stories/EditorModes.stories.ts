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
import type { OutputData, API } from '@/types';
import { createEditorContainer, simulateClick, waitForToolbar, TOOLBAR_TESTID } from './helpers';
import type { EditorFactoryOptions, EditorContainer } from './helpers';

interface EditorModesArgs extends EditorFactoryOptions {
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

const createEditor = (args: EditorModesArgs): HTMLElement => createEditorContainer(args);

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

/**
 * RTL (Right-to-Left) mode for languages like Arabic and Hebrew.
 * Text direction and toolbar positioning are mirrored.
 */
export const RTLMode: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'rtl-block-1',
          type: 'paragraph',
          data: { text: 'هذا نص باللغة العربية لاختبار وضع RTL.' },
        },
        {
          id: 'rtl-block-2',
          type: 'paragraph',
          data: { text: 'النص يتدفق من اليمين إلى اليسار.' },
        },
        {
          id: 'rtl-block-3',
          type: 'paragraph',
          data: { text: 'شريط الأدوات والعناصر التحكم معكوسة.' },
        },
      ],
    },
    readOnly: false,
    i18n: {
      direction: 'rtl',
    },
  },
  play: async ({ canvasElement, step }) => {
    await step('Verify RTL class is applied', async () => {
      await waitFor(
        () => {
          const editors = canvasElement.querySelectorAll('[data-blok-testid="editor-wrapper"], [class*="blok-editor"]');
          const rtlEditor = Array.from(editors).find(el => el.classList.contains('blok-editor--rtl'));

          expect(rtlEditor).toBeTruthy();
        },
        TIMEOUT_INIT
      );
    });

    await step('Show toolbar in RTL mode', async () => {
      await waitForToolbar(canvasElement);

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
 * Dragging state - visual feedback when a block is being dragged.
 * Shows grabbing cursor across the editor and demonstrates block reordering.
 */
export const DraggingState: Story = {
  args: {
    data: sampleData,
    readOnly: false,
  },
  play: async ({ canvasElement, step }) => {
    const container = canvasElement.querySelector('[data-story-container]') as EditorContainer | null;

    await step('Wait for editor and toolbar to initialize', async () => {
      await waitFor(
        () => {
          const blocks = canvasElement.querySelectorAll(BLOCK_TESTID);

          expect(blocks.length).toBeGreaterThanOrEqual(3);
          // Also wait for editor instance to be available
          expect(container?.__blokEditor).toBeTruthy();
        },
        TIMEOUT_INIT
      );
      await waitForToolbar(canvasElement);
    });

    await step('Focus block to show toolbar with drag handle', async () => {
      const blocks = canvasElement.querySelectorAll(BLOCK_TESTID);
      const firstBlock = blocks[0];

      if (firstBlock) {
        simulateClick(firstBlock);
      }

      await waitFor(
        () => {
          const toolbar = canvasElement.querySelector(TOOLBAR_TESTID);

          expect(toolbar).toHaveAttribute('data-blok-opened', 'true');
        },
        TIMEOUT_ACTION
      );
    });

    await step('Add dragging class to show visual dragging state', async () => {
      const editors = canvasElement.querySelectorAll('[class*="blok-editor"]');
      const editorWrapper = editors[0];

      if (editorWrapper) {
        editorWrapper.classList.add('blok-editor--dragging');
      }

      await waitFor(
        () => {
          const draggingEditor = Array.from(canvasElement.querySelectorAll('[class*="blok-editor"]'))
            .find(el => el.classList.contains('blok-editor--dragging'));

          expect(draggingEditor).toBeTruthy();
        },
        TIMEOUT_ACTION
      );
    });

    await step('Move first block to third position using editor API', async () => {
      const editor = container?.__blokEditor;

      if (editor) {
        // Move block from index 0 to index 2 (after the current third block)
        // Cast to access the dynamically added blocks API
        (editor as unknown as { blocks: API['blocks'] }).blocks.move(2, 0);
      }

      // Wait a moment for the DOM to update
      await new Promise(resolve => setTimeout(resolve, 300));

      // Verify the blocks have been reordered
      await waitFor(
        () => {
          const blocks = canvasElement.querySelectorAll(BLOCK_TESTID);
          // First block should now contain "Second paragraph" text
          const firstBlockText = blocks[0]?.textContent ?? '';

          expect(firstBlockText).toContain('Second');
        },
        TIMEOUT_ACTION
      );
    });

    await step('Remove dragging class after move completes', async () => {
      // Keep dragging class visible for a moment to show the state
      await new Promise(resolve => setTimeout(resolve, 500));

      const editors = canvasElement.querySelectorAll('[class*="blok-editor"]');
      const editorWrapper = editors[0];

      if (editorWrapper) {
        editorWrapper.classList.remove('blok-editor--dragging');
      }
    });
  },
};

/**
 * Rectangle selection overlay - visual feedback when selecting multiple blocks with mouse drag.
 */
export const RectangleSelection: Story = {
  args: {
    data: sampleData,
    readOnly: false,
  },
  play: async ({ canvasElement, step }) => {
    await step('Wait for editor to initialize', async () => {
      await waitFor(
        () => {
          const blocks = canvasElement.querySelectorAll(BLOCK_TESTID);

          expect(blocks.length).toBeGreaterThan(0);
        },
        TIMEOUT_INIT
      );
    });

    await step('Create and show rectangle selection overlay', async () => {
      // Create the overlay structure manually for visual demonstration
      const editors = canvasElement.querySelectorAll('[class*="blok-editor"]');
      const editorWrapper = editors[0];

      if (editorWrapper) {
        const overlay = document.createElement('div');

        overlay.className = 'blok-editor-overlay';
        overlay.style.position = 'absolute';
        overlay.style.inset = '0';
        overlay.style.pointerEvents = 'none';
        overlay.style.overflow = 'hidden';
        overlay.setAttribute('data-blok-testid', 'selection-overlay');

        const overlayContainer = document.createElement('div');

        overlayContainer.className = 'blok-editor-overlay__container';
        overlayContainer.style.position = 'relative';
        overlayContainer.style.width = '100%';
        overlayContainer.style.height = '100%';

        const rectangle = document.createElement('div');

        rectangle.className = 'blok-editor-overlay__rectangle';
        rectangle.setAttribute('data-blok-testid', 'selection-rectangle');
        rectangle.style.position = 'absolute';
        rectangle.style.top = '50px';
        rectangle.style.left = '20px';
        rectangle.style.width = '200px';
        rectangle.style.height = '100px';
        rectangle.style.backgroundColor = 'rgba(46, 170, 220, 0.2)';
        rectangle.style.border = '1px solid rgba(46, 170, 220, 0.5)';
        rectangle.style.pointerEvents = 'none';

        overlayContainer.appendChild(rectangle);
        overlay.appendChild(overlayContainer);
        editorWrapper.appendChild(overlay);
      }

      await waitFor(
        () => {
          const rectangleOverlay = canvasElement.querySelector('[data-blok-testid="selection-rectangle"]');

          expect(rectangleOverlay).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );
    });
  },
};
