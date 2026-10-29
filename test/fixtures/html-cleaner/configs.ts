/**
 * Frozen tag maps for the html-janitor 2.0.4 goldens (golden.json.gz).
 *
 * Every rule here is a COPY. Nothing imports from src/: if a tool changes its
 * `sanitize` later, the goldens must still describe what the old engine did
 * with the old rules. Source lines are as of commit 2b4bf44c.
 *
 * Maps are plain object literals, so they inherit Object.prototype. That is
 * how the `proto-key` hazard shows up at engine level (see README.md).
 */

export type AttrRule = boolean | string | ((value: string, node: Element) => boolean);
export type AttrMap = Record<string, AttrRule>;
export type TagRule = boolean | AttrMap | ((node: Element) => AttrMap | boolean | undefined | null);
export type TagMap = Record<string, TagRule>;

/* ------------------------------------------------------------------ */
/* Copied rule functions                                               */
/* ------------------------------------------------------------------ */

// src/shared/page-reference.ts:3
const PAGE_REFERENCE_ATTR = 'data-blok-page-id';
// src/shared/page-reference.ts:4
const PAGE_REFERENCE_FALLBACK = 'Page';

// src/shared/page-reference.ts:16
const preservePageReferenceAnchor = (node: Element): AttrMap => {
  const pageId = node.getAttribute(PAGE_REFERENCE_ATTR);

  if (pageId !== null && pageId !== '') {
    // eslint-disable-next-line no-param-reassign -- copied verbatim; the engine passes a sandbox node
    node.textContent = PAGE_REFERENCE_FALLBACK;

    return { [PAGE_REFERENCE_ATTR]: true };
  }

  return { href: true, target: true, rel: true };
};

// src/shared/page-reference.ts:6
const protectPageReferenceAnchor = (ordinaryRule: TagRule): ((node: Element) => AttrMap | boolean | undefined | null) => (node) => {
  if (node.getAttribute(PAGE_REFERENCE_ATTR)) {
    return preservePageReferenceAnchor(node);
  }

  return typeof ordinaryRule === 'function' ? ordinaryRule(node) : ordinaryRule;
};

// src/shared/inline-text-sanitize.ts:19
const ALLOWED_COLOR_STYLE_PROPS = new Set(['color', 'background-color']);

// src/shared/inline-text-sanitize.ts:28
const preserveColorStyles = (node: Element): AttrMap => {
  const style = (node as HTMLElement).style;

  const props = Array.from({ length: style.length }, (_, i) => style.item(i));

  for (const prop of props) {
    if (!ALLOWED_COLOR_STYLE_PROPS.has(prop)) {
      style.removeProperty(prop);
    }
  }

  return style.length > 0 ? { style: true } : {};
};

// src/shared/equation-mark.ts:21
const EQUATION_SOURCE_ATTR = 'data-latex';

// src/shared/inline-text-sanitize.ts:62
const preserveEquationSpan = (node: Element): AttrMap | false => {
  const latex = node.getAttribute(EQUATION_SOURCE_ATTR);

  if (latex === null) {
    return false;
  }

  if (node.textContent !== latex) {
    // eslint-disable-next-line no-param-reassign -- copied verbatim; the engine passes a sandbox node
    node.textContent = latex;
  }

  return { [EQUATION_SOURCE_ATTR]: true };
};

// src/shared/default-page-colors.ts:39
function computeRelativeLuminance(color: string): number {
  const normalized = color.replace(/\s/g, '').toLowerCase();

  const rgbMatch = /^rgba?\((\d+),(\d+),(\d+)(?:,[\d.]+)?\)$/.exec(normalized);

  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10) / 255;
    const g = parseInt(rgbMatch[2], 10) / 255;
    const b = parseInt(rgbMatch[3], 10) / 255;

    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  const hslMatch = /^hsla?\(([\d.]+),([\d.]+)%,([\d.]+)%(?:,[\d.]+)?\)$/.exec(normalized);

  if (hslMatch) {
    const h = parseFloat(hslMatch[1]) / 360;
    const s = parseFloat(hslMatch[2]) / 100;
    const l = parseFloat(hslMatch[3]) / 100;

    if (s === 0) {
      return 0.2126 * l + 0.7152 * l + 0.0722 * l;
    }

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const wrap = (t: number): number => {
      if (t < 0) {
        return t + 1;
      }

      if (t > 1) {
        return t - 1;
      }

      return t;
    };
    const hueToChannel = (t: number): number => {
      const wrapped = wrap(t);

      if (wrapped < 1 / 6) {
        return p + (q - p) * 6 * wrapped;
      }

      if (wrapped < 1 / 2) {
        return q;
      }

      if (wrapped < 2 / 3) {
        return p + (q - p) * (2 / 3 - wrapped) * 6;
      }

      return p;
    };

    const r = hueToChannel(h + 1 / 3);
    const g = hueToChannel(h);
    const b = hueToChannel(h - 1 / 3);

    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  const hexMatch = /^#([0-9a-f]{6}|[0-9a-f]{3})$/.exec(normalized);

  if (hexMatch) {
    const hex = hexMatch[1];
    const expand = hex.length === 3
      ? [hex[0] + hex[0], hex[1] + hex[1], hex[2] + hex[2]]
      : [hex.substring(0, 2), hex.substring(2, 4), hex.substring(4, 6)];
    const r = parseInt(expand[0], 16) / 255;
    const g = parseInt(expand[1], 16) / 255;
    const b = parseInt(expand[2], 16) / 255;

    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  return -1;
}

// src/shared/default-page-colors.ts:126
function isDefaultDarkBackground(bgColor: string): boolean {
  const luminance = computeRelativeLuminance(bgColor);

  return luminance >= 0 && luminance < 0.12;
}

// src/shared/default-page-colors.ts:138
const NEAR_WHITE_MIN_CHANNEL = 250;

// src/shared/default-page-colors.ts:146
function parseRgba(color: string): { r: number; g: number; b: number; a: number } | null {
  const normalized = color.replace(/\s/g, '').toLowerCase();

  if (normalized === 'transparent') {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  if (normalized === 'white') {
    return { r: 255, g: 255, b: 255, a: 1 };
  }

  const rgbMatch = /^rgba?\((\d+),(\d+),(\d+)(?:,([\d.]+))?\)$/.exec(normalized);

  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1], 10),
      g: parseInt(rgbMatch[2], 10),
      b: parseInt(rgbMatch[3], 10),
      a: rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1,
    };
  }

  const hexMatch = /^#([0-9a-f]{6}|[0-9a-f]{3})$/.exec(normalized);

  if (hexMatch) {
    const hex = hexMatch[1];
    const expand = hex.length === 3
      ? [hex[0] + hex[0], hex[1] + hex[1], hex[2] + hex[2]]
      : [hex.substring(0, 2), hex.substring(2, 4), hex.substring(4, 6)];

    return {
      r: parseInt(expand[0], 16),
      g: parseInt(expand[1], 16),
      b: parseInt(expand[2], 16),
      a: 1,
    };
  }

  return null;
}

// src/shared/default-page-colors.ts:198
function isInvisibleBackground(bgColor: string): boolean {
  const rgba = parseRgba(bgColor);

  if (rgba !== null) {
    if (rgba.a === 0) {
      return true;
    }

    if (rgba.r >= NEAR_WHITE_MIN_CHANNEL && rgba.g >= NEAR_WHITE_MIN_CHANNEL && rgba.b >= NEAR_WHITE_MIN_CHANNEL) {
      return true;
    }
  }

  return isDefaultDarkBackground(bgColor);
}

// src/shared/tool-descriptions/sanitize/inline.ts:10 (Marker tool `mark` rule)
const markerMarkRule = (node: Element): AttrMap => {
  const el = node as HTMLElement;
  const style = el.style;

  const props = Array.from({ length: style.length }, (_, i) => style.item(i));

  for (const prop of props) {
    if (!ALLOWED_COLOR_STYLE_PROPS.has(prop)) {
      style.removeProperty(prop);
    }
  }

  const bg = style.getPropertyValue('background-color');

  if (bg && isInvisibleBackground(bg)) {
    style.removeProperty('background-color');
  }

  if (style.getPropertyValue('color') && !style.getPropertyValue('background-color')) {
    style.setProperty('background-color', 'transparent');
  }

  return style.length > 0 ? { style: true } : {};
};

// src/shared/table/cell-sanitize.ts:4
const ALLOWED_MARK_STYLE_PROPS = new Set(['color', 'background-color']);

// src/tools/table/table-cell-clipboard.ts:461 and src/shared/tool-descriptions/sanitize/blocks.ts:216 (same body)
const cellMarkRule = (node: Element): AttrMap => {
  const el = node as HTMLElement;
  const style = el.style;

  const props = Array.from({ length: style.length }, (_, i) => style.item(i));

  for (const prop of props) {
    if (!ALLOWED_MARK_STYLE_PROPS.has(prop)) {
      style.removeProperty(prop);
    }
  }

  return style.length > 0 ? { style: true } : {};
};

// src/tools/table/table-cell-clipboard.ts:458 and src/shared/tool-descriptions/sanitize/blocks.ts:230 (same body)
const cellAnchorRule = (node: Element): AttrMap => node.getAttribute(PAGE_REFERENCE_ATTR)
  ? preservePageReferenceAnchor(node)
  : { href: true, target: '_blank', rel: 'nofollow' };

// src/shared/sanitize-rules.ts:22
const SAFE_ATTRIBUTES = new Set(['class', 'id', 'title', 'role', 'dir', 'lang']);

// src/shared/sanitize-rules.ts:29
const isSafeAttribute = (attribute: string): boolean => {
  const lowerName = attribute.toLowerCase();

  return lowerName.startsWith('data-') || lowerName.startsWith('aria-') || SAFE_ATTRIBUTES.has(lowerName);
};

type FunctionRule = (node: Element) => AttrMap | boolean | undefined | null;

// src/shared/sanitize-walk.ts:95
const wrapFunctionRule = (rule: FunctionRule): FunctionRule => (element) => {
  const result = rule(element);

  if (result == null) {
    return {};
  }

  return result;
};

// src/shared/sanitize-walk.ts:107
const preserveExistingAttributesRule: FunctionRule = (element) => {
  const preserved: AttrMap = {};

  Array.from(element.attributes).forEach((attribute) => {
    if (!isSafeAttribute(attribute.name)) {
      return;
    }

    preserved[attribute.name] = true;
  });

  return preserved;
};

// src/shared/sanitize-walk.ts:121 (cloneTagConfig; no string rule reaches here, objects are shallow, so a spread equals its deepMerge)
const cloneTagRule = (rule: TagRule): TagRule => {
  if (rule === true) {
    return wrapFunctionRule(preserveExistingAttributesRule);
  }

  if (rule === false) {
    return false;
  }

  if (typeof rule === 'function') {
    return wrapFunctionRule(rule);
  }

  return { ...rule };
};

// src/shared/sanitize-walk.ts (cloneSanitizerConfig): every own tag through cloneTagConfig
const cloneTags = (tags: TagMap): TagMap => Object.fromEntries(
  Object.entries(tags).map(([tag, rule]) => [tag, cloneTagRule(rule)])
);

// src/shared/sanitize-composition.ts:30
const isBlokAttribute = (name: string): boolean => name.toLowerCase().startsWith('data-blok-');

// src/shared/sanitize-composition.ts:36
const claimedBy = (claim: Record<string, AttrRule> | true, element: Element): AttrMap => Object.fromEntries(
  Array.from(element.attributes).flatMap(({ name, value }): Array<[string, true]> => {
    if (isBlokAttribute(name)) {
      return [];
    }
    if (claim === true) {
      return isSafeAttribute(name) ? [[name, true]] : [];
    }
    const attrRule = Object.hasOwn(claim, name) ? claim[name] : undefined;

    return attrRule === true || (typeof attrRule === 'string' && attrRule === value) ? [[name, true]] : [];
  })
);

// src/shared/sanitize-composition.ts:56
const combinedTagRule = (own: FunctionRule, claim: Record<string, AttrRule> | true) => (element: Element): AttrMap | boolean | undefined | null => {
  const claimed = claimedBy(claim, element);
  const ownVerdict = own(element) ?? {};

  if ((claim !== true && Object.keys(claimed).length === 0) || ownVerdict === true) {
    return ownVerdict;
  }

  return ownVerdict === false ? claimed : { ...claimed, ...ownVerdict };
};

/**
 * What src/components/utils/sanitizer.ts:105 `clean()` hands the engine:
 * a copy whose `a` rule is wrapped in protectPageReferenceAnchor (:112-116).
 * The copy here keeps Object.prototype (the branch's clean() now does not).
 */
const viaClean = (tags: TagMap): TagMap => {
  const copy: TagMap = { ...tags };
  const anchorRule = copy.a;

  if (anchorRule !== undefined && anchorRule !== false) {
    copy.a = protectPageReferenceAnchor(anchorRule);
  }

  return copy;
};

/* ------------------------------------------------------------------ */
/* Copied tag maps                                                     */
/* ------------------------------------------------------------------ */

// src/shared/inline-text-sanitize.ts:84
const INLINE_TEXT_SANITIZE: TagMap = {
  br: true,
  strong: {},
  b: {},
  em: {},
  i: {},
  u: {},
  s: {},
  del: {},
  a: preservePageReferenceAnchor,
  code: {},
  sup: {},
  sub: {},
  mark: preserveColorStyles,
  span: preserveEquationSpan,
};

// src/shared/table/cell-sanitize.ts:7
const CELL_BLOCK_TAGS_SANITIZE: TagMap = {
  ul: true,
  ol: true,
  li: { style: true, 'aria-level': true, 'data-list-style': true },
  input: { type: true, checked: true },
  p: {},
  div: {},
};

/*
 * Inline tools' `sanitize`, folded with Object.assign like
 * composeBaseSanitizeConfig (src/shared/sanitize-composition.ts:21).
 * No two tools share a tag, so the fold order does not matter.
 */
const INLINE_TOOLS_BASE: TagMap = {
  // src/components/inline-tools/inline-tool-marker.ts:91 -> inline.ts:8
  mark: markerMarkRule,
  // inline-tool-bold.ts:63 -> inline.ts:54
  strong: {},
  b: {},
  // simple-mark-tool.ts:120 with inline-tool-italic.ts:21-22
  i: {},
  em: {},
  // simple-mark-tool.ts:120 with inline-tool-underline.ts:21
  u: {},
  // inline-tool-link.ts:121 -> inline.ts:74
  a: preservePageReferenceAnchor,
  // simple-mark-tool.ts:120 with inline-tool-strikethrough.ts:21-25
  s: {},
  del: {},
  strike: {},
  // inline-tool-code.ts:53 -> inline.ts:86
  code: {},
  // inline-tool-equation.ts:71 -> inline.ts:92
  span: { [EQUATION_SOURCE_ATTR]: true },
  // inline-tool-sup-sub.ts:65 -> inline.ts:100
  sup: {},
  sub: {},
};

/*
 * composeFieldSanitize (src/shared/sanitize-composition.ts:91) of the inline
 * base with a block field rule: own wins, and `span` (own function, base
 * object with a non-false attribute) becomes a combinedTagRule. No other
 * shared tag qualifies for a claim: mark/a are functions in the base, the rest
 * are attribute-less.
 */
const composeWithInlineBase = (own: TagMap): TagMap => ({
  ...INLINE_TOOLS_BASE,
  ...own,
  span: combinedTagRule(preserveEquationSpan, { [EQUATION_SOURCE_ATTR]: true }),
});

// src/shared/tool-descriptions/sanitize/blocks.ts:8 (paragraph `text`)
const PARAGRAPH_TEXT: TagMap = {
  ...INLINE_TEXT_SANITIZE,
  img: {
    src: true,
    alt: true,
    style: true,
  },
  p: true,
  ul: true,
  li: true,
};

// src/shared/tool-descriptions/sanitize/blocks.ts:204 (table `content`)
const TABLE_CONTENT: TagMap = {
  ...INLINE_TEXT_SANITIZE,
  b: true,
  i: true,
  strong: true,
  em: true,
  u: true,
  s: true,
  del: true,
  code: true,
  mark: cellMarkRule,
  a: cellAnchorRule,
  ...CELL_BLOCK_TAGS_SANITIZE,
};

// src/tools/table/table-cell-clipboard.ts:450
const CELL_SANITIZE_CONFIG: TagMap = {
  ...INLINE_TEXT_SANITIZE,
  ul: true,
  ol: true,
  li: { style: true, 'aria-level': true, 'data-list-style': true },
  input: { type: true, checked: true },
  a: cellAnchorRule,
  mark: cellMarkRule,
};

// src/components/modules/paste/constants.ts:8
const CELL_CODE_TAG = 'blok-cell-code';

// src/tools/table/table-cell-clipboard.ts:479
const PASTED_CELL_SANITIZE_CONFIG: TagMap = {
  ...CELL_SANITIZE_CONFIG,
  table: {},
  thead: {},
  tbody: {},
  tfoot: {},
  tr: {},
  th: {},
  td: {},
  pre: {},
  [CELL_CODE_TAG]: {},
  img: { src: true, alt: true },
};

// src/components/modules/paste/constants.ts:14
const SAFE_STRUCTURAL_TAGS = [
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'details', 'summary', CELL_CODE_TAG,
];

// src/components/modules/paste/constants.ts:55
const STRUCTURAL_LI: AttrMap = { style: true, 'aria-level': true, 'data-list-style': true };

// Built-in tools' pasteConfig tags, lowercased like buildToolsTagsConfig (paste/sanitizer-config.ts:25); a bare tag name maps to {}.
const TOOLS_PASTE_TAGS: TagMap = {
  // src/tools/paragraph/index.ts:503
  p: {},
  // src/tools/code/index.ts:1376 (CODE_LANGUAGE_ATTR, paste/constants.ts:84)
  pre: { 'data-blok-code-language': true },
  // src/tools/quote/index.ts:263
  blockquote: {},
  // src/tools/list/static-configs.ts:30
  li: { style: true, 'aria-level': true, 'data-list-style': true },
  input: { type: true, checked: true },
  // src/tools/image/index.ts:244
  img: { src: true, alt: true },
  // src/tools/callout/index.ts:661
  aside: { style: true },
  // src/tools/toggle/index.ts:545
  details: {},
  // src/tools/table/index.ts:537
  table: { 'data-blok-columns-candidate': true, dir: true },
  tr: {},
  th: { style: true, colspan: true, rowspan: true, align: true, valign: true, bgcolor: true },
  td: { style: true, colspan: true, rowspan: true, align: true, valign: true, bgcolor: true },
  // src/tools/divider/index.ts:97
  hr: {},
  // src/tools/header/index.ts:1461
  h1: { id: true },
  h2: { id: true },
  h3: { id: true },
  h4: { id: true },
  h5: { id: true },
  h6: { id: true },
};

// src/components/modules/blockSelection.ts:129 (empty global sanitizer -> composeSanitizerConfig is a raw Object.assign)
const BLOCK_SELECTION: TagMap = {
  p: {},
  h1: {},
  h2: {},
  h3: {},
  h4: {},
  h5: {},
  h6: {},
  ol: {},
  ul: {},
  li: {},
  table: {},
  thead: {},
  tbody: {},
  tfoot: {},
  tr: {},
  th: {
    colspan: true,
    rowspan: true,
  },
  td: {
    colspan: true,
    rowspan: true,
  },
  img: {
    src: true,
    width: true,
    height: true,
  },
  blockquote: {},
  pre: {},
  ...INLINE_TEXT_SANITIZE,
  a: {
    href: true,
  },
};

// src/components/marks/mark-engine.ts:922 markSanitizerConfig, for an example spec:
// { tag: 'span', aliasTags: ['font'], style: { color }, className: 'hl', attributes: { 'data-tone': 'warm', 'data-id': fn } }
const MARK_SPEC_DECLARED_STYLES = ['color'];
const MARK_SPEC_DECLARED_CLASSES = ['hl'];
const MARK_SPEC_DECLARED_ATTRIBUTES: Array<[string, string | (() => string)]> = [['data-tone', 'warm'], ['data-id', () => 'id']];
const markSpecRule = (node: Element): AttrMap => {
  const element = node as HTMLElement;
  const allowed: AttrMap = {};

  const styleProps = Array.from({ length: element.style.length }, (_, i) => element.style.item(i));

  for (const prop of styleProps) {
    if (!MARK_SPEC_DECLARED_STYLES.includes(prop)) {
      element.style.removeProperty(prop);
    }
  }

  if (element.style.length > 0) {
    allowed.style = true;
  }

  for (const className of Array.from(element.classList)) {
    if (!MARK_SPEC_DECLARED_CLASSES.includes(className)) {
      element.classList.remove(className);
    }
  }

  if (element.classList.length > 0) {
    allowed.class = true;
  }

  for (const [name, value] of MARK_SPEC_DECLARED_ATTRIBUTES) {
    const current = element.getAttribute(name);

    if (current === null) {
      continue;
    }

    if (typeof value === 'string' && current !== value) {
      continue;
    }

    allowed[name] = true;
  }

  return allowed;
};

/* ------------------------------------------------------------------ */
/* Upstream html-janitor test config (test/janitor.spec.js)            */
/* ------------------------------------------------------------------ */

const UPSTREAM_SPEC: TagMap = {
  a: {
    href: true,
  },
  b: {},
  i: {},
  strong: {},
  em: {},
  sub: {},
  sup: {},
  strike: {},
  p: { foo: true, bar: 'baz' },
  ul: {},
  li: {},
  small: true,
  div: {},
  figure: false,
  u: (el) => el.innerHTML !== '',
  img: {
    // Copied verbatim: upstream calls parseInt without a radix.
    height: (value) => parseInt(value) < 10,
    width: (_value, el) => el.hasAttribute('height'),
  },
  blockquote: (el): AttrMap => (el.classList.contains('indent') ? { class: true, style: true } : {}),
};

/* ------------------------------------------------------------------ */
/* Synthetic maps: one per rule kind                                   */
/* ------------------------------------------------------------------ */

const FUZZ_TAGS = [
  'p', 'li', 'td', 'th', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre',
  'a', 'b', 'strong', 'i', 'em', 'sub', 'sup', 'u', 'strike',
  'span', 'mark', 'code', 's', 'ul', 'ol', 'table', 'tr', 'blockquote', 'img', 'br', 'font', 'figure', 'aside',
];

const SYN_TRUE_HEAVY: TagMap = {
  ...Object.fromEntries(FUZZ_TAGS.map((tag) => [tag, true])),
  script: true,
  style: true,
  svg: true,
};

const SYN_EMPTY_OBJECTS: TagMap = Object.fromEntries(FUZZ_TAGS.map((tag) => [tag, {}]));

const SYN_FALSE_TAGS: TagMap = {
  p: false,
  b: false,
  span: false,
  li: false,
  td: false,
  div: {},
  i: {},
  ul: {},
  a: { href: true },
};

const SYN_ATTR_TRUE: TagMap = {
  a: { href: true, title: true, target: true },
  p: { class: true, id: true },
  img: { src: true, alt: true },
  td: { colspan: true },
  span: { style: true, 'data-x': true },
  div: { class: true },
  li: { 'aria-level': true },
  b: {},
};

const SYN_ATTR_STRING: TagMap = {
  a: { target: '_blank', rel: 'nofollow', href: true },
  p: { class: 'keep' },
  span: { 'data-x': '1' },
  input: { type: 'checkbox' },
  td: { colspan: '2' },
  b: {},
};

const SYN_ATTR_FALSE: TagMap = {
  p: { class: false, id: true },
  a: { href: true, onclick: false, title: false },
  span: { style: false, class: true },
  b: {},
};

const SYN_ATTR_VALIDATOR: TagMap = {
  a: { href: (value) => value.startsWith('http'), title: true },
  img: { src: true, width: (_value, node) => node.hasAttribute('height'), height: (value) => /^\d+$/.test(value) },
  td: { colspan: (value) => /^\d+$/.test(value) },
  span: { style: (value, node) => value.includes('color') && node.parentElement !== null },
  p: { class: (value) => value === 'keep' },
  b: {},
};

const SYN_FUNCTION_RULES: TagMap = {
  p: (node) => (node.hasAttribute('class') ? { class: true } : true),
  b: (node) => node.textContent !== '',
  span: (node) => (node.hasAttribute('style') ? { style: true } : undefined),
  a: (node) => ((node.getAttribute('href') ?? '').startsWith('javascript:') ? false : { href: true }),
  div: () => ({}),
  li: (node) => node.childElementCount > 0,
  i: () => undefined,
  mark: (node) => {
    // Mutates the node, like Blok's colour rules.
    node.removeAttribute('class');

    return { style: true };
  },
};

const SYN_FUNCTION_NULL: TagMap = {
  p: () => null,
  b: {},
  span: () => null,
};

const SYN_UPPERCASE_KEYS: TagMap = {
  P: {},
  B: true,
  A: { HREF: true },
  p: { CLASS: true, id: true },
  b: {},
};

const SYN_BR_TRUE: TagMap = { br: true };

const SYN_SCRIPT_KEPT: TagMap = {
  script: {},
  style: {},
  template: {},
  noscript: {},
  p: {},
  b: {},
};

/* ------------------------------------------------------------------ */
/* Exports                                                             */
/* ------------------------------------------------------------------ */

export const GOLDEN_CONFIGS: Record<string, TagMap> = {
  // field rule `false` -> clean(x, {}) (src/components/utils/sanitizer.ts:105 via sanitize-walk.ts:215)
  'blok:empty': {},
  // src/shared/inline-text-sanitize.ts:84 raw, through clean(): table-subsystems.ts:1158, toggle/index.ts:222
  'blok:inline-text': viaClean(INLINE_TEXT_SANITIZE),
  // header/list/toggle/quote `text` on save: composeFieldSanitize (block.ts:577) then cloneSanitizerConfig (sanitizer.ts:152)
  'blok:inline-text-saved': viaClean(cloneTags(composeWithInlineBase(INLINE_TEXT_SANITIZE))),
  // paragraph `text` on save: blocks.ts:8 composed (block.ts:577) and cloned (sanitizer.ts:152)
  'blok:paragraph-text-saved': viaClean(cloneTags(composeWithInlineBase(PARAGRAPH_TEXT))),
  // paragraph `text` on convert/merge: block-mutation.ts:150 (raw compose, no clone)
  'blok:paragraph-text-import': viaClean(composeWithInlineBase(PARAGRAPH_TEXT)),
  // table `content` on save: blocks.ts:204 composed (block.ts:577) and cloned (sanitizer.ts:152)
  'blok:table-content-saved': viaClean(cloneTags(composeWithInlineBase(TABLE_CONTENT))),
  // src/components/utils/data-model-transform.ts:173, clean at :183
  'blok:legacy-cell': viaClean({ ...INLINE_TEXT_SANITIZE, ...CELL_BLOCK_TAGS_SANITIZE }),
  // src/tools/table/table-cell-clipboard.ts:450, clean at :911
  'blok:cell-clipboard': viaClean(CELL_SANITIZE_CONFIG),
  // src/tools/table/table-cell-clipboard.ts:479, clean at :558
  'blok:pasted-cell': viaClean(PASTED_CELL_SANITIZE_CONFIG),
  // src/components/modules/blockSelection.ts:129, clean at :670 / :753
  'blok:block-selection': viaClean(BLOCK_SELECTION),
  // src/components/modules/paste/index.ts:312-332 with every built-in tool and the default empty global sanitizer, clean at :345
  'blok:paste-first-pass': viaClean({
    ...Object.fromEntries(SAFE_STRUCTURAL_TAGS.map((tag) => [tag, {}])),
    ...TOOLS_PASTE_TAGS,
    ...INLINE_TOOLS_BASE,
    a: preservePageReferenceAnchor,
    br: {},
  }),
  // src/components/modules/paste/handlers/html-handler.ts:237 for a paragraph `<p>`, clean at :617
  'blok:paste-handler-paragraph': viaClean({ a: preservePageReferenceAnchor, p: {}, ...INLINE_TOOLS_BASE, br: {} }),
  // html-handler.ts:237 for a list `<li>` (structural li from paste/constants.ts:55, tool tags from list/static-configs.ts:30)
  'blok:paste-handler-list': viaClean({
    a: preservePageReferenceAnchor,
    li: STRUCTURAL_LI,
    ul: {},
    ol: {},
    input: { type: true, checked: true },
    ...INLINE_TOOLS_BASE,
    br: {},
  }),
  // html-handler.ts:237 for a `<table>` + sanitizeTable (paste/sanitizer-config.ts:103), clean at :108
  'blok:paste-handler-table': viaClean({
    a: preservePageReferenceAnchor,
    table: { 'data-blok-columns-candidate': true, dir: true },
    thead: {},
    tbody: {},
    tfoot: {},
    tr: {},
    th: { style: true, colspan: true, rowspan: true, align: true, valign: true, bgcolor: true },
    td: { style: true, colspan: true, rowspan: true, align: true, valign: true, bgcolor: true },
    ul: {},
    ol: {},
    li: STRUCTURAL_LI,
    ...INLINE_TOOLS_BASE,
    br: {},
    img: { src: true, alt: true, width: true, height: true },
    input: { type: true, checked: true },
  }),
  // src/components/modules/paste/handlers/base.ts:436-444 (caret insert into a text block)
  'blok:paste-caret-insert': viaClean({ ...INLINE_TOOLS_BASE, a: protectPageReferenceAnchor(preservePageReferenceAnchor), br: {} }),
  // src/tools/link/mention/mention.ts:83 (exported, no src caller)
  'blok:mention': {
    a: { href: true, class: true, target: true, rel: true },
    img: { src: true, class: true, alt: true },
    span: { class: true },
  },
  // src/components/marks/mark-engine.ts:922 for the example spec above
  'blok:mark-spec': { span: markSpecRule, font: markSpecRule },

  // html-janitor test/janitor.spec.js:6-49
  'upstream:spec': UPSTREAM_SPEC,
  // html-janitor test/janitor.spec.js t22 (with keepNestedBlockElements)
  'upstream:div': { div: {} },

  // probes (scratch harvest-janitor/probes.json); one map per distinct probe config
  'probe:figure-false': { figure: false, p: {} },
  'probe:span-true': { span: true },
  'probe:empty': {},
  'probe:p-class-false': { p: { class: false } },
  'probe:p-bar-baz': { p: { bar: 'baz' } },
  'probe:p-datax-camel': { p: { DataX: true } },
  'probe:p-upper': { P: {} },
  'probe:p': { p: {} },
  'probe:script': { script: {} },
  'probe:b-span-p': { b: {}, span: {}, p: {} },
  'probe:b-p': { b: {}, p: {} },
  'probe:div-p': { div: {}, p: {} },
  'probe:div': { div: {} },
  'probe:table-p': { table: {}, tbody: {}, tr: {}, td: {}, p: {} },
  'probe:div-pre': { div: {}, pre: {} },
  'probe:blockquote-p': { blockquote: {}, p: {} },
  'probe:ul-li': { ul: {}, li: {} },
  'probe:b': { b: {} },
  'probe:span': { span: {} },
  'probe:u-nonempty': { u: (el) => el.innerHTML !== '' },
  // A rule that returns undefined.
  'probe:p-fn-undefined': { p: () => {} },
  'probe:p-validators': { p: { a: (v, n) => v === '1' && n.nodeName === 'P', b: (v) => v === 'x' } },
  'probe:i-fn': { i: () => ({ 'data-n': true }) },
  'probe:a-href': { a: { href: true } },
  'probe:p-c': { p: { c: true } },
  'probe:tr-td': { tr: {}, td: {} },
  'probe:img-src': { img: { src: true } },

  // synthetic, one per rule kind
  'syn:true-heavy': SYN_TRUE_HEAVY,
  'syn:empty-objects': SYN_EMPTY_OBJECTS,
  'syn:false-tags': SYN_FALSE_TAGS,
  'syn:attr-true': SYN_ATTR_TRUE,
  'syn:attr-string': SYN_ATTR_STRING,
  'syn:attr-false': SYN_ATTR_FALSE,
  'syn:attr-validator': SYN_ATTR_VALIDATOR,
  'syn:function-rules': SYN_FUNCTION_RULES,
  'syn:function-null': SYN_FUNCTION_NULL,
  'syn:uppercase-keys': SYN_UPPERCASE_KEYS,
  'syn:br-true': SYN_BR_TRUE,
  'syn:script-kept': SYN_SCRIPT_KEPT,
};

/**
 * Configs outside the TagMap shape: the engine either throws on them or reads
 * them in odd ways. Each value is passed AS `tags` (undefined = no `tags` key).
 * Keys never collide with GOLDEN_CONFIGS.
 */
export const GOLDEN_ODD_CONFIGS: Record<string, unknown> = {
  // html-janitor test/janitor.spec.js t23
  'odd:upstream-number': { strong: 53 },
  'odd:no-tags': undefined,
  'odd:p-null': { p: null },
  'odd:p-string': { p: 'yes' },
  'odd:attr-number': { p: { a: 1 } },
  'odd:attr-zero': { p: { a: 0 } },
  'odd:attr-null': { p: { a: null } },
  'odd:attr-object': { p: { a: {} } },
  'odd:fn-returns-string': { p: () => 'abc' },
};
