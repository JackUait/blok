import type { Meta, StoryObj } from '@storybook/html-vite';

import { Header,  type HeaderConfig  } from '../tools/header';
import { Marker } from '../tools';

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

const markerHeaderTools = {
  header: {
    class: Header,
    inlineToolbar: true,
  },
  marker: Marker,
};

const createMarkerEditor = (args: HeaderArgs): HTMLElement => createEditorContainer({
  ...args,
  tools: markerHeaderTools,
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

// ---------------------------------------------------------------------------
//  Headers with color markers
// ---------------------------------------------------------------------------

const PRESETS = [
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

const textMark = (hex: string, label: string): string =>
  `<mark style="color: ${hex}; background-color: transparent">${label}</mark>`;

const bgMark = (hex: string, label: string): string =>
  `<mark style="background-color: ${hex}">${label}</mark>`;

/**
 * H2 header with all 10 text-color presets applied as inline marks.
 */
export const HeaderTextColors: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'header-text-colors',
          type: 'header',
          data: {
            text: PRESETS.map((p) => textMark(p.text, p.name)).join(' '),
            level: 2,
          },
        },
      ],
    },
  },
  render: createMarkerEditor,
};

/**
 * H2 header with all 10 background-color presets applied as inline marks.
 */
export const HeaderBackgroundColors: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'header-bg-colors',
          type: 'header',
          data: {
            text: PRESETS.map((p) => bgMark(p.bg, p.name)).join(' '),
            level: 2,
          },
        },
      ],
    },
  },
  render: createMarkerEditor,
};

/**
 * H1 through H6, each with a different preset text color applied.
 * Shows color markers render correctly at every heading level.
 */
export const HeaderLevelsWithColors: Story = {
  args: {
    minHeight: 500,
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: PRESETS.slice(0, 6).map((p, i) => ({
        id: `header-level-color-${i + 1}`,
        type: 'header',
        data: {
          text: `Heading ${i + 1} in ${textMark(p.text, p.name)}`,
          level: i + 1,
        },
      })),
    },
  },
  render: createMarkerEditor,
};
