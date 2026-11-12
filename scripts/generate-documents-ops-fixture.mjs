// Generates test/unit/server-conformance/fixtures/documents/ops.json: what the
// server runtime bundle answers for each operation, from node:vm. The C#
// DocumentOpsFixtureTests (Jint) and the Go jsruntime tests (goja) run the same
// inputs through their engines and must give the same answers.
//
//   node scripts/generate-documents-ops-fixture.mjs [--out <file>]
//
// Inputs come from the C# Documents and Runtime tests plus edge cases.
// - A long input is a recipe: literal parts and repeats, `{i}` the index,
//   `{i1}` the index plus one.
// - A long output is stored as the sha256 of its UTF-8 bytes.
// - Import ids carry the clock (`md-<base36>-N`), so every reader rewrites
//   them to `md-X-N` before comparing.
// - No bare-string output may hold a lone surrogate: Go strings cannot.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUNDLE = join(REPO_ROOT, 'packages/server/go/internal/jsruntime/blok-server-runtime.js');
const DEFAULT_OUT = join(REPO_ROOT, 'test/unit/server-conformance/fixtures/documents/ops.json');
const LONG = 20_000;
const LONG_INPUT = 100_000;

export const normalizeIds = (text) => text.replace(/"(md|html)-[a-z0-9]+-/g, '"$1-X-');

/** Expands a recipe: parts are strings or { repeat, join, items } with `{i}` the index and `{i1}` the index plus one. */
export const expandRecipe = (recipe) => recipe.parts.map((part) => {
  if (typeof part === 'string') {
    return part;
  }

  return Array.from({ length: part.repeat }, (_, i) => part.items[i % part.items.length].replaceAll('{i}', String(i)).replaceAll('{i1}', String(i + 1)))
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
  { id: 'c1', type: 'callout', data: { emoji: '🔥' } },
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
// Raw text, because J() cannot write a repeated key. JSON.parse keeps the
// LAST value at the FIRST key's position; Jint needs the host to do that.
const repeated = '{"blocks":[{"id":"p","type":"paragraph","type":"header","data":{"text":"a","text":"b","level":2}}]}';
const repeatedRoot = '{"blocks":1,"blocks":[{"id":"p","type":"paragraph","data":{"text":"x"}}]}';
const repeatedOrder = '{"blocks":[{"id":"p","type":"paragraph","data":{"text":"a","b":{"x":1},"t\\u0065xt":"c","b":7}}]}';
const repeatedAgentDoc = '{"blocks":[{"id":"p","type":"paragraph","data":{"text":"one"}}]}';
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
const bigUrlOf = (type, prefix, mib) => ({ parts: [
  `{"blocks":[{"id":"u1","type":"${type}","data":{"url":"${prefix}`, { repeat: mib * 1024 * 1024, join: '', items: ['A'] }, '"}}]}',
] });
// An outline nested `levels` deep: each list block is the previous one's child.
const outline = (levels) => ({ parts: [
  '{"blocks":[{"id":"n0","parent":null,"type":"list","data":{"style":"unordered","text":"level 0"}}',
  { repeat: levels - 1, join: '', items: [',{"id":"n{i1}","parent":"n{i}","type":"list","data":{"style":"unordered","text":"level {i1}"}}'] },
  ']}',
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
  add('lone.inspect.type', 'inspect', '{"blocks":[{"type":"\\udc00","data":{}}]}');
  add('repeated.html', 'blocksToHtml', repeated);
  add('repeated.markdown', 'blocksToMarkdown', repeated);
  add('repeated.text', 'blocksToPlainText', repeated);
  add('repeated.text.envelope', 'blocksToPlainText', '{"document":{"blocks":[],"blocks":[{"id":"p","type":"paragraph","data":{"text":"x","text":"y"}}]},"includeHiddenText":false}');
  add('repeated.inspect', 'inspect', repeated);
  add('repeated.root.html', 'blocksToHtml', repeatedRoot);
  add('repeated.root.markdown', 'blocksToMarkdown', repeatedRoot);
  add('repeated.root.text', 'blocksToPlainText', repeatedRoot);
  add('repeated.order.inject', 'injectTexts', `{"document":${repeatedOrder},"includeCode":false,"texts":["z"]}`);
  add('repeated.agent', 'agentExecute', `{"services":[],"document":${repeatedAgentDoc},"batch":{"commands":[],"commands":[{"name":"block.update","name":"doc.read","args":{}}]},"actor":{"id":"agent-x","name":"Agent","kind":"agent"}}`);
  // MCP operations (docs/plans/2026-11-06-csharp-mcp-research/08-bundle-contract.md). No case stamps a time.
  const mcpActor = { id: 'agent:alice:Desk', name: 'Desk (for alice)', kind: 'agent', onBehalfOf: 'alice' };
  const mcpStored = { source: true, mode: 'stored', write: true };
  const mcpDoc = { title: 'Notes <é> \u2028 😀', blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'Hello & <b>world</b>' } }] };
  const lockedDb = { blocks: [{ id: 'db', type: 'database', content: [], data: {
    title: 'Payroll', activeViewId: 'v',
    schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0', databaseLocked: true }],
    views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
  } }] };
  add('mcp.surface.default', 'mcpSurface', J({ source: true }));
  add('mcp.surface.pageMap.live', 'mcpSurface', J({ pageTitles: 'page-map', sync: true, source: true, uploads: true, comments: false, schema: 'full', handleIdleMs: 90500 }));
  add('mcp.prompt', 'mcpPrompt', J({ name: 'improve', arguments: { selection: 'Teh "cat"', blockId: 'b1', documentId: 'doc é' } }));
  add('mcp.prompt.unknown', 'mcpPrompt', J({ name: 'nope' }));
  add('mcp.parseArgs.number', 'mcpParseArgs', J({ argv: ['--handle-idle-ms', '0x10', '--max-handles', '1e3', '--source', 'files:./d'], env: {} }));
  add('mcp.parseArgs.emptyEnv', 'mcpParseArgs', J({ argv: [], env: { BLOK_MCP_HTTP: '', BLOK_SYNC_URL: '', BLOK_SECRET: '' } }));
  add('mcp.parseArgs.refused', 'mcpParseArgs', J({ argv: ['--http', '--public'], env: {} }));
  add('mcp.checkOptions', 'mcpCheckOptions', J({ options: { transport: { kind: 'http', listen: '0.0.0.0:1' }, auth: { kind: 'none' } } }));
  add('mcp.configFile', 'mcpConfigFile', J({ kind: 'overrides', value: { paragraph: { nope: 1 } } }));
  add('mcp.checkCall.refused', 'mcpCheckCall', J({ name: 'blok_open', arguments: { zzz: 1 }, scopes: null }));
  add('mcp.checkCall.execute', 'mcpCheckCall', J({ name: 'blok_execute', arguments: { handle: 'h', commands: [{ name: 'doc.read', args: {} }] }, scopes: ['blok.write'] }));
  add('mcp.checkCall.page', 'mcpCheckCall', J({ name: 'blok_read', arguments: { handle: 'h', page: 'p' }, scopes: null }));
  add('mcp.listAnswer', 'mcpListAnswer', J({ request: { query: 'z', limit: 5 }, listing: { documents: [], nextCursor: null, supported: true } }));
  add('mcp.pickDocument', 'mcpPickDocument', J({ find: { query: 'notes' }, listing: { documents: [{ id: 'x', title: ' Notes ', live: false }], nextCursor: null, supported: true } }));
  add('mcp.openAnswer', 'mcpOpenAnswer', J({ handle: 'h', session: { mode: 'stored', write: true, durability: 'saved-on-execute', contractRevision: 'c', exists: false }, expiresAfterIdleMs: 600000, found: { documentId: 'd', title: null } }));
  add('mcp.errorAnswer.execute', 'mcpErrorAnswer', J({ tool: 'blok_execute', helper: 'surface', error: { code: 'HANDLE_LIMIT', message: 'Too many.' } }));
  add('mcp.resolveMode', 'mcpResolveMode', J({ requested: 'stored', sync: true }));
  add('mcp.actor', 'mcpActor', J({ principal: 'alice', clientName: 'Claude 😀 Desktop' }));
  add('mcp.fileIds', 'mcpFileIds', J({ names: ['b.json', 'A.json', 'a.json', '.x.json', 'nul.json', 'é.json', 'n.txt'] }));
  add('mcp.filesList', 'mcpFilesList', J({ entries: [{ id: 'A', text: '{"title":"Alpha","blocks":[]}' }, { id: 'b', text: 'nope' }, { id: 'c', text: null }], query: 'ALP', limit: 5 }));
  add('mcp.parseDocument.bom', 'mcpParseDocument', J({ id: 'doc', text: '\ufeff{"blocks":[]}' }));
  add('mcp.documentText', 'mcpDocumentText', J({ document: mcpDoc, form: 'file' }));
  add('mcp.roomError', 'mcpRoomError', J({ terminal: 'handshake-timeout' }));
  add('mcp.read', 'mcpRead', J({ mcp: mcpStored, document: mcpDoc, actor: mcpActor, view: { detail: 'full' } }));
  add('mcp.describe', 'mcpDescribe', J({ mcp: mcpStored, document: mcpDoc, actor: mcpActor, query: { tool: 'paragraph' } }));
  add('mcp.execute.title', 'agentExecute', J({ mcp: mcpStored, document: mcpDoc, actor: mcpActor, documentText: 'file', batch: { commands: [{ name: 'doc.setTitle', args: { title: 'Plan <x> \u2028' } }] } }));
  add('mcp.execute.readOnly', 'agentExecute', J({ mcp: { ...mcpStored, write: false }, document: mcpDoc, actor: mcpActor, batch: { commands: [{ name: 'doc.setTitle', args: { title: 'T' } }] } }));
  add('mcp.execute.ask', 'agentExecute', J({ mcp: mcpStored, document: lockedDb, actor: mcpActor, approval: { capabilities: { elicitation: {} }, clientName: 'Desk' }, batch: { commands: [{ name: 'database.setLock', args: { id: 'db', locked: false } }] } }));
  add('mcp.execute.noCommands', 'agentExecute', J({ mcp: mcpStored, document: mcpDoc, actor: mcpActor, batch: {} }));
  add('mcp.pagesNeeded.approved', 'agentPagesNeeded', J({
    mcp: { ...mcpStored, pageTitles: 'page-map' }, document: lockedDb, actor: mcpActor,
    approval: { capabilities: { elicitation: {} }, clientName: 'Desk', replies: { '["database.unlock","db","Payroll"]': { action: 'accept', content: { unlock: true } } } },
    batch: { commands: [{ name: 'block.insert', args: { type: 'page', id: 'np0', position: 'end' } }, { name: 'database.setLock', args: { id: 'db', locked: false } }] },
  }));
  // A reply that is not a bare result object is dropped, as the SDK drops it, so the question comes again.
  add('mcp.execute.askAgain', 'agentExecute', J({ mcp: mcpStored, document: lockedDb, actor: mcpActor, approval: { capabilities: { elicitation: {} }, clientName: 'Desk', replies: { [J(['database.unlock', 'db', 'Payroll'])]: 'yes' } }, batch: { commands: [{ name: 'database.setLock', args: { id: 'db', locked: false } }] } }));
  add('mcp.pagesNeeded.prepared', 'agentPagesNeeded', J({
    mcp: { ...mcpStored, pageTitles: 'page-map' }, document: mcpDoc, actor: mcpActor,
    batch: { commands: [{ name: 'block.insert', args: { type: 'page', id: 'np0', data: { title: 'x' } } }] },
  }));
  // A comment batch is no undo step, so the history it hands back is empty. deleteComment: no clock, no minted id.
  add('agent.history.comment', 'agentExecute', J({
    services: [], actor: { id: 'agent-x', name: 'Agent', kind: 'agent' }, history: {},
    document: { blocks: [
      { id: 'db', type: 'database', content: ['r1'], data: {
        title: 'Payroll', activeViewId: 'v',
        schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }],
        views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      } },
      { id: 'r1', type: 'database-row', parent: 'db', content: ['c1'], data: { properties: {} } },
      { id: 'c1', type: 'database-comment', parent: 'r1', data: { text: 'a note', createdAt: 1, authorId: 'agent-x' } },
    ] },
    batch: { commands: [{ name: 'database.deleteComment', args: { id: 'db', commentId: 'c1' } }] },
  }));
  // notion-motion.md Round 13 filter operators: an ID emptiness check, an End date side and a rollup quantifier.
  // The server reads them back as saved. A write would stamp the clock, so this case only reads.
  add('agent.read.filterOperators', 'agentExecute', J({
    services: [], actor: { id: 'agent-x', name: 'Agent', kind: 'agent' },
    document: { blocks: [{ id: 'db', type: 'database', content: [], data: {
      title: 'Tasks', activeViewId: 'v',
      schema: [
        { id: 't', name: 'Name', type: 'title', position: 'a0' },
        { id: 'uid', name: 'ID', type: 'uniqueId', position: 'a1' },
        { id: 'due', name: 'Due', type: 'date', position: 'a2' },
        { id: 'rel', name: 'Related', type: 'relation', position: 'a3', relation: { targetDatabaseId: 'db' } },
        { id: 'names', name: 'Names', type: 'rollup', position: 'a4', rollup: { relationPropertyId: 'rel', targetPropertyId: 't', function: 'show_original' } },
      ],
      views: [{
        id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], visibleProperties: [],
        filters: [
          { id: 'f1', propertyId: 'uid', operator: 'is_empty', value: null },
          { id: 'f2', propertyId: 'due', operator: 'end:before', value: '2026-10-07' },
        ],
        filterTree: { id: 'g', conjunction: 'and', filterRules: [{ id: 'f3', propertyId: 'names', operator: 'none:starts_with', value: 'x' }] },
      }],
    } }] },
    batch: { commands: [{ name: 'doc.read', args: { ids: ['db'], detail: 'full' } }] },
  }));
  // The host could not make the second page: the batch fails at that insert with the host's error, the first page orphaned.
  add('mcp.execute.pageFailure', 'agentExecute', J({
    mcp: { ...mcpStored, pageTitles: 'page-map' }, document: mcpDoc, actor: mcpActor, createdPages: ['host-a'],
    createPageFailure: { helper: 'surface', error: { code: 'FORBIDDEN', message: 'You may not create a page document here.', details: { pageId: 'host-b' } } },
    batch: { commands: [{ name: 'doc.setTitle', args: { title: 'T' } }, { name: 'block.insert', args: { type: 'page', id: 'np0' } }, { name: 'block.insert', args: { type: 'page', id: 'np1' } }] },
  }));
  // A host that cannot wait mid-batch runs each upload call between agentExecute calls.
  const uploadBatch = { commands: [{ name: 'image.uploadFile', args: { path: 'cat.png' } }] };
  add('mcp.execute.upload.read', 'agentExecute', J({ mcp: { ...mcpStored, uploads: true }, document: mcpDoc, actor: mcpActor, batch: uploadBatch, uploads: { root: true, answers: [] } }));
  add('mcp.execute.upload.send', 'agentExecute', J({ mcp: { ...mcpStored, uploads: true }, document: mcpDoc, actor: mcpActor, batch: uploadBatch, uploads: { root: true, answers: [{ name: 'cat.png', size: 9 }] } }));
  // A thrown upload: the host's own text never reaches the agent.
  add('mcp.execute.upload.thrown', 'agentExecute', J({ mcp: { ...mcpStored, uploads: true }, document: mcpDoc, actor: mcpActor, batch: uploadBatch, uploads: { root: true, answers: [{ name: 'cat.png', size: 9 }, { error: 'connect ECONNREFUSED db.internal:5432 (password=hunter2)' }] } }));

  const pageMapStored = { ...mcpStored, pageTitles: 'page-map' };
  const withPageBlock = { blocks: [{ id: 'pb', type: 'page', data: { pageId: 'child é' } }] };
  const renamePb = { commands: [{ name: 'page.rename', args: { id: 'pb', title: 'New <name>' } }] };
  add('mcp.pagesNeeded.write', 'agentPagesNeeded', J({ mcp: pageMapStored, document: withPageBlock, actor: mcpActor, batch: renamePb }));
  add('mcp.execute.pageWrite', 'agentExecute', J({
    mcp: pageMapStored, document: withPageBlock, actor: mcpActor, batch: renamePb,
    pageWrites: [{ pageId: 'child é', result: { ok: true, revision: 'r', results: [{}], warnings: [] } }],
  }));
  add('mcp.execute.pageWriteRefused', 'agentExecute', J({
    mcp: pageMapStored, document: withPageBlock, actor: mcpActor, batch: { commands: [{ name: 'page.setIcon', args: { id: 'pb', icon: { type: 'emoji', value: '😀' } } }] },
    pageWrites: [{ pageId: 'child é', error: { code: 'FORBIDDEN', message: 'No.', retryable: false } }],
  }));
  add('mcp.execute.pageWriteStale', 'agentExecute', J({ mcp: pageMapStored, document: withPageBlock, actor: mcpActor, batch: renamePb, pageWrites: [] }));
  add('mcp.richTextFields', 'mcpRichTextFields', J({
    manifest: { formatVersion: 1, blocks: [{ name: 'note_x', description: { summary: 'A note.', data: { type: 'object' } }, statics: {
      toolbox: [], richTextFields: ['body', 'é'], acceptsChildren: false, ownsChildren: false, isLayout: false, deletesChildren: false,
      selfPlacesChildren: false, restrictedInTableCell: false, conversion: {}, convertible: { import: false, export: false }, hasPrepareInsert: false,
    } }] },
    richTextFields: { widget: ['caption'], paragraph: ['nope'] }, sync: true, source: true,
  }));
  // No answer from the sync server: the host says a retry can help, as Node's fetch error does.
  add('mcp.execute.historyUnreachable', 'agentExecute', J({
    mcp: { ...mcpStored, sync: true, mode: 'live' }, document: mcpDoc, actor: mcpActor,
    versionHistory: { failed: 'The sync server could not be reached: connection refused', retryable: true },
    batch: { commands: [{ name: 'history.versions', args: {} }] },
  }));
  add('mcp.execute.liveRevision', 'agentExecute', J({ mcp: { ...mcpStored, sync: true, mode: 'live' }, document: mcpDoc, actor: mcpActor, revision: { now: 'l4', afterWrite: 'l5' }, batch: { commands: [{ name: 'doc.setTitle', args: { title: 'T' } }, { name: 'doc.read', args: {} }], expectRevision: 'l4' } }));
  add('mcp.executeAnswer', 'mcpExecuteAnswer', J({ result: { ok: true, revision: 'r', results: [{}], refs: {}, changed: { created: [], updated: ['p1'], moved: [], removed: [] }, warnings: [] }, delivery: { durable: true, pending: false, serverSequence: null, savedVersion: 'v' } }));
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
  // C# converts these at its default budget, so every server must (C# stops
  // a 28 MiB bookmark, a 64 MiB image to Markdown and 48 MiB to HTML, and
  // 2400 HTML levels; on a cold first call it stops plain text at 7000
  // levels, deeper once warm).
  add('big.default.bookmark.24mib.markdown', 'blocksToMarkdown', bigUrlOf('bookmark', 'https://example.com/?q=', 24));
  add('big.default.image.56mib.markdown', 'blocksToMarkdown', bigUrlOf('image', 'data:image/png;base64,', 56));
  add('big.default.image.40mib.html', 'blocksToHtml', bigUrlOf('image', 'data:image/png;base64,', 40));
  add('big.default.image.32mib.text', 'blocksToPlainText', bigUrlOf('image', 'data:image/png;base64,', 32));
  add('big.default.outline.2300.html', 'blocksToHtml', outline(2300));
  add('big.default.outline.1400.markdown', 'blocksToMarkdown', outline(1400));
  add('big.default.outline.6000.text', 'blocksToPlainText', outline(6000));

  return cases;
};

const IMPORT_OPS = new Set(['markdownToBlocks', 'htmlToBlocks']);
const BARE_STRING_OPS = new Set(['blocksToHtml', 'blocksToHtmlWithPages', 'blocksToPlainText', 'version', 'schema']);

// The bundle runs on a worker with a deep stack: the deep outline cases
// recurse past the main thread's.
const WORKER = `
const { parentPort, workerData } = require('node:worker_threads');
const { createContext, runInContext } = require('node:vm');
const sandbox = {};
runInContext(workerData, createContext(sandbox));
parentPort.on('message', async ({ id, op, input }) => {
  try {
    parentPort.postMessage({ id, output: await sandbox.blokServerInvoke(op, input) });
  } catch (error) {
    parentPort.postMessage({ id, errorName: error.name });
  }
});`;

const loadInvoke = (source) => {
  const worker = new Worker(WORKER, { eval: true, workerData: source, resourceLimits: { stackSizeMb: 64 } });
  const waiting = new Map();
  let next = 0;

  worker.unref();
  worker.on('message', ({ id, output, errorName }) => {
    const { resolve, reject } = waiting.get(id);

    waiting.delete(id);
    if (errorName === undefined) {
      resolve(output);
    } else {
      reject(Object.assign(new Error(errorName), { name: errorName }));
    }
  });

  const invoke = (op, input) => new Promise((resolve, reject) => {
    next += 1;
    waiting.set(next, { resolve, reject });
    worker.postMessage({ id: next, op, input });
  });

  return { invoke, close: () => worker.terminate() };
};

/** Builds the fixture from the bundle at bundlePath. */
export const generate = async (bundlePath = BUNDLE) => {
  const { invoke, close } = loadInvoke(readFileSync(bundlePath, 'utf8'));

  try {
    return await generateWith(invoke);
  } finally {
    await close();
  }
};

const generateWith = async (invoke) => {
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
