import type { Definition } from '../../../types/data-formats/markdown-tree';
import { joinLines, type Block } from './block-model';
import { scanLinkDestination, scanLinkLabel, scanLinkTitle } from './link-parts';
import { decodeString, isLineEnding, isSpaceOrTab, normalizeIdentifier, skipSpaces } from './text';

/**
 * Index past spaces and tabs, and at most one line ending.
 * @param text - paragraph text
 * @param pos - start index
 */
const skipToNextLine = (text: string, pos: number): number => {
  const cursor = { index: pos, endings: 0 };

  while (cursor.index < text.length) {
    const char = text[cursor.index];

    if (!isSpaceOrTab(char) && !(isLineEnding(char) && cursor.endings === 0)) {
      break;
    }

    cursor.endings += isLineEnding(char) ? 1 : 0;
    cursor.index += char === '\r' && text[cursor.index + 1] === '\n' ? 2 : 1;
  }

  return cursor.index;
};

/**
 * If only spaces and tabs remain on the line from `pos`, the index of the
 * next line's start (or the text's end); else -1.
 * @param text - paragraph text
 * @param pos - start index
 */
const lineEndAfter = (text: string, pos: number): number => {
  const cursor = { index: pos };

  while (isSpaceOrTab(text[cursor.index])) {
    cursor.index++;
  }

  if (cursor.index === text.length) {
    return cursor.index;
  }

  if (!isLineEnding(text[cursor.index])) {
    return -1;
  }

  return cursor.index + (text[cursor.index] === '\r' && text[cursor.index + 1] === '\n' ? 2 : 1);
};

/**
 * One definition at `pos`, which starts a line: the node and the index of
 * the next line, or null.
 * @param text - paragraph text
 * @param pos - start index
 */
const scanDefinition = (text: string, pos: number): { node: Definition; end: number } | null => {
  const label = scanLinkLabel(text, skipSpaces(text, pos));

  if (label === null || text[label.end] !== ':' || normalizeIdentifier(label.value) === '') {
    return null;
  }

  const destination = scanLinkDestination(text, skipToNextLine(text, label.end + 1));

  if (destination === null) {
    return null;
  }

  const node: Definition = {
    type: 'definition',
    identifier: normalizeIdentifier(label.value),
    label: decodeString(label.value),
    url: decodeString(destination.value),
    title: null,
  };
  const titleStart = skipToNextLine(text, destination.end);
  const title = titleStart > destination.end ? scanLinkTitle(text, titleStart) : null;
  const afterTitle = title === null ? -1 : lineEndAfter(text, title.end);

  if (title !== null && afterTitle !== -1) {
    return { node: { ...node, title: title.value === '' ? null : decodeString(title.value) }, end: afterTitle };
  }

  const afterDestination = lineEndAfter(text, destination.end);

  return afterDestination === -1 ? null : { node, end: afterDestination };
};

/**
 * A paragraph's lines joined, the link reference definitions at their
 * start, and the text after them.
 * @param block - the paragraph
 */
export const extractDefinitions = (block: Block): { joined: string; definitions: Definition[]; rest: string } => {
  const joined = joinLines(block);
  const limit = block.lines.slice(0, block.definitionLines).reduce((sum, line, index) => sum + line.length + block.endings[index].length, 0);
  const definitions: Definition[] = [];
  const cursor = { pos: 0 };

  while (cursor.pos < limit && joined[skipSpaces(joined, cursor.pos)] === '[') {
    const found = scanDefinition(joined, cursor.pos);

    if (found === null || found.end > limit) {
      break;
    }

    definitions.push(found.node);
    cursor.pos = found.end;
  }

  return { joined, definitions, rest: joined.slice(cursor.pos) };
};
