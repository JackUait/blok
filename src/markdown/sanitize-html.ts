import { isClobbered } from '../components/utils/dom-clobbering';
import { parseUntrustedDocument } from '../components/utils/inert-html';
import { safeHref, safeImageSrc } from '../components/utils/sanitize-url';

/**
 * Block-level raw HTML in a Markdown document (e.g. a README's centred-logo
 * `<p align="center"><img></p>`) is rendered through a strict allowlist rather
 * than escaped, so common layout markup survives while script-bearing tags do
 * not. Inline raw HTML stays escaped at the caller — balancing split open/close
 * tag fragments through a sanitizer is unsafe.
 *
 * The input is untrusted (a third-party README, a model's reply) and the
 * output goes to `innerHTML`. Output matches DOMPurify 3.4.17 with this
 * allowlist byte for byte on `test/fixtures/markdown-sanitize`.
 */
const ALLOWED_TAGS = new Set([
  'p', 'div', 'span', 'a', 'img', 'picture', 'source',
  'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins', 'mark', 'small', 'abbr',
  'code', 'pre', 'kbd', 'samp', 'br', 'hr', 'sub', 'sup',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'blockquote',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  'figure', 'figcaption', 'details', 'summary',
]);

const ALLOWED_ATTRIBUTES = new Set([
  'href', 'src', 'alt', 'title', 'align', 'width', 'height',
  'colspan', 'rowspan', 'start', 'open',
]);

/** Text-only attributes: their value is never a URL, so it skips the URL check. */
const TEXT_ATTRIBUTES = new Set([ 'alt', 'title' ]);

/**
 * A disallowed tag is unwrapped and keeps its children, except these, which go
 * with everything inside: script, style, foreign (svg/math) or never-shown content.
 * Dropping svg and math whole also means no element outside HTML is ever kept.
 */
const DROPPED_WITH_CONTENT = new Set([
  'annotation-xml', 'audio', 'colgroup', 'desc', 'foreignobject', 'head', 'iframe', 'math', 'mi', 'mn', 'mo',
  'ms', 'mtext', 'noembed', 'noframes', 'noscript', 'plaintext', 'script', 'selectedcontent', 'style', 'svg',
  'template', 'title', 'video', 'xmp',
]);

/** A value is a safe URL when its scheme is one of these, or when it has no scheme. */
const SAFE_URL = /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i;

/** Characters a browser skips inside a URL scheme, so `java\tscript:` cannot pass the check. */
const URL_WHITESPACE = /[\u0000-\u0020\u00A0\u1680\u180E\u2000-\u2029\u205F\u3000]/g;

/** A comment end or a raw-text end tag in an attribute value could break out on a later reparse. */
const MARKUP_IN_VALUE = /((--!?|])>)|<\/(style|script|title|xmp|textarea|noscript|iframe|noembed|noframes)/i;

/** Only these tags may carry a `data:` URL; it is checked again below. */
const DATA_URL_TAGS = new Set([ 'img', 'source' ]);

/** Resolve a possibly-relative URL against the document's base, if known. */
function resolveUrl(url: string, base: string | undefined): string {
  if (base === undefined || base === '') {
    return url;
  }
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

/**
 * Whether an allowed attribute keeps its (trimmed) value.
 * @param name - lowercase attribute name
 * @param value - trimmed value
 * @param tagName - lowercase tag name
 */
const isSafeValue = (name: string, value: string, tagName: string): boolean => {
  if (MARKUP_IN_VALUE.test(value)) {
    return false;
  }

  if (TEXT_ATTRIBUTES.has(name) || SAFE_URL.test(value.replace(URL_WHITESPACE, ''))) {
    return true;
  }

  if ((name === 'src' || name === 'href') && value.startsWith('data:') && DATA_URL_TAGS.has(tagName)) {
    return true;
  }

  return value === '';
};

/**
 * Remove an attribute.
 * @param element - element that carries it
 * @param name - attribute name
 */
const dropAttribute = (element: Element, name: string): void => {
  element.removeAttribute(name);

  // The serializer still writes a removed `is`; an empty one can't name a custom element.
  if (name.toLowerCase() === 'is') {
    element.setAttribute('is', '');
  }
};

/**
 * Keep only allowed attributes with safe values.
 * @param element - element to clean
 * @param tagName - its lowercase tag name
 */
const cleanAttributes = (element: Element, tagName: string): void => {
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    const value = attribute.value.trim();
    const allowed = ALLOWED_ATTRIBUTES.has(name) || /^aria-[-\w]+$/.test(name);

    if (!allowed || !isSafeValue(name, value, tagName)) {
      dropAttribute(element, attribute.name);

      continue;
    }

    if (value !== attribute.value) {
      element.setAttribute(attribute.name, value);
    }
  }
};

/** Harden an anchor: resolve its href, drop unsafe schemes, prevent tab-nabbing. */
function hardenAnchor(element: Element, base: string | undefined): void {
  if (element.tagName !== 'A' || !element.hasAttribute('href')) {
    return;
  }
  const safe = safeHref(resolveUrl(element.getAttribute('href') ?? '', base));

  if (safe === null) {
    element.removeAttribute('href');

    return;
  }
  element.setAttribute('href', safe);
  element.setAttribute('target', '_blank');
  element.setAttribute('rel', 'noopener noreferrer nofollow');
}

/** Harden an image: strip srcset and resolve/validate its src. */
function hardenImage(element: Element, base: string | undefined): void {
  if (element.tagName !== 'IMG') {
    return;
  }
  element.removeAttribute('srcset');
  if (!element.hasAttribute('src')) {
    return;
  }
  const safe = safeImageSrc(resolveUrl(element.getAttribute('src') ?? '', base));

  if (safe === null) {
    element.removeAttribute('src');
  } else {
    element.setAttribute('src', safe);
  }
}

/**
 * Clean one node the iterator reached. A removed node's children, if kept,
 * are moved after it so the iterator visits them next.
 * @param node - node to clean
 * @param base - base URL for relative links
 */
const cleanNode = (node: Node, base: string | undefined): void => {
  if (node.nodeType === Node.TEXT_NODE) {
    return;
  }

  if (!(node instanceof Element)) {
    node.parentNode?.removeChild(node);

    return;
  }

  if (isClobbered(node)) {
    // Its own `remove` may be shadowed too.
    Element.prototype.remove.call(node);

    return;
  }

  const tagName = node.nodeName.toLowerCase();

  if (!ALLOWED_TAGS.has(tagName)) {
    const children = DROPPED_WITH_CONTENT.has(tagName) ? [] : Array.from(node.childNodes);

    node.replaceWith(...children);

    return;
  }

  cleanAttributes(node, tagName);
  hardenAnchor(node, base);
  hardenImage(node, base);
};

/**
 * Yield the iterator's nodes one by one, so a node can be removed before the next is read.
 * @param iterator - node iterator
 */
function* iterate(iterator: NodeIterator): Generator<Node, void> {
  for (;;) {
    const node = iterator.nextNode();

    if (node === null) {
      return;
    }
    yield node;
  }
}

/**
 * Sanitize a block of raw HTML to a safe subset. Relative `href`/`src` values
 * are resolved against `baseUrl` (the source document's URL) so README-relative
 * assets load. Script-capable tags/attributes and unsafe URL schemes are
 * stripped.
 * @param raw - untrusted HTML
 * @param baseUrl - URL of the document the HTML came from
 */
export function sanitizeBlockHtml(raw: string, baseUrl?: string): string {
  if (!raw.includes('<')) {
    return raw;
  }

  // Parsed into an inert document: nothing loads or runs while it is cleaned.
  const doc = parseUntrustedDocument(raw);
  // Read through Document.prototype: `<img name="body">` shadows `doc.body` (and
  // any other document member) in Firefox and WebKit.
  const body = Reflect.get<Document, 'body'>(Document.prototype, 'body', doc) as HTMLElement | null;

  // WebKit gives an input that is only a bogus comment (`<!d>`) no root, so no body.
  if (body === null) {
    return '';
  }
  const leadingWhitespace = /^[\r\n\t ]+/.exec(raw);

  // The parser drops whitespace before the first tag; DOMPurify kept it.
  if (leadingWhitespace !== null) {
    body.insertBefore(Document.prototype.createTextNode.call(doc, leadingWhitespace[0]), body.firstChild);
  }

  const iterator = Document.prototype.createNodeIterator.call(
    doc,
    body,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_TEXT | NodeFilter.SHOW_PROCESSING_INSTRUCTION
  );

  // The first node is `body` itself.
  iterator.nextNode();

  for (const node of iterate(iterator)) {
    cleanNode(node, baseUrl);
  }

  return body.innerHTML;
}
