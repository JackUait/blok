import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderBlockStatesGallery, type BlockStatesSpec } from '../../../src/playground/block-states-gallery';

const buildSpec = (): BlockStatesSpec[] => [
  {
    tool: 'paragraph',
    label: 'Paragraph',
    segments: [
      { label: 'Empty', blocks: [ { id: 'p-empty', type: 'paragraph', data: { text: '' } } ] },
      { label: 'Filled', blocks: [ { id: 'p-filled', type: 'paragraph', data: { text: 'Hello' } } ] },
      {
        label: 'Restricted',
        blocks: [ { id: 'p-restricted', type: 'paragraph', data: { text: 'Override' } } ],
        toolConfig: { paragraph: { preserveBlank: false } },
      },
    ],
  },
  {
    tool: 'header',
    label: 'Header',
    wide: true,
    segments: [
      { label: 'H1', blocks: [ { id: 'h-1', type: 'header', data: { text: 'Title', level: 1 } } ] },
    ],
  },
];

describe('playground block states gallery', () => {
  let container: HTMLElement;

  const tabs = (): HTMLElement[] => [ ...container.querySelectorAll<HTMLElement>('.block-states-tab') ];
  const panels = (): HTMLElement[] => [ ...container.querySelectorAll<HTMLElement>('.block-states-panel') ];
  const cardsOf = (panel: HTMLElement): HTMLElement[] => [ ...panel.querySelectorAll<HTMLElement>('.block-states-card') ];

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test('lays tabs and panels out in a side-menu wrapper with tabs first', () => {
    renderBlockStatesGallery({ container, spec: buildSpec(), renderBlock: vi.fn() });

    const layout = container.querySelector<HTMLElement>('.block-states-layout');

    expect(layout?.firstElementChild).toBe(container.querySelector('.block-states-tabs'));
    expect(layout?.children[1]).toBe(container.querySelector('.block-states-panels'));
  });

  test('renders one sub-tab per tool with its data-tool key', () => {
    renderBlockStatesGallery({ container, spec: buildSpec(), renderBlock: vi.fn() });

    expect(tabs().map((t) => t.textContent)).toEqual([ 'Paragraph', 'Header' ]);
    expect(tabs().map((t) => t.dataset.tool)).toEqual([ 'paragraph', 'header' ]);
  });

  test('first tab is selected and its panel visible by default', () => {
    renderBlockStatesGallery({ container, spec: buildSpec(), renderBlock: vi.fn() });

    expect(tabs().map((t) => t.getAttribute('aria-selected'))).toEqual([ 'true', 'false' ]);
    expect(panels().map((p) => p.classList.contains('hidden'))).toEqual([ false, true ]);
  });

  test('clicking a tab shows its panel and hides others', () => {
    renderBlockStatesGallery({ container, spec: buildSpec(), renderBlock: vi.fn() });

    tabs()[1].click();

    expect(tabs().map((t) => t.getAttribute('aria-selected'))).toEqual([ 'false', 'true' ]);
    expect(panels().map((p) => p.classList.contains('hidden'))).toEqual([ true, false ]);
  });

  test('each panel opens with the tool name and its state count', () => {
    renderBlockStatesGallery({ container, spec: buildSpec(), renderBlock: vi.fn() });

    const [ paragraph, header ] = panels();

    expect(paragraph.querySelector('h2')?.textContent).toBe('Paragraph');
    expect(paragraph.querySelector('.block-states-count')?.textContent).toBe('3 states');
    expect(header.querySelector('.block-states-count')?.textContent).toBe('1 state');
  });

  test('gives every state its own labelled card', () => {
    renderBlockStatesGallery({ container, spec: buildSpec(), renderBlock: vi.fn() });

    const cards = cardsOf(panels()[0]);

    expect(cards.map((c) => c.querySelector('.block-states-card__label')?.textContent)).toEqual([ 'Empty', 'Filled', 'Restricted' ]);
    expect(cards.every((c) => c.querySelectorAll('[data-block-states-preview]').length === 1)).toBe(true);
  });

  test('numbers cards so they can enter one after another', () => {
    renderBlockStatesGallery({ container, spec: buildSpec(), renderBlock: vi.fn() });

    expect(cardsOf(panels()[0]).map((c) => c.style.getPropertyValue('--i'))).toEqual([ '0', '1', '2' ]);
  });

  test('mounts one editor per state card with that state alone', () => {
    const renderBlock = vi.fn();
    const spec = buildSpec();

    renderBlockStatesGallery({ container, spec, renderBlock });

    const previews = cardsOf(panels()[0]).map((c) => c.querySelector('[data-block-states-preview]'));

    expect(renderBlock.mock.calls).toEqual(spec[0].segments.map((segment, i) => [ { container: previews[i], segments: [ segment ] } ]));
  });

  test('does not mount a tool until it is first opened, and mounts it once', () => {
    const renderBlock = vi.fn();
    const spec = buildSpec();

    renderBlockStatesGallery({ container, spec, renderBlock });

    expect(renderBlock).toHaveBeenCalledTimes(3);
    expect(cardsOf(panels()[1])).toHaveLength(0);

    tabs()[1].click();
    tabs()[0].click();
    tabs()[1].click();

    expect(renderBlock).toHaveBeenCalledTimes(4);
    expect(renderBlock).toHaveBeenLastCalledWith({
      container: cardsOf(panels()[1])[0].querySelector('[data-block-states-preview]'),
      segments: [ spec[1].segments[0] ],
    });
  });

  test('marks wide tools so their cards span the whole row', () => {
    renderBlockStatesGallery({ container, spec: buildSpec(), renderBlock: vi.fn() });

    expect(panels().map((p) => p.dataset.wide)).toEqual([ undefined, 'true' ]);
  });

  test('a state chip scrolls to its card and flashes it', () => {
    renderBlockStatesGallery({ container, spec: buildSpec(), renderBlock: vi.fn() });

    const panel = panels()[0];
    const chips = [ ...panel.querySelectorAll<HTMLButtonElement>('.block-states-jump') ];
    const target = cardsOf(panel)[1];
    const scrollIntoView = vi.fn();

    target.scrollIntoView = scrollIntoView;

    expect(chips.map((c) => c.textContent)).toEqual([ 'Empty', 'Filled', 'Restricted' ]);

    chips[1].click();

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(target.dataset.flash).toBe('true');
  });

  test('switches tools inside a view transition when motion is allowed', () => {
    const startViewTransition = vi.fn((update: () => void) => {
      update();

      return { finished: Promise.resolve() };
    });

    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    Object.assign(document, { startViewTransition });

    try {
      renderBlockStatesGallery({ container, spec: buildSpec(), renderBlock: vi.fn() });
      tabs()[1].click();

      expect(startViewTransition).toHaveBeenCalledTimes(1);
      expect(panels()[1].classList.contains('hidden')).toBe(false);
    } finally {
      Reflect.deleteProperty(document, 'startViewTransition');
    }
  });

  test('marks the root only while its own view transition runs', async () => {
    const seen: (string | null)[] = [];
    const finished = Promise.resolve();
    const startViewTransition = vi.fn((update: () => void) => {
      seen.push(document.documentElement.getAttribute('data-bs-vt'));
      update();

      return { finished };
    });

    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    Object.assign(document, { startViewTransition });

    try {
      renderBlockStatesGallery({ container, spec: buildSpec(), renderBlock: vi.fn() });
      tabs()[1].click();

      expect(seen).toEqual([ 'true' ]);
      await finished;
      await Promise.resolve();

      expect(document.documentElement.hasAttribute('data-bs-vt')).toBe(false);
    } finally {
      Reflect.deleteProperty(document, 'startViewTransition');
    }
  });

  test('switches tools instantly under reduced motion', () => {
    const startViewTransition = vi.fn();

    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    Object.assign(document, { startViewTransition });

    try {
      renderBlockStatesGallery({ container, spec: buildSpec(), renderBlock: vi.fn() });
      tabs()[1].click();

      expect(startViewTransition).not.toHaveBeenCalled();
      expect(panels()[1].classList.contains('hidden')).toBe(false);
    } finally {
      Reflect.deleteProperty(document, 'startViewTransition');
    }
  });

  test('the tab bar carries one decorative selection pill', () => {
    renderBlockStatesGallery({ container, spec: buildSpec(), renderBlock: vi.fn() });

    const pills = container.querySelectorAll('.block-states-tabs [data-block-states-pill]');

    expect(pills).toHaveLength(1);
    expect(pills[0].getAttribute('aria-hidden')).toBe('true');
  });

  test('activeTool option selects a non-first tab and mounts only that tool', () => {
    const renderBlock = vi.fn();

    renderBlockStatesGallery({ container, spec: buildSpec(), renderBlock, activeTool: 'header' });

    expect(tabs().map((t) => t.getAttribute('aria-selected'))).toEqual([ 'false', 'true' ]);
    expect(renderBlock).toHaveBeenCalledTimes(1);
  });

  test('unknown activeTool falls back to first tab', () => {
    renderBlockStatesGallery({ container, spec: buildSpec(), renderBlock: vi.fn(), activeTool: 'nonsense' });

    expect(tabs()[0].getAttribute('aria-selected')).toBe('true');
  });

  test('clicking a tab fires onTabChange with the tool key', () => {
    const onTabChange = vi.fn();

    renderBlockStatesGallery({ container, spec: buildSpec(), renderBlock: vi.fn(), onTabChange });
    tabs()[1].click();

    expect(onTabChange).toHaveBeenCalledWith('header');
  });

  test('returns a setActiveTool handle to programmatically switch tabs', () => {
    const onTabChange = vi.fn();
    const handle = renderBlockStatesGallery({ container, spec: buildSpec(), renderBlock: vi.fn(), onTabChange });

    handle.setActiveTool('header');

    expect(tabs()[1].getAttribute('aria-selected')).toBe('true');
    expect(cardsOf(panels()[1])).toHaveLength(1);
    expect(onTabChange).not.toHaveBeenCalled();
  });
});
