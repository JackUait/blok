import { COLOR_PRESETS } from '../../components/shared/color-presets';
import { PAGE_REFERENCE_ATTR } from '../page-reference';
import { EQUATION_SOURCE_ATTR } from '../equation-mark';
import type { InlineNode } from './inline-tree';
import type { RichText, RichTextMarks, RichTextSegment } from '../../../types/rich-text';

const SIMPLE_MARKS: Record<string, keyof RichTextMarks> = {
  strong: 'bold', b: 'bold', em: 'italic', i: 'italic', u: 'underline',
  s: 'strikethrough', del: 'strikethrough', strike: 'strikethrough',
  code: 'code', sup: 'sup', sub: 'sub',
};

/** Block-level or void tags the run model cannot hold; kept verbatim as an html embed. */
const OPAQUE_TAGS = new Set(['img', 'p', 'ul', 'ol', 'li', 'div', 'table', 'hr']);

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

const orderMarks = (marks: RichTextMarks): RichTextMarks | undefined => {
  const ordered: Record<string, unknown> = {};

  for (const key of MARK_ORDER) {
    if (marks[key] !== undefined) {
      ordered[key] = marks[key];
    }
  }
  for (const key of Object.keys(marks).filter(name => !MARK_ORDER.includes(name as keyof RichTextMarks)).sort()) {
    ordered[key] = (marks as Record<string, unknown>)[key];
  }

  return Object.keys(ordered).length === 0 ? undefined : ordered as RichTextMarks;
};

const withMarks = (segment: RichTextSegment, marks: RichTextMarks): RichTextSegment => {
  const ordered = orderMarks(marks);

  return ordered === undefined ? segment : { ...segment, marks: ordered };
};

/** A `<mark>` with a colour style sets color/background; a bare one is a highlight. */
const markMarks = (attrs: Record<string, string>, marks: RichTextMarks): RichTextMarks => {
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
      out.push(withMarks({ text: node.value }, marks));
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
      walk(node.children, markMarks(attrs, marks), out);
    } else if (OPAQUE_TAGS.has(tag)) {
      out.push(withMarks({ embed: { html: node.outerHtml } }, marks));
    } else {
      walk(node.children, { ...marks, [`tag:${tag}`]: sortedRecord(attrs) }, out);
    }
  }
};

const sameMarks = (a: RichTextSegment, b: RichTextSegment): boolean =>
  JSON.stringify(a.marks ?? {}) === JSON.stringify(b.marks ?? {});

/**
 * One spelling per document: adjacent runs with equal marks merged, empty runs
 * dropped, the contenteditable placeholder `<br>` removed. The echo check in
 * `blocks.render` compares this output, so it must be stable.
 * @param rich - segments in any spelling
 */
export const canonicalizeSegments = (rich: RichText): RichText => {
  const out: RichTextSegment[] = [];

  for (const segment of rich) {
    const previous = out[out.length - 1];

    if ('text' in segment && segment.text === '') {
      continue;
    }
    if ('text' in segment && previous !== undefined && 'text' in previous && sameMarks(previous, segment)) {
      out[out.length - 1] = { ...previous, text: previous.text + segment.text };
      continue;
    }
    out.push(segment);
  }

  const last = out[out.length - 1];

  if (last !== undefined && 'text' in last && last.text.endsWith('\n')) {
    const text = last.text.slice(0, -1);

    if (text === '') {
      out.pop();
    } else {
      out[out.length - 1] = { ...last, text };
    }
  }

  return out;
};

/**
 * Parsed inline HTML → canonical segments.
 * @param nodes - parser-neutral tree
 */
export const inlineTreeToSegments = (nodes: InlineNode[]): RichText => {
  const out: RichTextSegment[] = [];

  walk(nodes, {}, out);

  return canonicalizeSegments(out);
};
