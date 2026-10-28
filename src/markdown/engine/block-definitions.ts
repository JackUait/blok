import type { Definition } from '../../../types/data-formats/markdown-tree';
import { scanLinkDestination, scanLinkLabel, scanLinkTitle } from './link-parts';
import { stripLineStarts } from './block-syntax';
import { decodeString, normalizeIdentifier } from './text';

const isSpaceOrTab = (char: string | undefined): boolean => char === ' ' || char === '\t';

const isLineEnding = (char: string | undefined): boolean => char === '\n' || char === '\r';

/**
 * Index past spaces and tabs.
 * @param text - paragraph text
 * @param pos - start index
 */
const skipSpacesOnly = (text: string, pos: number): number => {
  const cursor = { index: pos };

  while (isSpaceOrTab(text[cursor.index])) {
    cursor.index++;
  }

  return cursor.index;
};

/**
 * A multi-line title without the indentation of its continuation lines,
 * which the old parser dropped (labels keep theirs).
 * @param value - the title as written
 */
const stripTitleLines = (value: string): string => {
  const firstEnd = value.search(/[\n\r]/);

  return firstEnd === -1 ? value : value.slice(0, firstEnd) + stripLineStarts(value.slice(firstEnd));
};

/**
 * Index past spaces and tabs, and at most one line ending.
 * @param text - paragraph text
 * @param pos - start index
 */
const skipWhitespace = (text: string, pos: number): number => {
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
  const label = scanLinkLabel(text, skipSpacesOnly(text, pos));

  if (label === null || text[label.end] !== ':' || normalizeIdentifier(label.value) === '') {
    return null;
  }

  const destination = scanLinkDestination(text, skipWhitespace(text, label.end + 1));

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
  const titleStart = skipWhitespace(text, destination.end);
  const title = titleStart > destination.end ? scanLinkTitle(text, titleStart) : null;
  const afterTitle = title === null ? -1 : lineEndAfter(text, title.end);

  if (title !== null && afterTitle !== -1) {
    return { node: { ...node, title: title.value === '' ? null : decodeString(stripTitleLines(title.value)) }, end: afterTitle };
  }

  const afterDestination = lineEndAfter(text, destination.end);

  return afterDestination === -1 ? null : { node, end: afterDestination };
};

/**
 * Link reference definitions at the start of a paragraph's text, and the
 * text after them.
 * @param text - the paragraph's lines as written
 */
export const extractDefinitions = (text: string): { definitions: Definition[]; rest: string } => {
  const definitions: Definition[] = [];
  const cursor = { pos: 0 };

  while (cursor.pos < text.length && text[skipSpacesOnly(text, cursor.pos)] === '[') {
    const found = scanDefinition(text, cursor.pos);

    if (found === null) {
      break;
    }

    definitions.push(found.node);
    cursor.pos = found.end;
  }

  return { definitions, rest: text.slice(cursor.pos) };
};
