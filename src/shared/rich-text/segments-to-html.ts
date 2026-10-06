import { COLOR_PRESETS, colorVarName } from '../../components/shared/color-presets';
import { PAGE_REFERENCE_ATTR, PAGE_REFERENCE_FALLBACK } from '../page-reference';
import { EQUATION_SOURCE_ATTR } from '../equation-mark';
import type { RichText, RichTextMarks, RichTextSegment } from './types';

const PRESET_NAMES = new Set(COLOR_PRESETS.map(preset => preset.name));

const escapeText = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const escapeAttr = (value: string): string => escapeText(value).replace(/"/g, '&quot;');

const cssColor = (value: string, mode: 'text' | 'bg'): string =>
  PRESET_NAMES.has(value) ? colorVarName(value, mode) : value;

const attrs = (pairs: Record<string, string | undefined>): string =>
  Object.keys(pairs)
    .filter(name => pairs[name] !== undefined)
    .map(name => ` ${name}="${escapeAttr(pairs[name] as string)}"`)
    .join('');

interface Wrapper {
  /** Value the runs are grouped by; `undefined` = no wrapper. */
  read(marks: RichTextMarks): unknown;
  open(value: unknown): string;
  close: string;
}

const simple = (key: keyof RichTextMarks, tag: string): Wrapper => ({
  read: marks => marks[key],
  open: () => `<${tag}>`,
  close: `</${tag}>`,
});

/** Outermost first. The order is part of the canonical HTML: changing it changes saved output. */
const FIXED_WRAPPERS: Wrapper[] = [
  {
    read: marks => marks.link,
    open: value => {
      const link = value as NonNullable<RichTextMarks['link']>;

      return `<a${attrs({ href: link.href, target: link.target, rel: link.rel })}>`;
    },
    close: '</a>',
  },
  {
    read: marks => (marks.color === undefined && marks.background === undefined
      ? undefined
      : { color: marks.color, background: marks.background }),
    open: (value) => {
      const { color, background } = value as { color?: string; background?: string };
      const style = [
        color === undefined ? '' : `color: ${cssColor(color, 'text')};`,
        background === undefined ? '' : `background-color: ${cssColor(background, 'bg')};`,
      ].filter(Boolean).join(' ');

      return `<mark style="${escapeAttr(style)}">`;
    },
    close: '</mark>',
  },
  simple('highlight', 'mark'),
  simple('bold', 'strong'),
  simple('italic', 'i'),
  simple('underline', 'u'),
  simple('strikethrough', 's'),
  simple('code', 'code'),
  simple('sup', 'sup'),
  simple('sub', 'sub'),
];

const customWrapper = (key: `tag:${string}`): Wrapper => {
  const tag = key.slice('tag:'.length);

  return {
    read: marks => marks[key],
    open: value => `<${tag}${attrs(value as Record<string, string>)}>`,
    close: `</${tag}>`,
  };
};

const stableKey = (value: unknown): string => JSON.stringify(value) ?? 'undefined';

const leaf = (segment: RichTextSegment): string => {
  if ('text' in segment) {
    return escapeText(segment.text).replace(/\n/g, '<br>');
  }

  const { embed } = segment;

  if ('equation' in embed) {
    const source = escapeText(embed.equation.expression);

    return `<span ${EQUATION_SOURCE_ATTR}="${escapeAttr(embed.equation.expression)}">${source}</span>`;
  }

  if ('page' in embed) {
    return `<a ${PAGE_REFERENCE_ATTR}="${escapeAttr(embed.page.id)}">${PAGE_REFERENCE_FALLBACK}</a>`;
  }

  return embed.html;
};

interface Group {
  value: unknown;
  key: string;
  runs: RichTextSegment[];
}

const groupRuns = (segments: RichTextSegment[], wrapper: Wrapper): Group[] =>
  segments.reduce<Group[]>((groups, segment) => {
    const value = wrapper.read(segment.marks ?? {});
    const key = stableKey(value);
    const last = groups[groups.length - 1];

    if (last !== undefined && last.key === key) {
      last.runs.push(segment);

      return groups;
    }

    return [...groups, { value, key, runs: [segment] }];
  }, []);

const render = (segments: RichTextSegment[], wrappers: Wrapper[], depth: number): string => {
  if (depth === wrappers.length) {
    return segments.map(leaf).join('');
  }

  const wrapper = wrappers[depth];

  return groupRuns(segments, wrapper)
    .map(({ value, runs }) => {
      const inner = render(runs, wrappers, depth + 1);

      return value === undefined ? inner : `${wrapper.open(value)}${inner}${wrapper.close}`;
    })
    .join('');
};

const isCustomKey = (key: string): key is `tag:${string}` => key.startsWith('tag:');

/**
 * Rich text → the inline HTML Blok tools store internally.
 * @param rich - segments
 */
export const segmentsToHtml = (rich: RichText): string => {
  const customKeys = new Set(rich.flatMap(segment => Object.keys(segment.marks ?? {})).filter(isCustomKey));
  const wrappers = [...FIXED_WRAPPERS, ...[...customKeys].sort().map(customWrapper)];
  const html = render(rich, wrappers, 0);
  const last = rich[rich.length - 1];

  // A lone trailing <br> in a contenteditable shows no line; a typed trailing break needs a second one.
  return last !== undefined && 'text' in last && last.text.endsWith('\n') ? `${html}<br>` : html;
};
