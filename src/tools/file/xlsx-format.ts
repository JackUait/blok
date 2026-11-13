/** What one cell style (an `xf` in cellXfs) asks for. */
export interface CellStyle {
  code: string;
  bold: boolean;
}

/** Excel's built-in number formats that a preview can show. Ids not listed read as General. */
const BUILTIN: Record<number, string> = {
  1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%',
  14: 'm/d/yyyy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy',
  18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss', 22: 'm/d/yyyy h:mm',
  37: '#,##0', 38: '#,##0', 39: '#,##0.00', 40: '#,##0.00',
};

/** Days from Excel's day 0 (1899-12-30) to 1970-01-01. */
const EPOCH_SERIAL = 25569;
const DAY_MS = 86_400_000;

function childrenNamed(el: Element | null | undefined, name: string): Element[] {
  return el === null || el === undefined ? [] : Array.from(el.children).filter((child) => child.tagName === name);
}

/** The cell styles of a workbook, indexed the way a cell's `s` attribute points at them. */
export function readStyles(doc: Document | null): CellStyle[] {
  if (doc === null) {
    return [];
  }
  const root = doc.documentElement;
  const custom = new Map<number, string>();
  for (const fmt of childrenNamed(childrenNamed(root, 'numFmts')[0], 'numFmt')) {
    custom.set(Number(fmt.getAttribute('numFmtId')), fmt.getAttribute('formatCode') ?? '');
  }
  const bolds = childrenNamed(childrenNamed(root, 'fonts')[0], 'font').map((font) => {
    const b = childrenNamed(font, 'b')[0];

    return b !== undefined && b.getAttribute('val') !== '0' && b.getAttribute('val') !== 'false';
  });

  return childrenNamed(childrenNamed(root, 'cellXfs')[0], 'xf').map((xf) => {
    const id = Number(xf.getAttribute('numFmtId') ?? '0');

    return {
      code: custom.get(id) ?? BUILTIN[id] ?? 'General',
      bold: bolds[Number(xf.getAttribute('fontId') ?? '0')] ?? false,
    };
  });
}

interface Parsed {
  prefix: string;
  suffix: string;
  pattern: string;
  /** Letters outside quotes: date and time codes. */
  letters: string;
}

/** Split the positive section of a format code into its literal text and its digit pattern. */
function parse(code: string): Parsed {
  const section = code.split(';')[0];
  const out: Parsed = { prefix: '', suffix: '', pattern: '', letters: '' };
  const literal = (text: string): void => {
    if (out.pattern === '') {
      out.prefix += text;
    } else {
      out.suffix += text;
    }
  };
  const chars = Array.from(section);
  const state = { i: 0 };
  while (state.i < chars.length) {
    const ch = chars[state.i];
    if (ch === '"') {
      const end = chars.indexOf('"', state.i + 1);
      const stop = end === -1 ? chars.length : end;
      literal(chars.slice(state.i + 1, stop).join(''));
      state.i = stop + 1;
    } else if (ch === '\\') {
      literal(chars[state.i + 1] ?? '');
      state.i += 2;
    } else if (ch === '[') {
      const end = chars.indexOf(']', state.i);
      const stop = end === -1 ? chars.length : end;
      // [$£-809] carries a currency sign; [Red] and conditions carry nothing to show.
      const currency = /^\$([^-\]]+)/.exec(chars.slice(state.i + 1, stop).join(''));
      literal(currency?.[1] ?? '');
      state.i = stop + 1;
    } else if ('0#,.?'.includes(ch)) {
      out.pattern += ch;
      state.i += 1;
    } else if (/[a-z]/i.test(ch)) {
      out.letters += ch.toLowerCase();
      state.i += 1;
    } else if (ch === '_' || ch === '*') {
      // Padding and fill codes take the next character with them.
      state.i += 2;
    } else {
      literal(ch);
      state.i += 1;
    }
  }

  return out;
}

function formatDate(serial: number, letters: string, locale: string | undefined): string {
  const hasTime = /[hs]/.test(letters);
  const hasDate = /[yd]/.test(letters) || !hasTime;
  const text = new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    ...(hasDate ? { dateStyle: 'medium' } : {}),
    ...(hasTime ? { timeStyle: 'short' } : {}),
  }).format(new Date(Math.round((serial - EPOCH_SERIAL) * DAY_MS)));

  // Newer ICU puts a narrow no-break space before AM/PM.
  return text.replace(/ /g, ' ');
}

/**
 * A number the way its Excel format code shows it: grouping, decimals,
 * percent, currency text, dates. A code this does not know (fractions,
 * scientific, text) keeps the raw number.
 */
export function formatNumber(value: number, code: string, locale?: string): string {
  if (code === '' || code === 'General' || code === '@') {
    return String(value);
  }
  const { prefix, suffix, pattern, letters } = parse(code);
  if (letters !== '' && /^[ymdhsapm]+$/.test(letters) && pattern.replace(/[.,]/g, '') === '') {
    return formatDate(value, letters, locale);
  }
  if (letters !== '' || pattern.includes('?') || !/[0#]/.test(pattern)) {
    return String(value);
  }
  const [whole, fraction = ''] = pattern.split('.');
  const percent = (prefix + suffix).includes('%');
  const number = new Intl.NumberFormat(locale, {
    useGrouping: whole.includes(','),
    minimumFractionDigits: (fraction.match(/0/g) ?? []).length,
    maximumFractionDigits: fraction.length,
  }).format(percent ? value * 100 : value);

  return `${prefix}${number}${suffix}`;
}
