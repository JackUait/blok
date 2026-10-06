/**
 * Cell formatting the cell parsers never see:
 * - Google Sheets puts bold/italic/underline/strike on the `<td>` style, but
 *   only marks inside the cell are read.
 * - LibreOffice puts text colour on `<font color>`, which the sanitizer unwraps.
 *
 * Runs on the raw clipboard string, before the Docs pass turns span styles
 * into marks.
 */
import { isSafeCssColor } from '../../../shared/css-color';
import { wrapCellTextMarks } from './excel-class-styles-preprocessor';
import { parseUntrustedDocument } from '../../utils/inert-html';

const MARK_DECLARATION = /(?<![a-z-])(font-weight|font-style|text-decoration(?:-line)?)\s*:/i;
const MARK_PROPS = ['font-weight', 'font-style', 'text-decoration', 'text-decoration-line'];
// Valid CSS colours that carry no colour of their own.
const NON_COLOR = /^(transparent|currentcolor|var\()/i;

function applyCellMarks(cell: HTMLElement): boolean {
  const style = cell.getAttribute('style') ?? '';

  // wrapCellTextMarks would wrap a nested table's rows, not its cells' text.
  if (!MARK_DECLARATION.test(style) || cell.querySelector('table') !== null) {
    return false;
  }

  // A pasted <th> lands in the heading row, which already renders bold.
  wrapCellTextMarks(cell, cell.tagName === 'TH' ? style.replace(/font-weight\s*:[^;]*/gi, '') : style);
  // Without this a second run of the chain wraps again.
  MARK_PROPS.forEach(prop => cell.style.removeProperty(prop));

  return true;
}

function convertFontColor(font: HTMLElement): boolean {
  const color = font.getAttribute('color')?.trim();

  if (!isSafeCssColor(color) || NON_COLOR.test(color)) {
    return false;
  }

  const span = font.ownerDocument.createElement('span');
  const style = font.getAttribute('style');

  if (style !== null) {
    span.setAttribute('style', style);
  }
  span.style.color = color;
  span.append(...Array.from(font.childNodes));
  font.replaceWith(span);

  return true;
}

/**
 * @param html - raw clipboard HTML string
 * @returns the rewritten HTML, or the input when nothing applies
 */
export function preprocessTableCellFormatting(html: string): string {
  if (!/<t[dh][\s>]/i.test(html)) {
    return html;
  }

  const doc = parseUntrustedDocument(html);
  const cells = Array.from(doc.body.querySelectorAll<HTMLElement>('td, th'));
  const fonts = Array.from(doc.body.querySelectorAll<HTMLElement>('td font[color], th font[color]'));
  const changed = [...cells.map(applyCellMarks), ...fonts.map(convertFontColor)];

  return changed.some(Boolean) ? doc.documentElement.outerHTML : html;
}
