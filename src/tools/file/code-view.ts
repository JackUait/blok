import { IconCopy } from '../../components/icons';
import { measureLineRows, rowHeight } from '../code/line-geometry';
import { applyPrismHighlight } from '../code/prism-applier';
import { isHighlightable, tokenizePrism } from '../code/prism-loader';
import { humanFileSize } from './format';
import { barButton, barSpacer, barText, buildBar, copyButton, type PreviewChrome } from './preview-chrome';
import { counted } from './preview-labels';

/** Columns a tab takes. Matches `tab-size` on `.blok-file-preview-pre`. */
const TAB_COLUMNS = 2;
/** Minimap: px one line takes when the whole file fits. */
const MAP_LINE = 4;
/** Minimap: px one bar takes when lines must share a bar. */
const MAP_MIN_STEP = 2;
/** Minimap: px of bar per text column, and per indent column. */
const MAP_TEXT = 0.85;
const MAP_INDENT = 1.4;
const MAP_WIDTH = 64;

function el(tag: string, className: string, role: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.setAttribute('data-role', role);

  return node;
}

/** The lines of a file. A trailing newline ends the last line; it does not start a new one. */
export function splitLines(text: string): string[] {
  const lines = text.split('\n');

  return lines.length > 1 && lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
}

/** Leading whitespace of a line, in columns. */
function indentOf(line: string): number {
  const lead = /^[ \t]*/.exec(line)?.[0] ?? '';

  return line.trim() === '' ? 0 : Array.from(lead).reduce((sum, ch) => sum + (ch === '\t' ? TAB_COLUMNS : 1), 0);
}

/** Indent guides: one strip per line, as wide as its indent, striped every `step` columns. */
function buildGuides(indents: number[]): { layer: HTMLElement; strips: HTMLElement[] } {
  const layer = el('div', 'blok-file-preview-guides', 'file-preview-guides');
  layer.setAttribute('aria-hidden', 'true');
  const used = indents.filter((indent) => indent > 0);
  const step = used.length === 0 ? TAB_COLUMNS : Math.max(TAB_COLUMNS, Math.min(...used));
  layer.style.setProperty('--blok-file-guide-step', `${step}ch`);
  const strips = indents.map((indent) => {
    const strip = document.createElement('div');
    const columns = Math.floor(indent / step) * step;
    if (columns > 0) {
      strip.style.width = `${columns}ch`;
    }
    layer.appendChild(strip);

    return strip;
  });

  return { layer, strips };
}

/**
 * The minimap: a bar per line (or per few lines of a long file), with a window
 * that follows the scroll. Pressing or dragging on it scrolls the code.
 */
function buildMinimap(lines: string[], indents: number[], scroller: HTMLElement, chrome: PreviewChrome): HTMLElement {
  const map = el('div', 'blok-file-preview-minimap', 'file-preview-minimap');
  map.setAttribute('aria-hidden', 'true');
  const bars = el('div', 'blok-file-preview-minimap-bars', 'file-preview-minimap-bars');
  const win = el('div', 'blok-file-preview-minimap-window', 'file-preview-minimap-window');
  map.appendChild(bars);
  const state = { height: 0, stride: 0 };

  const draw = (): void => {
    const room = map.clientHeight;
    const perLine = room > 0 ? Math.min(MAP_LINE, room / lines.length) : MAP_LINE;
    const stride = perLine >= MAP_MIN_STEP ? 1 : Math.ceil(MAP_MIN_STEP / perLine);
    const step = perLine >= MAP_MIN_STEP ? perLine : MAP_MIN_STEP;
    state.height = Math.ceil(lines.length / stride) * step;
    if (stride === state.stride) {
      return;
    }
    state.stride = stride;
    bars.replaceChildren(win);
    bars.style.setProperty('--blok-file-map-step', `${step}px`);
    for (const [index, line] of lines.entries()) {
      if (index % stride !== 0) {
        continue;
      }
      const bar = document.createElement('i');
      const inset = Math.min(indents[index] * MAP_INDENT, MAP_WIDTH / 2);
      if (inset > 0) {
        bar.style.marginInlineStart = `${inset}px`;
      }
      bar.style.width = `${Math.min(MAP_WIDTH - inset, line.trim().length * MAP_TEXT)}px`;
      bars.appendChild(bar);
    }
  };

  const sync = (): void => {
    draw();
    const total = scroller.scrollHeight || 1;
    win.style.top = `${(scroller.scrollTop / total) * state.height}px`;
    win.style.height = `${Math.min(1, scroller.clientHeight / total) * state.height}px`;
  };

  const scrollTo = (event: MouseEvent): void => {
    const y = event.clientY - bars.getBoundingClientRect().top;
    // eslint-disable-next-line no-param-reassign -- scrolling the code is this control's job
    scroller.scrollTop = (y / (state.height || 1)) * scroller.scrollHeight - scroller.clientHeight / 2;
  };
  map.addEventListener('pointerdown', (event) => {
    map.setPointerCapture?.(event.pointerId);
    scrollTo(event);
  });
  map.addEventListener('pointermove', (event) => {
    if (event.buttons === 1) {
      scrollTo(event);
    }
  });

  scroller.addEventListener('scroll', sync, { passive: true });
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(sync);
    observer.observe(scroller);
    chrome.onRelease(() => observer.disconnect());
  }
  sync();

  return map;
}

/** The band under the pointer's line. It finds the line by the gutter number at the pointer's height. */
function trackHover(pre: HTMLElement, gutter: HTMLElement): HTMLElement {
  const band = el('div', 'blok-file-preview-line-hover', 'file-preview-line-hover');
  band.setAttribute('aria-hidden', 'true');
  band.hidden = true;
  const state: { line: HTMLElement | null } = { line: null };
  const clear = (): void => {
    state.line?.removeAttribute('data-hover');
    state.line = null;
    band.hidden = true;
  };
  pre.addEventListener('pointermove', (event) => {
    if (typeof document.elementFromPoint !== 'function') {
      return;
    }
    // Probe inside a number: the gutter's own padding would hit the gutter, not a line.
    const probe = gutter.firstElementChild?.getBoundingClientRect().left ?? 0;
    const hit = document.elementFromPoint(probe + 1, event.clientY);
    const line = hit instanceof HTMLElement && hit.parentElement === gutter ? hit : null;
    if (line === state.line) {
      return;
    }
    clear();
    if (line === null) {
      return;
    }
    state.line = line;
    line.setAttribute('data-hover', '');
    band.style.top = `${gutter.offsetTop + line.offsetTop}px`;
    band.style.height = `${line.offsetHeight}px`;
    band.hidden = false;
  });
  pre.addEventListener('pointerleave', clear);

  return band;
}

/**
 * A code file: line numbers, indent guides, a band under the pointer's line, a
 * draggable minimap, and a status bar with Wrap lines and Copy.
 */
export async function renderCode(chrome: PreviewChrome, text: string, lang: string): Promise<void> {
  const { body, labels } = chrome;
  body.replaceChildren();
  const pre = el('pre', 'blok-file-preview-pre', 'file-preview-code');
  // Source reads LTR in any editor direction, so the gutter stays on the left.
  pre.dir = 'ltr';
  pre.setAttribute('data-wrap', 'true');

  const lines = splitLines(text);
  const indents = lines.map(indentOf);
  // A sibling of <code>, so the highlighter's innerHTML swap leaves it alone.
  const gutter = el('div', 'blok-file-preview-gutter', 'file-preview-gutter');
  gutter.setAttribute('aria-hidden', 'true');
  const numbers = lines.map((_, index) => {
    const line = document.createElement('div');
    line.textContent = String(index + 1);
    gutter.appendChild(line);

    return line;
  });

  const area = el('div', 'blok-file-preview-code-area', 'file-preview-code-area');
  const { layer, strips } = buildGuides(indents);
  const code = document.createElement('code');
  code.textContent = text;
  area.append(layer, code);
  pre.append(trackHover(pre, gutter), gutter, area);
  body.appendChild(pre);

  // Long lines wrap, so a number and a guide must cover every row of their line.
  const syncRows = (): void => {
    const rows = measureLineRows(code);
    const row = rowHeight(code);
    numbers.forEach((line, index) => {
      const count = rows[index] ?? 1;
      if (count > 1) {
        line.style.setProperty('height', `${count * row}px`);
      } else {
        line.style.removeProperty('height');
      }
      if (row > 0) {
        strips[index].style.setProperty('height', `${count * row}px`);
      }
    });
  };

  const lineCount = counted(lines.length, labels.linesOne, labels.lines);
  chrome.setFacts([lineCount]);
  chrome.setBar(buildBar([
    ...[chrome.typeName, lineCount, humanFileSize(chrome.size)].filter((part) => part !== '').map((part) => barText(part)),
    barSpacer(),
    barButton(labels.wrap, 'preview-wrap', (button) => {
      const wrap = pre.getAttribute('data-wrap') !== 'true';
      pre.setAttribute('data-wrap', String(wrap));
      button.setAttribute('aria-pressed', String(wrap));
      syncRows();
    }, { pressed: true }),
    copyButton(() => text, labels, IconCopy),
  ]));
  chrome.addOverlay(buildMinimap(lines, indents, pre, chrome));

  if (isHighlightable(lang)) {
    const html = await tokenizePrism(text, lang);
    if (html !== null) {
      applyPrismHighlight(code, html, lang);
    }
  }

  syncRows();
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(syncRows);
    observer.observe(code);
    chrome.onRelease(() => observer.disconnect());
  }
}
