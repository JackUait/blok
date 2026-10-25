import type { DatabaseSavedAutomations } from '../database/types';

/*
 * Values a tool fills on load and saves. The tool and its ToolRuntime.normalize both read
 * these, so the editor, json and store engines save the same data for the same batch.
 */
export const CODE_LOAD_DEFAULTS = { lineNumbers: true } as const;
export const QUOTE_LOAD_DEFAULTS = { size: 'default' } as const;
export const SPACER_LOAD_DEFAULTS = { height: 38 } as const;
export const CALLOUT_LOAD_DEFAULTS = { textColor: null, backgroundColor: null } as const;
/*
 * What an agent's removal of a key writes, when the tool would refill that key on load with a
 * default the user did not ask for (USER RULING 2026-10-25). Every engine plans through these.
 * A key a tool loads as none when absent needs no entry. Code's language must equal the code
 * tool's DEFAULT_LANGUAGE.
 */
export const CODE_CLEARED = { lineNumbers: false, language: 'plain text', code: '' } as const;
export const QUOTE_CLEARED = { size: QUOTE_LOAD_DEFAULTS.size } as const;
/** "" hides the emoji; an absent one loads as the lightbulb. */
export const CALLOUT_CLEARED = { emoji: '' } as const;
/** normalizeList drops checked again when the item is not a checklist. */
export const LIST_CLEARED = { checked: false } as const;
/** The spacer loads an absent height as this one. */
export const SPACER_CLEARED = { height: SPACER_LOAD_DEFAULTS.height } as const;
/** Cloned on every use: a shared object would tie two databases' automations together. */
export const DATABASE_EMPTY_AUTOMATIONS: Readonly<DatabaseSavedAutomations> = { version: 1, definitions: [] };
/** A list item saves `start` only when it differs from this. */
export const LIST_DEFAULT_START = 1;

/** The checked and start keys a list item saves: checked only on a checklist, start only when not 1. */
export const listItemSavedFlags = <S>(style: unknown, checked: unknown, start: S | undefined): { checked?: boolean; start?: S } => ({
  ...(style === 'checklist' ? { checked: Boolean(checked) } : {}),
  ...(start !== undefined && start !== LIST_DEFAULT_START ? { start } : {}),
});

const fillMissing = (defaults: Readonly<Record<string, unknown>>) =>
  (data: Record<string, unknown>): Record<string, unknown> => ({
    ...data,
    ...Object.fromEntries(Object.entries(defaults)
      .filter(([key]) => data[key] === undefined)
      // JSON copy, not structuredClone: the Jint bundle runs this code and has no structuredClone.
      .map(([key, value]) => [key, JSON.parse(JSON.stringify(value)) as unknown])),
  });

export const normalizeCode = fillMissing(CODE_LOAD_DEFAULTS);
export const normalizeQuote = fillMissing(QUOTE_LOAD_DEFAULTS);
export const normalizeCallout = fillMissing(CALLOUT_LOAD_DEFAULTS);
export const normalizeDatabase = fillMissing({ automations: DATABASE_EMPTY_AUTOMATIONS });

/**
 * Normalizers that only fill missing keys. A read shows a stored block through these, as the
 * editor shows it after load. normalizeList is left out: it also drops stored keys.
 */
export const LOAD_DEFAULT_FILLS: ReadonlySet<(data: Record<string, unknown>) => Record<string, unknown>> = new Set([
  normalizeCode, normalizeQuote, normalizeCallout, normalizeDatabase,
]);

export const normalizeList = (data: Record<string, unknown>): Record<string, unknown> => {
  const { checked, start, ...rest } = data;

  return { ...rest, ...listItemSavedFlags(rest.style, checked, start) };
};
