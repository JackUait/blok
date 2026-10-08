export type FormulaType =
  | { kind: 'number' | 'text' | 'boolean' | 'date' | 'person' | 'page' | 'empty' | 'any' }
  | { kind: 'list'; of: FormulaType };

/** A date or a range. Times are epoch ms; `hasTime: false` means a whole day starting at local midnight. */
export interface FormulaDate {
  kind: 'date';
  start: number;
  end?: number;
  hasTime: boolean;
}

/** A person or a page, known only by its id. */
export interface FormulaRef {
  kind: 'person' | 'page';
  id: string;
}

export interface StyledRun {
  text: string;
  styles: string[];
  link?: string;
}

/** Text carrying `style()` or `link()` formatting. Plain text stays a string. */
export interface FormulaRichText {
  kind: 'richText';
  runs: StyledRun[];
}

/** `null` is Notion's empty value. */
export type FormulaValue = null | number | string | boolean | FormulaDate | FormulaRef | FormulaRichText | FormulaValue[];

export type FormulaText = string | FormulaRichText;

export const T = {
  number: { kind: 'number' },
  text: { kind: 'text' },
  boolean: { kind: 'boolean' },
  date: { kind: 'date' },
  person: { kind: 'person' },
  page: { kind: 'page' },
  empty: { kind: 'empty' },
  any: { kind: 'any' },
} as const satisfies Record<string, FormulaType>;

export const listOf = (of: FormulaType): FormulaType => ({ kind: 'list', of });

const NAMES: Record<string, string> = {
  number: 'Number', text: 'Text', boolean: 'Boolean', date: 'Date', person: 'Person', page: 'Page', empty: 'Empty', any: 'Any',
};

/** Names follow the help page: "Text (list)", "Person (list)". */
export const typeName = (type: FormulaType): string =>
  type.kind === 'list' ? `${typeName(type.of)} (list)` : NAMES[type.kind];

/** The type both values fit, or `undefined`. Empty and Any fit anything. */
export const unify = (a: FormulaType, b: FormulaType): FormulaType | undefined => {
  if (a.kind === 'empty' || a.kind === 'any') return b.kind === 'empty' ? a : b;
  if (b.kind === 'empty' || b.kind === 'any') return a;
  if (a.kind === 'list' && b.kind === 'list') {
    const of = unify(a.of, b.of);

    return of === undefined ? undefined : listOf(of);
  }

  return a.kind === b.kind ? a : undefined;
};


export const elementOf = (type: FormulaType): FormulaType => (type.kind === 'list' ? type.of : T.any);

export const isDate = (value: FormulaValue): value is FormulaDate =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && value.kind === 'date';

export const isRef = (value: FormulaValue): value is FormulaRef =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && (value.kind === 'person' || value.kind === 'page');

export const isRichText = (value: FormulaValue): value is FormulaRichText =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && value.kind === 'richText';
