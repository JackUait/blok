/**
 * Architectural enforcement: the Cell-Clipboard Payload Completeness Law.
 *
 * The cell-range clipboard has a payload TYPE (TableClipboardCell /
 * ClipboardBlockData in src/tools/table/types.ts), a payload BUILDER (the
 * collector, on copy) and payload CONSUMERS (the in-grid paste, the
 * outside-a-table paste handler, and the external HTML flavor). Those three
 * drifted: `tunes` and `placement` were COLLECTED and then silently ignored,
 * spans were collected and never emitted into the HTML flavor, and non-text
 * blocks were carried in the JSON but dropped by every HTML consumer. Every
 * loss looked identical — a field written by one side and read by nobody.
 *
 * This test makes that class of drift mechanically impossible: every field
 * declared on the payload types must be BOTH written by at least one builder
 * site AND read by at least one consumer site. Adding a field to the type
 * without wiring both ends fails here. Exemptions require a reason.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../..');

const TYPES_FILE = 'src/tools/table/types.ts';
const SUBSYSTEMS_FILE = 'src/tools/table/table-subsystems.ts';
const CLIPBOARD_FILE = 'src/tools/table/table-cell-clipboard.ts';
const CELL_BLOCKS_FILE = 'src/tools/table/table-cell-blocks.ts';
const HANDLER_FILE = 'src/components/modules/paste/handlers/table-cells-handler.ts';

interface Site {
  file: string;
  fn: string;
}

/** Sites that BUILD the clipboard payload (copy direction). */
const CELL_WRITERS: Site[] = [
  { file: SUBSYSTEMS_FILE, fn: 'collectCellBlockData' },
  { file: CLIPBOARD_FILE, fn: 'serializeCellsToClipboard' },
  { file: CLIPBOARD_FILE, fn: 'buildCellPayloadFromTd' },
];

/** Sites that CONSUME the clipboard payload (paste direction + external flavors). */
const CELL_CONSUMERS: Site[] = [
  { file: SUBSYSTEMS_FILE, fn: 'pastePayloadIntoCells' },
  { file: CLIPBOARD_FILE, fn: 'buildClipboardHtml' },
  { file: CLIPBOARD_FILE, fn: 'buildClipboardPlainText' },
  { file: HANDLER_FILE, fn: 'buildCellContent' },
];

/** Sites that BUILD the per-block payload entries. */
const BLOCK_WRITERS: Site[] = [
  { file: SUBSYSTEMS_FILE, fn: 'collectCellBlockData' },
  { file: SUBSYSTEMS_FILE, fn: 'readCellBlocks' },
];

/** Sites that CONSUME the per-block payload entries (block re-creation). */
const BLOCK_CONSUMERS: Site[] = [
  { file: SUBSYSTEMS_FILE, fn: 'pasteCellPayload' },
  { file: CELL_BLOCKS_FILE, fn: 'insertClipboardBlock' },
  { file: CLIPBOARD_FILE, fn: 'renderNonTextBlock' },
];

interface Exemption {
  type: string;
  field: string;
  side: 'writer' | 'consumer';
  reason: string;
}

/**
 * Fields provably not required on one side. Every entry must say WHY.
 */
const EXEMPTIONS: Exemption[] = [
  {
    type: 'TableClipboardCell',
    field: 'covered',
    side: 'writer',
    reason:
      'covered is derived, not collected: serializeCellsToClipboard pre-fills every ' +
      'position as covered and real entries overwrite it — no collector writes it per cell',
  },
];

const readSource = (relFile: string): string => readFileSync(join(REPO_ROOT, relFile), 'utf-8');

/**
 * Index of the `{` that opens a declaration's body, skipping braces that belong
 * to the signature (parameter destructuring, `Array<{ ... }>` return types).
 */
const bodyStart = (source: string, from: number): number => {
  let paren = 0;
  let angle = 0;

  for (let i = from; i < source.length; i++) {
    const char = source[i];

    if (char === '(') {
      paren += 1;
    } else if (char === ')') {
      paren -= 1;
    } else if (char === '<') {
      angle += 1;
    } else if (char === '>') {
      angle = Math.max(0, angle - 1);
    } else if (char === '{' && paren === 0 && angle === 0) {
      return i;
    }
  }

  return -1;
};

/**
 * Extract the body of a named declaration by brace matching.
 * Throws when the site no longer exists — a renamed site must be updated here,
 * which is exactly the review moment this law exists to force.
 */
const extractBody = (source: string, name: string, decl: RegExp): string => {
  const match = decl.exec(source);

  if (match === null) {
    throw new Error(`site ${name} not found — update the payload-law site list`);
  }

  const open = bodyStart(source, match.index);

  if (open === -1) {
    throw new Error(`site ${name}: no body found`);
  }

  let depth = 0;

  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') {
      depth += 1;

      continue;
    }

    if (source[i] !== '}') {
      continue;
    }

    depth -= 1;

    if (depth === 0) {
      return source.slice(open, i + 1);
    }
  }

  throw new Error(`site ${name}: unbalanced body`);
};

/** Field names declared on an interface in the types file. */
const declaredFields = (typeName: string): string[] => {
  const body = extractBody(readSource(TYPES_FILE), typeName, new RegExp(`interface\\s+${typeName}\\b`));

  return Array.from(body.matchAll(/^\s{2}(\w+)\??:/gm)).map((match) => match[1]);
};

/**
 * Drop comments: a field name mentioned in prose ("// Caret placement …") is
 * not a read, and would let a dead field pass this law.
 */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const bodies = (sites: Site[]): Array<{ site: Site; body: string }> =>
  sites.map((site) => ({
    site,
    body: stripComments(extractBody(
      readSource(site.file),
      site.fn,
      new RegExp(`(?:function\\s+|private\\s+|public\\s+|const\\s+)${site.fn}\\b`),
    )),
  }));

const isExempt = (type: string, field: string, side: 'writer' | 'consumer'): boolean =>
  EXEMPTIONS.some((entry) => entry.type === type && entry.field === field && entry.side === side);

const missingSide = (
  type: string,
  fields: string[],
  sites: Site[],
  side: 'writer' | 'consumer',
): string[] => {
  const sources = bodies(sites);

  return fields
    .filter((field) => !isExempt(type, field, side))
    .filter((field) => !sources.some(({ body }) => new RegExp(`\\b${field}\\b`).test(body)))
    .map(
      (field) =>
        `${type}.${field} is never read by any ${side} site ` +
        `(${sites.map((site) => `${site.file}:${site.fn}`).join(', ')}). ` +
        'A payload field written by one side and ignored by the other is a silent data loss — ' +
        'wire it up, or add an EXEMPTIONS entry with a reason.',
    );
};

describe('Cell-Clipboard Payload Completeness Law', () => {
  it('every TableClipboardCell field is written by a collector', () => {
    expect(missingSide('TableClipboardCell', declaredFields('TableClipboardCell'), CELL_WRITERS, 'writer')).toEqual([]);
  });

  it('every TableClipboardCell field is read by a consumer', () => {
    expect(missingSide('TableClipboardCell', declaredFields('TableClipboardCell'), CELL_CONSUMERS, 'consumer')).toEqual([]);
  });

  it('every ClipboardBlockData field is written by a collector', () => {
    expect(missingSide('ClipboardBlockData', declaredFields('ClipboardBlockData'), BLOCK_WRITERS, 'writer')).toEqual([]);
  });

  it('every ClipboardBlockData field is read by a consumer', () => {
    expect(missingSide('ClipboardBlockData', declaredFields('ClipboardBlockData'), BLOCK_CONSUMERS, 'consumer')).toEqual([]);
  });

  it('the payload types still declare the fields this law was written for (no silent shrink)', () => {
    expect(declaredFields('TableClipboardCell').sort()).toEqual(
      ['blocks', 'color', 'colspan', 'covered', 'placement', 'rowspan', 'textColor'].sort(),
    );
    expect(declaredFields('ClipboardBlockData').sort()).toEqual(['data', 'tool', 'tunes'].sort());
  });

  it('every exemption still refers to a declared field (stale exemptions must be removed)', () => {
    const stale = EXEMPTIONS
      .filter((entry) => !declaredFields(entry.type).includes(entry.field))
      .map((entry) => `${entry.type}.${entry.field}: exempted field no longer exists`);

    expect(stale).toEqual([]);
  });
});
