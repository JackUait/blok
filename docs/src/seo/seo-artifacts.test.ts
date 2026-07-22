// Tests for the build-time SEO/agent artifact generator.
//
// The generator itself lives in docs/scripts/ (it is a postbuild step, not app
// code), but vitest only collects `src/**/*.test.ts` — hence the test living
// here next to the metadata module the generator consumes.
import { describe, expect, it } from 'vitest';
import {
  htmlToMarkdown,
  mirrorPathForRoute,
  renderLlmsFull,
  renderLlmsIndex,
  renderMarkdownMirror,
  renderSitemap,
} from '../../scripts/seo-artifacts.mjs';

const SITE_URL = 'https://blokeditor.com';

/** Stand-in for the real manifest: the generator is fed route+lastmod pairs. */
const FIXTURE_ENTRIES = [
  { loc: 'https://blokeditor.com/', lastmod: '2026-07-01' },
  { loc: 'https://blokeditor.com/docs/table', lastmod: '2026-07-20' },
  { loc: 'https://blokeditor.com/migration/reference', lastmod: '2026-06-11' },
];

const parseXml = (xml: string): Document =>
  new DOMParser().parseFromString(xml, 'application/xml');

const elementFrom = (html: string): HTMLElement => {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
};

describe('renderSitemap', () => {
  it('parses as XML with the sitemaps.org namespace', () => {
    const doc = parseXml(renderSitemap(FIXTURE_ENTRIES));

    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.documentElement.tagName).toBe('urlset');
    expect(doc.documentElement.getAttribute('xmlns')).toBe(
      'http://www.sitemaps.org/schemas/sitemap/0.9',
    );
  });

  it('emits exactly one absolute <loc> per entry, in the order given', () => {
    const doc = parseXml(renderSitemap(FIXTURE_ENTRIES));
    const locs = [...doc.querySelectorAll('url > loc')].map((node) => node.textContent);

    expect(locs).toEqual(FIXTURE_ENTRIES.map((entry) => entry.loc));
    for (const loc of locs) expect(loc?.startsWith(`${SITE_URL}/`)).toBe(true);
  });

  it('carries the lastmod it was given', () => {
    const doc = parseXml(renderSitemap(FIXTURE_ENTRIES));
    const lastmods = [...doc.querySelectorAll('url > lastmod')].map((n) => n.textContent);

    expect(lastmods).toEqual(['2026-07-01', '2026-07-20', '2026-06-11']);
  });

  it('omits priority and changefreq, which Google ignores', () => {
    const xml = renderSitemap(FIXTURE_ENTRIES);

    expect(xml).not.toContain('priority');
    expect(xml).not.toContain('changefreq');
  });

  it('escapes XML-significant characters in a loc', () => {
    const xml = renderSitemap([{ loc: 'https://blokeditor.com/a?b=1&c=2', lastmod: '2026-01-01' }]);

    expect(xml).toContain('https://blokeditor.com/a?b=1&amp;c=2');
    expect(parseXml(xml).querySelector('parsererror')).toBeNull();
  });
});

describe('mirrorPathForRoute', () => {
  it('maps every route to a sibling .md file', () => {
    expect(mirrorPathForRoute('/')).toBe('index.md');
    expect(mirrorPathForRoute('/demo')).toBe('demo.md');
    expect(mirrorPathForRoute('/docs/table')).toBe('docs/table.md');
    expect(mirrorPathForRoute('/migration/reference')).toBe('migration/reference.md');
  });

  it('keeps the locale tree separate', () => {
    expect(mirrorPathForRoute('/ru')).toBe('ru.md');
    expect(mirrorPathForRoute('/ru/docs/table')).toBe('ru/docs/table.md');
  });

  it('never produces the same file for two different routes', () => {
    const routes = [
      '/',
      '/docs',
      '/docs/table',
      '/tools',
      '/migration',
      '/migration/reference',
      '/ru',
      '/ru/docs/table',
    ];
    const files = routes.map(mirrorPathForRoute);

    expect(new Set(files).size).toBe(routes.length);
  });
});

describe('htmlToMarkdown', () => {
  const FIXTURE = `
    <nav><a href="/demo">Demo</a></nav>
    <main>
      <h1>Table block</h1>
      <p>Merged cells and <a href="/docs/paragraph">rich content</a>.</p>
      <h2>Config</h2>
      <ul><li>First</li><li>Second</li></ul>
      <pre class="shiki"><code>const a = 1;
const b = 2;</code></pre>
      <table>
        <thead><tr><th>Option</th><th>Type</th></tr></thead>
        <tbody><tr><td>withHeadings</td><td>boolean</td></tr></tbody>
      </table>
      <div><span>Wrapped</span> <strong>inline</strong> text</div>
    </main>
    <aside><a href="/docs/list">On this page</a></aside>
    <footer>Footer</footer>
    <script>console.log('x')</script>
  `;

  const markdown = () => htmlToMarkdown(elementFrom(FIXTURE), { siteUrl: SITE_URL });

  it('converts headings, paragraphs and lists', () => {
    const md = markdown();

    expect(md).toContain('# Table block');
    expect(md).toContain('## Config');
    expect(md).toContain('- First');
    expect(md).toContain('- Second');
  });

  it('converts code blocks into fences with the code intact', () => {
    expect(markdown()).toContain('```\nconst a = 1;\nconst b = 2;\n```');
  });

  it('converts tables into markdown tables', () => {
    const md = markdown();

    expect(md).toContain('| Option | Type |');
    expect(md).toContain('| --- | --- |');
    expect(md).toContain('| withHeadings | boolean |');
  });

  it('rewrites site-relative links to absolute URLs', () => {
    expect(markdown()).toContain('[rich content](https://blokeditor.com/docs/paragraph)');
  });

  it('keeps an inline-only container on one line', () => {
    expect(markdown()).toContain('Wrapped **inline** text');
  });

  it('drops navigation, sidebars, footers and scripts', () => {
    const md = markdown();

    expect(md).not.toContain('On this page');
    expect(md).not.toContain('Footer');
    expect(md).not.toContain('console.log');
    expect(md).not.toContain('](https://blokeditor.com/demo)');
  });

  it('returns an empty string for a page with no content', () => {
    expect(htmlToMarkdown(elementFrom('<nav>Nav</nav>'), { siteUrl: SITE_URL })).toBe('');
  });

  it('drops the visually-hidden skip link', () => {
    const md = htmlToMarkdown(
      elementFrom('<a href="#main-content">Skip to content</a><main><p>Real</p></main>'),
      { siteUrl: SITE_URL },
    );

    expect(md).toBe('Real');
  });

  it('separates block-level children instead of running their text together', () => {
    const md = htmlToMarkdown(
      elementFrom('<ul><li><a href="/docs/table"><div>Table</div><div>Merged cells.</div></a></li></ul>'),
      { siteUrl: SITE_URL },
    );

    expect(md).toBe('- [Table Merged cells.](https://blokeditor.com/docs/table)');
  });

  it('separates stacked spans in a layout container, which carry no whitespace', () => {
    const md = htmlToMarkdown(
      elementFrom('<a href="/docs/table"><span>Table</span><span>Merged cells.</span></a>'),
      { siteUrl: SITE_URL },
    );

    expect(md).toBe('[Table Merged cells.](https://blokeditor.com/docs/table)');
  });

  it('does not insert a space where the markup deliberately has none', () => {
    const md = htmlToMarkdown(elementFrom('<p>read the <code>save()</code> docs</p>'), {
      siteUrl: SITE_URL,
    });

    expect(md).toBe('read the `save()` docs');
  });

  it('keeps a card link whose label is built from block elements', () => {
    const md = htmlToMarkdown(
      elementFrom('<div><a href="/docs/list"><h3>List</h3><p>Ordered and unordered.</p></a></div>'),
      { siteUrl: SITE_URL },
    );

    expect(md).toBe('[List Ordered and unordered.](https://blokeditor.com/docs/list)');
  });
});

describe('renderMarkdownMirror', () => {
  const mirror = renderMarkdownMirror({
    title: 'Table Block — Merged Cells',
    description: 'How the table block stores merged cells.',
    source: 'https://blokeditor.com/docs/table',
    lastmod: '2026-07-20',
    body: '# Table block\n\nMerged cells.',
  });

  it('opens with YAML front matter carrying the canonical source', () => {
    expect(mirror.startsWith('---\n')).toBe(true);
    expect(mirror).toContain('source: https://blokeditor.com/docs/table');
    expect(mirror).toContain('lastmod: 2026-07-20');
  });

  it('quotes front-matter strings so a colon in a title cannot break the YAML', () => {
    expect(mirror).toContain('title: "Table Block — Merged Cells"');
    expect(mirror).toContain('description: "How the table block stores merged cells."');
  });

  it('ends with the page body', () => {
    expect(mirror.trimEnd().endsWith('# Table block\n\nMerged cells.')).toBe(true);
  });
});

describe('renderLlmsIndex', () => {
  const llms = renderLlmsIndex({
    title: 'Blok',
    summary: 'Headless block-based editor.',
    sections: [
      {
        heading: 'Getting started',
        links: [
          {
            title: 'Quick start',
            url: 'https://blokeditor.com/docs/quick-start',
            description: 'Install and mount an editor.',
          },
        ],
      },
      {
        heading: 'Blocks',
        links: [
          {
            title: 'Table',
            url: 'https://blokeditor.com/docs/table',
            description: 'Merged cells.',
          },
        ],
      },
    ],
  });

  it('follows the llms.txt shape: H1, blockquote summary, H2 link sections', () => {
    expect(llms.startsWith('# Blok\n')).toBe(true);
    expect(llms).toContain('> Headless block-based editor.');
    expect(llms).toContain('## Getting started');
    expect(llms).toContain('## Blocks');
  });

  it('lists every link as an absolute markdown link with its description', () => {
    expect(llms).toContain(
      '- [Quick start](https://blokeditor.com/docs/quick-start): Install and mount an editor.',
    );
    expect(llms).toContain('- [Table](https://blokeditor.com/docs/table): Merged cells.');
  });
});

describe('renderLlmsFull', () => {
  it('concatenates the mirrors under a single header, separated by rules', () => {
    const full = renderLlmsFull({
      title: 'Blok',
      summary: 'Headless block-based editor.',
      documents: ['# A\n\nalpha', '# B\n\nbeta'],
    });

    expect(full.startsWith('# Blok\n')).toBe(true);
    expect(full).toContain('> Headless block-based editor.');
    expect(full).toContain('# A\n\nalpha');
    expect(full).toContain('# B\n\nbeta');
    expect(full.split('\n---\n')).toHaveLength(3);
  });
});
