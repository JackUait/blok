import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { BlockStatesSpec, RenderBlockArgs } from '../../../src/playground/block-states-gallery';
import { renderBlockStatesGallery } from '../../../src/playground/block-states-gallery';

/**
 * Mutation coverage for the playground block-states gallery.
 *
 * Observation notes:
 *
 * - `tab.type` is read back with `getAttribute('type')`. The IDL getter maps
 *   an invalid value to `'submit'`, so a blanked assignment would look like a
 *   real button through `tab.type`.
 * - The two `setActiveTool` mutants are only visible through a call that must
 *   do nothing (unknown tool) and a call that must select index 0 (the one
 *   index where `>= 0` and `> 0` disagree).
 *
 * EQUIVALENT MUTANT — `initialIndex` (source line 84):
 *   `requestedIndex >= 0 ? requestedIndex : 0` mutated to
 *   `requestedIndex > 0 ? requestedIndex : 0`.
 *   `requestedIndex` is either the literal `-1` or an `Array.findIndex`
 *   result, so its domain is `{-1} union {0, 1, 2, ...}`. The two forms pick
 *   different branches at exactly one value, `0`, and there both branches
 *   evaluate to `0` — the consequent yields `requestedIndex` (0) and the
 *   alternative yields the literal `0`. Every other value takes the same
 *   branch in both forms. The expressions are therefore equal over the whole
 *   domain and no input can distinguish them.
 *
 * Six of the seven recorded mutants are killed; the seventh is the equivalent
 * one proven above.
 */
describe('renderBlockStatesGallery mutants', () => {
  let container: HTMLElement;

  const buildSpec = (): BlockStatesSpec[] => [
    {
      tool: 'paragraph',
      label: 'Paragraph',
      segments: [ { blocks: [ { id: 'p-1',
        type: 'paragraph',
        data: { text: 'Hello' } } ] } ],
    },
    {
      tool: 'header',
      label: 'Header',
      segments: [ { blocks: [ { id: 'h-1',
        type: 'header',
        data: { text: 'Title',
          level: 1 } } ] } ],
    },
  ];

  const noopRenderBlock = (_args: RenderBlockArgs): void => undefined;

  const tabsOf = (): HTMLButtonElement[] => [
    ...container.querySelectorAll<HTMLButtonElement>('.block-states-tabs button'),
  ];

  const panelsOf = (): HTMLElement[] => [
    ...container.querySelectorAll<HTMLElement>('.block-states-panels > div'),
  ];

  const selectedFlags = (): (string | null)[] => tabsOf().map((tab) => tab.getAttribute('aria-selected'));

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  it('gives every tab an explicit button type attribute', () => {
    renderBlockStatesGallery({ container,
      spec: buildSpec(),
      renderBlock: noopRenderBlock });

    expect(tabsOf().map((tab) => tab.getAttribute('type'))).toEqual([ 'button', 'button' ]);
  });

  it('gives every tab the tab role', () => {
    renderBlockStatesGallery({ container,
      spec: buildSpec(),
      renderBlock: noopRenderBlock });

    expect(tabsOf().map((tab) => tab.getAttribute('role'))).toEqual([ 'tab', 'tab' ]);
  });

  it('gives every panel the tabpanel role', () => {
    renderBlockStatesGallery({ container,
      spec: buildSpec(),
      renderBlock: noopRenderBlock });

    expect(panelsOf().map((panel) => panel.getAttribute('role'))).toEqual([ 'tabpanel', 'tabpanel' ]);
  });

  it('gives the tab bar the tablist role', () => {
    renderBlockStatesGallery({ container,
      spec: buildSpec(),
      renderBlock: noopRenderBlock });

    const tabBar = container.querySelector<HTMLElement>('.block-states-tabs');

    expect(tabBar?.getAttribute('role')).toBe('tablist');
  });

  it('keeps the current selection when setActiveTool names an unknown tool', () => {
    const handle = renderBlockStatesGallery({ container,
      spec: buildSpec(),
      renderBlock: noopRenderBlock });

    handle.setActiveTool('does-not-exist');

    expect(selectedFlags()).toEqual([ 'true', 'false' ]);
    expect(panelsOf()[0].classList.contains('hidden')).toBe(false);
  });

  it('selects the first tool when setActiveTool walks back to index zero', () => {
    const handle = renderBlockStatesGallery({ container,
      spec: buildSpec(),
      renderBlock: noopRenderBlock,
      activeTool: 'header' });

    expect(selectedFlags()).toEqual([ 'false', 'true' ]);

    handle.setActiveTool('paragraph');

    expect(selectedFlags()).toEqual([ 'true', 'false' ]);
    expect(panelsOf()[0].classList.contains('hidden')).toBe(false);
    expect(panelsOf()[1].classList.contains('hidden')).toBe(true);
  });
});
