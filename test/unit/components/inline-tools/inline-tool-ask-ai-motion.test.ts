import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, within } from '@testing-library/dom';

import { AskAiInlineTool } from '../../../../src/components/inline-tools/inline-tool-ask-ai';
import { IconRose } from '../../../../src/components/icons';
import { PopoverItemType } from '../../../../src/components/utils/popover';
import type { API } from '../../../../types';

const t = (key: string): string => ({
  'assistant.label': 'Ask AI',
  'assistant.actions': 'Suggestions',
}[key] ?? key);

const render = (): HTMLElement => {
  const api = {
    agent: { openAssistant: vi.fn() },
    inlineToolbar: { close: vi.fn() },
    i18n: { t },
  } as unknown as API;
  const item = new AskAiInlineTool({ api }).render();

  if (Array.isArray(item) || !('type' in item) || item.type !== PopoverItemType.Html) {
    throw new Error('expected one html item');
  }

  return item.element;
};

/** Mounts the tool the way the inline popover does: a rule, then the tool's html item. */
const mountAfterRule = (element: HTMLElement): HTMLElement => {
  const rule = document.createElement('div');
  const line = document.createElement('div');
  const item = document.createElement('div');

  rule.setAttribute('data-blok-popover-item-separator', '');
  line.setAttribute('data-blok-popover-item-separator-line', '');
  item.setAttribute('data-blok-popover-item-html', '');
  rule.append(line);
  item.append(element);
  document.body.append(rule, item);

  return line;
};

const skills = (root: HTMLElement): HTMLElement[] => {
  fireEvent.click(within(root).getByRole('menuitem', { name: 'Suggestions' }));

  return [...root.querySelectorAll<HTMLElement>('[data-blok-ask-ai-skill]')];
};

describe('AskAiInlineTool — motion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('marks Ask AI with the bar\'s rose and lays a light on it, under a gradient of its own', () => {
    const first = render();
    const second = render();
    const lightOf = (root: HTMLElement): SVGPathElement | null =>
      root.querySelector('[data-blok-ask-ai-open] [data-blok-assistant-light]');
    const gradientOf = (root: HTMLElement): string | null => lightOf(root)?.getAttribute('stroke') ?? null;
    const rose = new DOMParser().parseFromString(IconRose, 'image/svg+xml').querySelector('path')?.getAttribute('d');

    expect(first.querySelector('[data-blok-ask-ai-open] path')?.getAttribute('d')).toBe(rose);
    expect(lightOf(first)?.getAttribute('d')).toBe(rose);
    expect(gradientOf(first)).toMatch(/^url\(#.+\)$/);
    expect(gradientOf(first)).not.toBe(gradientOf(second));
  });

  it('gives each built-in skill the act its icon plays, and its place in the cascade', () => {
    const rows = skills(render());

    expect(rows.map((row) => row.getAttribute('data-blok-ask-ai-act'))).toEqual(['write', 'sparkle', 'shrink', 'grow', 'simplify', 'explain']);
    expect(rows.map((row) => row.style.getPropertyValue('--blok-ask-ai-index'))).toEqual(['0', '1', '2', '3', '4', '5']);
  });


  it('draws a coloured copy of each skill icon over its ink, with a gradient of its own', () => {
    const rows = skills(render());
    const ids = rows.map((row) => {
      const ink = row.querySelector('svg:not([data-blok-ask-ai-hue])');
      const hue = row.querySelector('svg[data-blok-ask-ai-hue]');
      const stroke = hue?.querySelector('[stroke^="url("]')?.getAttribute('stroke');

      expect(ink?.querySelector('[stroke]')?.getAttribute('stroke')).toBe('currentColor');
      expect(hue?.querySelector('[stroke="currentColor"]')).toBeNull();
      expect(hue?.querySelector('[fill="currentColor"]')).toBeNull();
      expect(hue?.getAttribute('aria-hidden')).toBe('true');

      return stroke;
    });

    expect(ids.every((id) => id !== undefined && id !== null)).toBe(true);
    expect(new Set(ids).size).toBe(rows.length);
  });

  it('measures every stroke of a skill icon as one, so the icon can draw itself in', () => {
    const [improve] = skills(render());
    const strokes = [...improve.querySelectorAll('svg path, svg circle')].filter((shape) => shape.getAttribute('fill') !== 'currentColor');

    expect(strokes.length).toBeGreaterThan(0);
    expect(strokes.every((shape) => shape.getAttribute('pathLength') === '1')).toBe(true);
  });

  it('gives the pencil a line to write and the star two sparks to throw', () => {
    const [improve, proofread] = skills(render());

    expect(improve.querySelectorAll('svg:not([data-blok-ask-ai-hue]) [data-blok-ask-ai-scribble]')).toHaveLength(1);
    expect(proofread.querySelectorAll('svg:not([data-blok-ask-ai-hue]) [data-blok-ask-ai-spark]')).toHaveLength(2);
  });

  it('lights the rule above it once the toolbar mounts it', async () => {
    const root = render();
    const line = mountAfterRule(root);

    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(line.hasAttribute('data-blok-ask-ai-seam')).toBe(true);
  });

  it('lights nothing when no rule sits above it', async () => {
    const root = render();
    const before = document.createElement('div');
    const item = document.createElement('div');

    item.append(root);
    document.body.append(before, item);

    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(document.querySelector('[data-blok-ask-ai-seam]')).toBeNull();
  });
});
