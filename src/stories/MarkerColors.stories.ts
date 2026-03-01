import type { Meta, StoryObj } from '@storybook/html-vite';
import { waitFor, expect } from 'storybook/test';

import { Marker } from '../tools';

import { createEditorContainer, defaultTools, simulateClick, waitForToolbar, selectTextInBlock, waitForPointerEvents } from './helpers';
import type { EditorFactoryOptions } from './helpers';

import type { OutputData } from '@/types';


interface MarkerColorArgs extends EditorFactoryOptions {
  minHeight: number;
  data: OutputData | undefined;
}

// ---------------------------------------------------------------------------
//  Tools configuration — include the marker inline tool
// ---------------------------------------------------------------------------

const markerTools = {
  ...defaultTools,
  marker: Marker,
};

const createEditor = (args: MarkerColorArgs): HTMLElement =>
  createEditorContainer({ ...args, tools: markerTools });

// ---------------------------------------------------------------------------
//  Color presets (mirrors src/components/shared/color-presets.ts)
// ---------------------------------------------------------------------------

interface Preset {
  name: string;
  text: string;
  bg: string;
}

const PRESETS: Preset[] = [
  { name: 'gray', text: '#787774', bg: '#f1f1ef' },
  { name: 'brown', text: '#9f6b53', bg: '#f4eeee' },
  { name: 'orange', text: '#d9730d', bg: '#fbecdd' },
  { name: 'yellow', text: '#cb9b00', bg: '#fbf3db' },
  { name: 'green', text: '#448361', bg: '#edf3ec' },
  { name: 'teal', text: '#2b9a8f', bg: '#e4f5f3' },
  { name: 'blue', text: '#337ea9', bg: '#e7f3f8' },
  { name: 'purple', text: '#9065b0', bg: '#f6f3f9' },
  { name: 'pink', text: '#c14c8a', bg: '#f9f0f5' },
  { name: 'red', text: '#d44c47', bg: '#fdebec' },
];

// ---------------------------------------------------------------------------
//  Mark-HTML helpers
// ---------------------------------------------------------------------------

/** Wrap `label` in a text-color-only mark. */
const textMark = (hex: string, label: string): string =>
  `<mark style="color: ${hex}; background-color: transparent">${label}</mark>`;

/** Wrap `label` in a background-color mark. */
const bgMark = (hex: string, label: string): string =>
  `<mark style="background-color: ${hex}">${label}</mark>`;

/** Wrap `label` in a dual-color (text + background) mark. */
const dualMark = (textHex: string, bgHex: string, label: string): string =>
  `<mark style="color: ${textHex}; background-color: ${bgHex}">${label}</mark>`;

// ---------------------------------------------------------------------------
//  Meta
// ---------------------------------------------------------------------------

const meta: Meta<MarkerColorArgs> = {
  title: 'Components/Marker Colors',
  tags: ['autodocs'],
  args: {
    minHeight: 200,
    data: undefined,
  },
  render: createEditor,
};

export default meta;


type Story = StoryObj<MarkerColorArgs>;

// ---------------------------------------------------------------------------
//  Interaction constants & helpers
// ---------------------------------------------------------------------------

const BLOCK_TESTID = '[data-blok-testid="block-wrapper"]';
const INLINE_TOOLBAR_TESTID = '[data-blok-testid="inline-toolbar"]';
const CONTENTEDITABLE_SELECTOR = '[contenteditable="true"]';
const MARKER_TOOL_SELECTOR = '[data-blok-item-name="marker"]';
const MARKER_PICKER_SELECTOR = '[data-blok-testid="marker-picker"]';
const MARKER_TAB_BG_SELECTOR = '[data-blok-testid="marker-tab-background-color"]';
const MARKER_GRID_SELECTOR = '[data-blok-testid="marker-grid"]';
const TIMEOUT_INIT = { timeout: 5000 };
const TIMEOUT_ACTION = { timeout: 5000 };

/**
 * Shared helper: waits for the editor to initialize, selects text in the
 * first block's contenteditable, opens the inline toolbar, then clicks the
 * marker tool to reveal the color picker.
 */
const openMarkerPicker = async (canvasElement: HTMLElement): Promise<void> => {
  // 1. Wait for the editor block to appear
  await waitFor(
    () => {
      const block = canvasElement.querySelector(BLOCK_TESTID);

      expect(block).toBeInTheDocument();
    },
    TIMEOUT_INIT
  );

  // 2. Wait for toolbar initialization via requestIdleCallback
  await waitForToolbar(canvasElement);

  // 3. Select text in the first block's contenteditable
  const block = canvasElement.querySelector(BLOCK_TESTID);
  const contentEditable = block?.querySelector(CONTENTEDITABLE_SELECTOR);

  if (contentEditable) {
    simulateClick(contentEditable);

    const range = document.createRange();

    range.selectNodeContents(contentEditable);

    const selection = window.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);

    (contentEditable as HTMLElement).focus();

    // 4. Dispatch selectionchange event
    document.dispatchEvent(new Event('selectionchange'));
  }

  // 5. Wait for debounced selection handler (180ms) plus popover creation
  await new Promise((resolve) => setTimeout(resolve, 300));

  // 6. Wait for inline toolbar to appear
  await waitFor(
    () => {
      const inlineToolbar = document.querySelector(INLINE_TOOLBAR_TESTID);

      expect(inlineToolbar).toBeInTheDocument();
    },
    TIMEOUT_ACTION
  );

  // 7. Wait for pointer events on the popover container
  await waitForPointerEvents(`${INLINE_TOOLBAR_TESTID} [data-blok-testid="popover-container"]`);

  // Small delay for CSS animation to complete
  await new Promise((resolve) => setTimeout(resolve, 150));

  // 8. Click the marker tool to open the picker
  const markerTool = document.querySelector(MARKER_TOOL_SELECTOR);

  expect(markerTool).toBeInTheDocument();

  if (markerTool) {
    simulateClick(markerTool);
  }

  // 9. Wait for the picker element to appear
  await waitFor(
    () => {
      const picker = document.querySelector(MARKER_PICKER_SELECTOR);

      expect(picker).toBeInTheDocument();
    },
    TIMEOUT_ACTION
  );
};

// ---------------------------------------------------------------------------
//  Interaction data fixtures
// ---------------------------------------------------------------------------

/** Plain text paragraph for picker interaction tests. */
const pickerData: OutputData = {
  time: Date.now(),
  version: '1.0.0',
  blocks: [
    {
      id: 'picker-block-1',
      type: 'paragraph',
      data: { text: 'Select this text to open the marker color picker.' },
    },
  ],
};

/** Paragraph with pre-applied red text color for active-swatch tests. */
const preColoredTextData: OutputData = {
  time: Date.now(),
  version: '1.0.0',
  blocks: [
    {
      id: 'pre-color-text-1',
      type: 'paragraph',
      data: {
        text: '<mark style="color: #d44c47; background-color: transparent">Red colored text</mark>',
      },
    },
  ],
};

/** Paragraph with pre-applied orange background color for active-swatch tests. */
const preColoredBgData: OutputData = {
  time: Date.now(),
  version: '1.0.0',
  blocks: [
    {
      id: 'pre-color-bg-1',
      type: 'paragraph',
      data: {
        text: '<mark style="background-color: #fbecdd">Orange highlighted text</mark>',
      },
    },
  ],
};

// ---------------------------------------------------------------------------
//  Static stories
// ---------------------------------------------------------------------------

/**
 * Single paragraph showing all 10 text-color presets.
 * Each color name is rendered with its corresponding foreground hex value.
 */
export const AllTextColors: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'text-colors-1',
          type: 'paragraph',
          data: {
            text: PRESETS.map((p) => textMark(p.text, p.name)).join(' '),
          },
        },
      ],
    },
  },
};

/**
 * Single paragraph showing all 10 background-color presets.
 * Each color name is highlighted with its corresponding background hex value.
 */
export const AllBackgroundColors: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'bg-colors-1',
          type: 'paragraph',
          data: {
            text: PRESETS.map((p) => bgMark(p.bg, p.name)).join(' '),
          },
        },
      ],
    },
  },
};

/**
 * Ten paragraphs — one per preset — each showing the same-preset text + background
 * combo applied to a full sentence.
 */
export const DualColorMatrix: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: PRESETS.map((p) => ({
        id: `dual-${p.name}`,
        type: 'paragraph',
        data: {
          text: dualMark(
            p.text,
            p.bg,
            `This sentence uses the ${p.name} preset with text and background color.`
          ),
        },
      })),
    },
  },
};

/**
 * Bold text rendered with each of the 10 text-color presets.
 * Verifies that marker styles compose correctly with the bold inline tool.
 */
export const ColorWithBold: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'bold-colors-1',
          type: 'paragraph',
          data: {
            text: PRESETS.map(
              (p) => textMark(p.text, `<strong>Bold ${p.name}</strong>`)
            ).join(' '),
          },
        },
      ],
    },
  },
};

/**
 * Italic text rendered with each of the 10 text-color presets.
 * Verifies that marker styles compose correctly with the italic inline tool.
 */
export const ColorWithItalic: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'italic-colors-1',
          type: 'paragraph',
          data: {
            text: PRESETS.map(
              (p) => textMark(p.text, `<em>Italic ${p.name}</em>`)
            ).join(' '),
          },
        },
      ],
    },
  },
};

// ---------------------------------------------------------------------------
//  PICKER UI — Interaction stories with play functions
// ---------------------------------------------------------------------------

/**
 * Opens the marker picker on the text-color tab and verifies the grid
 * contains exactly 10 color swatches.
 */
export const PickerTextTab: Story = {
  args: {
    data: pickerData,
  },
  play: async ({ canvasElement, step }) => {
    await step('Open marker picker on text tab', async () => {
      await openMarkerPicker(canvasElement);

      await waitFor(
        () => {
          const grid = document.querySelector(MARKER_GRID_SELECTOR);
          const swatches = grid?.querySelectorAll('button');

          expect(swatches?.length).toBe(10);
        },
        TIMEOUT_ACTION
      );
    });
  },
};

/**
 * Opens the marker picker, switches to the background-color tab, and
 * verifies the grid contains exactly 10 color swatches.
 */
export const PickerBackgroundTab: Story = {
  args: {
    data: pickerData,
  },
  play: async ({ canvasElement, step }) => {
    await step('Open marker picker', async () => {
      await openMarkerPicker(canvasElement);
    });

    await step('Switch to background tab', async () => {
      const bgTab = document.querySelector(MARKER_TAB_BG_SELECTOR);

      expect(bgTab).toBeInTheDocument();

      if (bgTab) {
        simulateClick(bgTab);
      }

      await waitFor(
        () => {
          const grid = document.querySelector(MARKER_GRID_SELECTOR);

          expect(grid?.querySelectorAll('button')?.length).toBe(10);
        },
        TIMEOUT_ACTION
      );
    });
  },
};

/**
 * Selects pre-colored red text, opens the marker picker, and verifies the
 * red swatch shows an active ring indicator.
 */
export const PickerActiveTextSwatch: Story = {
  args: {
    data: preColoredTextData,
  },
  play: async ({ canvasElement, step }) => {
    await step('Select pre-colored text and open picker', async () => {
      // Wait for the editor block to appear
      await waitFor(
        () => {
          const block = canvasElement.querySelector(BLOCK_TESTID);

          expect(block).toBeInTheDocument();
        },
        TIMEOUT_INIT
      );

      // Wait for toolbar initialization
      await waitForToolbar(canvasElement);

      // Select the <mark> element text
      const block = canvasElement.querySelector(BLOCK_TESTID);

      if (block) {
        selectTextInBlock(block, 'mark');
      }

      // Wait for debounced selection handler
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Wait for inline toolbar
      await waitFor(
        () => {
          const inlineToolbar = document.querySelector(INLINE_TOOLBAR_TESTID);

          expect(inlineToolbar).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );

      // Wait for pointer events
      await waitForPointerEvents(`${INLINE_TOOLBAR_TESTID} [data-blok-testid="popover-container"]`);
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Click the marker tool to open the picker
      const markerTool = document.querySelector(MARKER_TOOL_SELECTOR);

      expect(markerTool).toBeInTheDocument();

      if (markerTool) {
        simulateClick(markerTool);
      }

      // Wait for the picker
      await waitFor(
        () => {
          const picker = document.querySelector(MARKER_PICKER_SELECTOR);

          expect(picker).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );

      // Verify the red swatch has the active ring
      await waitFor(
        () => {
          const redSwatch = document.querySelector('[data-blok-testid="marker-swatch-red"]');

          expect(redSwatch?.className).toContain('ring-black/30');
        },
        TIMEOUT_ACTION
      );
    });
  },
};

/**
 * Selects pre-colored orange background text, opens the marker picker,
 * switches to the background tab, and verifies the orange swatch shows
 * an active ring indicator.
 */
export const PickerActiveBackgroundSwatch: Story = {
  args: {
    data: preColoredBgData,
  },
  play: async ({ canvasElement, step }) => {
    await step('Select pre-colored background text and open picker', async () => {
      // Wait for the editor block to appear
      await waitFor(
        () => {
          const block = canvasElement.querySelector(BLOCK_TESTID);

          expect(block).toBeInTheDocument();
        },
        TIMEOUT_INIT
      );

      // Wait for toolbar initialization
      await waitForToolbar(canvasElement);

      // Select the <mark> element text
      const block = canvasElement.querySelector(BLOCK_TESTID);

      if (block) {
        selectTextInBlock(block, 'mark');
      }

      // Wait for debounced selection handler
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Wait for inline toolbar
      await waitFor(
        () => {
          const inlineToolbar = document.querySelector(INLINE_TOOLBAR_TESTID);

          expect(inlineToolbar).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );

      // Wait for pointer events
      await waitForPointerEvents(`${INLINE_TOOLBAR_TESTID} [data-blok-testid="popover-container"]`);
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Click the marker tool to open the picker
      const markerTool = document.querySelector(MARKER_TOOL_SELECTOR);

      expect(markerTool).toBeInTheDocument();

      if (markerTool) {
        simulateClick(markerTool);
      }

      // Wait for the picker
      await waitFor(
        () => {
          const picker = document.querySelector(MARKER_PICKER_SELECTOR);

          expect(picker).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );

      // Switch to background tab
      const bgTab = document.querySelector(MARKER_TAB_BG_SELECTOR);

      expect(bgTab).toBeInTheDocument();

      if (bgTab) {
        simulateClick(bgTab);
      }

      // Verify the orange swatch has the active ring
      await waitFor(
        () => {
          const orangeSwatch = document.querySelector('[data-blok-testid="marker-swatch-orange"]');

          expect(orangeSwatch?.className).toContain('ring-black/30');
        },
        TIMEOUT_ACTION
      );
    });
  },
};

/**
 * Selects pre-colored text and verifies the marker tool button shows its
 * active state (data-blok-popover-item-active="true") without opening
 * the picker.
 */
export const MarkerButtonActive: Story = {
  args: {
    data: preColoredTextData,
  },
  play: async ({ canvasElement, step }) => {
    await step('Select pre-colored text to show marker active state', async () => {
      // Wait for the editor block to appear
      await waitFor(
        () => {
          const block = canvasElement.querySelector(BLOCK_TESTID);

          expect(block).toBeInTheDocument();
        },
        TIMEOUT_INIT
      );

      // Wait for toolbar initialization
      await waitForToolbar(canvasElement);

      // Select the <mark> element text
      const block = canvasElement.querySelector(BLOCK_TESTID);

      if (block) {
        selectTextInBlock(block, 'mark');
      }

      // Wait for debounced selection handler
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Wait for inline toolbar
      await waitFor(
        () => {
          const inlineToolbar = document.querySelector(INLINE_TOOLBAR_TESTID);

          expect(inlineToolbar).toBeInTheDocument();
        },
        TIMEOUT_ACTION
      );

      // Verify the marker tool button is active
      await waitFor(
        () => {
          const markerTool = document.querySelector(MARKER_TOOL_SELECTOR);

          expect(markerTool).toHaveAttribute('data-blok-popover-item-active', 'true');
        },
        TIMEOUT_ACTION
      );
    });
  },
};
