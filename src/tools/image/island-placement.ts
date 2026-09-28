import { DATA_ATTR } from '../../components/constants/data-attributes';
import { TABLE_CELL_ATTR } from './constants';

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

/**
 * The lowest of the viewport top, the editor's top edge and a table cell's top edge:
 * islands must not poke out past any of them (a cell clips its overflow).
 */
export function islandBoundaryTop(figure: HTMLElement): number {
  const editor = figure.closest<HTMLElement>(`[${DATA_ATTR.redactor}]`);
  const cell = figure.closest<HTMLElement>(`[${TABLE_CELL_ATTR}]`);
  const editorTop = editor ? editor.getBoundingClientRect().top : 0;
  const cellTop = cell ? cell.getBoundingClientRect().top : 0;

  return Math.max(0, editorTop, cellTop);
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
