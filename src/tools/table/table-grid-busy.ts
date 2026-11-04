/**
 * Which grids a pointer gesture owns right now, so other gestures stand down.
 * Kept off the DOM: a style or attribute written on the grid restyles or
 * mutates the table.
 */
const busyGrids = new WeakSet<HTMLElement>();

export const setGridBusy = (grid: HTMLElement, busy: boolean): void => {
  if (busy) {
    busyGrids.add(grid);
  } else {
    busyGrids.delete(grid);
  }
};

export const isGridBusy = (grid: HTMLElement): boolean => busyGrids.has(grid);
