import type { Meta, StoryObj } from '@storybook/html-vite';
import { expect, waitFor } from 'storybook/test';

import { CodeTool } from '../tools/code';
import { createEditorContainer } from './helpers';
import type { EditorFactoryOptions } from './helpers';
import type { ToolSettings } from '@/types';

const meta: Meta<EditorFactoryOptions> = {
  title: 'Tools/Code',
  args: {
    minHeight: 520,
    data: { blocks: [{ id: 'notion-code', type: 'code', data: {
      code: 'function fibonacci(n) {\n\tif (n <= 1) {\n\t\treturn n;\n\t}\n\treturn fibonacci(n - 1) + fibonacci(n - 2);\n}',
      language: 'javascript',
      filename: 'fibonacci.js',
      lineNumbers: true,
    } }] },
  },
  render: (args) => {
    const container = createEditorContainer({ ...args, tools: { code: { class: CodeTool } as ToolSettings } });

    container.style.border = '0';
    container.style.maxWidth = '860px';
    container.style.margin = '40px auto';

    return container;
  },
};

export default meta;
type Story = StoryObj<EditorFactoryOptions>;

export const Rest: Story = {};

// Focus uses the same reveal as hover, making the snapshot reproducible even
// when the screenshot runner parks its physical mouse outside the canvas.
export const Hover: Story = {
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('[data-blok-testid="code-language-btn"]')).not.toBeNull());
    canvasElement.querySelector<HTMLButtonElement>('[data-blok-testid="code-language-btn"]')?.focus();
  },
};

export const SelectorOpen: Story = {
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('[data-blok-testid="code-language-btn"]')).not.toBeNull());
    const button = canvasElement.querySelector<HTMLButtonElement>('[data-blok-testid="code-language-btn"]');

    button?.click();
    await waitFor(() => expect(button).toHaveAttribute('aria-expanded', 'true'));
  },
};
