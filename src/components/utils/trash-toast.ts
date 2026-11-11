import type { HistoryStep } from '../../../types/api/history';
import type { NotifierOptions } from '../../../types/configs/notifier';
import type { BlokModules } from '../../types-internal/blok-modules';
import type { Block } from '../block';

type Modules = Pick<BlokModules, 'HistoryAPI' | 'NotifierAPI' | 'I18n'>;
type DeleteModules = Modules & Pick<BlokModules, 'BlockManager'>;

// Notion's toast was still up at 6 s; its real length was not measured.
const TRASH_TOAST_MS = 8000;

/**
 * True when the block's menu trashes it instead of deleting it (a sub-page).
 * @param block - the block to check
 */
export const trashesBlock = (block: Block): boolean => block.tool?.blockMenu?.trash;

/**
 * Shows Notion's "Moved to Trash" toast after a delete that trashed a block.
 * Restore undoes that delete's own step, so redo trashes it again.
 * @param Blok - the modules the toast needs
 * @param before - the newest undo step before the delete
 */
export const showTrashToast = (Blok: Modules, before: HistoryStep | undefined): void => {
  const step = Blok.HistoryAPI.latestStep();

  // No step of its own: Restore would undo something else.
  if (step === undefined || step === before) {
    return;
  }

  const options: NotifierOptions = {
    message: Blok.I18n.t('tools.database.movedToTrash'),
    compact: true,
    time: TRASH_TOAST_MS,
    actions: [{
      label: Blok.I18n.t('tools.database.restore'),
      onClick: () => {
        Blok.HistoryAPI.undoStep(step);
        Blok.NotifierAPI.dismiss(options);
      },
    }],
  };

  Blok.NotifierAPI.show(options);
};

/**
 * Runs a delete of the selection `roots`, then shows the Trash toast when it
 * removed a trashed block.
 * @param Blok - the modules the delete and the toast need
 * @param roots - the selection roots, taken before the delete
 * @param remove - the delete
 */
export const deleteWithTrashToast = <T>(Blok: DeleteModules, roots: Block[], remove: () => T): T => {
  const trashing = roots.some(trashesBlock);
  const before = trashing ? Blok.HistoryAPI.latestStep() : undefined;
  const result = remove();

  if (trashing && roots.some((root) => trashesBlock(root) && Blok.BlockManager.getBlockById(root.id) === undefined)) {
    showTrashToast(Blok, before);
  }

  return result;
};
