/**
 * Pure, zero-dependency OpenGraph/Twitter-card metadata parser for the dev
 * unfurl endpoint. Regex-based on purpose — this is dev-only tooling, not a
 * production HTML parser.
 */

/**
 * @typedef {object} ParsedMetadata
 * @property {string} [title] Page title (og:title → twitter:title → <title>).
 * @property {string} [description] Page description (og → twitter → meta description).
 * @property {string} [image] Absolute preview image URL.
 * @property {string} [favicon] Absolute favicon URL (falls back to /favicon.ico).
 * @property {string} [domain] Hostname of the page URL.
 */

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/**
 * Decodes common named and numeric HTML entities.
 *
 * @param {string} text Raw attribute or text content.
 * @returns {string} Decoded text.
 */
function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => NAMED_ENTITIES[name]);
}

/**
 * Parses the attributes of a single HTML tag into a lowercase-keyed map.
 * Attribute order and quote style are irrelevant.
 *
 * @param {string} tag Full tag markup, e.g. `<meta content="x" property="og:title">`.
 * @returns {Record<string, string>} Attribute name → raw value.
 */
function parseAttributes(tag) {
  /** @type {Record<string, string>} */
  const attrs = {};
  const attrRe = /([a-zA-Z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;

  while ((match = attrRe.exec(tag)) !== null) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? '';
  }

  return attrs;
}

/**
 * Collects all <meta> tag values keyed by `property`/`name` (first non-empty wins).
 *
 * @param {string} html Page markup.
 * @returns {Map<string, string>} Meta key → decoded content.
 */
function collectMetaTags(html) {
  const map = new Map();

  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = parseAttributes(tag);
    const key = (attrs.property ?? attrs.name ?? '').toLowerCase();
    const value = decodeEntities((attrs.content ?? '').trim());

    if (key !== '' && value !== '' && !map.has(key)) {
      map.set(key, value);
    }
  }

  return map;
}

/**
 * Resolves a possibly-relative URL against the page URL.
 *
 * @param {string} href Raw href/src value.
 * @param {string} pageUrl Base page URL.
 * @returns {string | undefined} Absolute URL, or undefined when unresolvable.
 */
function resolveUrl(href, pageUrl) {
  try {
    return new URL(href, pageUrl).href;
  } catch {
    return undefined;
  }
}

/**
 * Extracts the text of the first <title> element.
 *
 * @param {string} html Page markup.
 * @returns {string | undefined} Decoded, trimmed title text.
 */
function extractTitleTag(html) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);

  if (match === null) {
    return undefined;
  }

  const title = decodeEntities(match[1]).trim();

  return title === '' ? undefined : title;
}

/**
 * Finds the page favicon from <link rel="icon"|"shortcut icon"|"apple-touch-icon">,
 * falling back to `${origin}/favicon.ico`.
 *
 * @param {string} html Page markup.
 * @param {string} pageUrl Base page URL.
 * @returns {string | undefined} Absolute favicon URL.
 */
function findFavicon(html, pageUrl) {
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = parseAttributes(tag);
    const relTokens = (attrs.rel ?? '').toLowerCase().split(/\s+/);
    const href = decodeEntities((attrs.href ?? '').trim());

    if (href !== '' && (relTokens.includes('icon') || relTokens.includes('apple-touch-icon'))) {
      return resolveUrl(href, pageUrl);
    }
  }

  return resolveUrl('/favicon.ico', pageUrl);
}

/**
 * Parses bookmark metadata out of an HTML document, using metascraper-style
 * ordered fallbacks (og → twitter → plain HTML).
 *
 * @param {string} html Page markup (may be truncated; meta tags live in <head>).
 * @param {string} pageUrl Final URL of the page, used for relative resolution.
 * @returns {ParsedMetadata} Parsed fields; absent values are undefined.
 */
export function parseMetadata(html, pageUrl) {
  const meta = collectMetaTags(html);

  /**
   * @param {string[]} keys Ordered candidate meta keys.
   * @returns {string | undefined} First non-empty value.
   */
  const pick = (...keys) => {
    for (const key of keys) {
      const value = meta.get(key);

      if (value !== undefined) {
        return value;
      }
    }

    return undefined;
  };

  const rawImage = pick('og:image', 'og:image:secure_url', 'twitter:image', 'twitter:image:src');

  let domain;

  try {
    domain = new URL(pageUrl).hostname;
  } catch {
    domain = undefined;
  }

  return {
    title: pick('og:title', 'twitter:title') ?? extractTitleTag(html),
    description: pick('og:description', 'twitter:description', 'description'),
    image: rawImage === undefined ? undefined : resolveUrl(rawImage, pageUrl),
    favicon: findFavicon(html, pageUrl),
    domain,
  };
}
