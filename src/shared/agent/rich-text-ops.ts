import type { RichTextHelpers, TextRange } from '../../../types/agent';
import type { RichText, RichTextMarks, RichTextSegment } from '../../../types/rich-text';
import { canonicalizeSegments, isTextSegment } from '../rich-text/html-to-segments';
import { failure } from './errors';

export const KNOWN_MARKS: ReadonlySet<string> = new Set<keyof RichTextMarks>([
  'bold', 'italic', 'underline', 'strikethrough', 'code', 'sup', 'sub', 'highlight', 'color', 'background', 'link',
]);

const EMBED_CHAR = '￼';

const unitsOf = (segment: RichTextSegment): number => isTextSegment(segment) ? segment.text.length : 1;
const plainText = (value: RichText): string => value.map(segment => isTextSegment(segment) ? segment.text : EMBED_CHAR).join('');
const length = (value: RichText): number => value.reduce((sum, segment) => sum + unitsOf(segment), 0);

const isHigh = (code: number): boolean => code >= 0xD800 && code <= 0xDBFF;
const isLow = (code: number): boolean => code >= 0xDC00 && code <= 0xDFFF;
const splitsPair = (text: string, offset: number): boolean =>
  offset > 0 && offset < text.length && isHigh(text.charCodeAt(offset - 1)) && isLow(text.charCodeAt(offset));

const splitAt = (value: RichText, offset: number): [RichText, RichText] => {
  const left: RichText = [];
  const right: RichText = [];

  value.reduce((cursor, segment) => {
    const size = unitsOf(segment);

    if (cursor + size <= offset) {
      left.push(segment);
    } else if (cursor >= offset) {
      right.push(segment);
    } else if (isTextSegment(segment)) {
      const cut = offset - cursor;

      left.push({ ...segment, text: segment.text.slice(0, cut) });
      right.push({ ...segment, text: segment.text.slice(cut) });
    }

    return cursor + size;
  }, 0);

  return [left, right];
};

const slice = (value: RichText, start: number, end: number): RichText => splitAt(splitAt(value, end)[0], start)[1];

const isMarkKey = (key: string): key is keyof RichTextMarks => KNOWN_MARKS.has(key) || key.startsWith('tag:');

const withMarks = (segment: RichTextSegment, set: RichTextMarks | undefined, unset: string[] | undefined): RichTextSegment => {
  const marks = (unset ?? []).reduce<RichTextMarks>((current, key) => {
    if (!isMarkKey(key)) {
      return current;
    }

    const { [key]: _removed, ...remaining } = current;

    return remaining;
  }, { ...segment.marks, ...set });

  const marked = Object.keys(marks).length === 0 ? {} : { marks };

  return isTextSegment(segment) ? { text: segment.text, ...marked } : { embed: segment.embed, ...marked };
};

const findRange = (text: string, range: Extract<TextRange, { find: string }>): { start: number; end: number } => {
  if (range.find.trim() === '') {
    throw failure('INVALID_ARGS', '`find` must contain non-space text.');
  }
  if (range.occurrence !== undefined && (!Number.isInteger(range.occurrence) || range.occurrence < 1)) {
    throw failure('INVALID_ARGS', '`occurrence` counts from 1.');
  }

  const occurrence = range.occurrence ?? 1;
  const search = { at: -1, count: 0 };

  while (search.count < occurrence) {
    search.at = text.indexOf(range.find, search.at + 1);
    if (search.at < 0) {
      throw failure('RANGE_NOT_FOUND', `"${range.find}" occurs fewer than ${occurrence} time(s). Read the field text in details and retry.`, {
        details: { text },
      });
    }
    search.count += 1;
  }

  return { start: search.at, end: search.at + range.find.length };
};

const resolve = (value: RichText, range: TextRange): { start: number; end: number } => {
  const text = plainText(value);

  if (range === 'all') {
    return { start: 0, end: text.length };
  }

  const { start, end } = 'find' in range ? findRange(text, range) : range;

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > text.length) {
    throw failure('RANGE_OUT_OF_BOUNDS', `Range ${start}..${end} is outside 0..${text.length}.`, {
      details: { length: text.length },
    });
  }
  if (splitsPair(text, start) || splitsPair(text, end)) {
    throw failure('RANGE_OUT_OF_BOUNDS', `Range ${start}..${end} splits a surrogate pair. Move the edge by one unit.`, {
      details: { length: text.length },
    });
  }
  if ('expectText' in range && range.expectText !== undefined && text.slice(start, end) !== range.expectText) {
    throw failure('STALE', `The text at ${start}..${end} changed. It is now "${text.slice(start, end)}".`, {
      details: { current: { text } },
    });
  }

  return { start, end };
};

export const richTextHelpers: RichTextHelpers = {
  plainText,
  length,
  resolve,
  slice,
  insert: (value, at, inserted) => {
    const [left, right] = splitAt(value, at);

    return canonicalizeSegments([...left, ...inserted, ...right]);
  },
  remove: (value, start, end) => canonicalizeSegments([...splitAt(value, start)[0], ...splitAt(value, end)[1]]),
  format: (value, start, end, set, unset) => {
    const [head, tail] = splitAt(value, end);
    const [before, middle] = splitAt(head, start);

    return canonicalizeSegments([...before, ...middle.map(segment => withMarks(segment, set, unset)), ...tail]);
  },
  canonicalize: canonicalizeSegments,
};
