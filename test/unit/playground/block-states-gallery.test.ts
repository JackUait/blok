import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderBlockStatesGallery, type BlockStatesSpec } from '../../../src/playground/block-states-gallery';

const buildSpec = (): BlockStatesSpec[] => [
  {
    tool: 'paragraph',
    label: 'Paragraph',
    blocks: [
      { id: 'p-label-empty', type: 'header', data: { text: 'Empty', level: 4 } },
      { id: 'p-empty', type: 'paragraph', data: { text: '' } },
      { id: 'p-label-filled', type: 'header', data: { text: 'Filled', level: 4 } },
      { id: 'p-filled', type: 'paragraph', data: { text: 'Hello' } },
    ],
  },
  {
    tool: 'header',
    label: 'Header',
    blocks: [
      { id: 'h-label', type: 'header', data: { text: 'H1', level: 4 } },
      { id: 'h-1', type: 'header', data: { text: 'Title', level: 1 } },
    ],
  },
];

describe('playground block states gallery', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  test('renders one sub-tab per tool', () => {
    const renderBlock = vi.fn();

    renderBlockStatesGallery({ container, spec: buildSpec(), renderBlock });

    const tabs = container.querySelectorAll<HTMLElement>('.block-states-tab');

    expect(tabs.length).toBe(2);
    expect(tabs[0].textContent).toContain('Paragraph');
    expect(tabs[1].textContent).toContain('Header');
  });

  test('first tab is selected and its panel visible by default', () => {
    const renderBlock = vi.fn();

    renderBlockStatesGallery({ container, spec: buildSpec(), renderBlock });

    const tabs = container.querySelectorAll<HTMLElement>('.block-states-tab');
    const panels = container.querySelectorAll<HTMLElement>('.block-states-panel');

    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');
    expect(panels[0].classList.contains('hidden')).toBe(false);
    expect(panels[1].classList.contains('hidden')).toBe(true);
  });

  test('clicking a tab shows its panel and hides others', () => {
    const renderBlock = vi.fn();

    renderBlockStatesGallery({ container, spec: buildSpec(), renderBlock });

    const tabs = container.querySelectorAll<HTMLElement>('.block-states-tab');
    const panels = container.querySelectorAll<HTMLElement>('.block-states-panel');

    tabs[1].click();

    expect(tabs[0].getAttribute('aria-selected')).toBe('false');
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(panels[0].classList.contains('hidden')).toBe(true);
    expect(panels[1].classList.contains('hidden')).toBe(false);
  });

  test('each panel has a single editor preview mount', () => {
    const renderBlock = vi.fn();

    renderBlockStatesGallery({ container, spec: buildSpec(), renderBlock });

    const panels = container.querySelectorAll<HTMLElement>('.block-states-panel');

    expect(panels[0].querySelectorAll('.block-states-preview').length).toBe(1);
    expect(panels[1].querySelectorAll('.block-states-preview').length).toBe(1);
  });

  test('calls renderBlock once per tool with all flattened blocks', () => {
    const renderBlock = vi.fn();
    const spec = buildSpec();

    renderBlockStatesGallery({ container, spec, renderBlock });

    expect(renderBlock).toHaveBeenCalledTimes(2);

    const previews = container.querySelectorAll<HTMLElement>('.block-states-preview');

    expect(renderBlock).toHaveBeenNthCalledWith(1, {
      container: previews[0],
      blocks: spec[0].blocks,
    });
    expect(renderBlock).toHaveBeenNthCalledWith(2, {
      container: previews[1],
      blocks: spec[1].blocks,
    });
  });

  test('sub-tab gets data-tool attribute matching its tool key', () => {
    const renderBlock = vi.fn();

    renderBlockStatesGallery({ container, spec: buildSpec(), renderBlock });

    const tabs = container.querySelectorAll<HTMLElement>('.block-states-tab');

    expect(tabs[0].dataset.tool).toBe('paragraph');
    expect(tabs[1].dataset.tool).toBe('header');
  });

  test('activeTool option selects a non-first tab initially', () => {
    const renderBlock = vi.fn();

    renderBlockStatesGallery({ container, spec: buildSpec(), renderBlock, activeTool: 'header' });

    const tabs = container.querySelectorAll<HTMLElement>('.block-states-tab');
    const panels = container.querySelectorAll<HTMLElement>('.block-states-panel');

    expect(tabs[0].getAttribute('aria-selected')).toBe('false');
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(panels[0].classList.contains('hidden')).toBe(true);
    expect(panels[1].classList.contains('hidden')).toBe(false);
  });

  test('unknown activeTool falls back to first tab', () => {
    const renderBlock = vi.fn();

    renderBlockStatesGallery({ container, spec: buildSpec(), renderBlock, activeTool: 'nonsense' });

    const tabs = container.querySelectorAll<HTMLElement>('.block-states-tab');

    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });

  test('clicking a tab fires onTabChange with the tool key', () => {
    const renderBlock = vi.fn();
    const onTabChange = vi.fn();

    renderBlockStatesGallery({ container, spec: buildSpec(), renderBlock, onTabChange });

    const tabs = container.querySelectorAll<HTMLElement>('.block-states-tab');

    tabs[1].click();

    expect(onTabChange).toHaveBeenCalledWith('header');
  });

  test('returns a setActiveTool handle to programmatically switch tabs', () => {
    const renderBlock = vi.fn();
    const onTabChange = vi.fn();

    const handle = renderBlockStatesGallery({ container, spec: buildSpec(), renderBlock, onTabChange });

    handle.setActiveTool('header');

    const tabs = container.querySelectorAll<HTMLElement>('.block-states-tab');
    const panels = container.querySelectorAll<HTMLElement>('.block-states-panel');

    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(panels[1].classList.contains('hidden')).toBe(false);
    expect(onTabChange).not.toHaveBeenCalled();
  });
});
