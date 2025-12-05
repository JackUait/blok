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

const createAllStatesDemo = (): HTMLElement => {
  const placements: TooltipArgs['placement'][] = ['bottom', 'top', 'left', 'right'];
  const container = document.createElement('div');

  container.style.display = 'grid';
  container.style.gridTemplateColumns = 'repeat(auto-fit, minmax(180px, 1fr))';
  container.style.gap = '32px';
  container.style.alignItems = 'center';
  container.style.justifyItems = 'center';
  container.style.minHeight = '400px';
  container.style.padding = '80px';
  container.style.backgroundColor = '#fff';

  const makeTrigger = (label: string, testId: string): HTMLButtonElement => {
    const button = document.createElement('button');

    button.textContent = label;
    button.style.padding = '12px 24px';
    button.style.fontSize = '14px';
    button.style.borderRadius = '6px';
    button.style.border = '1px solid #ddd';
    button.style.cursor = 'pointer';
    button.style.backgroundColor = '#f8f8f8';
    button.setAttribute('data-blok-testid', testId);

    return button;
  };

  const defaultTrigger = makeTrigger('Default (hidden)', 'tooltip-trigger-default');
  const placementTriggers = placements.map((placement) =>
    makeTrigger(`Shown ${placement}`, `tooltip-trigger-${placement}`)
  );

  container.appendChild(defaultTrigger);
  placementTriggers.forEach((trigger) => container.appendChild(trigger));

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

export const TooltipStates: Story = {
  args: {
    placement: 'bottom',
    content: 'This is a tooltip',
    delay: 0,
  },
  render: createAllStatesDemo,
  play: async ({ canvasElement, step }) => {
    const placements: TooltipArgs['placement'][] = ['bottom', 'top', 'left', 'right'];
    const triggerDefault = canvasElement.querySelector('[data-blok-testid="tooltip-trigger-default"]') as HTMLElement;

    expect(triggerDefault).toBeInTheDocument();

    const showAndClone = async (placement: TooltipArgs['placement']) => {
      const trigger = canvasElement.querySelector(`[data-blok-testid="tooltip-trigger-${placement}"]`) as HTMLElement;

      expect(trigger).toBeInTheDocument();

      Tooltip.show(trigger, `Tooltip at ${placement}`, { placement, delay: 0 });

      await waitFor(
        () => {
          const tooltip = document.querySelector(TOOLTIP_TESTID) as HTMLElement;

          expect(tooltip).toBeInTheDocument();
          expect(tooltip).toHaveAttribute('data-blok-shown', 'true');
          expect(tooltip).toHaveAttribute('data-blok-placement', placement);
        },
        TIMEOUT_ACTION
      );

      const tooltip = document.querySelector(TOOLTIP_TESTID) as HTMLElement;
      const clone = tooltip.cloneNode(true) as HTMLElement;

      clone.setAttribute('data-blok-testid', `tooltip-${placement}`);
      document.body.appendChild(clone);
    };

    await step('Show all placements', async () => {
      for (const placement of placements) {
        await showAndClone(placement);
      }

      Tooltip.hide(true);
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
