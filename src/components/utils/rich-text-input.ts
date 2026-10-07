import type { BlockToolData } from '../../../types';
import type { BlockToolAdapter } from '../tools/block';
import { blockDataToHtml, legacyNestingFor } from '../../shared/rich-text/block-data';
import { isRichText, readRichTextLeniently } from '../../shared/rich-text/guards';
import { logLabeled } from '../utils';

// Keep in step with the wrappers in segments-to-html.ts: it drops any other key silently.
const KNOWN_MARKS = new Set(['link', 'color', 'background', 'highlight', 'bold', 'italic', 'underline', 'strikethrough', 'code', 'sup', 'sub']);

// Same test segments-to-html.ts applies before writing a tag name raw.
const SAFE_TAG_NAME = /^[a-z][a-z0-9-]*$/i;

const warnedMarks = new Set<string>();
const warnedFields = new Set<string>();

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
 * A declared field holding an array that is not segments: read it leniently
 * here, so the unknown-mark warning below still sees its marks.
 * @param toolName - for the warning
 * @param data - block data as the host gave it
 * @param fields - the tool's rich fields
 */
const readMalformedFields = (toolName: string, data: BlockToolData, fields: string[]): BlockToolData => {
  const malformed = fields.filter(field => Array.isArray(data[field]) && !isRichText(data[field]));

  if (malformed.length === 0) {
    return data;
  }

  const next: BlockToolData = { ...data };

  for (const field of malformed) {
    const key = `${toolName}.${field}`;

    next[field] = readRichTextLeniently(data[field] as unknown[]);
    if (!warnedFields.has(key)) {
      warnedFields.add(key);
      logLabeled(`Rich text field «${key}» holds an array that is not segments; unknown keys and items were dropped.`, 'warn');
    }
  }

  return next;
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

  // Test doubles and hand-built adapters may lack the getter.
  const fields = tool.richTextFields ?? [];
  const read = readMalformedFields(tool.name, data, fields);

  warnUnknownMarksOnce(read, fields);

  // Legacy walk too: a host may insert or update a legacy shape (list items[]) taken from a legacy save.
  return blockDataToHtml(read, fields, type => resolveTool(type)?.richTextFields ?? [], legacyNestingFor(tool.name));
};
