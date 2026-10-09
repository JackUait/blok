import type { Blocks } from '../../../../types/api/blocks';
import type { NotifierOptions } from '../../../../types/configs/notifier';
import { csvDatabaseBlocks, pastedTable } from '../../../tools/database/database-csv';

export interface CsvOfferDeps {
  blocks: Pick<Blocks, 'getById' | 'getBlockIndex' | 'insertAt' | 'delete' | 'beginTransaction' | 'endTransaction'>;
  notify: (options: NotifierOptions) => void;
  t: (key: string) => string;
  newId: () => string;
}

/** Reads the index at delete time: each delete shifts the ones after it. */
const deleteById = async (blocks: CsvOfferDeps['blocks'], id: string): Promise<void> => {
  const index = blocks.getBlockIndex(id);

  if (index !== undefined) await blocks.delete(index, false);
};

const convert = async (table: string[][], addedIds: string[], deps: CsvOfferDeps): Promise<void> => {
  const { blocks } = deps;
  const [first, ...rest] = addedIds.filter((id) => blocks.getById(id) !== null);

  if (first === undefined) return;
  const built = csvDatabaseBlocks(table, {
    newId: deps.newId,
    untitled: deps.t('tools.database.csvUntitledColumn'),
    viewName: deps.t('tools.database.viewTypeTable'),
    title: '',
  });

  blocks.beginTransaction?.();
  try {
    blocks.insertAt('database', built.data, { replace: first, id: built.id });
    for (const row of built.rows) {
      blocks.insertAt('database-row', row.data, { parentId: built.id, position: 'end', id: row.id });
    }
    for (const id of rest) {
      await deleteById(blocks, id);
    }
  } finally {
    blocks.endTransaction?.();
  }
};

/**
 * After plain text that reads as a CSV or TSV table lands as paragraphs,
 * offers to turn those paragraphs into a database. Unverified in Notion
 * (research/05 U4). Offered only when every line became a new block: a line
 * merged into the block at the caret could not be taken back.
 */
export const offerCsvDatabase = (text: string, addedIds: string[], deps: CsvOfferDeps): boolean => {
  const table = pastedTable(text);
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '').length;

  if (table === null || addedIds.length !== lines) return false;
  deps.notify({
    message: deps.t('tools.database.csvPasteOffer'),
    actions: [{
      label: deps.t('tools.database.csvPasteConvert'),
      primary: true,
      onClick: () => {
        void convert(table, addedIds, deps);
      },
    }],
  });

  return true;
};
