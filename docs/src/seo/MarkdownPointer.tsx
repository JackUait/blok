import { markdownMirrorUrl } from './locales';

/**
 * One sentence in the body naming this page's markdown mirror.
 *
 * It targets the commonest way a page reaches an LLM: a person pastes the URL
 * into a chat. The assistant fetches the HTML and reads the body, so a `<link>`
 * in the head (which many fetchers discard along with the rest of the head) is
 * not enough on its own.
 *
 * Hidden from sighted visitors by `sr-only` and from assistive technology by
 * `aria-hidden` — nothing here is content, so nobody reading the page should
 * meet it.
 */
export const MarkdownPointer = ({ pathname }: { pathname: string }) => (
  <div className="sr-only" aria-hidden="true">
    {/* One interpolation, one text node. Splitting the sentence around the URL
        would make React emit a `<!-- -->` separator between them, right in the
        middle of the address a raw-HTML reader has to pick up. */}
    {`A Markdown version of this page is available at ${markdownMirrorUrl(pathname)}.`}
  </div>
);
