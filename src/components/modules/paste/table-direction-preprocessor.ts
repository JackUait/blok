import { pastedGridDirection } from '../../../tools/table/table-cell-clipboard';

/**
 * Carry a pasted table's column direction onto the `<table>` itself.
 *
 * Apps put RTL on a wrapper (`<div dir="rtl">`), on `<body dir="rtl">` or in
 * an inline `direction` style. The sanitizer drops all of those and keeps
 * only TABLE `dir` (whitelisted in the table's pasteConfig), so
 * `Table.onPaste` would read the grid as LTR and mirror every
 * text-align: left/right placement.
 *
 * Must run on the raw clipboard string, before any pass that parses into a
 * `<div>`: that drops `<html>`/`<body>` and the body's `dir`.
 * @param html - raw clipboard HTML string
 * @returns the HTML with `dir` stamped on tables, or the input when none needs it
 */
export function stampPastedTableDirection(html: string): string {
  if (!/<table[\s>]/i.test(html)) {
    return html;
  }

  // DOMParser keeps <body> attributes and loads nothing (no browsing context).
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const unstamped = Array.from(doc.querySelectorAll('table')).filter(table => {
    const own = table.getAttribute('dir')?.trim().toLowerCase() === 'rtl' ? 'rtl' : 'ltr';

    return pastedGridDirection(table) !== own;
  });

  if (unstamped.length === 0) {
    return html;
  }

  unstamped.forEach(table => table.setAttribute('dir', pastedGridDirection(table)));

  return doc.documentElement.outerHTML;
}
