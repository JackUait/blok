/**
 * StubBlock.stories.ts - Stories for stub block component.
 *
 * The stub block is displayed when a block's tool is not found/registered.
 * It shows an error state with the tool name and preserves the original data.
 */
import type { Meta, StoryObj } from '@storybook/html-vite';
import { waitFor, expect } from 'storybook/test';

import { createEditorContainer } from './helpers';
import type { EditorFactoryOptions } from './helpers';

import type { OutputData } from '@/types';

interface StubBlockArgs extends EditorFactoryOptions {
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

const createEditor = (args: StubBlockArgs): HTMLElement => createEditorContainer(args);

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
          // Look for the stub block by its data attribute
          const stubBlock = canvasElement.querySelector('[data-blok-stub]');

          expect(stubBlock).toBeTruthy();
        },
        TIMEOUT_INIT
      );
    });

    await step('Verify stub block structure', async () => {
      const stubBlock = canvasElement.querySelector('[data-blok-stub]');
      const title = stubBlock?.querySelector('[data-blok-stub-title]');
      const subtitle = stubBlock?.querySelector('[data-blok-stub-subtitle]');

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
          // Count stub wrapper elements by data attribute
          const stubWrappers = canvasElement.querySelectorAll('[data-blok-stub]');

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
    readOnly: true,
  },
  play: async ({ canvasElement, step }) => {
    await step('Wait for stub block in read-only mode', async () => {
      await waitFor(
        () => {
          const stubBlock = canvasElement.querySelector('[data-blok-stub]');

          expect(stubBlock).toBeTruthy();
        },
        TIMEOUT_INIT
      );
    });
  },
};
