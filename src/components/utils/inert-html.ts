/**
 * Document used to parse untrusted markup. It has no browsing context, so
 * nothing inside it loads. Created once and reused — `createHTMLDocument`
 * is not free, and one per editor session is enough.
 */
const inertDocument = {
  current: undefined as Document | undefined,
};

/**
 * Parse untrusted HTML into a detached wrapper element.
 *
 * The wrapper deliberately does NOT belong to the live document. A wrapper made
 * with `document.createElement('div')` does: assigning `innerHTML` there starts
 * the resource loads the markup asks for, so `<img src=x onerror=…>` runs its
 * handler at parse time — before the sanitizer that would have stripped it.
 * A document with no browsing context loads nothing, so the markup stays inert
 * until `clean()` has decided what survives.
 *
 * The return value is a real element, so callers keep the full API they parse
 * with (`querySelector`, `children`, `contains`, `innerHTML`), and nodes created
 * against the live document are adopted on append as usual.
 * @param html - untrusted markup, typically clipboard HTML
 * @returns a detached wrapper holding the parsed markup
 */
export function parseUntrustedHtml(html: string): HTMLElement {
  inertDocument.current ??= document.implementation.createHTMLDocument('');

  const wrapper = inertDocument.current.createElement('div');

  wrapper.innerHTML = html;

  return wrapper;
}
