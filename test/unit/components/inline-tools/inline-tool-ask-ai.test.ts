import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, within } from '@testing-library/dom';

import { AskAiInlineTool } from '../../../../src/components/inline-tools/inline-tool-ask-ai';
import { assistantActions } from '../../../../src/components/modules/assistant/actions';
import { PopoverItemType } from '../../../../src/components/utils/popover';
import type { API } from '../../../../types';

const t = (key: string): string => ({
  'assistant.label': 'Ask AI',
  'assistant.actions': 'Suggestions',
}[key] ?? key);

const setup = (): { row: HTMLElement; openAssistant: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } => {
  const openAssistant = vi.fn();
  const close = vi.fn();
  const api = { agent: { openAssistant }, inlineToolbar: { close }, i18n: { t } } as unknown as API;
  const item = new AskAiInlineTool({ api }).render();

  if (Array.isArray(item) || !('type' in item) || item.type !== PopoverItemType.Html) {
    throw new Error('expected one html item');
  }
  document.body.append(item.element);

  return { row: item.element, openAssistant, close };
};

describe('AskAiInlineTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('opens the assistant bar and closes the inline toolbar from the Ask AI button', () => {
    const { row, openAssistant, close } = setup();

    fireEvent.click(within(row).getByRole('menuitem', { name: 'Ask AI' }));

    expect(openAssistant).toHaveBeenCalledTimes(1);
    expect(openAssistant).toHaveBeenCalledWith();
    expect(close).toHaveBeenCalledTimes(1);
    // The bar must read the selection before the toolbar closes and drops it.
    expect(openAssistant.mock.invocationCallOrder[0]).toBeLessThan(close.mock.invocationCallOrder[0]);
  });

  it('labels the Ask AI button at regular weight, like the tools around it', () => {
    const { row } = setup();

    expect(within(row).getByRole('menuitem', { name: 'Ask AI' }).className).not.toContain('font-medium');
  });

  it('keeps the skills folded until the toggle opens them, and folds them again', () => {
    const { row } = setup();
    const toggle = within(row).getByRole('menuitem', { name: 'Suggestions' });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(row).queryByRole('menuitem', { name: 'assistant.action.improve' })).toBeNull();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(row).getByRole('menuitem', { name: 'assistant.action.improve' })).toBeVisible();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(row).queryByRole('menuitem', { name: 'assistant.action.improve' })).toBeNull();
  });

  it('lists the built-in selection skills, in order', () => {
    const { row } = setup();

    fireEvent.click(within(row).getByRole('menuitem', { name: 'Suggestions' }));

    const skills = within(row).getAllByRole('menuitem').filter((button) => button.hasAttribute('data-blok-ask-ai-skill'));

    expect(skills.map((button) => button.textContent?.trim())).toEqual(assistantActions('selection', t).map(({ label }) => label));
  });

  it('stacks each icon cell with grid, not flex', () => {
    const { row } = setup();

    fireEvent.click(within(row).getByRole('menuitem', { name: 'Suggestions' }));

    // A skill's ink icon and its coloured copy share one grid cell. A host page's own .flex
    // utility beats Blok's grid rule, sets the two side by side and shoves the icon left.
    for (const glyph of row.querySelectorAll('[data-blok-ask-ai-glyph]')) {
      expect(glyph.classList).toContain('grid');
      expect(glyph.classList).not.toContain('flex');
    }
  });

  it('keeps a one-line skill row as tall as the Ask AI row', () => {
    const { row } = setup();

    fireEvent.click(within(row).getByRole('menuitem', { name: 'Suggestions' }));

    // The 24px icon cell plus py-0.5 is 28px, the h-7 of the Ask AI row; py-1 made it 32px.
    for (const skill of within(row).getAllByRole('menuitem').filter((button) => button.hasAttribute('data-blok-ask-ai-skill'))) {
      expect(skill.classList).toContain('min-h-7');
      expect(skill.classList).toContain('py-0.5');
      expect(skill.classList).not.toContain('py-1');
    }
  });

  it('runs a skill: opens the bar with its prompt, then closes the toolbar', () => {
    const { row, openAssistant, close } = setup();
    const [improve] = assistantActions('selection', t);

    fireEvent.click(within(row).getByRole('menuitem', { name: 'Suggestions' }));
    fireEvent.click(within(row).getByRole('menuitem', { name: improve.label }));

    expect(openAssistant).toHaveBeenCalledWith({ prompt: improve.prompt });
    expect(close).toHaveBeenCalledTimes(1);
    expect(openAssistant.mock.invocationCallOrder[0]).toBeLessThan(close.mock.invocationCallOrder[0]);
  });
});
