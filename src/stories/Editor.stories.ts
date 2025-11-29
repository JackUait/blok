import type { Meta, StoryObj } from '@storybook/html-vite';
import Blok from '../blok';
import type { OutputData, BlokConfig } from '@/types';

interface EditorArgs {
  placeholder: string;
  readOnly: boolean;
  autofocus: boolean;
  minHeight: number;
  data: OutputData | undefined;
}

const DEFAULT_PLACEHOLDER = 'Start typing here...';
const DEFAULT_MIN_HEIGHT = 300;

const meta: Meta<EditorArgs> = {
  title: 'Editor/Blok Editor',
  tags: ['autodocs'],
  argTypes: {
    placeholder: {
      control: 'text',
      description: 'Placeholder text shown when the editor is empty',
    },
    readOnly: {
      control: 'boolean',
      description: 'When true, the editor is read-only',
    },
    autofocus: {
      control: 'boolean',
      description: 'Whether to focus the editor on mount',
    },
    minHeight: {
      control: { type: 'number', min: 100, max: 800, step: 50 },
      description: 'Minimum height of the editor in pixels',
    },
  },
  args: {
    placeholder: DEFAULT_PLACEHOLDER,
    readOnly: false,
    autofocus: true,
    minHeight: DEFAULT_MIN_HEIGHT,
    data: undefined,
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
      placeholder: args.placeholder,
      readOnly: args.readOnly,
      autofocus: args.autofocus,
      data: args.data,
    };

    // Initialize editor after DOM is ready
    setTimeout(() => {
      new Blok(config);
    }, 0);

    return container;
  },
};

export default meta;

type Story = StoryObj<EditorArgs>;

/*
 * NOTE: Editor mode stories (ReadOnly, EmptyEditor) live in EditorModes.stories.ts
 * Placeholder stories (CustomPlaceholder) live in Placeholder.stories.ts
 * This file focuses on basic editor configurations and content states.
 */

/**
 * Default empty editor with placeholder text.
 * Click inside to start typing.
 */
export const Empty: Story = {
  args: {
    placeholder: DEFAULT_PLACEHOLDER,
    readOnly: false,
    autofocus: true,
    minHeight: DEFAULT_MIN_HEIGHT,
  },
};

/**
 * Editor pre-populated with sample content including paragraphs.
 */
export const WithContent: Story = {
  args: {
    placeholder: DEFAULT_PLACEHOLDER,
    readOnly: false,
    autofocus: false,
    minHeight: DEFAULT_MIN_HEIGHT,
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'block-1',
          type: 'paragraph',
          data: {
            text: 'Welcome to <strong>Blok</strong> — a headless, block-based rich text editor.',
          },
        },
        {
          id: 'block-2',
          type: 'paragraph',
          data: {
            text: 'Each block represents a piece of content that can be edited, moved, and deleted independently.',
          },
        },
        {
          id: 'block-3',
          type: 'paragraph',
          data: {
            text: 'Try selecting some text to see the <em>inline toolbar</em> appear.',
          },
        },
      ],
    },
  },
};

/**
 * Compact editor with minimal height.
 */
export const Compact: Story = {
  args: {
    placeholder: 'Quick note...',
    readOnly: false,
    autofocus: true,
    minHeight: 150,
  },
};
