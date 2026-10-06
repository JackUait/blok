import type { OutputBlockData } from '@/types/data-formats/output-data';

export interface BlockStateSegment {
  label: string;
  blocks: OutputBlockData[];
  /** Per-editor tool config overrides (e.g. `{ audio: { sources: 'url' } }`). */
  toolConfig?: Record<string, Record<string, unknown>>;
}

export interface BlockStatesSpec {
  tool: string;
  label: string;
  /** Cards take the whole row instead of sharing it two-up. */
  wide?: boolean;
  segments: BlockStateSegment[];
}

export interface RenderBlockArgs {
  container: HTMLElement;
  segments: BlockStateSegment[];
}

export interface RenderBlockStatesGalleryOptions {
  container: HTMLElement;
  spec: BlockStatesSpec[];
  renderBlock: (args: RenderBlockArgs) => void;
  activeTool?: string;
  onTabChange?: (tool: string) => void;
}

export interface BlockStatesGalleryHandle {
  setActiveTool: (tool: string) => void;
}

const FLASH_MS = 1200;

function createTab(label: string, tool: string, isActive: boolean): HTMLButtonElement {
  const tab = document.createElement('button');

  tab.type = 'button';
  tab.className = 'block-states-tab';
  tab.setAttribute('data-tool', tool);
  tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
  tab.textContent = label;

  return tab;
}

function createCard(segment: BlockStateSegment, index: number): HTMLElement {
  const card = document.createElement('section');
  const label = document.createElement('h3');
  const preview = document.createElement('div');

  card.className = 'block-states-card';
  card.style.setProperty('--i', String(index));
  label.className = 'block-states-card__label';
  label.textContent = segment.label;
  preview.setAttribute('data-block-states-preview', '');
  card.append(label, preview);

  return card;
}

function flash(card: HTMLElement): void {
  card.setAttribute('data-flash', 'true');
  setTimeout(() => card.removeAttribute('data-flash'), FLASH_MS);
}

function createPanelHead(spec: BlockStatesSpec, cards: () => HTMLElement[]): HTMLElement {
  const head = document.createElement('header');
  const title = document.createElement('h2');
  const count = document.createElement('p');
  const jumps = document.createElement('nav');
  const total = spec.segments.length;

  head.className = 'block-states-head';
  title.className = 'block-states-title';
  title.textContent = spec.label;
  count.className = 'block-states-count';
  count.textContent = `${total} ${total === 1 ? 'state' : 'states'}`;
  jumps.className = 'block-states-jumps';
  jumps.setAttribute('aria-label', `${spec.label} states`);

  spec.segments.forEach((segment, index) => {
    const chip = document.createElement('button');

    chip.type = 'button';
    chip.className = 'block-states-jump';
    chip.textContent = segment.label;
    chip.addEventListener('click', () => {
      const card = cards()[index];

      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      flash(card);
    });
    jumps.appendChild(chip);
  });

  head.append(title, count, jumps);

  return head;
}

function createPanel(spec: BlockStatesSpec, renderBlock: (args: RenderBlockArgs) => void): { panel: HTMLElement; mount: () => void } {
  const panel = document.createElement('div');
  const grid = document.createElement('div');
  const cards: HTMLElement[] = [];

  panel.className = 'block-states-panel';
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('data-tool', spec.tool);

  if (spec.wide) {
    panel.setAttribute('data-wide', 'true');
  }

  grid.className = 'block-states-grid';
  panel.append(createPanelHead(spec, () => cards), grid);

  // Editors are costly, so a tool's cards are built the first time it opens.
  const mount = (): void => {
    if (cards.length > 0) {
      return;
    }

    spec.segments.forEach((segment, index) => {
      const card = createCard(segment, index);

      cards.push(card);
      grid.appendChild(card);
      renderBlock({ container: card.querySelector<HTMLElement>('[data-block-states-preview]') ?? card, segments: [ segment ] });
    });
  };

  return { panel, mount };
}

function createPill(): HTMLElement {
  const pill = document.createElement('span');

  pill.className = 'block-states-tabs__pill';
  pill.setAttribute('data-block-states-pill', '');
  pill.setAttribute('aria-hidden', 'true');

  return pill;
}

const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type StartViewTransition = (cb: () => void) => { finished: Promise<unknown> };

// The CSS for this transition is scoped to `data-bs-vt`, so the theme switch
// and page-host transitions keep their own root animation.
function withTransition(update: () => void): void {
  const start = (document as Document & { startViewTransition?: StartViewTransition }).startViewTransition;

  if (typeof start !== 'function' || prefersReducedMotion()) {
    update();

    return;
  }

  const root = document.documentElement;

  root.setAttribute('data-bs-vt', 'true');
  start.call(document, update).finished.finally(() => root.removeAttribute('data-bs-vt')).catch(() => undefined);
}

export function renderBlockStatesGallery({
  container,
  spec,
  renderBlock,
  activeTool,
  onTabChange,
}: RenderBlockStatesGalleryOptions): BlockStatesGalleryHandle {
  const tabBar = document.createElement('div');
  const pill = createPill();

  tabBar.className = 'block-states-tabs';
  tabBar.setAttribute('role', 'tablist');
  tabBar.appendChild(pill);

  const panelsWrap = document.createElement('div');

  panelsWrap.className = 'block-states-panels';

  const requestedIndex = activeTool ? spec.findIndex((entry) => entry.tool === activeTool) : -1;
  const initialIndex = requestedIndex >= 0 ? requestedIndex : 0;

  const entries = spec.map((entry, index) => {
    const isActive = index === initialIndex;
    const { panel, mount } = createPanel(entry, renderBlock);

    panel.classList.toggle('hidden', !isActive);

    return {
      tool: entry.tool,
      tab: createTab(entry.label, entry.tool, isActive),
      panel,
      mount,
    };
  });

  entries.forEach(({ tab, panel }) => {
    tabBar.appendChild(tab);
    panelsWrap.appendChild(panel);
  });

  const placePill = (tab: HTMLElement): void => {
    pill.style.transform = `translateY(${tab.offsetTop}px)`;
    pill.style.height = `${tab.offsetHeight}px`;
  };

  const selectIndex = (activeIndex: number): void => {
    entries.forEach(({ tab: t, panel: p }, otherIndex) => {
      const isTarget = otherIndex === activeIndex;

      t.setAttribute('aria-selected', isTarget ? 'true' : 'false');
      p.classList.toggle('hidden', !isTarget);
    });
    entries[activeIndex].mount();
    placePill(entries[activeIndex].tab);
  };

  entries.forEach(({ tab, tool }, activeIndex) => {
    tab.addEventListener('click', () => {
      withTransition(() => selectIndex(activeIndex));
      onTabChange?.(tool);
    });
  });

  const layout = document.createElement('div');

  layout.className = 'block-states-layout';
  layout.appendChild(tabBar);
  layout.appendChild(panelsWrap);

  container.appendChild(layout);
  entries[initialIndex]?.mount();

  // Tabs have no size until the layout is in the page and styled. `data-ready`
  // turns the pill's transition on, so it lands a frame after the first place.
  requestAnimationFrame(() => {
    const active = entries.find(({ tab }) => tab.getAttribute('aria-selected') === 'true');

    if (active) {
      placePill(active.tab);
    }
    requestAnimationFrame(() => {
      tabBar.setAttribute('data-ready', 'true');
    });
  });

  return {
    setActiveTool(tool: string) {
      const targetIndex = entries.findIndex((e) => e.tool === tool);

      if (targetIndex >= 0) {
        selectIndex(targetIndex);
      }
    },
  };
}
