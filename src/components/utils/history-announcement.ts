import { announce } from './announcer';

/**
 * Says what an undo or redo key press did, like Notion. Key presses and Blok's
 * own Trash toast Restore call this. A host's blok.history.undo() is the host's
 * button, and the host says what it wants.
 * @param t - translates a message key
 * @param direction - which key was pressed
 * @param applied - whether the press applied a step
 */
export const announceHistoryPress = (
  t: (key: string) => string,
  direction: 'undo' | 'redo',
  applied: boolean
): void => {
  // One group: in a burst of presses only the newest history text waits in the queue.
  const config = { group: 'history' };

  if (applied) {
    announce(direction === 'undo' ? t('a11y.undone') : t('a11y.redone'), config);

    return;
  }
  announce(direction === 'undo' ? t('a11y.nothingToUndo') : t('a11y.nothingToRedo'), config);
};
