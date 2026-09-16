import { parseUntrustedHtml } from '../components/utils/inert-html';
import { preprocessLegacyCmsHtmlIn } from './legacy-cms-html';

export { preprocessLegacyCmsHtmlIn };

/**
 * Clean up legacy CMS markup (Summernote-era WYSIWYG output) so the paste
 * pipeline, the markdown importer or the CLI converter see structure instead of
 * styled `<div>` soup: background `<div>`s become `<aside>` callouts, invisible
 * background colours go, cell paragraphs become `<br>` lines, spacer paragraphs
 * are dropped, `<del>`/`<strike>` become `<s>`, and `•`-prefixed paragraphs
 * become real lists.
 *
 * Parsing goes through the inert document, so nothing in the input loads while
 * it is cleaned. Callers that already hold a DOM (and no live `document`, as in
 * a jsdom CLI) use `preprocessLegacyCmsHtmlIn` instead.
 * @param html - legacy markup
 * @returns the cleaned markup
 */
export function preprocessLegacyCmsHtml(html: string): string {
  const wrapper = parseUntrustedHtml(html);

  preprocessLegacyCmsHtmlIn(wrapper);

  return wrapper.innerHTML;
}
