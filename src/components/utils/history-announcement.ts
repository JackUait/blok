import { announce } from './announcer';

/**
 * Says what an undo or redo key press did, like Notion. Only key presses call
 * this: a host's blok.history.undo() is its own button, and it says what it wants.
 * An undo with nothing to undo says nothing, because Notion's text for it was never measured.
 * @param t - translates a message key
 * @param direction - which key was pressed
 * @param applied - whether the press applied a step
 */
export const announceHistoryPress = (
  t: (key: string) => string,
  direction: 'undo' | 'redo',
  applied: boolean
): void => {
  if (applied) {
    announce(direction === 'undo' ? t('a11y.undone') : t('a11y.redone'));

    return;
  }
  if (direction === 'redo') {
    announce(t('a11y.nothingToRedo'));
  }
};
