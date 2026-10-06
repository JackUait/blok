/**
 * Minimal block shape expected by the normalizer.
 * Matches the SaverValidatedData shape from the saver pipeline.
 */
interface NormalizableBlock {
  id?: string;
  tool?: string;
  data?: Record<string, unknown>;
  isValid: boolean;
  parentId?: string | null;
  contentIds?: string[];
  tunes?: Record<string, unknown>;
  time?: number;
}

/**
 * Shape of a table cell within the table's content data.
 */
interface TableCell {
  blocks: string[];
}

/**
 * One run of a paragraph's text, cut at each extracted image.
 */
type Piece =
  | { kind: 'text'; html: string; empty: boolean }
  | { kind: 'image'; url: string; alt: string | null };

/**
 * Blocks that replace one paragraph, in document order.
 */
interface Replacement {
  parentTableId: string;
  blocks: NormalizableBlock[];
}

const serialize = (fragment: DocumentFragment): Pick<Extract<Piece, { kind: 'text' }>, 'html' | 'empty'> => {
  const template = document.createElement('template');

  template.content.append(fragment);

  return {
    html: template.innerHTML,
    // A Range cut leaves empty clones of marks that wrapped the image.
    empty: (template.content.textContent ?? '').trim() === '' && template.content.querySelector('img') === null,
  };
};

/**
 * Cuts paragraph HTML at every `<img src>`. Uses a Range so a mark that wraps
 * an image is closed on one side and reopened on the other.
 *
 * @param text - paragraph HTML
 * @returns pieces in order, or null when there is no image to extract
 */
const splitAroundImages = (text: string): Piece[] | null => {
  if (!/<img\b/i.test(text)) {
    return null;
  }

  // A template parses inertly: no image loads, no onerror.
  const template = document.createElement('template');

  template.innerHTML = text;

  const root = template.content;
  const images = Array.from(root.querySelectorAll('img')).filter((img) => (img.getAttribute('src') ?? '') !== '');

  if (images.length === 0) {
    return null;
  }

  const pieces: Piece[] = [];
  const range = (root.ownerDocument ?? document).createRange();

  for (const img of images) {
    range.setStart(root, 0);
    range.setEndBefore(img);
    pieces.push({ kind: 'text', ...serialize(range.extractContents()) });
    pieces.push({ kind: 'image', url: img.getAttribute('src') ?? '', alt: img.getAttribute('alt') });
    img.remove();
  }

  range.selectNodeContents(root);
  pieces.push({ kind: 'text', ...serialize(range.extractContents()) });

  return pieces;
};

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/**
 * Hashes a seed into a 10-char id in the generateBlockId alphabet.
 * Two 32-bit lanes (cyrb53 mixing) give 5 chars of 6 bits each.
 *
 * @param seed - any string
 */
const hashToBlockId = (seed: string): string => {
  const [a, b] = Array.from(seed).reduce(
    ([h1, h2], char) => {
      const code = char.charCodeAt(0);

      return [Math.imul(h1 ^ code, 2654435761), Math.imul(h2 ^ code, 1597334677)];
    },
    [0xdeadbeef, 0x41c6ce57]
  );
  const h1 = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  const h2 = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return [h1, h2]
    .flatMap((lane) => [0, 6, 12, 18, 24].map((shift) => ID_ALPHABET[(lane >>> shift) & 63]))
    .join('');
};

/**
 * Mints the id of one extracted block. The save never rewrites the live
 * document, so a random id would change on every save of the same content.
 *
 * @param sourceId - id of the paragraph being split
 * @param pieceIndex - position of the piece in that paragraph
 * @param taken - ids already used; the new id is added to it
 * @param attempt - bumped past each id that is already taken
 */
const deriveId = (sourceId: string, pieceIndex: number, taken: Set<string>, attempt = 0): string => {
  const id = hashToBlockId(`${sourceId}:${pieceIndex}:${attempt}`);

  if (taken.has(id)) {
    return deriveId(sourceId, pieceIndex, taken, attempt + 1);
  }

  taken.add(id);

  return id;
};

/**
 * Builds the blocks that replace a table cell paragraph holding images.
 * The paragraph keeps its id on the first non-empty text run; later runs
 * become new paragraphs. With no text left it stays, empty, after the images.
 *
 * @param paragraph - the source paragraph
 * @param sourceId - its id
 * @param parentTableId - id of the table that holds it
 * @param pieces - its text cut around the images
 * @param taken - ids already used in the document
 * @returns blocks in document order
 */
const buildReplacement = (
  paragraph: NormalizableBlock,
  sourceId: string,
  parentTableId: string,
  pieces: Piece[],
  taken: Set<string>
): NormalizableBlock[] => {
  const blocks: NormalizableBlock[] = [];
  const firstText = pieces.find((piece) => piece.kind === 'text' && !piece.empty);

  for (const [index, piece] of pieces.entries()) {
    if (piece.kind === 'image') {
      blocks.push({
        id: deriveId(sourceId, index, taken),
        tool: 'image',
        data: piece.alt !== null && piece.alt !== '' ? { url: piece.url, alt: piece.alt } : { url: piece.url },
        isValid: true,
        parentId: parentTableId,
      });
      continue;
    }

    if (piece.empty) {
      continue;
    }

    if (piece === firstText) {
      blocks.push({ ...paragraph, data: { ...paragraph.data, text: piece.html } });
      continue;
    }

    const copy: NormalizableBlock = { ...paragraph, id: deriveId(sourceId, index, taken), data: { ...paragraph.data, text: piece.html } };

    // Children belong to the original paragraph only.
    delete copy.contentIds;
    blocks.push(copy);
  }

  if (firstText === undefined) {
    blocks.push({ ...paragraph, data: { ...paragraph.data, text: '' } });
  }

  return blocks;
};

/**
 * Normalizes inline images in table cell paragraphs by extracting `<img>` tags
 * into standalone image blocks.
 *
 * For each paragraph block whose parent is a table, the paragraph is split at
 * every `<img>`: text before an image stays before it, text after stays after.
 * The new blocks take the paragraph's place in the cell's `blocks` array, in
 * the table's `contentIds`, and in the returned array.
 *
 * @param blocks - array of saved block data
 * @returns new array with inline images extracted into standalone blocks
 */
export const normalizeInlineImages = <T extends NormalizableBlock>(blocks: T[]): T[] => {
  const blockById = new Map<string, T>();

  for (const block of blocks) {
    if (block.id !== undefined) {
      blockById.set(block.id, block);
    }
  }

  if (!blocks.some((b) => b.tool === 'table')) {
    return blocks;
  }

  const replacements = new Map<string, Replacement>();
  const taken = new Set(blockById.keys());

  for (const block of blocks) {
    if (block.tool !== 'paragraph' || block.id === undefined || block.parentId === undefined || block.parentId === null) {
      continue;
    }

    const parent = blockById.get(block.parentId);
    const text = block.data?.text;

    if (parent === undefined || parent.tool !== 'table' || typeof text !== 'string') {
      continue;
    }

    const pieces = splitAroundImages(text);

    if (pieces === null) {
      continue;
    }

    replacements.set(block.id, {
      parentTableId: block.parentId,
      blocks: buildReplacement(block, block.id, block.parentId, pieces, taken),
    });
  }

  if (replacements.size === 0) {
    return blocks;
  }

  /**
   * Clone each touched table so the caller's data stays untouched.
   */
  const clonedTables = new Map<string, T>();

  for (const { parentTableId } of replacements.values()) {
    const original = blockById.get(parentTableId);

    if (original === undefined || clonedTables.has(parentTableId)) {
      continue;
    }

    const cloned = { ...original };
    const originalData = original.data as { content: TableCell[][] } | undefined;

    if (originalData?.content !== undefined) {
      cloned.data = {
        ...original.data,
        content: originalData.content.map((row) => row.map((cell) => ({ ...cell, blocks: [...cell.blocks] }))),
      };
    }

    cloned.contentIds = original.contentIds !== undefined ? [...original.contentIds] : [];
    clonedTables.set(parentTableId, cloned);
  }

  for (const [paragraphId, replacement] of replacements) {
    const clonedTable = clonedTables.get(replacement.parentTableId);

    if (clonedTable === undefined) {
      continue;
    }

    const orderedIds = replacement.blocks.map((b) => b.id ?? '');
    const tableData = clonedTable.data as { content: TableCell[][] } | undefined;

    // No grid to place them in: leave contentIds alone so no child goes unreferenced.
    if (tableData?.content === undefined) {
      continue;
    }

    tableData.content.flat().forEach((cell) => {
      const index = cell.blocks.indexOf(paragraphId);

      if (index !== -1) {
        cell.blocks.splice(index, 1, ...orderedIds);
      }
    });

    const contentIds = clonedTable.contentIds ?? [];
    const index = contentIds.indexOf(paragraphId);

    if (index !== -1) {
      contentIds.splice(index, 1, ...orderedIds);
    } else {
      contentIds.push(...orderedIds.filter((id) => id !== paragraphId));
    }

    clonedTable.contentIds = contentIds;
  }

  const result: T[] = [];

  for (const block of blocks) {
    const id = block.id;

    if (id !== undefined && clonedTables.has(id)) {
      result.push(clonedTables.get(id) as T);
      continue;
    }

    const replacement = id !== undefined ? replacements.get(id) : undefined;

    if (replacement !== undefined) {
      result.push(...(replacement.blocks as T[]));
      continue;
    }

    result.push(block);
  }

  return result;
};
