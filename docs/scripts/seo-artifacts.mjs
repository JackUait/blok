// Pure builders for the build-time SEO / agent-readable artifacts:
// sitemap.xml, llms.txt, llms-full.txt and the per-route markdown mirrors.
//
// Everything here is a plain string/DOM transform so it can be unit-tested
// without a build. `scripts/generate-seo-artifacts.mjs` is the runner that
// feeds it the real route manifest and writes the output into dist/client.

const SITEMAP_NS = 'http://www.sitemaps.org/schemas/sitemap/0.9';

const escapeXml = (value) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * @param {{ loc: string, lastmod: string }[]} entries
 * @returns {string} sitemaps.org XML. No `priority`/`changefreq`: Google
 * documents that it ignores both, so emitting them is pure noise.
 */
export const renderSitemap = (entries) => {
  const urls = entries
    .map(
      ({ loc, lastmod }) =>
        `  <url>\n    <loc>${escapeXml(loc)}</loc>\n    <lastmod>${escapeXml(lastmod)}</lastmod>\n  </url>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="${SITEMAP_NS}">\n${urls}\n</urlset>\n`;
};

/** `/docs/table` -> `docs/table.md`, `/` -> `index.md`. */
export const mirrorPathForRoute = (route) => {
  const trimmed = route.replace(/^\/+/, '').replace(/\/+$/, '');
  return trimmed === '' ? 'index.md' : `${trimmed}.md`;
};

// Chrome that surrounds the article on every page. Dropping it is what keeps a
// mirror from being 60% sidebar. `nav` covers the site nav, the breadcrumb
// trail and the prev/next pager; `aside` covers the docs sidebar and the
// "On this page" rail.
const CHROME_SELECTOR =
  'script,style,noscript,svg,template,nav,aside,footer,[aria-hidden="true"],a[href="#main-content"]';

const HEADING_PREFIX = { h1: '#', h2: '##', h3: '###', h4: '####', h5: '#####', h6: '######' };

// Tags that force a block boundary. Used to decide whether a container holds
// prose (render it as one paragraph) or further structure (recurse into it).
const BLOCK_SELECTOR =
  'p,div,section,article,main,header,ul,ol,li,table,pre,blockquote,figure,dl,hr,h1,h2,h3,h4,h5,h6';

const collapse = (text) => text.replace(/\s+/g, ' ').trim();

const absolutize = (href, siteUrl) => (href.startsWith('/') ? `${siteUrl}${href}` : href);

const linkMarkdown = (anchor, siteUrl, precomputedLabel) => {
  const label = collapse(precomputedLabel ?? inlineText(anchor, siteUrl));
  const href = anchor.getAttribute('href');
  return href && label !== '' ? `[${label}](${absolutize(href, siteUrl)})` : label;
};

/**
 * True for a wrapper whose only children are elements — a flex/grid layout
 * container. Its children are visually separate lines but carry no whitespace
 * between them, so their text has to be joined with a space or labels run
 * together ("Quick StartGet up and running with Blok").
 */
const isLayoutContainer = (node) =>
  node.children.length > 1 &&
  [...node.childNodes].every((child) => child.nodeType !== 3 || (child.textContent ?? '').trim() === '');

/** Renders an element's inline content (links, code, emphasis) to one line. */
const inlineText = (node, siteUrl) => {
  const separator = isLayoutContainer(node) ? ' ' : '';
  let out = '';
  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      out += child.textContent ?? '';
      continue;
    }
    if (child.nodeType !== 1) continue;
    const tag = child.tagName.toLowerCase();
    const inner = inlineText(child, siteUrl);
    let rendered;
    if (tag === 'br') rendered = ' ';
    else if (tag === 'code') rendered = inner.trim() === '' ? '' : `\`${collapse(inner)}\``;
    else if (tag === 'a') rendered = linkMarkdown(child, siteUrl, inner);
    else if (tag === 'strong' || tag === 'b') rendered = inner.trim() === '' ? '' : `**${collapse(inner)}**`;
    else if (tag === 'em' || tag === 'i') rendered = inner.trim() === '' ? '' : `*${collapse(inner)}*`;
    else rendered = inner;
    // Block elements nested in inline context (card links) need the same
    // separation as stacked spans, for the same reason.
    out += separator || child.matches(BLOCK_SELECTOR) ? ` ${rendered} ` : rendered;
  }
  return out;
};

const renderTable = (table, siteUrl) => {
  const rows = [...table.querySelectorAll('tr')]
    .map((tr) => [...tr.querySelectorAll('th,td')].map((cell) => collapse(inlineText(cell, siteUrl))))
    .filter((cells) => cells.length > 0);
  if (rows.length === 0) return '';

  const [head, ...body] = rows;
  const line = (cells) => `| ${cells.join(' | ')} |`;
  return [line(head), line(head.map(() => '---')), ...body.map(line)].join('\n');
};

const renderList = (list, ordered, siteUrl) =>
  [...list.children]
    .filter((child) => child.tagName.toLowerCase() === 'li')
    .map((li, index) => {
      const marker = ordered ? `${index + 1}.` : '-';
      // A nested list inside the <li> is emitted by the recursive walk below,
      // so render the item's own prose and its sublists separately.
      const nested = [...li.children].filter((c) => /^(ul|ol)$/i.test(c.tagName));
      const own = li.cloneNode(true);
      [...own.children].filter((c) => /^(ul|ol)$/i.test(c.tagName)).forEach((c) => c.remove());
      const lines = [`${marker} ${collapse(inlineText(own, siteUrl))}`];
      for (const sub of nested) {
        const subMd = renderList(sub, sub.tagName.toLowerCase() === 'ol', siteUrl);
        lines.push(subMd.replace(/^/gm, '  '));
      }
      return lines.join('\n');
    })
    .filter((item) => item.trim() !== '-')
    .join('\n');

const visit = (element, out, siteUrl) => {
  for (const node of element.childNodes) {
    if (node.nodeType === 3) {
      const text = collapse(node.textContent ?? '');
      if (text) out.push(text);
      continue;
    }
    if (node.nodeType !== 1) continue;
    const tag = node.tagName.toLowerCase();

    if (HEADING_PREFIX[tag]) {
      const text = collapse(inlineText(node, siteUrl));
      if (text) out.push(`${HEADING_PREFIX[tag]} ${text}`);
      continue;
    }
    if (tag === 'pre') {
      const code = (node.textContent ?? '').replace(/\n+$/, '');
      if (code.trim()) out.push(`\`\`\`\n${code}\n\`\`\``);
      continue;
    }
    if (tag === 'table') {
      const md = renderTable(node, siteUrl);
      if (md) out.push(md);
      continue;
    }
    if (tag === 'ul' || tag === 'ol') {
      const md = renderList(node, tag === 'ol', siteUrl);
      if (md) out.push(md);
      continue;
    }
    if (tag === 'blockquote') {
      const text = collapse(inlineText(node, siteUrl));
      if (text) out.push(`> ${text}`);
      continue;
    }
    // `a` is checked before the recursion below because card links wrap block
    // elements; recursing into one would drop its href entirely.
    if (tag === 'a') {
      const text = collapse(linkMarkdown(node, siteUrl));
      if (text) out.push(text);
      continue;
    }
    if (tag === 'p' || node.querySelector(BLOCK_SELECTOR) === null) {
      const text = collapse(inlineText(node, siteUrl));
      if (text) out.push(text);
      continue;
    }
    visit(node, out, siteUrl);
  }
};

/**
 * Converts a prerendered page's DOM into markdown. Deriving the mirror from
 * what the components actually rendered (rather than re-templating the data)
 * is what stops the two drifting apart.
 *
 * @param {Element} root element whose subtree holds the page (usually `body`).
 * @param {{ siteUrl: string }} options
 * @returns {string}
 */
export const htmlToMarkdown = (root, { siteUrl }) => {
  const clone = root.cloneNode(true);
  clone.querySelectorAll(CHROME_SELECTOR).forEach((node) => node.remove());

  const blocks = [];
  visit(clone, blocks, siteUrl);
  return blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
};

const yamlString = (value) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** A single `.md` mirror: front matter an agent can read, then the page. */
export const renderMarkdownMirror = ({ title, description, source, lastmod, body }) =>
  [
    '---',
    `title: ${yamlString(title)}`,
    `description: ${yamlString(description)}`,
    `source: ${source}`,
    `lastmod: ${lastmod}`,
    '---',
    '',
    body,
    '',
  ].join('\n');

/**
 * llms.txt per llmstxt.org: H1, blockquote summary, then H2 sections of links.
 * Shipped as agent-readiness and as a Context7 ingestion input — Google has
 * stated it does not use the file, so it is not an SEO measure.
 */
export const renderLlmsIndex = ({ title, summary, sections }) => {
  const body = sections
    .map(({ heading, links }) =>
      [
        `## ${heading}`,
        '',
        ...links.map(({ title: linkTitle, url, description }) =>
          description ? `- [${linkTitle}](${url}): ${description}` : `- [${linkTitle}](${url})`,
        ),
      ].join('\n'),
    )
    .join('\n\n');

  return `# ${title}\n\n> ${summary}\n\n${body}\n`;
};

/** Every mirror in one file, for agents that fetch a single document. */
export const renderLlmsFull = ({ title, summary, documents }) =>
  `# ${title}\n\n> ${summary}\n\n---\n${documents.join('\n---\n')}\n`;
