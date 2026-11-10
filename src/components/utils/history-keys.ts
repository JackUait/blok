import { getUserOS } from './browser';

/**
 * What a keydown does to the editor history. `blocked` is a Control chord that
 * is undo or redo on Windows and Linux but nothing on macOS (Notion keys); its
 * default must still be cancelled so the browser's own undo never runs.
 */
export type HistoryKey = 'undo' | 'redo' | 'blocked' | null;

/**
 * @param event - the keydown
 * @param letter - the shortcut letter, already mapped from the physical key on non-Latin layouts
 */
export const historyKeyOf = (event: KeyboardEvent, letter: string): HistoryKey => {
  const lower = letter.toLowerCase();
  const isZ = lower === 'z';
  const isY = lower === 'y';

  if (!isZ && !isY) {
    return null;
  }

  // Read per press: the platform is mocked in tests.
  if (getUserOS().mac) {
    if (event.ctrlKey) {
      return isZ || !event.shiftKey ? 'blocked' : null;
    }
    if (!event.metaKey) {
      return null;
    }
    if (isZ) {
      return event.shiftKey ? 'redo' : 'undo';
    }

    return event.shiftKey ? null : 'redo';
  }

  if (isZ && (event.metaKey || event.ctrlKey)) {
    return event.shiftKey ? 'redo' : 'undo';
  }

  return isY && event.ctrlKey && !event.shiftKey ? 'redo' : null;
};
