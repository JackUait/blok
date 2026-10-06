import type { BlockToolData } from '../../../types';
import type { BlockToolAdapter } from '../tools/block';
import { blockDataToHtml, nestedDocumentsFor } from '../../shared/rich-text/block-data';
import { isRichText } from '../../shared/rich-text/guards';
import { logLabeled } from '../utils';

// Keep in step with the wrappers in segments-to-html.ts: it drops any other key silently.
const KNOWN_MARKS = new Set(['link', 'color', 'background', 'highlight', 'bold', 'italic', 'underline', 'strikethrough', 'code', 'sup', 'sub']);

// Same test segments-to-html.ts applies before writing a tag name raw.
const SAFE_TAG_NAME = /^[a-z][a-z0-9-]*$/i;

const warnedMarks = new Set<string>();

const isDroppedMark = (key: string): boolean =>
  key.startsWith('tag:') ? !SAFE_TAG_NAME.test(key.slice('tag:'.length)) : !KNOWN_MARKS.has(key);

const warnUnknownMarksOnce = (data: BlockToolData, fields: string[]): void => {
  const keys = fields
    .map((field): unknown => data[field])
    .filter(isRichText)
    .flatMap(value => value.flatMap(segment => Object.keys(segment.marks ?? {})));

  for (const key of keys) {
    if (isDroppedMark(key) && !warnedMarks.has(key)) {
      warnedMarks.add(key);
      logLabeled(`Rich text mark «${key}» is not supported and was dropped.`, 'warn');
    }
  }
};

/**
 * Segment arrays → the HTML strings tools store. Must run BEFORE any
 * sanitize pass: the sanitizer HTML-parses every string it meets, and a
 * segment's text is plain text. Idempotent: HTML strings pass through.
 * @param tool - the block's tool; no tool means the data is left alone
 * @param data - block data as the host gave it
 * @param resolveTool - looks up the tools of nested documents' blocks
 */
export const richTextInputToHtml = (
  tool: BlockToolAdapter | undefined,
  data: BlockToolData,
  resolveTool: (name: string) => BlockToolAdapter | undefined
): BlockToolData => {
  if (tool === undefined || data === null || typeof data !== 'object') {
    return data;
  }

  warnUnknownMarksOnce(data, tool.richTextFields);

  return blockDataToHtml(data, tool.richTextFields, type => resolveTool(type)?.richTextFields ?? [], nestedDocumentsFor(tool.name));
};
