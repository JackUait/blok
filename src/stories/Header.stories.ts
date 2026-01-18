import type { Meta, StoryObj } from '@storybook/html-vite';

import { Header,  type HeaderConfig  } from '../tools/header';

import { createEditorContainer } from './helpers';
import type { EditorFactoryOptions } from './helpers';

import type { OutputData } from '@/types';


interface HeaderArgs extends EditorFactoryOptions {
  minHeight: number;
  data: OutputData | undefined;
}

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
 * Default header state (H2).
 */
export const Default: Story = {
  args: {
    data: createHeaderData('header-default'),
  },
};

/**
 * All header levels (H1-H6) displayed together.
 * Shows all 6 heading levels at their default styles.
 */
export const AllLevels: Story = {
  args: {
    minHeight: 500,
    data: createAllHeaderLevelsData(),
  },
};

/**
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
      config: customHeaderConfig as Record<string, unknown>,
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
