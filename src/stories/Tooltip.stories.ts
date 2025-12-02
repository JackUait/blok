/**
 * Tooltip.stories.ts - Stories for tooltip component states.
 *
 * This file covers tooltip positioning and visibility states:
 * - Default (hidden)
 * - Shown at bottom, top, left, right positions
 */
import type { Meta, StoryObj } from '@storybook/html-vite';
import { waitFor, expect } from 'storybook/test';
import * as Tooltip from '../components/utils/tooltip';

interface TooltipArgs {
  placement: 'top' | 'bottom' | 'left' | 'right';
  content: string;
  delay: number;
}

const TIMEOUT_ACTION = { timeout: 5000 };
const TOOLTIP_TESTID = '[data-blok-testid="tooltip"]';

const createTooltipDemo = (_args: TooltipArgs): HTMLElement => {
  const container = document.createElement('div');

  container.style.display = 'flex';
  container.style.alignItems = 'center';
  container.style.justifyContent = 'center';
  container.style.minHeight = '300px';
  container.style.padding = '80px';
  container.style.backgroundColor = '#fff';

  const button = document.createElement('button');

  button.textContent = 'Hover me for tooltip';
  button.style.padding = '12px 24px';
  button.style.fontSize = '14px';
  button.style.borderRadius = '6px';
  button.style.border = '1px solid #ddd';
  button.style.cursor = 'pointer';
  button.style.backgroundColor = '#f8f8f8';
  button.setAttribute('data-blok-testid', 'tooltip-trigger');

  container.appendChild(button);

  return container;
};

const meta: Meta<TooltipArgs> = {
  title: 'Components/Tooltip',
  tags: ['autodocs'],
  args: {
    placement: 'bottom',
    content: 'This is a tooltip',
    delay: 0,
  },
  argTypes: {
    placement: {
      control: 'select',
      options: ['top', 'bottom', 'left', 'right'],
      description: 'Tooltip placement relative to trigger element',
    },
    content: {
      control: 'text',
      description: 'Tooltip content text',
    },
    delay: {
      control: { type: 'number', min: 0, max: 1000, step: 50 },
      description: 'Delay before showing tooltip (ms)',
    },
  },
  render: createTooltipDemo,
};

export default meta;

type Story = StoryObj<TooltipArgs>;

/**
 * Default state: Tooltip is hidden.
 */
export const Default: Story = {
  args: {
    placement: 'bottom',
    content: 'This is a tooltip',
    delay: 0,
  },
};

/**
 * Tooltip shown below the trigger element.
 */
export const ShownBottom: Story = {
  args: {
    placement: 'bottom',
    content: 'Tooltip at bottom',
    delay: 0,
  },
  play: async ({ canvasElement, step }) => {
    await step('Show tooltip at bottom', async () => {
      const trigger = canvasElement.querySelector('[data-blok-testid="tooltip-trigger"]') as HTMLElement;

      expect(trigger).toBeInTheDocument();

      if (trigger) {
        Tooltip.show(trigger, 'Tooltip at bottom', { placement: 'bottom', delay: 0 });
      }

      await waitFor(
        () => {
          const tooltip = document.querySelector(TOOLTIP_TESTID);

          expect(tooltip).toBeInTheDocument();
          expect(tooltip).toHaveAttribute('data-blok-shown', 'true');
          expect(tooltip).toHaveAttribute('data-blok-placement', 'bottom');
        },
        TIMEOUT_ACTION
      );
    });
  },
};

/**
 * Tooltip shown above the trigger element.
 */
export const ShownTop: Story = {
  args: {
    placement: 'top',
    content: 'Tooltip at top',
    delay: 0,
  },
  play: async ({ canvasElement, step }) => {
    await step('Show tooltip at top', async () => {
      const trigger = canvasElement.querySelector('[data-blok-testid="tooltip-trigger"]') as HTMLElement;

      expect(trigger).toBeInTheDocument();

      if (trigger) {
        Tooltip.show(trigger, 'Tooltip at top', { placement: 'top', delay: 0 });
      }

      await waitFor(
        () => {
          const tooltip = document.querySelector(TOOLTIP_TESTID);

          expect(tooltip).toBeInTheDocument();
          expect(tooltip).toHaveAttribute('data-blok-shown', 'true');
          expect(tooltip).toHaveAttribute('data-blok-placement', 'top');
        },
        TIMEOUT_ACTION
      );
    });
  },
};

/**
 * Tooltip shown to the left of the trigger element.
 */
export const ShownLeft: Story = {
  args: {
    placement: 'left',
    content: 'Tooltip at left',
    delay: 0,
  },
  play: async ({ canvasElement, step }) => {
    await step('Show tooltip at left', async () => {
      const trigger = canvasElement.querySelector('[data-blok-testid="tooltip-trigger"]') as HTMLElement;

      expect(trigger).toBeInTheDocument();

      if (trigger) {
        Tooltip.show(trigger, 'Tooltip at left', { placement: 'left', delay: 0 });
      }

      await waitFor(
        () => {
          const tooltip = document.querySelector(TOOLTIP_TESTID);

          expect(tooltip).toBeInTheDocument();
          expect(tooltip).toHaveAttribute('data-blok-shown', 'true');
          expect(tooltip).toHaveAttribute('data-blok-placement', 'left');
        },
        TIMEOUT_ACTION
      );
    });
  },
};

/**
 * Tooltip shown to the right of the trigger element.
 */
export const ShownRight: Story = {
  args: {
    placement: 'right',
    content: 'Tooltip at right',
    delay: 0,
  },
  play: async ({ canvasElement, step }) => {
    await step('Show tooltip at right', async () => {
      const trigger = canvasElement.querySelector('[data-blok-testid="tooltip-trigger"]') as HTMLElement;

      expect(trigger).toBeInTheDocument();

      if (trigger) {
        Tooltip.show(trigger, 'Tooltip at right', { placement: 'right', delay: 0 });
      }

      await waitFor(
        () => {
          const tooltip = document.querySelector(TOOLTIP_TESTID);

          expect(tooltip).toBeInTheDocument();
          expect(tooltip).toHaveAttribute('data-blok-shown', 'true');
          expect(tooltip).toHaveAttribute('data-blok-placement', 'right');
        },
        TIMEOUT_ACTION
      );
    });
  },
};

/**
 * Tooltip with HTML content.
 */
export const WithHTMLContent: Story = {
  args: {
    placement: 'bottom',
    content: '<strong>Bold</strong> tooltip',
    delay: 0,
  },
  play: async ({ canvasElement, step }) => {
    await step('Show tooltip with HTML content', async () => {
      const trigger = canvasElement.querySelector('[data-blok-testid="tooltip-trigger"]') as HTMLElement;

      expect(trigger).toBeInTheDocument();

      if (trigger) {
        const content = document.createElement('span');

        content.innerHTML = '<strong>Bold</strong> and <em>italic</em>';
        Tooltip.show(trigger, content, { placement: 'bottom', delay: 0 });
      }

      await waitFor(
        () => {
          const tooltip = document.querySelector(TOOLTIP_TESTID);

          expect(tooltip).toBeInTheDocument();
          expect(tooltip).toHaveAttribute('data-blok-shown', 'true');
        },
        TIMEOUT_ACTION
      );
    });
  },
};
