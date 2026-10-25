import type { DatabaseSavedAutomations } from '../database/types';

/*
 * Values a tool fills on load and saves. The tool and its ToolRuntime.normalize both read
 * these, so the editor, json and store engines save the same data for the same batch.
 */
export const CODE_LOAD_DEFAULTS = { lineNumbers: true } as const;
export const QUOTE_LOAD_DEFAULTS = { size: 'default' } as const;
export const CALLOUT_LOAD_DEFAULTS = { textColor: null, backgroundColor: null } as const;
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

export const normalizeList = (data: Record<string, unknown>): Record<string, unknown> => {
  const { checked, start, ...rest } = data;

  return { ...rest, ...listItemSavedFlags(rest.style, checked, start) };
};
