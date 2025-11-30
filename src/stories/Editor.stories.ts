import type { Meta, StoryObj } from '@storybook/html-vite';
import type { OutputData } from '@/types';
import { createEditorContainer } from './helpers';
import type { EditorFactoryOptions } from './helpers';

interface EditorArgs extends EditorFactoryOptions {
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
  render: (args) => createEditorContainer(args),
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
