import type { BlokModules } from '../../types-internal/blok-modules';
import type { Block } from '../block';

import { selectionRoots } from './selection-roots';

type Modules = Pick<BlokModules, 'BlockManager' | 'BlockSelection'>;

/** Editors with a delete question open, by their BlockManager. */
const asking = new WeakSet<BlokModules['BlockManager']>();

/**
 * True while a delete question is open in this editor. Its keys stand down:
 * Enter on the dialog's button must not clear the selection and cancel the click.
 * @param Blok - the editor's modules
 */
export const isAskingBeforeDelete = (Blok: Pick<BlokModules, 'BlockManager'>): boolean => asking.has(Blok.BlockManager);

/**
 * The first selection root whose tool asks before it goes. One question covers
 * the whole selection (notion-motion.md Round 66 §2).
 * @param roots - the selection roots
 */
export const deleteAsker = (roots: Block[]): Block | undefined => roots.find((root) => root.asksBeforeDelete);

/**
 * The selection holds a block whose tool asks before it goes. Typing or
 * pasting over it then must not replace it: only a delete may remove it,
 * and a delete asks (notion-motion.md Round 67 §2).
 * @param blocks - every block, selected or not
 */
export const selectionHoldsAsker = (blocks: Block[]): boolean =>
  deleteAsker(selectionRoots(blocks.filter((block) => block.selected))) !== undefined;

/**
 * Asks `asker` before a delete. After the answer, `keep` is the selection again,
 * as in Notion, where Escape and Cancel leave the block selected.
 * The answer comes a task later: in a browser the key that answered the dialog
 * still reaches the editor's document listeners after the answer's microtasks,
 * and Escape there would clear the selection.
 * @param Blok - the editor's modules
 * @param asker - the block whose tool asks
 * @param keep - the blocks selected through the question
 * @returns the answer, true to delete
 */
export const askBeforeDelete = async (Blok: Modules, asker: Block, keep: Block[]): Promise<boolean> => {
  const { BlockManager, BlockSelection } = Blok;

  asking.add(BlockManager);
  try {
    const confirmed = await asker.confirmDelete();

    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    const ids = new Set(keep.map((block) => block.id));

    BlockManager.blocks
      .filter((block) => block.selected !== ids.has(block.id))
      .forEach((block) => {
        const changed = block;

        changed.selected = ids.has(block.id);
      });
    BlockSelection.clearCache();

    return confirmed;
  } finally {
    asking.delete(BlockManager);
  }
};
