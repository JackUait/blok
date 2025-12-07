import type { Meta, StoryObj } from '@storybook/html-vite';
import { userEvent, waitFor, expect } from 'storybook/test';
import type { OutputData } from '@/types';
import { createEditorContainer, simulateClick, waitForToolbar } from './helpers';
import type { EditorFactoryOptions } from './helpers';
import Header, { type HeaderConfig } from '../tools/header';

interface HeaderArgs extends EditorFactoryOptions {
  minHeight: number;
  data: OutputData | undefined;
}

// Constants
const BLOCK_TESTID = '[data-blok-testid="block-wrapper"]';
const ACTIONS_TESTID = '[data-blok-testid="toolbar-actions"]';
const SETTINGS_BUTTON_TESTID = '[data-blok-testid="settings-toggler"]';
const BLOCK_TUNES_POPOVER_TESTID = '[data-blok-testid="block-tunes-popover"]';
const POPOVER_ITEM_TITLE_TESTID = '[data-blok-testid="popover-item-title"]';

const TIMEOUT_INIT = { timeout: 5000 };
const TIMEOUT_ACTION = { timeout: 5000 };

/**
 * Creates sample data with a header block at level 2 (default)
 */
const createHeaderData = (id: string): OutputData => ({
  time: Date.now(),
  version: '1.0.0',
  blocks: [
    {
      id,
      type: 'header',
      data: { text: 'Sample Header Text', level: 2 },
    },
  ],
});

const createEditor = (args: HeaderArgs): HTMLElement => createEditorContainer({
  ...args,
  tools: {
    header: Header,
  },
});

const meta: Meta<HeaderArgs> = {
  title: 'Components/Header',
  tags: ['autodocs'],
  args: {
    minHeight: 300,
    data: createHeaderData('header-default'),
  },
  render: createEditor,
};

export default meta;

type Story = StoryObj<HeaderArgs>;

/**
 * Finds and clicks a heading level item in the tunes popover by its level number.
 * @param level - The heading level (1-6)
 */
const selectHeadingLevel = async (level: number): Promise<void> => {
  const popoverItems = Array.from(document.querySelectorAll(POPOVER_ITEM_TITLE_TESTID));
  const targetItem = popoverItems.find((item) => item.textContent?.includes(`Heading ${level}`));
  const popoverItem = targetItem?.closest('[data-blok-testid="popover-item"]');

  if (popoverItem) {
    await userEvent.click(popoverItem);
  }
};

/**
 * Common play function steps for header level stories.
 */
const openTunesAndSelectLevel = async (
  canvasElement: HTMLElement,
  step: (name: string, fn: () => Promise<void>) => void | Promise<void>,
  level: number
): Promise<void> => {
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

  await step('Open block tunes menu', async () => {
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

  await step(`Select Heading ${level} from tunes menu`, async () => {
    // Wait for popover items to render
    await new Promise((resolve) => setTimeout(resolve, 150));

    await selectHeadingLevel(level);

    // Wait for the header to update
    await new Promise((resolve) => setTimeout(resolve, 100));

    await waitFor(
      () => {
        const headerElement = canvasElement.querySelector(`h${level}`);

        expect(headerElement).toBeInTheDocument();
      },
      TIMEOUT_ACTION
    );
  });
};

/**
 * Default header state (H2).
 */
export const Default: Story = {
  args: {
    data: createHeaderData('header-default'),
  },
};

/**
 * Header changed to H1 via tunes menu.
 */
export const Heading1: Story = {
  args: {
    data: createHeaderData('header-h1'),
  },
  play: async ({ canvasElement, step }) => {
    await openTunesAndSelectLevel(canvasElement, step, 1);
  },
};

/**
 * Header changed to H2 via tunes menu.
 */
export const Heading2: Story = {
  args: {
    data: createHeaderData('header-h2'),
  },
  play: async ({ canvasElement, step }) => {
    await openTunesAndSelectLevel(canvasElement, step, 2);
  },
};

/**
 * Header changed to H3 via tunes menu.
 */
export const Heading3: Story = {
  args: {
    data: createHeaderData('header-h3'),
  },
  play: async ({ canvasElement, step }) => {
    await openTunesAndSelectLevel(canvasElement, step, 3);
  },
};

/**
 * Header changed to H4 via tunes menu.
 */
export const Heading4: Story = {
  args: {
    data: createHeaderData('header-h4'),
  },
  play: async ({ canvasElement, step }) => {
    await openTunesAndSelectLevel(canvasElement, step, 4);
  },
};

/**
 * Header changed to H5 via tunes menu.
 */
export const Heading5: Story = {
  args: {
    data: createHeaderData('header-h5'),
  },
  play: async ({ canvasElement, step }) => {
    await openTunesAndSelectLevel(canvasElement, step, 5);
  },
};

/**
 * Header changed to H6 via tunes menu.
 */
export const Heading6: Story = {
  args: {
    data: createHeaderData('header-h6'),
  },
  play: async ({ canvasElement, step }) => {
    await openTunesAndSelectLevel(canvasElement, step, 6);
  },
};

/**
 * Creates sample data with all header levels (H1-H6)
 */
const createAllHeaderLevelsData = (): OutputData => ({
  time: Date.now(),
  version: '1.0.0',
  blocks: [
    { id: 'header-h1', type: 'header', data: { text: 'Heading 1', level: 1 } },
    { id: 'header-h2', type: 'header', data: { text: 'Heading 2', level: 2 } },
    { id: 'header-h3', type: 'header', data: { text: 'Heading 3', level: 3 } },
    { id: 'header-h4', type: 'header', data: { text: 'Heading 4', level: 4 } },
    { id: 'header-h5', type: 'header', data: { text: 'Heading 5', level: 5 } },
    { id: 'header-h6', type: 'header', data: { text: 'Heading 6', level: 6 } },
  ],
});

/**
 * Custom header level overrides configuration with different font-sizes and margins.
 */
const customHeaderConfig: HeaderConfig = {
  levelOverrides: {
    1: { size: '100px', marginTop: '32px', marginBottom: '12px' },
    2: { size: '90px', marginTop: '35px', marginBottom: '20px' },
    3: { size: '80px', marginTop: '40px', marginBottom: '12px' },
    4: { size: '70px', marginTop: '30px', marginBottom: '10px' },
    5: { size: '60px', marginTop: '20px', marginBottom: '8px' },
    6: { size: '50px', marginTop: '10px', marginBottom: '6px' },
  },
};

/**
 * Creates an editor with custom header configuration.
 */
const createCustomHeaderEditor = (args: HeaderArgs): HTMLElement => createEditorContainer({
  ...args,
  tools: {
    header: {
      class: Header,
      config: customHeaderConfig,
    },
  },
});

/**
 * All header levels with custom font-sizes and margins configured via levelOverrides.
 */
export const AllLevelsCustomStyles: Story = {
  args: {
    minHeight: 600,
    data: createAllHeaderLevelsData(),
  },
  render: createCustomHeaderEditor,
};
