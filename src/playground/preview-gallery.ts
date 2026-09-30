import { createPreviewCard } from '../components/ui/toolbox-preview';

import type { ToolboxConfigEntry } from '@/types';

interface PreviewGalleryOptions {
  container: HTMLElement;
  /** Tool classes by export name, as src/tools/index.ts exports them. */
  tools: Record<string, unknown>;
  translate: (key: string, params?: Record<string, string | number>) => string;
}

const entriesOf = (tool: unknown): ToolboxConfigEntry[] => {
  if (typeof tool !== 'function' || !('toolbox' in tool)) {
    return [];
  }

  const toolbox = (tool as { toolbox?: ToolboxConfigEntry | ToolboxConfigEntry[] }).toolbox;

  if (toolbox === undefined) {
    return [];
  }

  return Array.isArray(toolbox) ? toolbox : [ toolbox ];
};

/**
 * Playground page showing every toolbox hover preview at once, laid out in
 * place instead of floating.
 * @param options - gallery options
 */
export const renderPreviewGallery = ({ container, tools, translate }: PreviewGalleryOptions): void => {
  const grid = document.createElement('div');

  grid.className = 'preview-gallery-grid';

  Object.entries(tools).forEach(([exportName, tool]) => {
    entriesOf(tool).forEach((entry) => {
      const preview = entry.preview;

      if (preview === undefined) {
        return;
      }

      const cell = document.createElement('figure');
      const root = document.createElement('div');
      const label = document.createElement('figcaption');
      const { card, paper, caption } = createPreviewCard();

      root.setAttribute('data-blok-interface', 'block-preview');
      root.setAttribute('data-state', 'open');
      root.setAttribute('data-preview-gallery-card', '');
      paper.appendChild(preview.render());
      caption.textContent = preview.descriptionKey !== undefined
        ? translate(preview.descriptionKey, preview.descriptionParams)
        : preview.description ?? '';
      root.appendChild(card);
      label.setAttribute('data-preview-gallery-label', '');
      label.textContent = `${exportName} · ${entry.name ?? entry.titleKey ?? ''}`;
      cell.className = 'preview-gallery-cell';
      cell.append(root, label);
      grid.appendChild(cell);
    });
  });

  container.replaceChildren(grid);
};
