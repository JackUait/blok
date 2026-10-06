import { COLOR_PRESETS } from '../../components/shared/color-presets';
import { PAGE_REFERENCE_ATTR } from '../page-reference';
import { EQUATION_SOURCE_ATTR } from '../equation-mark';
import type { InlineNode } from './inline-tree';
import type { RichText, RichTextLink, RichTextMarks, RichTextSegment, RichTextTextSegment } from '../../../types/rich-text';

const SIMPLE_MARKS: Record<string, keyof RichTextMarks> = {
  strong: 'bold', b: 'bold', em: 'italic', i: 'italic', u: 'underline',
  s: 'strikethrough', del: 'strikethrough', strike: 'strikethrough',
  code: 'code', sup: 'sup', sub: 'sub',
};

/**
 * Block-level, void or replaced tags the run model cannot hold; kept verbatim as
 * an html embed. Explicit on purpose: a tag missing here is walked as a mark, so
 * a text-less one vanishes (that is right for an empty `<b></b>`).
 */
const OPAQUE_TAGS = new Set([
  'img', 'p', 'ul', 'ol', 'li', 'div', 'table', 'hr',
  'input', 'video', 'audio', 'iframe', 'svg', 'math', 'canvas', 'object', 'embed', 'picture', 'wbr', 'source', 'track',
]);

const PRESET_VAR = /^var\(--blok-color-([a-z]+)-(text|bg)\)$/;
const PRESET_NAMES = new Set(COLOR_PRESETS.map(preset => preset.name));

/** Fixed key order: it keeps saved output stable, and the echo check compares it. */
const MARK_ORDER: Array<keyof RichTextMarks> = [
  'link', 'color', 'background', 'highlight', 'bold', 'italic', 'underline', 'strikethrough', 'code', 'sup', 'sub',
];

const readColor = (value: string | undefined, mode: 'text' | 'bg'): string | undefined => {
  if (value === undefined || value === '' || value === 'transparent') {
    return undefined;
  }

  const preset = PRESET_VAR.exec(value);

  return preset !== null && preset[2] === mode && PRESET_NAMES.has(preset[1]) ? preset[1] : value;
};

const parseStyle = (style: string): Record<string, string> => Object.fromEntries(
  style.split(';')
    .map(rule => rule.split(':'))
    .filter(parts => parts.length >= 2)
    .map(([prop, ...rest]) => [prop.trim().toLowerCase(), rest.join(':').trim()])
);

const sortedRecord = (record: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.keys(record).sort().map(key => [key, record[key]]));

const BOOLEAN_MARKS = new Set<keyof RichTextMarks>(['highlight', 'bold', 'italic', 'underline', 'strikethrough', 'code', 'sup', 'sub']);

/** Yjs stores link keys sorted; this order is the one the echo check and the C# export compare. */
const canonicalLink = (link: RichTextLink): RichTextLink => ({
  href: link.href,
  ...(link.target === undefined ? {} : { target: link.target }),
  ...(link.rel === undefined ? {} : { rel: link.rel }),
});

const orderMarks = (marks: RichTextMarks): RichTextMarks | undefined => {
  const ordered: Record<string, unknown> = {};

  for (const key of MARK_ORDER) {
    // A host may write `bold: false`; only `true` is a mark.
    if (BOOLEAN_MARKS.has(key) ? marks[key] === true : marks[key] !== undefined) {
      ordered[key] = key === 'link' && marks.link !== undefined ? canonicalLink(marks.link) : marks[key];
    }
  }
  for (const key of Object.keys(marks).filter(name => !MARK_ORDER.includes(name as keyof RichTextMarks)).sort()) {
    const value = (marks as Record<string, unknown>)[key];

    ordered[key] = key.startsWith('tag:') && typeof value === 'object' && value !== null && !Array.isArray(value)
      ? sortedRecord(value as Record<string, string>)
      : value;
  }

  return Object.keys(ordered).length === 0 ? undefined : ordered as RichTextMarks;
};

const withMarks = (segment: RichTextSegment, marks: RichTextMarks): RichTextSegment => {
  const ordered = orderMarks(marks);

  return ordered === undefined ? segment : { ...segment, marks: ordered };
};

const readMarkStyle = (attrs: Record<string, string>, marks: RichTextMarks): RichTextMarks => {
  const style = parseStyle(attrs.style ?? '');
  const color = readColor(style.color, 'text');
  const background = readColor(style['background-color'], 'bg');
  const next: RichTextMarks = { ...marks };

  if (color !== undefined) {
    next.color = color;
  }
  if (background !== undefined) {
    next.background = background;
  }
  if (color === undefined && background === undefined) {
    next.highlight = true;
  }

  return next;
};

const walk = (nodes: InlineNode[], marks: RichTextMarks, out: RichTextSegment[]): void => {
  for (const node of nodes) {
    if (node.kind === 'text') {
      // HTML renders a raw newline as a space; only <br> is a line break.
      out.push(withMarks({ text: node.value.replace(/[ \t\n\r\f]*\n[ \t\n\r\f]*/g, ' ') }, marks));
      continue;
    }

    const { tag, attrs } = node;

    if (tag === 'br') {
      out.push(withMarks({ text: '\n' }, marks));
    } else if (SIMPLE_MARKS[tag] !== undefined) {
      walk(node.children, { ...marks, [SIMPLE_MARKS[tag]]: true }, out);
    } else if (tag === 'a' && attrs[PAGE_REFERENCE_ATTR] !== undefined) {
      out.push(withMarks({ embed: { page: { id: attrs[PAGE_REFERENCE_ATTR] } } }, marks));
    } else if (tag === 'a' && attrs.href !== undefined) {
      const link = { href: attrs.href, ...(attrs.target === undefined ? {} : { target: attrs.target }), ...(attrs.rel === undefined ? {} : { rel: attrs.rel }) };

      walk(node.children, { ...marks, link }, out);
    } else if (tag === 'span' && attrs[EQUATION_SOURCE_ATTR] !== undefined) {
      out.push(withMarks({ embed: { equation: { expression: attrs[EQUATION_SOURCE_ATTR] } } }, marks));
    } else if (tag === 'mark') {
      walk(node.children, readMarkStyle(attrs, marks), out);
    } else if (OPAQUE_TAGS.has(tag)) {
      out.push(withMarks({ embed: { html: node.outerHtml } }, marks));
    } else {
      walk(node.children, { ...marks, [`tag:${tag}`]: sortedRecord(attrs) }, out);
    }
  }
};

const sortKeys = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;

  return Object.fromEntries(Object.keys(record).sort().map(key => [key, sortKeys(record[key])]));
};

/** Key order inside nested values (`tag:*` attrs, link) must not split equal marks. */
const sameMarks = (a: RichTextSegment, b: RichTextSegment): boolean =>
  JSON.stringify(sortKeys(a.marks ?? {})) === JSON.stringify(sortKeys(b.marks ?? {}));

// `'text' in` alone is true for a present-but-undefined key that an embed item may carry.
export const isTextSegment = (segment: RichTextSegment): segment is RichTextTextSegment =>
  'text' in segment && typeof segment.text === 'string';

const withoutMarks = (segment: RichTextSegment): RichTextSegment => {
  const { marks: _marks, ...rest } = segment;

  return rest;
};

/**
 * One spelling per document: marks in fixed order, empty marks and empty runs
 * dropped, adjacent runs with equal marks merged. The echo check in
 * `blocks.render` compares this output, so it must be stable.
 * @param rich - segments in any spelling
 */
export const canonicalizeSegments = (rich: RichText): RichText => {
  const out: RichTextSegment[] = [];

  for (const raw of rich) {
    const segment = withMarks(withoutMarks(raw), raw.marks ?? {});
    const previous = out[out.length - 1];

    if (isTextSegment(segment) && segment.text === '') {
      continue;
    }
    if (isTextSegment(segment) && previous !== undefined && isTextSegment(previous) && sameMarks(previous, segment)) {
      out[out.length - 1] = { ...previous, text: previous.text + segment.text };
      continue;
    }
    out.push(segment);
  }

  return out;
};

/** A lone trailing `<br>` is the contenteditable placeholder, not a typed line. */
const dropPlaceholderBreak = (rich: RichText): RichText => {
  const last = rich[rich.length - 1];

  if (last === undefined || !isTextSegment(last) || !last.text.endsWith('\n')) {
    return rich;
  }

  const text = last.text.slice(0, -1);

  return text === '' ? rich.slice(0, -1) : [...rich.slice(0, -1), { ...last, text }];
};

/**
 * Parsed inline HTML → canonical segments.
 * @param nodes - parser-neutral tree
 */
export const inlineTreeToSegments = (nodes: InlineNode[]): RichText => {
  const out: RichTextSegment[] = [];

  walk(nodes, {}, out);

  return dropPlaceholderBreak(canonicalizeSegments(out));
};
