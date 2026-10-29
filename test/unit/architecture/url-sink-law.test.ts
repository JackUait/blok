/**
 * Architectural enforcement: the URL Sink Law (everything outside src/tools/link).
 *
 * Stored block data is attacker-controllable in host apps: documents come back
 * from storage and nothing guarantees a persisted `data.url` is still the URL a
 * tool once resolved. A `javascript:` URL placed on an anchor href executes in
 * the host page's origin when the anchor is clicked — that exact stored-XSS
 * shipped in the audio and video tools' "Download" action (`a.href =
 * this.data.url`, no scheme gate). The render-time pass cannot save us: it only
 * hardens URLs inside HTML-markup strings, so a bare URL field is never
 * scheme-checked anywhere but at the sink.
 *
 * The law: no value may reach a URL sink in the scanned roots unless it is
 *
 * - a call to one of the sanctioned scheme gates (see SAFE_HELPERS);
 * - an identifier whose declaration in the same file comes from such a gate;
 * - a compile-time string literal (no `${}`), or a choice between two;
 * - an entry in EXEMPT_SINKS with a reason explaining why it cannot execute
 *   script (inert `<img>`/`<video>`/`<audio>` sources, guards proven upstream).
 *
 * Sinks: `.src`/`.href`/`.poster` assignments (any line layout),
 * `setAttribute`/`setAttributeNS` of src/href/xlink:href/poster (any quote),
 * `window.open(...)`, `location = ...`, `location.assign/replace(...)`,
 * `Object.assign(el, { href })`, and CSS that can carry `url()`:
 * `style.background`/`backgroundImage`/`cssText`, `style.setProperty` and
 * `Object.assign(el.style, { backgroundImage })`.
 *
 * The scan parses each file with TypeScript, so comments never count and a
 * statement split over lines is still one sink.
 *
 * src/tools/link has its own, stricter law for `.src`/`.href`/`setAttribute`
 * (see link-url-sink-law.test.ts); this law still checks every other form there.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPO_DIR = resolve(__dirname, '../../..');
const SRC_DIR = join(REPO_DIR, 'src');

/** All of src, and each workspace package's src. */
const SCAN_ROOTS = [
  SRC_DIR,
  ...readdirSync(join(REPO_DIR, 'packages'))
    .map((name) => join(REPO_DIR, 'packages', name, 'src'))
    .filter((dir) => existsSync(dir)),
];

/** The stricter link-url-sink-law test owns the `.src`/`.href`/setAttribute forms here. */
const LINK_DIR = join(SRC_DIR, 'tools', 'link');

/** Scheme gates a sink may be fed from. */
const SAFE_HELPERS = [
  'safeDownloadHref(',
  'safeHref(',
  'safeImageSrc(',
  'safeHttpHref(',
  'safePreviewSrc(',
  'toSafeEmbedSrc(',
];

/** pptx fills come from StyleResolver.ts, which emits only colours (via safeHexColor) and gradients, never url(). */
const PPTX_FILL = 'pptx fill CSS from resolveFill/resolveColorToCss/resolveGradientForText: colours and gradients only, never url()';
/** pptx pictures are blob: URLs from getOrCreateBlobUrl; external rels are refused first. */
const PPTX_BLOB = 'pptx picture as CSS url() of a blob: URL made from deck media (external targets are refused) — CSS images cannot run script';

/**
 * Sinks allowed to bypass the gates. Keyed by `file » rhs`.
 * Every entry MUST carry a reason.
 */
const EXEMPT_SINKS: Record<string, string> = {
  'tools/database/database-maplibre.ts » `#${encodeURIComponent(item.rowId)}`':
    'a map pin links to its row as a same-page fragment: a fixed "#" before a percent-encoded id cannot carry a scheme',
  'tools/database/cells/display.ts » href':
    'renderLink takes an href every caller already gated: safeHref(url), or mailtoHref/telHref, which build the URL and return safeHref of it',
  'tools/image/index.ts » src':
    'HTMLImageElement src — <img> is not a script-execution sink (javascript: URLs do not run in img)',
  'tools/file/docx/drawing.ts » url':
    'HTMLImageElement src set to a blob: URL this file made from zip bytes whose raster signature it checked — image loads cannot run script',
  'tools/image/tone-sampler.ts » src':
    'HTMLImageElement src for a hidden CORS copy of the picture already on screen, only read for its tone — image loads cannot run script',
  'tools/image/error-state.ts » file.preview':
    'HTMLImageElement src for a failed-upload thumbnail — image-resource loads cannot run script',
  'tools/image/markup/render.ts » src':
    'SVGImageElement href copied from an img src — SVG image resources disable scripting in secure image mode',
  'tools/image/ui.ts » data.url':
    'HTMLImageElement src — <img> is not a script-execution sink',
  'tools/image/ui.ts » item.url':
    'HTMLImageElement src (lightbox display) — <img> is not a script-execution sink',
  'tools/image/darkroom/index.ts » opts.url':
    'HTMLImageElement src (darkroom photo) — <img> is not a script-execution sink',
  'tools/image/darkroom/motion.ts » opts.url':
    'HTMLImageElement src (fly-out clone) — <img> is not a script-execution sink',
  'tools/image/darkroom/filter-strip.ts » o.url':
    'HTMLImageElement src (filter preset thumbnails, same url as the darkroom photo) — <img> is not a script-execution sink',
  'tools/image/darkroom/markup-panel.ts » url':
    'HTMLImageElement src (spotlight and magnifier shape tiles, same url as the darkroom photo) — <img> is not a script-execution sink',
  'components/utils/notifier/draw.ts » source':
    'HTMLImageElement src (failed-image toast tile), set only after SAFE_THUMBNAIL allows blob: or a raster data: image — <img> is not a script-execution sink',
  'tools/image/probe-dimensions.ts » url':
    'HTMLImageElement src (off-DOM dimension probe) — <img> is not a script-execution sink',
  'tools/audio/ui.ts » data.coverUrl':
    'HTMLImageElement src (cover art) — <img> is not a script-execution sink',
  'tools/audio/ui.ts » data.url':
    'HTMLAudioElement src — media elements do not execute javascript: URLs',
  'tools/video/ui.ts » data.url':
    'HTMLVideoElement src — media elements do not execute javascript: URLs',
  'tools/video/ui.ts » variant.url':
    '<source src> inside a <video> — media elements do not execute javascript: URLs, and readVariants drops script schemes first',
  'tools/video/controls.ts » src':
    'HTMLVideoElement src (seek-preview clone, copied from the rendered video) — media elements do not execute javascript: URLs',
  'components/inline-tools/inline-tool-link.ts » entry.favicon':
    'HTMLImageElement src (recent-link favicon), set only after an isHttpUrl() guard — <img> is not a script-execution sink',
  'components/modules/paste/handlers/pattern-handler.ts » url':
    'anchor href, but the URL reached this handler through the isHttpUrl() guard in onPaste',
  'components/modules/blockEvents/composers/markdownShortcuts.ts » url':
    'anchor href, but the markdown-link composer returns early on hasUnsafeScheme(url)',
  'components/utils/resolve-link-attributes.ts » resolved.href':
    'host-supplied transformHref result applied to an already-gated anchor href (config is trusted, not stored data)',
  'tools/file/pptx/renderer/ImageRenderer.ts » url':
    'pptx picture: HTMLImageElement src or SVG <image href> set to a blob: URL the engine made from deck media (external media is never resolved) — image loads cannot run script',
  'tools/file/pptx/renderer/ImageRenderer.ts » mediaUrl':
    'pptx audio/video element src, a blob: URL the engine made from deck media — media elements do not execute javascript: URLs',
  'tools/file/pptx/renderer/ImageRenderer.ts » canvas.toDataURL()':
    'pptx picture effect rendered to a canvas and shown as a PNG data: image in <img> — cannot run script',
  'tools/file/pptx/renderer/Shape3DRenderer.ts » url':
    'pptx 3D picture plane: off-DOM HTMLImageElement decode and SVG <image href> of a blob: URL made from deck media — image loads cannot run script',
  'components/modules/pageReferences.ts » href':
    'PageReferences.href() passes the host URL through safeHref() and returns null for unsafe schemes before paint assigns this anchor href',
  'tools/table-of-contents/index.ts » `#${encodeURIComponent(heading.id)}`':
    'a TOC entry links to its heading as a same-page fragment: a fixed "#" before a percent-encoded id cannot carry a scheme',
  'tools/file/pptx/renderer/ShapeRenderer.ts » `#${pathId}`':
    'SVG textPath href to a path id this renderer just made — a fixed "#" fragment cannot carry a scheme',
  'playground/icon-gallery.ts » url':
    'dev playground only: download anchor href is a blob: URL made by URL.createObjectURL two lines up',
  'playground/page-host.ts » href':
    'dev playground only: breadcrumb href comes from pagePath(), a fixed /editor path with an encodeURIComponent id',
  'playground/page-tree.ts » options.href(node.id)':
    'dev playground only: index.html passes pagePath(), a fixed /editor path with an encodeURIComponent id',
  'playground/slow-image-retry.ts » recoverUrl':
    'dev playground only: <img src> set to a fixed https URL from index.html — image loads cannot run script',
  'components/modules/pageReferences.ts » window.open: href':
    'PageReferences.href() passes the host URL through safeHref() and returns null for unsafe schemes; null skips the open',
  'components/modules/pageReferences.ts » location: href':
    'PageReferences.href() passes the host URL through safeHref() and returns null for unsafe schemes; null skips the navigation',
  'tools/page/index.ts » window.open: link.url':
    'copyAsLink() builds the URL from safeHref(config.href(pageId)) and returns null when it refuses the scheme',
  'tools/page/index.ts » window.open: newTab.url':
    'copyAsLink() builds the URL from safeHref(config.href(pageId)) and returns null when it refuses the scheme',
  "tools/page/index.ts » window.open: link.getAttribute('href') ?? ''":
    'the only a[href] in the page block is its own link, whose href is set only from safeHref(config.href(pageId)); the title is textContent',
  'tools/page-link/index.ts » window.open: anchor.href':
    'the only a[href] in the page-link block is its own link, whose href is set only from safeHref(config.href(pageId)); the title is textContent',
  'tools/link/bookmark/index.ts » window.open: url':
    'renderSettings returns no "Open original" item unless isHttpUrl(url)',
  'tools/link/embed/index.ts » window.open: source':
    'the "Open original" item exists only in link mode, which resolveEmbedRender picks only when isHttpUrl(data.source)',
  'tools/file/pptx/viewer.ts » window.open: target.url':
    'pptx hyperlink: goTo opens it only after isAllowedExternalUrl() allows http:, https: or mailto:',
  'tools/file/pptx/renderer/ImageRenderer.ts » poster: posterUrl':
    'pptx video poster from resolveMediaUrl(), a blob: URL made from deck media (external targets return undefined) — a poster image cannot run script',
  'tools/file/pptx/renderer/ShapeRenderer.ts » setAttributeNS: blipUrl':
    'pptx shape picture: SVG <image> xlink:href to a blob: URL from resolveShapeBlipUrl (deck media only) — image loads cannot run script',
  'components/modules/paste/google-docs-preprocessor.ts » style: style':
    'pasted style parsed on a div of a fresh inert document (createHTMLDocument) only to read its colour — no url() there is fetched',
  'tools/table/table-cell-clipboard.ts » style: style':
    'pasted style parsed on a div of a fresh inert document (createHTMLDocument) only to read its colour — no url() there is fetched',
  'tools/file/pptx/renderer/BackgroundRenderer.ts » style: tiled.imageLayers':
    PPTX_FILL,
  'tools/file/pptx/renderer/BackgroundRenderer.ts » style: fillCss':
    PPTX_FILL,
  'tools/file/pptx/renderer/BackgroundRenderer.ts » style: css':
    PPTX_FILL,
  'tools/file/pptx/renderer/BackgroundRenderer.ts » style: `url("${url}")`':
    PPTX_BLOB,
  'tools/file/pptx/renderer/ImageRenderer.ts » style: `url("${url}")`':
    PPTX_BLOB,
  'tools/file/pptx/renderer/ImageRenderer.ts » style: tiled.imageLayers':
    PPTX_FILL,
  'tools/file/pptx/renderer/ImageRenderer.ts » style: fillCss':
    PPTX_FILL,
  'tools/file/pptx/renderer/ImageRenderer.ts » style: maskImage':
    'pptx soft-edge mask: two fixed linear-gradients around a CSS variable, no url()',
  'tools/file/pptx/renderer/ReflectionRenderer.ts » style: mask':
    'pptx reflection mask from alphaMask(): one linear-gradient of numbers, no url()',
  'tools/file/pptx/renderer/ShapeRenderer.ts » style: fillCss':
    PPTX_FILL,
  'tools/file/pptx/renderer/TableRenderer.ts » style: tiled.imageLayers':
    PPTX_FILL,
  'tools/file/pptx/renderer/TableRenderer.ts » style: fillCss':
    PPTX_FILL,
  'tools/file/pptx/renderer/TextRenderer.ts » style: css':
    PPTX_FILL,
  "tools/file/pptx/renderer/TextRenderer.ts » style: backgroundImages.join(', ')":
    PPTX_FILL,
  'tools/file/pptx/renderer/TextRenderer.ts » style: `url("${escapedUrl}")`':
    PPTX_BLOB,
  'tools/file/pptx/renderer/TextRenderer.ts » style: maskGrad':
    PPTX_FILL,
  'playground/presence-face.ts » style: color':
    'dev playground only: a peer presence colour as a background — CSS url() cannot run script',
  'tools/table/table-resize.ts » style: `linear-gradient(to right, transparent var(--blok-table-resize-line-x), #3b82f6 var(--blok-table-resize-line-x), #3b82f6 calc(var(--blok-table-resize-line-x) + ${RESIZE_LINE_WIDTH}px), transparent calc(var(--blok-table-resize-line-x) + ${RESIZE_LINE_WIDTH}px))`':
    'resize line: a fixed gradient whose only input is the RESIZE_LINE_WIDTH number constant',
};

/**
 * Which sink a hit came from. `href`/`src` are the original forms: their
 * exemption keys are `file » rhs`. Every other form keys as
 * `file » form: rhs`, so an exemption for one form never covers another.
 */
type SinkForm =
  | 'href'
  | 'src'
  | 'poster'
  | 'setAttribute'
  | 'setAttributeNS'
  | 'window.open'
  | 'location'
  | 'Object.assign'
  | 'style';

interface Sink {
  file: string;
  line: number;
  form: SinkForm;
  rhs: string;
}

const URL_PROPERTIES = new Set(['src', 'href', 'poster']);
const URL_ATTRIBUTES = new Set(['src', 'href', 'xlink:href', 'poster']);
/** Inline-style properties whose value may hold `url(...)`. */
const CSS_URL_PROPERTIES = new Set([
  'background',
  'backgroundImage',
  'cssText',
  'listStyleImage',
  'borderImage',
  'borderImageSource',
  'mask',
  'maskImage',
]);
const CSS_URL_PROPERTY_NAMES = new Set([
  'background',
  'background-image',
  'list-style-image',
  'border-image',
  'border-image-source',
  'mask',
  'mask-image',
]);
const WINDOW_NAMES = new Set(['window', 'globalThis', 'self', 'top', 'parent']);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      return walk(full);
    }

    return /\.tsx?$/.test(full) && !/\.(d|test|spec)\.tsx?$/.test(full) ? [full] : [];
  });
}

const isSafeCall = (expression: string): boolean =>
  SAFE_HELPERS.some((helper) => expression.includes(helper));

const textOf = (node: ts.Node): string => node.getText().replace(/\s+/g, ' ').trim();

/** A string with no `${}` part: its value is fixed when the code is written. */
const isLiteral = (node: ts.Node): boolean =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);

/** A literal, or a choice between literals (`a ? 'x' : 'y'`). */
const isConstant = (node: ts.Node): boolean => {
  if (ts.isParenthesizedExpression(node)) {
    return isConstant(node.expression);
  }

  return isLiteral(node) || (ts.isConditionalExpression(node) && isConstant(node.whenTrue) && isConstant(node.whenFalse));
};

const literalText = (node: ts.Node | undefined): string | undefined =>
  node !== undefined && isLiteral(node) ? (node as ts.StringLiteralLike).text : undefined;

const propertyName = (node: ts.Node): string | undefined => {
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text;
  }

  return ts.isElementAccessExpression(node) ? literalText(node.argumentExpression) : undefined;
};

/** `x.style.backgroundImage` → true; the object must itself be a `.style`. */
const isStyleProperty = (node: ts.Node): boolean => {
  const name = propertyName(node);

  return name !== undefined && CSS_URL_PROPERTIES.has(name)
    && (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
    && propertyName(node.expression) === 'style';
};

const isLocation = (node: ts.Node): boolean =>
  (ts.isIdentifier(node) && node.text === 'location') || propertyName(node) === 'location';

const isWindowOpen = (callee: ts.Node): boolean =>
  ts.isPropertyAccessExpression(callee)
  && callee.name.text === 'open'
  && ts.isIdentifier(callee.expression)
  && WINDOW_NAMES.has(callee.expression.text);

const methodName = (callee: ts.Node): string | undefined =>
  ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;

/**
 * Names this file declares from a scheme gate, e.g.
 * `const href = safeHttpHref(data.url)` — the sink `a.href = href` is then gated.
 */
function safeIdentifiers(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && node.initializer !== undefined && isSafeCall(node.initializer.getText())) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };

  visit(source);

  return names;
}

/** Every URL sink in one file, before gate and exemption checks. */
function rawSinks(source: ts.SourceFile, inLinkDir: boolean): Array<{ node: ts.Node; form: SinkForm; value: ts.Node }> {
  const found: Array<{ node: ts.Node; form: SinkForm; value: ts.Node }> = [];
  const add = (node: ts.Node, form: SinkForm, value: ts.Node | undefined): void => {
    // The link law owns these three forms inside src/tools/link.
    if (value === undefined || (inLinkDir && (form === 'href' || form === 'src' || form === 'setAttribute'))) {
      return;
    }
    found.push({ node, form, value });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const name = propertyName(node.left);

      if (isStyleProperty(node.left)) {
        add(node, 'style', node.right);
      } else if (name !== undefined && URL_PROPERTIES.has(name)) {
        add(node, name as SinkForm, node.right);
      } else if (isLocation(node.left)) {
        add(node, 'location', node.right);
      }
    }

    if (ts.isCallExpression(node)) {
      const [first, second, third] = node.arguments;
      const method = methodName(node.expression);
      const target = ts.isPropertyAccessExpression(node.expression) ? node.expression.expression : undefined;

      if (method === 'setAttribute' && URL_ATTRIBUTES.has(literalText(first) ?? '')) {
        add(node, 'setAttribute', second);
      } else if (method === 'setAttributeNS' && URL_ATTRIBUTES.has(literalText(second) ?? '')) {
        add(node, 'setAttributeNS', third);
      } else if (isWindowOpen(node.expression)) {
        add(node, 'window.open', first);
      } else if ((method === 'assign' || method === 'replace') && target !== undefined && isLocation(target)) {
        add(node, 'location', first);
      } else if (method === 'setProperty' && target !== undefined && propertyName(target) === 'style'
        && CSS_URL_PROPERTY_NAMES.has(literalText(first) ?? '')) {
        add(node, 'style', second);
      } else if (method === 'assign' && target !== undefined && ts.isIdentifier(target) && target.text === 'Object'
        && second !== undefined && ts.isObjectLiteralExpression(second)) {
        const styleTarget = first !== undefined && propertyName(first) === 'style';

        for (const property of second.properties) {
          const key = property.name !== undefined && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
            ? property.name.text
            : undefined;
          const isSink = key !== undefined && (styleTarget ? CSS_URL_PROPERTIES.has(key) : URL_PROPERTIES.has(key));

          if (isSink && ts.isPropertyAssignment(property)) {
            add(property, styleTarget ? 'style' : 'Object.assign', property.initializer);
          } else if (isSink && ts.isShorthandPropertyAssignment(property)) {
            add(property, styleTarget ? 'style' : 'Object.assign', property.name);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}

/** The ungated URL sinks in one file. `file` is the path the exemption keys use. */
function scanSource(file: string, text: string, inLinkDir = false): Sink[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const safeNames = safeIdentifiers(source);

  return rawSinks(source, inLinkDir)
    .map(({ node, form, value }) => ({ node, form, value, rhs: textOf(value) }))
    .filter(({ value, rhs }) => !isConstant(value) && !isSafeCall(rhs) && !safeNames.has(rhs))
    .map(({ node, form, rhs }) => ({
      file,
      line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      form,
      rhs,
    }));
}

const sinkKey = (sink: Pick<Sink, 'file' | 'form' | 'rhs'>): string =>
  sink.form === 'href' || sink.form === 'src' || sink.form === 'setAttribute'
    ? `${sink.file} » ${sink.rhs}`
    : `${sink.file} » ${sink.form}: ${sink.rhs}`;

/** Paths under src stay short (`tools/…`); package files keep their full path. */
const keyPath = (file: string): string => {
  const base = file.startsWith(SRC_DIR) ? SRC_DIR : REPO_DIR;

  return relative(base, file).split(/[\\/]/).join('/');
};

function collectSinks(): { sinks: Sink[]; filesPerRoot: Map<string, number> } {
  const sinks: Sink[] = [];
  const filesPerRoot = new Map<string, number>();

  for (const root of SCAN_ROOTS) {
    const files = walk(root);

    filesPerRoot.set(relative(REPO_DIR, root), files.length);
    for (const file of files) {
      sinks.push(...scanSource(keyPath(file), readFileSync(file, 'utf8'), file.startsWith(LINK_DIR)));
    }
  }

  return { sinks, filesPerRoot };
}

describe('URL Sink Law', () => {
  const { sinks, filesPerRoot } = collectSinks();

  it('scans files in every root (a wrong root must not scan nothing)', () => {
    const empty = [...filesPerRoot].filter(([, count]) => count === 0).map(([root]) => root);

    expect(filesPerRoot.size).toBeGreaterThanOrEqual(2);
    expect(empty).toEqual([]);
  });

  it.each<SinkForm>(['href', 'src', 'poster', 'setAttributeNS', 'window.open', 'location', 'style'])(
    'finds real %s sinks (scan self-check: a broken matcher must not silently pass)',
    (form) => {
      expect(sinks.some((sink) => sink.form === form)).toBe(true);
    }
  );

  it('routes every URL sink through a scheme gate or a reasoned exemption', () => {
    const violations = sinks
      .filter((sink) => !(sinkKey(sink) in EXEMPT_SINKS))
      .map(
        (sink) =>
          `${sink.file}:${sink.line} feeds a ${sink.form} sink with ${sink.rhs} — route it through ` +
          'safeHref(...) / safeDownloadHref(...) / safeHttpHref(...) / safePreviewSrc(...), or add an ' +
          'EXEMPT_SINKS entry with a reason'
      );

    expect(violations).toEqual([]);
  });

  it('keeps every exemption alive (a stale entry means the sink moved — re-verify it)', () => {
    const present = new Set(sinks.map(sinkKey));
    const stale = Object.keys(EXEMPT_SINKS).filter((key) => !present.has(key));

    expect(stale).toEqual([]);
  });
});

/** Each row: a sink form, then code that must be flagged, then code that must not. */
const FIXTURES: Array<[SinkForm, string, string[]]> = [
  ['href', 'a.href =\n  data.url;', ['a.href = \'#top\';', 'a.href = safeHref(data.url);']],
  ['href', 'location.href = data.url;', ['location.href = \'/\';']],
  ['href', 'a[\'href\'] = data.url;', ['a[\'href\'] = safeHref(data.url);']],
  ['src', 'img.src = `${data.url}`;', ['img.src = `blank.png`;', 'const s = safeImageSrc(u);\nimg.src = s;']],
  ['poster', 'video.poster = data.cover;', ['video.poster = \'\';', 'video.poster = safeImageSrc(data.cover);']],
  ['setAttribute', 'a.setAttribute("href", data.url);', ['a.setAttribute("href", "#");', 'a.setAttribute("href", safeHref(u));']],
  ['setAttribute', 'a.setAttribute(`href`,\n  data.url);', ['a.setAttribute(`href`, `#`);']],
  ['setAttribute', 'a.setAttribute(\'xlink:href\', data.url);', ['a.setAttribute(\'title\', data.url);']],
  ['setAttributeNS', 'i.setAttributeNS(XLINK, \'href\', data.url);', ['i.setAttributeNS(XLINK, \'href\', \'#a\');', 'i.setAttributeNS(null, \'href\', safeImageSrc(u));']],
  ['window.open', 'window.open(data.url, \'_blank\');', ['window.open(\'https://blok.dev\');', 'window.open(safeHref(u) ?? \'\');']],
  ['location', 'window.location.assign(data.url);', ['window.location.assign(\'/\');', 'location.assign(safeHref(u) ?? \'/\');']],
  ['location', 'location.replace(data.url);', ['location.replace(\'/\');', 'history.replace(data.url);']],
  ['location', 'window.location = data.url;', ['window.location = \'/\';']],
  ['Object.assign', 'Object.assign(a, { href: data.url });', ['Object.assign(a, { href: \'#\' });', 'Object.assign(a, { title: data.url });']],
  ['Object.assign', 'Object.assign(a, { href });', ['Object.assign(a, { target: \'_blank\' });']],
  ['style', 'el.style.backgroundImage = `url("${data.url}")`;', ['el.style.backgroundImage = \'none\';', 'el.style.color = data.color;']],
  ['style', 'el.style.cssText = data.style;', ['el.style.cssText = \'display:none\';']],
  ['style', 'el.style.setProperty(\'background-image\', data.bg);', ['el.style.setProperty(\'background-color\', data.bg);']],
  ['style', 'el.style.background = cond ? data.bg : \'none\';', ['el.style.background = cond ? \'red\' : \'none\';']],
  ['style', 'Object.assign(el.style, { backgroundImage: data.bg });', ['Object.assign(el.style, { width: data.w });']],
];

describe('URL Sink Law scanner (fixtures)', () => {
  it.each(FIXTURES)('flags an ungated %s sink: %s', (form, code) => {
    expect(scanSource('fixture.ts', code).map((sink) => sink.form)).toEqual([form]);
  });

  it.each(FIXTURES.flatMap(([form, , safe]) => safe.map((code): [SinkForm, string] => [form, code])))(
    'passes a literal or gated %s value: %s',
    (_form, code) => {
      expect(scanSource('fixture.ts', code)).toEqual([]);
    }
  );

  it('ignores sinks inside comments and keeps a URL literal whole', () => {
    expect(scanSource('fixture.ts', '// a.href = data.url;\n/* window.open(url) */\nlink.href = \'https://cdn.example/k.css\';')).toEqual([]);
  });

  it('leaves the src/href/setAttribute forms to the link law inside src/tools/link', () => {
    expect(scanSource('fixture.ts', 'a.href = data.url;\nwindow.open(data.url);', true).map((sink) => sink.form)).toEqual(['window.open']);
  });
});
