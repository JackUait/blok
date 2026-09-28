import { DATA_ATTR } from '../../components/constants/data-attributes';

/** Must match the `bottom: calc(100% + 20px)` on `.blok-image-toolbar` in main.css. */
export const ISLAND_GAP_PX = 20;

export type IslandPlacement = 'above' | 'inside';

export function resolveIslandPlacement(input: {
  figureTop: number;
  islandHeight: number;
  boundaryTop: number;
}): IslandPlacement {
  const room = input.figureTop - input.boundaryTop;

  return room >= input.islandHeight + ISLAND_GAP_PX ? 'above' : 'inside';
}

/** The lower of the viewport top and the editor's top edge: islands must not poke out past either. */
export function islandBoundaryTop(figure: HTMLElement): number {
  const editor = figure.closest<HTMLElement>(`[${DATA_ATTR.redactor}]`);
  const editorTop = editor ? editor.getBoundingClientRect().top : 0;

  return Math.max(0, editorTop);
}

/**
 * The figure also holds the caption row, so figure-relative CSS would wrap the caption too.
 * The ring, dots, readout and alt pill are placed from this height instead.
 */
export function syncMediaHeight(figure: HTMLElement): void {
  const media = figure.querySelector<HTMLElement>('.blok-image-crop') ?? figure.querySelector<HTMLElement>('img');
  if (!media || media.offsetHeight <= 0) return;
  figure.style.setProperty('--blok-image-media-height', `${media.offsetHeight}px`);
}
