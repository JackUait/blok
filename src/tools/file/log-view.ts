import { IconCopy } from '../../components/icons';
import { splitLines } from './code-view';
import { barButton, barSpacer, buildBar, copyButton, type PreviewChrome } from './preview-chrome';

type Level = 'error' | 'warn' | 'info';

const WORDS = 'TRACE|DEBUG|INFO|NOTICE|WARN(?:ING)?|ERROR|ERR|FATAL|CRIT(?:ICAL)?|SEVERE';
/** A timestamp opening a line: ISO-like, clock only, or syslog ("Nov 13 09:14:02"). */
const TIME = /^(?:\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\]?|\d{2}:\d{2}:\d{2}(?:[.,]\d+)?|[A-Z][a-z]{2} +\d{1,2} \d{2}:\d{2}:\d{2})/;
/** A level word right after the timestamp, in any case, bare or bracketed. */
const LEVEL_AT_START = new RegExp(`^(\\s*[[(]?)(${WORDS})(?=[\\])]?:?(?:\\s|$))`, 'i');
/** Else an upper-case level word near the start. Lower-case words there are prose. */
const LEVEL_NEAR_START = new RegExp(`^(.{0,48}?\\b)(${WORDS})\\b`);
const KEY = /([\w.-]+=)/;
const ERRORS = /^(?:ERROR|ERR|FATAL|CRIT|CRITICAL|SEVERE)$/i;
const WARNINGS = /^WARN(?:ING)?$/i;

function levelOf(word: string): Level {
  if (ERRORS.test(word)) {
    return 'error';
  }

  return WARNINGS.test(word) ? 'warn' : 'info';
}

function part(kind: 'time' | 'level' | 'key', text: string): HTMLElement {
  const span = document.createElement('span');
  span.setAttribute('data-part', kind);
  span.textContent = text;

  return span;
}

/** One log line as a row: its timestamp, level word and `key=` names wrapped, every character kept. */
function buildLine(text: string, number: number): { row: HTMLElement; level: Level } {
  const row = document.createElement('div');
  row.className = 'blok-file-preview-log-line';
  row.setAttribute('data-line', String(number));
  const time = TIME.exec(text)?.[0] ?? '';
  const rest = text.slice(time.length);
  const found = LEVEL_AT_START.exec(rest) ?? LEVEL_NEAR_START.exec(rest);
  const word = found?.[2] ?? '';
  const message = found === null ? rest : rest.slice(found[0].length);
  const level = levelOf(word);
  row.setAttribute('data-level', level);

  if (time !== '') {
    row.appendChild(part('time', time));
  }
  if (found !== null) {
    row.append(found[1], part('level', word));
  }
  // Splitting on a capture group puts every `key=` at an odd index.
  message.split(KEY).forEach((piece, index) => {
    if (piece !== '') {
      row.append(index % 2 === 1 ? part('key', piece) : piece);
    }
  });

  return { row, level };
}

/** A log file: dim timestamps, coloured levels, and a filter for errors and warnings. */
export function renderLog(chrome: PreviewChrome, text: string): void {
  const { body, labels } = chrome;
  body.replaceChildren();
  const pre = document.createElement('pre');
  pre.className = 'blok-file-preview-pre blok-file-preview-log';
  pre.setAttribute('data-role', 'file-preview-log');
  pre.dir = 'ltr';
  const lines = splitLines(text).map((line, index) => buildLine(line, index + 1));
  pre.append(...lines.map((line) => line.row));
  body.appendChild(pre);

  const count = (level: Level): number => lines.filter((line) => line.level === level).length;
  const filters: Array<{ label: string; level: Level | null }> = [
    { label: `${labels.logAll} ${lines.length}`, level: null },
    { label: `${labels.logErrors} ${count('error')}`, level: 'error' },
    { label: `${labels.logWarnings} ${count('warn')}`, level: 'warn' },
  ];
  const buttons: HTMLButtonElement[] = filters.map((filter, index) => barButton(filter.label, 'preview-log-filter', () => {
    lines.forEach((line) => {
      // eslint-disable-next-line no-param-reassign -- filtering rows is this control's job
      line.row.hidden = filter.level !== null && line.level !== filter.level;
    });
    buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
  }, { pressed: index === 0 }));

  chrome.setBar(buildBar([...buttons, barSpacer(), copyButton(() => text, labels, IconCopy)]));
}

/** Any other text file: the text as it is, with a Copy button. */
export function renderPlainText(chrome: PreviewChrome, text: string): void {
  const { body, labels } = chrome;
  body.replaceChildren();
  const pre = document.createElement('pre');
  pre.className = 'blok-file-preview-pre';
  pre.setAttribute('data-role', 'file-preview-text');
  pre.textContent = text;
  body.appendChild(pre);

  chrome.setBar(buildBar([barSpacer(), copyButton(() => text, labels, IconCopy)]));
}
