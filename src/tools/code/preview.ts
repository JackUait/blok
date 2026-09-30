import { createPreview, h } from '../../components/utils/block-preview';

type Token = [kind: string, text: string];

/** Kinds map to Prism's hue families: kw purple, fn blue, str green, num orange, cm gray. */
const LINES: Token[][] = [
  [['kw', 'const'], ['', ' order = '], ['fn', 'brew'], ['p', '('], ['str', "'oat latte'"], ['p', ');']],
  [['kw', 'if'], ['p', ' ('], ['', 'order.temp '], ['kw', '>'], ['num', ' 60'], ['p', ') {']],
  [['', '  '], ['fn', 'sip'], ['p', '('], ['', 'order'], ['p', ');'], ['cm', ' // slowly']],
  [['p', '}']],
  [['fn', 'notify'], ['p', '('], ['str', "'Coffee is ready'"], ['p', ');']],
];

/** Typing speed; the stylesheet reads these per line as --d (delay) and --t (duration). */
const MS_PER_CHAR = 22;
const LINE_PAUSE_MS = 140;
const FIRST_LINE_DELAY_MS = 200;

/** A code block whose lines type in one after another, then the caret blinks. */
export const renderCodePreview = (): HTMLElement => {
  const charCounts = LINES.map(tokens => tokens.reduce((sum, [, text]) => sum + text.length, 0));
  const starts = charCounts.map((_, index) => charCounts
    .slice(0, index)
    .reduce((sum, chars) => sum + chars * MS_PER_CHAR + LINE_PAUSE_MS, FIRST_LINE_DELAY_MS));
  const caretStart = starts[starts.length - 1] + charCounts[charCounts.length - 1] * MS_PER_CHAR + LINE_PAUSE_MS;
  const lines = LINES.map((tokens, index) => h(
    'div',
    { 'data-line': '', style: `--d: ${starts[index]}ms; --t: ${charCounts[index] * MS_PER_CHAR}ms; --chars: ${charCounts[index]}` },
    h('span', { 'data-gutter': '' }, String(index + 1)),
    h('span', { 'data-text': '' }, ...tokens.map(([kind, value]) => (kind === '' ? value : h('span', { 'data-tok': kind }, value)))),
    ...(index === LINES.length - 1 ? [ h('span', { 'data-caret': '', style: `--d: ${caretStart}ms` }) ] : [])
  ));

  return createPreview(
    'code',
    h(
      'div',
      { 'data-card': '' },
      h('div', { 'data-header': '' }, 'TypeScript'),
      h('div', { 'data-body': '' }, ...lines)
    )
  );
};
