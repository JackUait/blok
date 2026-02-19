import { generateBlockId } from '../utils/id-generator';

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
 * Regex to match <img> tags and capture their src attribute.
 * Handles both single and double quotes around src value.
 */
const IMG_TAG_REGEX = /<img\s+[^>]*src=["']([^"']+)["'][^>]*>/g;

/**
 * Normalizes inline images in table cell paragraphs by extracting `<img>` tags
 * into standalone image blocks.
 *
 * For each paragraph block whose parent is a table:
 * 1. Extracts all `<img>` tags from the paragraph's text
 * 2. Creates a new image block for each extracted `<img>`
 * 3. Removes the `<img>` tags from the paragraph text
 * 4. Inserts the new image block IDs before the paragraph in the table cell's blocks array
 * 5. Adds the new image block IDs to the table's contentIds
 *
 * @param blocks - array of saved block data
 * @returns new array with inline images extracted into standalone blocks
 */
export const normalizeInlineImages = <T extends NormalizableBlock>(blocks: T[]): T[] => {
  /**
   * Build a lookup of block id → block for quick parent resolution.
   */
  const blockById = new Map<string, T>();

  for (const block of blocks) {
    if (block.id !== undefined) {
      blockById.set(block.id, block);
    }
  }

  /**
   * Check if there are any table blocks at all. If not, return input unchanged.
   */
  const hasTable = blocks.some((b) => b.tool === 'table');

  if (!hasTable) {
    return blocks;
  }

  /**
   * Track which paragraphs need image extraction.
   * Maps paragraph id → { parentTableId, imgSrcs[] }
   */
  interface ExtractionInfo {
    parentTableId: string;
    imgSrcs: string[];
    cleanedText: string;
  }

  const extractionMap = new Map<string, ExtractionInfo>();

  for (const block of blocks) {
    if (block.tool !== 'paragraph' || block.parentId === undefined || block.parentId === null) {
      continue;
    }

    const parent = blockById.get(block.parentId);

    if (parent === undefined || parent.tool !== 'table') {
      continue;
    }

    const text = block.data?.text;

    if (typeof text !== 'string') {
      continue;
    }

    const imgSrcs: string[] = [];
    let match: RegExpExecArray | null;

    /**
     * Reset regex lastIndex before iterating since it's a global regex.
     */
    IMG_TAG_REGEX.lastIndex = 0;

    while ((match = IMG_TAG_REGEX.exec(text)) !== null) {
      imgSrcs.push(match[1]);
    }

    if (imgSrcs.length === 0) {
      continue;
    }

    /**
     * Remove all <img> tags from text.
     */
    IMG_TAG_REGEX.lastIndex = 0;
    const cleanedText = text.replace(IMG_TAG_REGEX, '');

    if (block.id !== undefined) {
      extractionMap.set(block.id, {
        parentTableId: block.parentId,
        imgSrcs,
        cleanedText,
      });
    }
  }

  /**
   * If no paragraphs need extraction, return input unchanged.
   */
  if (extractionMap.size === 0) {
    return blocks;
  }

  /**
   * Generate image block IDs and build new image blocks.
   * Maps paragraph id → array of new image block entries.
   */
  const newImageBlocksPerParagraph = new Map<string, T[]>();

  for (const [paragraphId, info] of extractionMap) {
    const imageBlocks: T[] = [];

    for (const src of info.imgSrcs) {
      const imageBlock = {
        id: generateBlockId(),
        tool: 'image',
        data: { url: src },
        isValid: true,
        parentId: info.parentTableId,
      } as unknown as T;

      imageBlocks.push(imageBlock);
    }

    newImageBlocksPerParagraph.set(paragraphId, imageBlocks);
  }

  /**
   * Clone table blocks and update their content/contentIds with new image block references.
   */
  const updatedTableIds = new Set<string>();

  for (const info of extractionMap.values()) {
    updatedTableIds.add(info.parentTableId);
  }

  const clonedTables = new Map<string, T>();

  for (const tableId of updatedTableIds) {
    const original = blockById.get(tableId);

    if (original === undefined) {
      continue;
    }

    const cloned = { ...original };
    const originalData = original.data as { content: TableCell[][] } | undefined;

    if (originalData?.content !== undefined) {
      /**
       * Deep clone the content array so we can mutate cell blocks arrays.
       */
      const clonedContent: TableCell[][] = originalData.content.map(
        (row) => row.map((cell) => ({ ...cell, blocks: [...cell.blocks] }))
      );

      cloned.data = { ...original.data, content: clonedContent };
    }

    cloned.contentIds = original.contentIds !== undefined ? [...original.contentIds] : [];
    clonedTables.set(tableId, cloned);
  }

  /**
   * Update cloned table cell blocks arrays and contentIds.
   */
  for (const [paragraphId, imageBlocks] of newImageBlocksPerParagraph) {
    const info = extractionMap.get(paragraphId);

    if (info === undefined) {
      continue;
    }

    const clonedTable = clonedTables.get(info.parentTableId);

    if (clonedTable === undefined) {
      continue;
    }

    const tableData = clonedTable.data as { content: TableCell[][] } | undefined;

    if (tableData?.content === undefined) {
      continue;
    }

    const imageBlockIds = imageBlocks.map((b) => {
      const block = b as unknown as NormalizableBlock;

      return block.id ?? '';
    });

    /**
     * Find the cell containing this paragraph and insert image IDs before the paragraph.
     */
    for (const row of tableData.content) {
      for (const cell of row) {
        const paragraphIndex = cell.blocks.indexOf(paragraphId);

        if (paragraphIndex !== -1) {
          cell.blocks.splice(paragraphIndex, 0, ...imageBlockIds);
        }
      }
    }

    /**
     * Add image block IDs to the table's contentIds.
     */
    if (clonedTable.contentIds !== undefined) {
      clonedTable.contentIds.push(...imageBlockIds);
    }
  }

  /**
   * Build the result array:
   * - Replace table blocks with cloned versions
   * - Replace paragraph blocks with cleaned text versions
   * - Insert image blocks before their source paragraph
   */
  const result: T[] = [];

  for (const block of blocks) {
    /**
     * If this is a table that was updated, use the cloned version.
     */
    if (block.id !== undefined && clonedTables.has(block.id)) {
      result.push(clonedTables.get(block.id) as T);
      continue;
    }

    /**
     * If this is a paragraph with images to extract, insert image blocks before it
     * and update its text.
     */
    if (block.id !== undefined && extractionMap.has(block.id)) {
      const imageBlocks = newImageBlocksPerParagraph.get(block.id);

      if (imageBlocks !== undefined) {
        for (const imgBlock of imageBlocks) {
          result.push(imgBlock);
        }
      }

      const info = extractionMap.get(block.id);
      const updatedParagraph = {
        ...block,
        data: { ...block.data, text: info?.cleanedText ?? '' },
      };

      result.push(updatedParagraph);
      continue;
    }

    result.push(block);
  }

  return result;
};
