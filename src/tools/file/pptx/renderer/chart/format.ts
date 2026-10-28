// Derived from @aiden0z/pptx-renderer 1.4.0 (Apache-2.0); modified for Blok. See NOTICE.
import type { SafeXmlNode } from '../../parser/XmlParser';

// A hostile file can declare millions of points; never allocate past this.
const MAX_CHART_CACHE_POINTS = 10_000;
// toFixed throws past 100 digits. toLocaleString allows more, but 20 is plenty.
const MAX_FIXED_DIGITS = 100;
const MAX_LOCALE_DIGITS = 20;

function isPointIndex(idx: number | undefined, limit: number): idx is number {
  return idx !== undefined && Number.isInteger(idx) && idx >= 0 && idx < limit && idx < MAX_CHART_CACHE_POINTS;
}

function getCachePointLimit(cache: SafeXmlNode): number {
  const declared = cache.child('ptCount').numAttr('val');
  const present = cache
    .children('pt')
    .map((pt) => pt.numAttr('idx'))
    .filter((idx): idx is number => isPointIndex(idx, MAX_CHART_CACHE_POINTS));
  // A spread over a huge list overflows the call stack.
  const presentCount = present.reduce((max, idx) => Math.max(max, idx), -1) + 1;

  if (declared === undefined || !Number.isFinite(declared) || declared < 0) {
    return presentCount;
  }
  const declaredCount = Math.floor(declared);

  if (declaredCount > MAX_CHART_CACHE_POINTS) {
    return presentCount;
  }

  return Math.min(Math.max(declaredCount, presentCount), MAX_CHART_CACHE_POINTS);
}

/** Reference caches win when populated; empty or missing caches may use inline data. */
function resolveDataCache(refNode: SafeXmlNode, kind: 'str' | 'num'): SafeXmlNode {
  const candidates = [
    refNode.child(`${kind}Ref`).child(`${kind}Cache`),
    refNode.child(`${kind}Lit`),
    refNode.child(`${kind}Cache`),
  ];

  return (
    candidates.find((cache) => cache.children('pt').length > 0) ??
    candidates.find((cache) => cache.exists()) ??
    candidates[0]
  );
}

function readPoints(cache: SafeXmlNode, read: (raw: string) => string): string[] {
  const limit = getCachePointLimit(cache);
  const values = new Array<string>(limit).fill('');

  for (const pt of cache.children('pt')) {
    const idx = pt.numAttr('idx');

    if (isPointIndex(idx, limit)) {
      values[idx] = read(pt.child('v').text());
    }
  }

  return values;
}

export function excelSerialToDateString(serial: number): string {
  if (!Number.isFinite(serial) || serial < 1) {
    return String(serial);
  }
  // Excel counts a 29 Feb 1900 that never existed.
  const adjusted = serial > 59 ? serial - 1 : serial;
  const date = new Date(Date.UTC(1899, 11, 31) + adjusted * 86400000);

  return `${date.getUTCFullYear()}/${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

function extractNumericValuesAsStrings(cache: SafeXmlNode): string[] {
  const fc = cache.child('formatCode').text();
  const isDateFmt = fc !== '' && /[yYmMdD]/.test(fc) && !/[#0]/.test(fc);

  return readPoints(cache, (raw) => (isDateFmt && raw ? excelSerialToDateString(parseFloat(raw)) : raw));
}

export function extractStringValues(refNode: SafeXmlNode): string[] {
  const cache = resolveDataCache(refNode, 'str');

  if (cache.children('pt').length === 0) {
    const numCache = resolveDataCache(refNode, 'num');

    if (numCache.exists() && (!cache.exists() || numCache.children('pt').length > 0)) {
      return extractNumericValuesAsStrings(numCache);
    }
    if (!cache.exists()) {
      return [];
    }
  }

  return readPoints(cache, (raw) => raw);
}

export function extractFormatCode(refNode: SafeXmlNode): string | undefined {
  const text = resolveDataCache(refNode, 'num').child('formatCode').text();

  return text || undefined;
}

export interface NumericValues {
  values: number[];
  blankIndices: Set<number>;
}

export function extractNumericValuesWithBlanks(refNode: SafeXmlNode): NumericValues {
  const cache = resolveDataCache(refNode, 'num');

  if (!cache.exists()) {
    return { values: [], blankIndices: new Set() };
  }
  const raw = readPoints(cache, (text) => text.trim());
  const blankIndices = new Set<number>();
  const values = raw.map((text, idx) => {
    const v = parseFloat(text);

    // An infinite value cannot be placed on an axis; treat it like a blank point.
    if (text === '' || !Number.isFinite(v)) {
      blankIndices.add(idx);

      return 0;
    }

    return v;
  });

  return { values, blankIndices };
}

export function extractNumericValues(refNode: SafeXmlNode): number[] {
  return extractNumericValuesWithBlanks(refNode).values;
}

function splitFormatSections(formatCode: string): string[] {
  const sections = [''];
  const state = { inQuote: false };

  for (const ch of formatCode) {
    if (ch === '"') {
      state.inQuote = !state.inQuote;
    }
    if (ch === ';' && !state.inQuote) {
      sections.push('');
      continue;
    }
    sections[sections.length - 1] += ch;
  }

  return sections;
}

/** Drops quoted text, [colour] directives, `_x` spacers and `*x` fills; keeps `\x` escapes. */
function normalizeNumericFormatSection(section: string): string {
  return section
    .replace(/\[[^\]]+\]/g, '')
    .replace(/"[^"]*"?/g, '')
    .replace(/\\(.)|[_*]./g, (_m, escaped: string | undefined) => escaped ?? '')
    .trim();
}

function formatOfficeNumber(value: number, formatCode: string): string | undefined {
  const sections = splitFormatSections(formatCode);
  const useNegativeSection = value < 0 && sections.length > 1;
  const normalized = normalizeNumericFormatSection(useNegativeSection ? sections[1] : sections[0]);

  if (!/[#0]/.test(normalized) || (!normalized.includes(',') && sections.length === 1)) {
    return undefined;
  }
  const decimalMatch = normalized.match(/\.(0+|#+)/);
  const decimals = Math.min(decimalMatch ? decimalMatch[1].length : 0, MAX_LOCALE_DIGITS);
  const formatted = (useNegativeSection ? Math.abs(value) : value).toLocaleString('en-US', {
    useGrouping: normalized.includes(','),
    minimumFractionDigits: decimalMatch?.[1].includes('0') ? decimals : 0,
    maximumFractionDigits: decimals,
  });

  if (!useNegativeSection) {
    return formatted;
  }
  if (normalized.includes('(') && normalized.includes(')')) {
    return `(${formatted})`;
  }

  return normalized.includes('-') ? `-${formatted}` : formatted;
}

function formatGeneral(value: number): string {
  return Number.isInteger(value) ? String(value) : parseFloat(value.toFixed(2)).toString();
}

export function formatValue(value: number, formatCode: string | undefined): string {
  if (!formatCode || formatCode === 'General') {
    return formatGeneral(value);
  }
  if (formatCode.includes('%')) {
    const match = formatCode.match(/0\.(0+)%/);

    return `${(value * 100).toFixed(Math.min(match ? match[1].length : 0, MAX_FIXED_DIGITS))}%`;
  }
  const officeNumber = formatOfficeNumber(value, formatCode);

  if (officeNumber !== undefined) {
    return officeNumber;
  }
  const decMatch = formatCode.match(/\.(0+|#+)/);

  if (decMatch) {
    return parseFloat(value.toFixed(Math.min(decMatch[1].length, MAX_FIXED_DIGITS))).toString();
  }
  if (/^[#0,]+$/.test(formatCode.replace(/[[\]"\\]/g, ''))) {
    return Math.round(value).toString();
  }

  return formatGeneral(value);
}
