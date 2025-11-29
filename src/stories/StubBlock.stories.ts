/**
 * StubBlock.stories.ts - Stories for stub block component.
 *
 * The stub block is displayed when a block's tool is not found/registered.
 * It shows an error state with the tool name and preserves the original data.
 */
import type { Meta, StoryObj } from '@storybook/html-vite';
import { waitFor, expect } from 'storybook/test';
import Blok from '../blok';
import type { OutputData, BlokConfig } from '@/types';
import { waitForIdleCallback } from './helpers';

interface StubBlockArgs {
  minHeight: number;
  data: OutputData;
}

const TIMEOUT_INIT = { timeout: 5000 };

/**
 * Sample data with a block type that has no registered tool
 */
const stubBlockData: OutputData = {
  time: Date.now(),
  version: '1.0.0',
  blocks: [
    {
      id: 'stub-block-1',
      type: 'paragraph',
      data: { text: 'This is a regular paragraph block.' },
    },
    {
      id: 'stub-block-2',
      type: 'unknownTool', // This tool doesn't exist - will show stub
      data: { someData: 'preserved data for unknown tool' },
    },
    {
      id: 'stub-block-3',
      type: 'paragraph',
      data: { text: 'Another regular paragraph after the stub.' },
    },
  ],
};

const createEditor = (args: StubBlockArgs): HTMLElement => {
  const container = document.createElement('div');

  container.style.border = '1px solid #e0e0e0';
  container.style.borderRadius = '8px';
  container.style.padding = '16px';
  container.style.minHeight = `${args.minHeight}px`;
  container.style.backgroundColor = '#fff';

  const editorHolder = document.createElement('div');

  editorHolder.id = `blok-editor-${Date.now()}`;
  container.appendChild(editorHolder);

  const config: BlokConfig = {
    holder: editorHolder,
    autofocus: false,
    data: args.data,
  };

  setTimeout(async () => {
    const editor = new Blok(config);

    await editor.isReady;
    await waitForIdleCallback();
  }, 0);

  return container;
};

const meta: Meta<StubBlockArgs> = {
  title: 'Components/Stub Block',
  tags: ['autodocs'],
  args: {
    minHeight: 300,
    data: stubBlockData,
  },
  render: createEditor,
};

export default meta;

type Story = StoryObj<StubBlockArgs>;

/**
 * Stub block shown when tool is not registered.
 * Displays warning icon, tool name, and error message.
 */
export const MissingTool: Story = {
  args: {
    data: stubBlockData,
  },
  play: async ({ canvasElement, step }) => {
    await step('Wait for stub block to render', async () => {
      await waitFor(
        () => {
          // Look for the stub block by its wrapper class
          const blocks = canvasElement.querySelectorAll('[data-blok-testid="block-wrapper"]');
          const stubBlock = Array.from(blocks).find(block =>
            block.querySelector('[class*="blok-stub"]')
          );

          expect(stubBlock).toBeTruthy();
        },
        TIMEOUT_INIT
      );
    });

    await step('Verify stub block structure', async () => {
      const blocks = canvasElement.querySelectorAll('[data-blok-testid="block-wrapper"]');
      const stubWrapper = Array.from(blocks).find(block =>
        block.querySelector('[class*="blok-stub"]')
      );
      const stubBlock = stubWrapper?.querySelector('[class*="blok-stub"]');
      const title = stubBlock?.querySelector('[class*="blok-stub__title"]');
      const subtitle = stubBlock?.querySelector('[class*="blok-stub__subtitle"]');

      expect(title).toBeTruthy();
      expect(subtitle).toBeTruthy();
    });
  },
};

/**
 * Multiple stub blocks for different missing tools.
 */
export const MultipleMissingTools: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'multi-stub-1',
          type: 'customImage', // Missing tool
          data: { url: 'https://example.com/image.jpg' },
        },
        {
          id: 'multi-stub-2',
          type: 'customVideo', // Missing tool
          data: { videoId: 'abc123' },
        },
        {
          id: 'multi-stub-3',
          type: 'customEmbed', // Missing tool
          data: { embedCode: '<iframe></iframe>' },
        },
      ],
    },
  },
  play: async ({ canvasElement, step }) => {
    await step('Wait for all stub blocks to render', async () => {
      await waitFor(
        () => {
          // Count only the main stub wrapper elements (not nested info/title/subtitle)
          const allElements = canvasElement.querySelectorAll('[class*="blok-stub"]');
          const stubWrappers = Array.from(allElements).filter(el =>
            el.classList.contains('blok-stub') && !el.classList.contains('blok-stub__info') &&
            !el.classList.contains('blok-stub__title') && !el.classList.contains('blok-stub__subtitle')
          );

          expect(stubWrappers.length).toBe(3);
        },
        TIMEOUT_INIT
      );
    });
  },
};

/**
 * Stub block in read-only mode.
 */
export const StubInReadOnly: Story = {
  args: {
    data: stubBlockData,
  },
  render: (args) => {
    const container = document.createElement('div');

    container.style.border = '1px solid #e0e0e0';
    container.style.borderRadius = '8px';
    container.style.padding = '16px';
    container.style.minHeight = `${args.minHeight}px`;
    container.style.backgroundColor = '#fff';

    const editorHolder = document.createElement('div');

    editorHolder.id = `blok-editor-${Date.now()}`;
    container.appendChild(editorHolder);

    const config: BlokConfig = {
      holder: editorHolder,
      autofocus: false,
      readOnly: true,
      data: args.data,
    };

    setTimeout(async () => {
      const editor = new Blok(config);

      await editor.isReady;
      await waitForIdleCallback();
    }, 0);

    return container;
  },
  play: async ({ canvasElement, step }) => {
    await step('Wait for stub block in read-only mode', async () => {
      await waitFor(
        () => {
          const stubBlock = canvasElement.querySelector('[class*="blok-stub"]');

          expect(stubBlock).toBeTruthy();
        },
        TIMEOUT_INIT
      );
    });
  },
};
