import type { Meta, StoryObj } from '@storybook/html-vite';
import type { OutputData } from '@/types';
import { createEditorContainer } from './helpers';
import type { EditorFactoryOptions } from './helpers';
import { Paragraph,  type ParagraphConfig  } from '../tools/paragraph';

interface ParagraphArgs extends EditorFactoryOptions {
  minHeight: number;
  data: OutputData | undefined;
}

/**
 * Creates sample data with a paragraph block
 */
const createParagraphData = (id: string, text: string): OutputData => ({
  time: Date.now(),
  version: '1.0.0',
  blocks: [
    {
      id,
      type: 'paragraph',
      data: { text },
    },
  ],
});

/**
 * Creates sample data with multiple paragraph blocks
 */
const createMultipleParagraphsData = (): OutputData => ({
  time: Date.now(),
  version: '1.0.0',
  blocks: [
    {
      id: 'para-1',
      type: 'paragraph',
      data: { text: 'This is the first paragraph with custom styling.' },
    },
    {
      id: 'para-2',
      type: 'paragraph',
      data: { text: 'This is the second paragraph. It demonstrates how multiple paragraphs look together.' },
    },
    {
      id: 'para-3',
      type: 'paragraph',
      data: { text: 'And here is a third paragraph to show the spacing between blocks.' },
    },
  ],
});

const createEditor = (args: ParagraphArgs): HTMLElement => createEditorContainer({
  ...args,
  tools: {
    paragraph: Paragraph,
  },
});

const meta: Meta<ParagraphArgs> = {
  title: 'Components/Paragraph',
  tags: ['autodocs'],
  args: {
    minHeight: 300,
    data: createParagraphData('paragraph-default', 'This is a sample paragraph with default styling.'),
  },
  render: createEditor,
};

export default meta;


type Story = StoryObj<ParagraphArgs>;

/**
 * Default paragraph state with no custom styling.
 */
export const Default: Story = {
  args: {
    data: createParagraphData('paragraph-default', 'This is a sample paragraph with default styling.'),
  },
};

/**
 * Custom paragraph configuration with all style options.
 */
const fullCustomConfig: ParagraphConfig = {
  placeholder: 'Start writing here...',
  styles: {
    size: '18px',
    lineHeight: '2',
    marginTop: '16px',
    marginBottom: '16px',
  },
};

const createFullCustomEditor = (args: ParagraphArgs): HTMLElement => createEditorContainer({
  ...args,
  tools: {
    paragraph: {
      class: Paragraph,
      config: fullCustomConfig,
    },
  },
});

export const CustomStyles: Story = {
  args: {
    minHeight: 400,
    data: createMultipleParagraphsData(),
  },
  render: createFullCustomEditor,
};
