import type { OutputBlockData } from '@/types/data-formats/output-data';

export interface BlockStatesSpec {
  tool: string;
  label: string;
  blocks: OutputBlockData[];
}

export interface RenderBlockArgs {
  container: HTMLElement;
  blocks: OutputBlockData[];
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

function createPanel(spec: BlockStatesSpec, isActive: boolean, renderBlock: (args: RenderBlockArgs) => void): HTMLElement {
  const panel = document.createElement('div');

  panel.className = 'block-states-panel';
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('data-tool', spec.tool);

  if (!isActive) {
    panel.classList.add('hidden');
  }

  const preview = document.createElement('div');

  preview.className = 'block-states-preview';

  panel.appendChild(preview);

  renderBlock({ container: preview, blocks: spec.blocks });

  return panel;
}

export function renderBlockStatesGallery({
  container,
  spec,
  renderBlock,
  activeTool,
  onTabChange,
}: RenderBlockStatesGalleryOptions): BlockStatesGalleryHandle {
  const tabBar = document.createElement('div');

  tabBar.className = 'block-states-tabs';
  tabBar.setAttribute('role', 'tablist');

  const panelsWrap = document.createElement('div');

  panelsWrap.className = 'block-states-panels';

  const requestedIndex = activeTool ? spec.findIndex((entry) => entry.tool === activeTool) : -1;
  const initialIndex = requestedIndex >= 0 ? requestedIndex : 0;

  const entries = spec.map((entry, index) => {
    const isActive = index === initialIndex;

    return {
      tool: entry.tool,
      tab: createTab(entry.label, entry.tool, isActive),
      panel: createPanel(entry, isActive, renderBlock),
    };
  });

  entries.forEach(({ tab, panel }) => {
    tabBar.appendChild(tab);
    panelsWrap.appendChild(panel);
  });

  const selectIndex = (activeIndex: number): void => {
    entries.forEach(({ tab: t, panel: p }, otherIndex) => {
      const isTarget = otherIndex === activeIndex;

      t.setAttribute('aria-selected', isTarget ? 'true' : 'false');
      p.classList.toggle('hidden', !isTarget);
    });
  };

  entries.forEach(({ tab, tool }, activeIndex) => {
    tab.addEventListener('click', () => {
      selectIndex(activeIndex);
      onTabChange?.(tool);
    });
  });

  container.appendChild(tabBar);
  container.appendChild(panelsWrap);

  return {
    setActiveTool(tool: string) {
      const targetIndex = entries.findIndex((e) => e.tool === tool);

      if (targetIndex >= 0) {
        selectIndex(targetIndex);
      }
    },
  };
}
