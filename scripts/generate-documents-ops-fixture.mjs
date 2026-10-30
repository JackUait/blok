// Generates test/unit/server-conformance/fixtures/documents/ops.json: what the
// server runtime bundle answers for each operation, from node:vm. The C#
// DocumentOpsFixtureTests (Jint) and the Go jsruntime tests (goja) run the same
// inputs through their engines and must give the same answers.
//
//   node scripts/generate-documents-ops-fixture.mjs [--out <file>]
//
// Inputs come from the C# Documents and Runtime tests plus edge cases.
// - A long input is a recipe: literal parts and repeats, `{i}` the index.
// - A long output is stored as the sha256 of its UTF-8 bytes.
// - Import ids carry the clock (`md-<base36>-N`), so every reader rewrites
//   them to `md-X-N` before comparing.
// - No bare-string output may hold a lone surrogate: Go strings cannot.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUNDLE = join(REPO_ROOT, 'packages/server/go/internal/jsruntime/blok-server-runtime.js');
const DEFAULT_OUT = join(REPO_ROOT, 'test/unit/server-conformance/fixtures/documents/ops.json');
const LONG = 20_000;
const LONG_INPUT = 100_000;

export const normalizeIds = (text) => text.replace(/"(md|html)-[a-z0-9]+-/g, '"$1-X-');

/** Expands a recipe: parts are strings or { repeat, join, items } with `{i}` the index. */
export const expandRecipe = (recipe) => recipe.parts.map((part) => {
  if (typeof part === 'string') {
    return part;
  }

  return Array.from({ length: part.repeat }, (_, i) => part.items[i % part.items.length].replaceAll('{i}', String(i)))
    .join(part.join);
}).join('');

const hasLoneSurrogate = (text) => /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(text);

const J = JSON.stringify;
/** A JSON string's text without its quotes, for building recipe templates. */
const inner = (text) => J(text).slice(1, -1);

const article = { blocks: [
  { id: 'h1', type: 'header', data: { text: 'Release notes', level: 2 } },
  { id: 'p1', type: 'paragraph', data: { text: 'Ships <b>today</b> — see <a href="https://x.com">details</a>.' } },
] };
const callout = { blocks: [
  { id: 'c1', type: 'callout', data: { emoji: '💡' } },
  { id: 'p1', type: 'paragraph', data: { text: 'Mind the gap' }, parent: 'c1' },
  { id: 's1', type: 'spacer', data: {} },
] };
const toc = { blocks: [
  { id: 'toc', type: 'table_of_contents', data: {} },
  { id: 'h1', type: 'header', data: { text: 'Intro', level: 2 } },
  { id: 'h2', type: 'header', data: { text: 'Details', level: 3 } },
] };
const media = { blocks: [
  { id: 'i1', type: 'image', data: { url: 'https://cdn/x.png', caption: 'A cat', alt: 'A tabby asleep' } },
  { id: 'b1', type: 'bookmark', data: { title: 'Blok', url: 'https://blokeditor.com', description: 'Block editor' } },
  { id: 'v1', type: 'paragraph', data: { text: '<a href="javascript:alert(1)">bad</a> <a href="https://ok.test">ok</a>' } },
] };
const pageDoc = { time: 1759670000000, version: '1.15.2', blocks: [
  { id: 'h1', type: 'header', data: { text: 'Roadmap <a href="#p2">jump</a>', level: 2 }, tunes: { anchor: { id: 'roadmap' } } },
  { id: 'p1', type: 'paragraph', data: { text: 'See <a data-blok-page-id="pg-ref" href="/p/pg-ref">Specs</a> &amp; <b>more</b>' } },
  { id: 'own1', type: 'page', data: { pageId: 'pg-child-a', title: 'Child A' } },
  { id: 'lnk', type: 'page-link', data: { pageId: 'pg-elsewhere' } },
  { id: 'tg', type: 'toggle', content: ['tgc', 'own2'], data: { text: 'Details' } },
  { id: 'tgc', type: 'paragraph', parent: 'tg', data: { text: 'Nested <a data-blok-page-id="pg-ref">again</a>' } },
  { id: 'own2', type: 'page', parent: 'tg', data: { pageId: 'pg-child-b' } },
  { id: 'q', type: 'quote', data: { text: 'Quoted', caption: 'by <a data-blok-page-id="pg-cap">Author</a>' } },
  { id: 'tbl', type: 'table', content: ['c1', 'c2'], data: { withHeadings: false, content: [[{ blocks: ['c1'] }, 'legacy <a data-blok-page-id="pg-cell-str">cell</a>'], [{ blocks: ['c2'], text: 'x' }, { blocks: [], text: 'Text <a data-blok-page-id="pg-cell-txt">t</a>' }]] } },
  { id: 'c1', type: 'paragraph', parent: 'tbl', data: { text: 'Cell one <a data-blok-page-id="pg-in-cell">c</a>' } },
  { id: 'c2', type: 'page', parent: 'tbl', data: { pageId: 'pg-child-c' } },
  { id: 'p2', type: 'paragraph', data: { text: 'Tail ünïcödé 日本' } },
  { type: 'paragraph', data: { text: 'idless legacy' } },
] };
const tabs = { blocks: [
  { id: 'tabs', type: 'tabs', data: {}, content: ['t1', 't2', 't3'] },
  { id: 't1', type: 'tab', data: { title: 'Fruit & <Veg>', icon: '🍎' }, parent: 'tabs', content: ['p1', 'pg'] },
  { id: 'p1', type: 'paragraph', data: { text: 'Body <b>one</b>' }, parent: 't1' },
  { id: 'pg', type: 'page', data: { pageId: 'page-1' }, parent: 't1' },
  { id: 't2', type: 'tab', data: { title: '' }, parent: 'tabs', content: ['p2'] },
  { id: 'p2', type: 'paragraph', data: { text: 'Body two' }, parent: 't2' },
  { id: 't3', type: 'tab', data: { title: 'Empty' }, parent: 'tabs' },
] };
const strayInToggle = { blocks: [
  { id: 'tg', type: 'toggle', data: { text: 'Tog' }, content: ['tabs', 'after'] },
  { id: 'tabs', type: 'tabs', data: {}, parent: 'tg', content: ['s1', 't1'] },
  { id: 's1', type: 'paragraph', data: { text: 'Stray' }, parent: 'tabs' },
  { id: 't1', type: 'tab', data: { title: 'Do' }, parent: 'tabs', content: ['p1'] },
  { id: 'p1', type: 'paragraph', data: { text: 'one' }, parent: 't1' },
  { id: 'after', type: 'paragraph', data: { text: 'After' }, parent: 'tg' },
] };
const strayInCell = { blocks: [
  { id: 'tbl', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['tabs'] }, { blocks: ['c2'] }]] }, content: ['tabs', 'c2'] },
  { id: 'tabs', type: 'tabs', data: {}, parent: 'tbl', content: ['s1', 't1'] },
  { id: 's1', type: 'paragraph', data: { text: 'STRAYTEXT' }, parent: 'tabs' },
  { id: 't1', type: 'tab', data: { title: 'Do' }, parent: 'tabs', content: ['p1'] },
  { id: 'p1', type: 'paragraph', data: { text: 'one' }, parent: 't1' },
  { id: 'c2', type: 'paragraph', data: { text: 'Two' }, parent: 'tbl' },
] };
const fullTable = { blocks: [
  { id: 'tb', type: 'table', content: ['p00', 'p01', 'p10', 'p11', 'p12'], data: {
    withHeadings: true, withHeadingColumn: true, stretched: true, colWidths: [120.5, 200, 333.25], initialColWidth: 217.75, textSize: 'comfortable',
    content: [
      [{ id: 'c0', rowId: 'r0', blocks: ['p00'], colspan: 2, color: 'blue', textColor: 'red', placement: 'middle-center' }, { id: 'c1', rowId: 'r0', blocks: [], mergedInto: [0, 0] }, { id: 'c2', rowId: 'r0', blocks: ['p01'], rowspan: 2 }],
      [{ id: 'c0', rowId: 'r1', blocks: ['p10', 'p11'] }, { id: 'c1', rowId: 'r1', blocks: ['p12'], placement: 'bottom-right' }, { id: 'c2', rowId: 'r1', blocks: [], mergedInto: [0, 2] }],
    ] } },
  { id: 'p00', type: 'paragraph', parent: 'tb', data: { text: 'origin' } },
  { id: 'p01', type: 'paragraph', parent: 'tb', data: { text: 'tall' } },
  { id: 'p10', type: 'paragraph', parent: 'tb', data: { text: 'first' } },
  { id: 'p11', type: 'paragraph', parent: 'tb', data: { text: 'second' } },
  { id: 'p12', type: 'paragraph', parent: 'tb', data: { text: 'xcell' } },
] };
const textCellTable = { blocks: [{ id: 'tb', type: 'table', data: {
  withHeadings: false, withHeadingColumn: false, colWidths: [10, 20, 30],
  content: [['plain a', { blocks: [], text: 'rich <b>b</b>', color: 'red' }, 'c'], [{ blocks: [], text: 'wide', colspan: 2 }, { blocks: [], mergedInto: [1, 0] }, 'f']],
} }] };
// Raw text: number spellings and escapes that a re-serializer could change.
const boundaryTable = '{"time":1700000000000,"version":"1.0.0","blocks":[{ "id": "tb", "type": "table", "tunes": { "x": null },'
  + '"data": { "withHeadings": false, "withHeadingColumn": false, "colWidths": [200, 120.125, 0.1, 1e3],"initialColWidth": 333.3333333333333,'
  + '"content": [["مرحبا بالعالم", { "blocks": [], "text": "😀 <b>a&amp;b</b> \\u2028 \\"q\\" \\\\ ", "color": null }],[{ "blocks": [], "text": "שלום", "colspan": 1 }, "\\u00e9\\u0301 z\\u200dw"]] } }]}';
const titled = { title: 'My page', icon: { type: 'emoji', value: '📄' }, ...article };
const imageTitled = { title: 'Pictured <b>', icon: { type: 'image', url: 'https://cdn/i.png' }, ...callout };
const malformed = '{"blocks":[{"id":"p1","type":"paragraph","data":{"text":"Kept"}},7,{"id":"p2","data":{"text":"No type"}},{"id":"p3","type":"","data":{}},{"id":"p4","type":"paragraph","data":[]},{"id":5,"type":"paragraph","data":{}}]}';
const unknownBlocks = { blocks: [...callout.blocks, { id: 'x', type: 'custom-tool', data: {} }, { id: 'd', type: 'divider', data: {} }, { id: 'o', type: 'org-chart', data: { text: 'hidden' } }] };
const parentAlias = { blocks: [
  { id: 'tg', type: 'toggle', data: { text: 'Parent' } },
  { id: 'c', type: 'paragraph', parentId: 'tg', data: { text: 'Child through parentId' } },
] };
const lone = '{"blocks":[{"id":"p","type":"paragraph","data":{"text":"a\\ud800b"}},{"id":"\\udc00","type":"header","data":{"text":"x\\udbff","level":2}}]}';
const nested = { blocks: Array.from({ length: 120 }, (_, d) => ({ id: `n${d}`, parent: d === 0 ? null : `n${d - 1}`, type: 'list', data: { style: 'unordered', text: `level ${d}` } })) };
const remapDoc = { time: 1759670000000, version: '1.15.2', blocks: [
  { id: 'h1', type: 'header', data: { text: 'Go <a href="#p2">down</a>', level: 2 }, tunes: { anchor: { id: 'top' } } },
  { id: 'own', type: 'page', data: { pageId: 'pg-a' }, custom: 'kept' },
  { id: 'p2', type: 'paragraph', data: { text: 'See <a data-blok-page-id="pg-ref">x</a>' } },
] };
const remapGaps = { blocks: [
  { id: 'a', type: 'paragraph', parent: 'gone', data: { text: '' } },
  { id: 'b', type: 'paragraph', data: { text: '' } },
  { type: 'paragraph', data: { text: 'idless' } },
  { id: 'co', type: 'callout', data: { body: { blocks: [{ id: 'nested', type: 'page', data: { pageId: 'p' } }] } } },
] };
const pages = {
  'pg-ref': { title: 'Specs', icon: { type: 'emoji', value: '📐' }, href: '/p/pg-ref' },
  'pg-elsewhere': { access: 'none' },
  'pg-child-a': null,
  'pg-cap': { title: 'Bad', href: 'javascript:alert(1)' },
  'pg-child-b': { icon: { type: 'image', url: 'https://cdn/b.png' }, title: '' },
  toString: { title: 'prototype key' },
};
const markdown = [
  '# Hello', '', 'A **bold** claim with `code`, a [link](https://x.com) and ~~strike~~.', '',
  '- a', '  - b', '', '1. one', '2. two', '', '- [x] done', '- [ ] todo', '',
  '| a | b |', '|---|---|', '| 1 | 2 |', '', '$$E = mc^2$$', '', 'inline $x^2$ math', '',
  '<div>raw html</div>', '', '```js', 'const a = 1;', '```', '', '> quote', '', '---', '',
  'Email <me@example.com>, auto <https://a.b>, &amp; &copy; &#x41; ü 日本 🍎', '',
  '[ref]: https://ref.example', 'see [ref] and [missing]', '', '![img](javascript:x)',
].join('\n');
const html = '<h1>Hi</h1><p>A <b>bold</b> <i>it</i> <a href="https://x">link</a> &amp; &nbsp;x</p>'
  + '<ul><li>a<ul><li>b</li></ul></li></ul><ol start="3"><li>c</li></ol>'
  + '<table><tr><th colspan="2">m</th></tr><tr><td>1</td><td rowspan="1">2</td></tr></table>'
  + '<pre><code class="language-ts">let x: number</code></pre><blockquote>q</blockquote><hr>'
  + '<details><summary>T</summary><p>body</p></details><img src="https://i/x.png" alt="alt">'
  + '<iframe src="https://evil"></iframe><input type="text"><svg><circle r="1"/></svg><unknown-el>u</unknown-el>';
const tableHtml = [
  '<table><tr><td><ul><li>outer<ul><li>inner</li></ul></li></ul></td></tr></table>',
  '<table><tr><td><p>one</p><p>two</p></td><td><pre><code>x = 1</code></pre></td></tr></table>',
  '<table><tr><td><div><table><tr><td>deep</td></tr></table></div></td></tr></table>',
  '<table><tr><td><h2>title</h2></td></tr></table>',
  '<table><tr><td><blockquote>quoted</blockquote><img src="https://x.test/a.png" alt="pic"></td></tr></table>',
  '<table><tr><td><section><div><table><tr><td>deep</td></tr></table></div></section></td></tr></table>',
  '<table><tr><td colspan="2">wide</td></tr><tr><td rowspan="2">tall</td><td>b</td></tr><tr><td>c</td></tr></table>',
];
const tableMarkdown = [
  '| a \\| b | c |\n| --- | --- |\n| d | `e \\| f` |\n',
  '| h1 | h2 |\n| --- | --- |\n| only one |\n',
  '| h1 |\n| --- |\n| x | overflow |\n',
];

// Long inputs from JintBlokRuntimeTests, as recipes.
const slovo = Array(30).fill('слово').join(' ');
const plainLine = 'An entirely ordinary paragraph with no markup at all inside it, ';
const markedLine = 'Ships <b>today</b> &amp; see <a href="https://example.com/a">the details</a>, ';
const paragraphItem = (text) => `{"id":"b{i}","type":"paragraph","data":{"text":${J(text)}}}`;
const longPlain = { parts: ['{"blocks":[', { repeat: 3600, join: ',', items: [paragraphItem(slovo)] }, ']}'] };
const longMarked = { parts: ['{"blocks":[', { repeat: 1800, join: ',', items: [
  `{"id":"b{i}","type":"paragraph","data":{"text":"${inner(markedLine.repeat(5))}paragraph {i}"}}`,
  `{"id":"b{i}","type":"paragraph","data":{"text":"${inner(plainLine.repeat(5))}paragraph {i}"}}`,
  `{"id":"b{i}","type":"paragraph","data":{"text":"${inner(plainLine.repeat(5))}paragraph {i}"}}`,
] }, ']}'] };
const bigUrl = (type, prefix) => ({ parts: [
  `{"blocks":[{"id":"u1","type":"${type}","data":{"url":"${prefix}`, { repeat: 3 * 1024 * 1024, join: '', items: ['A'] }, '"}}]}',
] });
const bigMarkdown = { parts: ['{"markdown":"', { repeat: 200, join: '\\n\\n', items: [inner(markdown)] }, '"}'] };
const envelope = (inside, extra) => ({ parts: ['{"document":', ...inside.parts, extra] });

const documents = {
  article, callout, toc, media, pageDoc, tabs, strayInToggle, strayInCell, fullTable, textCellTable,
  titled, imageTitled, unknownBlocks, parentAlias, nested, remapDoc,
};

const prototypeTypes = ['constructor', 'toString', '__proto__', 'x-unknown'];

/** Every case, built with the bundle's own answers where an input depends on one. */
const buildCases = async (invoke) => {
  const cases = [];
  const add = (name, op, input) => cases.push(typeof input === 'string' ? { name, op, input } : { name, op, inputRecipe: input });
  const docText = (doc) => (typeof doc === 'string' ? doc : J(doc));
  const docNode = (doc) => (typeof doc === 'string' ? JSON.parse(doc) : doc);

  add('version', 'version', '{}');
  add('schema', 'schema', '{}');
  add('manifest', 'manifest', '{}');

  for (const [name, doc] of [...Object.entries(documents), ['malformed', malformed], ['boundaryTable', boundaryTable]]) {
    const text = docText(doc);
    const node = docNode(doc);

    add(`${name}.markdown`, 'blocksToMarkdown', text);
    add(`${name}.html`, 'blocksToHtml', text);
    add(`${name}.text`, 'blocksToPlainText', text);
    add(`${name}.text.hidden`, 'blocksToPlainText', J({ document: node, includeHiddenText: true }));
    add(`${name}.report`, 'blocksToPlainTextWithReport', J({ document: node, includeHiddenText: false }));
    add(`${name}.inspect`, 'inspect', text);
    add(`${name}.extract`, 'extractTexts', J({ document: node, includeCode: false }));
    add(`${name}.extract.code`, 'extractTexts', J({ document: node, includeCode: true }));
    add(`${name}.pageIndex`, 'pageIndex', J({ document: node }));
    add(`${name}.markdown.title`, 'blocksToMarkdown', J({ document: node, title: true }));
    add(`${name}.html.title`, 'blocksToHtml', J({ document: node, title: true }));
    add(`${name}.text.title`, 'blocksToPlainText', J({ document: node, includeHiddenText: false, title: true }));
    add(`${name}.html.pages`, 'blocksToHtmlWithPages', J({ document: node, pages }));
    add(`${name}.markdown.pages.title`, 'blocksToMarkdownWithPages', J({ document: node, pages, title: true }));

    const texts = JSON.parse(await invoke('extractTexts', J({ document: node, includeCode: true })));
    add(`${name}.inject`, 'injectTexts', J({ document: node, includeCode: true, texts: texts.map((t) => `«${t}»`) }));
    add(`${name}.inject.same`, 'injectTexts', J({ document: node, includeCode: false, texts: JSON.parse(await invoke('extractTexts', J({ document: node, includeCode: false }))) }));

    const ids = Object.fromEntries((node.blocks ?? []).flatMap((b) => (typeof b?.id === 'string' ? [[b.id, `N-${b.id}`]] : [])));
    const index = JSON.parse(await invoke('pageIndex', J({ document: node })));
    const pageIds = Object.fromEntries([...index.owners, ...index.references].map((row) => [row.pageId, `P-${row.pageId}`]));
    add(`${name}.remap`, 'remapPageDocument', J({ document: node, blockIds: ids, pageIds }));

    const html = await invoke('blocksToHtml', text);
    add(`${name}.html.reimport`, 'htmlToBlocks', J({ html }));
    const md = JSON.parse(await invoke('blocksToMarkdown', text)).markdown;
    add(`${name}.markdown.reimport`, 'markdownToBlocks', J({ markdown: md }));
  }

  add('pages.bare.ignored', 'blocksToHtml', J({ ...pageDoc, pages }));
  add('pages.envelope.on.bare.op', 'blocksToHtml', J({ document: pageDoc, pages }));
  for (const type of prototypeTypes) {
    add(`pageIndex.type.${type}`, 'pageIndex', J({ document: { blocks: [{ id: 'b', type, data: { text: 'Own text' } }] } }));
  }
  add('remap.gaps', 'remapPageDocument', J({ document: remapGaps, blockIds: { a: 'X', b: 'X', co: 'CO' }, pageIds: {} }));
  add('remap.missing', 'remapPageDocument', J({ document: { blocks: [{ id: 'm', type: 'paragraph' }] }, blockIds: {}, pageIds: {} }));
  add('remap.duplicate', 'remapPageDocument', J({ document: { blocks: [{ id: 'x', type: 'paragraph' }, { id: 'a', type: 'paragraph' }] }, blockIds: { x: 'A', a: 'A' }, pageIds: {} }));
  add('remap.idless', 'remapPageDocument', J({ document: { blocks: [{ type: 'paragraph' }, { type: 'paragraph' }] }, blockIds: {}, pageIds: {} }));
  add('remap.badMap', 'remapPageDocument', J({ document: remapDoc, blockIds: [], pageIds: {} }));
  add('remap.nonStringValues', 'remapPageDocument', J({ document: remapDoc, blockIds: { h1: 1, own: 'OWN', p2: 'P2' }, pageIds: {} }));
  add('inject.mismatch', 'injectTexts', J({ document: article, texts: ['one'] }));
  add('inject.nonString', 'injectTexts', J({ document: article, texts: [1, 2] }));
  add('pageIndex.noBlocks', 'pageIndex', J({ document: { notBlocks: [] } }));
  add('lone.extract.raw', 'extractTexts', `{"document":${lone},"includeCode":false}`);
  add('lone.inspect', 'inspect', lone);
  add('lone.markdown', 'blocksToMarkdown', lone);
  add('lone.pageIndex', 'pageIndex', `{"document":${lone}}`);
  add('lone.inject', 'injectTexts', `{"document":${lone},"includeCode":false,"texts":["\\ud801","y\\udfff"]}`);
  add('fromMarkdown', 'markdownToBlocks', J({ markdown }));
  add('fromHtml', 'htmlToBlocks', J({ html }));
  tableHtml.forEach((source, i) => add(`fromHtml.table.${i}`, 'htmlToBlocks', J({ html: source })));
  tableMarkdown.forEach((source, i) => add(`fromMarkdown.table.${i}`, 'markdownToBlocks', J({ markdown: source })));
  add('fromMarkdown.math', 'markdownToBlocks', J({ markdown: 'Inline $a^2$ and\n\n$$\\int_0^1 x\\,dx$$\n' }));
  add('fromMarkdown.notString', 'markdownToBlocks', J({ markdown: 1 }));
  add('fromHtml.notString', 'htmlToBlocks', J({ html: null }));
  add('segments', 'htmlFieldsToSegments', '[{"id":"a","type":"paragraph","field":"text","html":"Hi <b>there</b>"},{"type":"header","field":"text","html":"a &lt; b &amp;&amp; <img src=\\"x.png\\">"}]');
  add('err.notjson', 'blocksToHtml', 'not json');
  add('err.noblocks', 'blocksToMarkdown', '{"nope":1}');
  add('err.notRecord', 'blocksToPlainText', '[1,2]');
  add('err.unknownop', 'nope', '{}');
  add('err.emptyop', '', '{}');

  add('big.plain.text', 'blocksToPlainText', longPlain);
  add('big.plain.markdown', 'blocksToMarkdown', longPlain);
  add('big.plain.html', 'blocksToHtml', longPlain);
  add('big.marked.text', 'blocksToPlainText', longMarked);
  add('big.marked.markdown', 'blocksToMarkdown', longMarked);
  add('big.marked.html', 'blocksToHtml', longMarked);
  add('big.marked.pageIndex', 'pageIndex', envelope(longMarked, '}'));
  add('big.marked.extract', 'extractTexts', envelope(longMarked, ',"includeCode":false}'));
  add('big.url.image.markdown', 'blocksToMarkdown', bigUrl('image', 'data:image/png;base64,'));
  add('big.url.bookmark.markdown', 'blocksToMarkdown', bigUrl('bookmark', 'https://example.com/?q='));
  add('big.fromMarkdown', 'markdownToBlocks', bigMarkdown);

  return cases;
};

const IMPORT_OPS = new Set(['markdownToBlocks', 'htmlToBlocks']);
const BARE_STRING_OPS = new Set(['blocksToHtml', 'blocksToHtmlWithPages', 'blocksToPlainText', 'version', 'schema']);

const loadInvoke = (source) => {
  const sandbox = {};

  runInContext(source, createContext(sandbox));

  return async (op, input) => sandbox.blokServerInvoke(op, input);
};

/** Builds the fixture from the bundle at bundlePath. */
export const generate = async (bundlePath = BUNDLE) => {
  const invoke = loadInvoke(readFileSync(bundlePath, 'utf8'));
  const cases = await buildCases(invoke);
  const names = new Set();

  for (const entry of cases) {
    if (names.has(entry.name)) {
      throw new Error(`duplicate case ${entry.name}`);
    }
    names.add(entry.name);

    const input = entry.input ?? expandRecipe(entry.inputRecipe);

    if (entry.input !== undefined && entry.input.length > LONG_INPUT) {
      throw new Error(`${entry.name}: an input this long must be a recipe`);
    }
    if (IMPORT_OPS.has(entry.op)) {
      entry.normalizeIds = true;
    }

    let output;

    try {
      output = await invoke(entry.op, input);
    } catch (error) {
      // A bundle error comes from the vm's own realm, so it is no host Error.
      entry.errorName = error.name;
      continue;
    }
    if (BARE_STRING_OPS.has(entry.op) && hasLoneSurrogate(output)) {
      throw new Error(`${entry.name}: a bare-string output holds a lone surrogate, which Go cannot carry`);
    }
    if (entry.normalizeIds) {
      output = normalizeIds(output);
    }
    if (output.length > LONG) {
      entry.outputSha256 = createHash('sha256').update(output, 'utf8').digest('hex');
    } else {
      entry.output = output;
    }
  }

  return cases;
};

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const outFlag = process.argv.indexOf('--out');
  const out = outFlag === -1 ? DEFAULT_OUT : process.argv[outFlag + 1];
  const cases = await generate();

  writeFileSync(out, `${JSON.stringify(cases, null, 2)}\n`);
  console.log(`${cases.length} cases -> ${out}`);
}
