/**
 * `extractTexts` / `injectTexts` — DOM-free extraction of a saved Blok
 * document's translatable strings and re-injection of the translations in the
 * same places. Values are the RAW field contents (inline HTML included), so a
 * translation carries the original markup back into the document.
 *
 * Both functions run the SAME walk (`collectSlots`): extract reads the slot
 * values, inject writes into them. Two parallel switches would drift.
 *
 * The walk never resolves parents or drops entries: the input may be a SUBSET
 * document (a nested child without its parent), and `injectTexts` output IS the
 * stored article — a skipped block would be a deleted block.
 *
 * PURITY CONTRACT: only pure imports (src/shared/*, src/view/*).
 */
import type { OutputData } from '../../types';

/** Options shared by extraction and injection — they must match, or the counts will not. */
export interface DocumentTextsOptions {
  /** Include code blocks' source. Default false — code is not prose. */
  includeCode?: boolean;
}

/**
 * Prose fields per block type, in emission order. Field NAMES come from
 * `ownText` in blocks-to-plain-text.ts, but this list diverges twice on
 * purpose: no URL fallbacks (a url is not prose), and EVERY field of a type is
 * emitted rather than the first non-empty one — each is separately translated.
 */
const PROSE_FIELDS: Record<string, string[]> = {
  paragraph: ['text'],
  header: ['text'],
  quote: ['text'],
  toggle: ['text'],
  list: ['text'],
  /** `alt` is written for a reader who cannot see the image, so it is prose too. */
  image: ['caption', 'alt'],
  video: ['caption'],
  embed: ['caption'],
  audio: ['caption', 'title'],
  /**
   * `fileName` is deliberately absent: it sets the anchor's `download`
   * attribute, so translating it renames the file the reader saves to disk.
   */
  file: ['caption'],
  bookmark: ['title', 'description'],
  /** Legacy `toggleList` names its heading `title`; the current `toggle` uses `text`. */
  toggleList: ['title'],
  /**
   * Legacy only: a current callout holds no text of its own, so this field is
   * present exactly when the document predates children-by-reference.
   */
  callout: ['title'],
};

/** Types whose LEGACY data nests item text in `data.items[]`. Current list blocks are flat. */
const LEGACY_ITEM_TYPES = new Set(['list', 'checklist']);

/** Types whose LEGACY data nests child blocks in `data.body.blocks[]`. */
const LEGACY_BODY_TYPES = new Set(['callout', 'toggleList']);

/**
 * Narrow an unknown value to a plain record.
 * @param value - value to check
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The prose fields to read off one block's data.
 * @param type - block type
 * @param options - extraction options
 */
const fieldsFor = (type: string, options: DocumentTextsOptions): string[] => {
  if (type === 'code') {
    return options.includeCode === true ? ['code'] : [];
  }

  /** An unfamiliar tool storing prose in `data.text` is still translatable. */
  return PROSE_FIELDS[type] ?? ['text'];
};

/** One translatable string and the write-back that puts its translation in place. */
interface TextSlot {
  value: string;
  write(text: string): void;
}

/**
 * Every translatable string in a blocks array, in document order.
 * @param blocks - raw `blocks` entries (walked in place; `write` mutates them)
 * @param options - extraction options
 */
const collectSlots = (blocks: unknown[], options: DocumentTextsOptions): TextSlot[] => {
  const slots: TextSlot[] = [];

  /**
   * Emit a slot for one field of a record, or one element of an array, if it
   * holds prose.
   * @param holder - record or array owning the value
   * @param key - field name or array index
   */
  const pushSlot = (holder: Record<string, unknown> | unknown[], key: string | number): void => {
    const value: unknown = Reflect.get(holder, key);

    /** Blank values are not worth a model round-trip — and inject skips them identically. */
    if (typeof value !== 'string' || value.trim() === '') {
      return;
    }

    slots.push({
      value,
      write: (text: string): void => {
        Reflect.set(holder, key, text);
      },
    });
  };

  /**
   * Walk a legacy list's items and their nested items.
   * @param items - `data.items` array
   */
  const walkItems = (items: unknown[]): void => {
    items.forEach((item, index) => {
      if (!isRecord(item)) {
        pushSlot(items, index);

        return;
      }

      /** Nested-list items name the field `content`; old checklist items name it `text`. */
      pushSlot(item, typeof item.content === 'string' ? 'content' : 'text');

      if (Array.isArray(item.items)) {
        walkItems(item.items);
      }
    });
  };

  /**
   * Walk a table's cell grid. Only inline-HTML cells carry text here.
   * @param data - table block data
   */
  const walkTable = (data: Record<string, unknown>): void => {
    const rows = Array.isArray(data.content) ? data.content : [];

    for (const row of rows) {
      if (!Array.isArray(row)) {
        continue;
      }

      row.forEach((cell, index) => {
        if (!isRecord(cell)) {
          pushSlot(row, index);

          return;
        }

        /** A covered cell renders nothing — matches `tableText`'s merge handling. */
        if (cell.mergedInto !== undefined) {
          return;
        }

        const ids = Array.isArray(cell.blocks) ? cell.blocks.filter((id) => typeof id === 'string') : [];

        /** A cell holding block ids owns no text: each referenced block is its own `blocks` entry. */
        if (ids.length > 0) {
          return;
        }

        pushSlot(cell, 'text');
      });
    }
  };

  /**
   * Walk one legacy column's blocks.
   * @param column - raw entry from a `data.cols` array
   */
  const walkColumn = (column: unknown): void => {
    if (isRecord(column) && Array.isArray(column.blocks)) {
      column.blocks.forEach(walkBlock);
    }
  };

  /**
   * Walk one block entry. Entries that are not shaped like a block yield
   * nothing and stay untouched.
   * @param entry - raw block entry
   */
  const walkBlock = (entry: unknown): void => {
    if (!isRecord(entry) || typeof entry.type !== 'string' || entry.type === '') {
      return;
    }

    const data = entry.data;

    if (!isRecord(data)) {
      return;
    }

    for (const field of fieldsFor(entry.type, options)) {
      pushSlot(data, field);
    }

    if (entry.type === 'table') {
      walkTable(data);
    }

    if (LEGACY_ITEM_TYPES.has(entry.type) && Array.isArray(data.items)) {
      walkItems(data.items);
    }

    if (LEGACY_BODY_TYPES.has(entry.type) && isRecord(data.body) && Array.isArray(data.body.blocks)) {
      data.body.blocks.forEach(walkBlock);
    }

    /** `type: 'columns'` is legacy-only — the columns tool writes `column_list`/`column`. */
    if (entry.type === 'columns' && Array.isArray(data.cols)) {
      data.cols.forEach(walkColumn);
    }
  };

  blocks.forEach(walkBlock);

  return slots;
};

/**
 * The document's `blocks` array, or an empty one for anything that is not a document.
 * @param data - candidate document
 */
const blocksOf = (data: unknown): unknown[] => (isRecord(data) && Array.isArray(data.blocks) ? data.blocks : []);

/**
 * Clone a record's values structurally.
 * @param record - record to clone
 */
const cloneRecord = (record: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};

  for (const key of Object.keys(record)) {
    out[key] = cloneValue(record[key]);
  }

  return out;
};

/**
 * Structural clone of a parsed-JSON value. Hand-written because the bare
 * ECMAScript engine this module is bundled for has no `structuredClone`.
 * @param value - value to clone
 */
const cloneValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }

  return isRecord(value) ? cloneRecord(value) : value;
};

/**
 * Every translatable string of a saved document, in document order.
 * Empty and whitespace-only values are skipped.
 * @param data - saved document (anything else yields no texts)
 * @param options - extraction options; must match the ones passed to `injectTexts`
 * @returns raw field values, inline HTML included
 */
export const extractTexts = (data: unknown, options: DocumentTextsOptions = {}): string[] =>
  collectSlots(blocksOf(data), options).map((slot) => slot.value);

/**
 * Put translated strings back where `extractTexts` found them.
 * @param data - the document the texts were extracted from
 * @param texts - translations, in extraction order
 * @param options - the SAME options `extractTexts` ran with
 * @throws RangeError when the count differs from what this document yields
 * @returns a new document; the input is not mutated
 */
export const injectTexts = (data: unknown, texts: readonly string[], options: DocumentTextsOptions = {}): OutputData => {
  const envelope = isRecord(data) ? cloneRecord(data) : {};
  const blocks = blocksOf(envelope);
  const slots = collectSlots(blocks, options);

  if (slots.length !== texts.length) {
    throw new RangeError(`injectTexts expected ${slots.length} texts for this document, received ${texts.length}.`);
  }

  slots.forEach((slot, index) => slot.write(texts[index]));

  /**
   * Asserted, not proven: entries too malformed to read are carried through
   * verbatim, because dropping one would silently delete a stored block.
   */
  return { ...envelope, blocks } as OutputData;
};
