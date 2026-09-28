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
